export const COLLAB_GATE_SCENARIOS = [
  'collab-channel-v1',
  'collab-channel-v2',
  'collab-channel-v3',
];

const BASE_STEP_IDS = [
  'foundation-preflight',
  'collab-target-ready',
  'human-request-sent',
  'human-request-persisted',
  'architect-delivered',
  'architect-delegated',
  'worker-delivered',
  'worker-tool-evidence',
  'worker-artifact-verified',
  'worker-result-visible',
  'architect-final-visible',
];

const REVIEW_STEP_IDS = [
  'reviewer-delivered',
  'reviewer-validation-visible',
];

const TASK_STEP_IDS = [
  'task-created',
  'task-claimed-or-started',
  'task-review-visible',
  'task-source-linked',
];

const STEP_LABELS = {
  'foundation-preflight': 'Foundation preflight',
  'collab-target-ready': 'Collaboration target ready',
  'human-request-sent': 'Human request sent',
  'human-request-persisted': 'Human request persisted',
  'architect-delivered': 'Architect delivered',
  'architect-delegated': 'Architect delegated',
  'worker-delivered': 'Worker delivered',
  'worker-tool-evidence': 'Worker tool evidence',
  'worker-artifact-verified': 'Worker artifact verified',
  'worker-result-visible': 'Worker result visible',
  'architect-final-visible': 'Architect final visible',
  'reviewer-delivered': 'Reviewer delivered',
  'reviewer-validation-visible': 'Reviewer validation visible',
  'task-created': 'Task created',
  'task-claimed-or-started': 'Task claimed or started',
  'task-review-visible': 'Task review visible',
  'task-source-linked': 'Task source linked',
};

export function buildCollabGateReport(input = {}) {
  const scenario = normalizeScenario(input.scenario);
  const roles = normalizeRoles(input.roles);
  const channel = normalizeChannel(input.channel);
  const marker = stringOrNull(input.marker);
  const messages = normalizeMessages(input.messages);
  const toolEvidence = normalizeToolEvidence(input.toolEvidence);
  const artifactEvidence = normalizeArtifactEvidence(input.artifactEvidence);
  const reviewEvidence = normalizeReviewEvidence(input.reviewEvidence, messages.reviewerValidation);
  const taskEvidence = normalizeTaskEvidence(input.taskEvidence);
  const roleTimeline = normalizeRoleTimeline(input.roleTimeline, messages, roles);
  const warnings = buildWarnings(input);
  const normalized = {
    ...input,
    scenario,
    roles,
    channel,
    marker,
    messages,
    toolEvidence,
    artifactEvidence,
    reviewEvidence,
    taskEvidence,
    roleTimeline,
  };
  const failure = classifyCollabFailure(normalized);
  const steps = buildSteps(normalized, failure);
  const failedSteps = steps.filter((step) => step.status === 'failed');
  const ok = !failure && failedSteps.length === 0;
  const status = ok ? (warnings.length > 0 ? 'warning' : 'passed') : 'failed';

  return {
    scenario,
    runId: stringOrNull(input.runId) ?? `collab-gate-${Date.now()}`,
    traceId: stringOrNull(input.traceId) ?? null,
    status,
    ok,
    startedAt: stringOrNull(input.startedAt) ?? null,
    completedAt: stringOrNull(input.completedAt) ?? null,
    channel,
    marker,
    roles,
    messages,
    steps,
    roleTimeline,
    toolEvidence,
    artifactEvidence,
    reviewEvidence,
    taskEvidence,
    latency: input.latency ?? {},
    usage: normalizeObject(input.usage),
    context: normalizeObject(input.context),
    warnings,
    failure,
    summary: {
      total: steps.length,
      passed: steps.filter((step) => step.status === 'passed').length,
      failed: failedSteps.length,
      warning: steps.filter((step) => step.status === 'warning').length,
    },
  };
}

export function classifyCollabFailure(input = {}) {
  const scenario = normalizeScenario(input.scenario);
  const roles = normalizeRoles(input.roles);
  const channel = normalizeChannel(input.channel);
  const messages = normalizeMessages(input.messages);
  const toolEvidence = normalizeToolEvidence(input.toolEvidence);
  const artifactEvidence = normalizeArtifactEvidence(input.artifactEvidence);
  const reviewEvidence = normalizeReviewEvidence(input.reviewEvidence, messages.reviewerValidation);
  const taskEvidence = normalizeTaskEvidence(input.taskEvidence);
  const roleTimeline = normalizeRoleTimeline(input.roleTimeline, messages, roles);
  const marker = stringOrNull(input.marker);

  if (!input.foundation?.ok) {
    return failure('foundation', 'RUNTIME_NOT_RUNNING', 'Foundation readiness is missing or failed.');
  }
  if (!channel.id || !channel.replyTarget) {
    return failure('target', 'COLLAB_AUDIENCE_INCOMPLETE', 'Collaboration channel target is incomplete.');
  }
  if (!roles.rolePolicy || !roles.humanMemberId || !roles.architectAgentId || !roles.workerAgentId) {
    return failure('roles', 'COLLAB_ROLE_POLICY_AMBIGUOUS', 'Required role mapping is incomplete.');
  }
  const requiredVisible = requiredVisibleAgentIds(scenario, roles);
  if (!requiredVisible.every((agentId) => roles.visibleAgentIds.includes(agentId))) {
    return failure('roles', 'COLLAB_AUDIENCE_INCOMPLETE', 'Required role agents are not visible in the channel.');
  }
  const duplicate = findDuplicateRoleAction(roleTimeline);
  if (duplicate) {
    return failure('roles', 'DUPLICATE_ROLE_ACTION', `Duplicate ${duplicate.role}:${duplicate.action} action.`);
  }
  const wrongAgent = findWrongAgentAction(messages, roles);
  if (wrongAgent) {
    return failure('roles', 'WRONG_AGENT_ACTION', `${wrongAgent.role} action was authored by ${wrongAgent.authorId}.`);
  }
  const scopeLeak = findScopeLeak(messages, channel.id);
  if (scopeLeak) {
    return failure('target', 'TARGET_SCOPE_LEAK', `Message ${scopeLeak.id} landed outside the expected channel.`);
  }
  if (!messageReady(messages.humanRequest, marker)) {
    return failure('human', 'HUMAN_REQUEST_MISSING', 'Human marker request is missing.');
  }
  if (!input.delivery?.architectDelivered) {
    return failure('architect', 'ARCHITECT_DELEGATION_MISSING', 'Architect did not receive/start the request.');
  }
  if (!messageReady(messages.architectDelegation, marker)) {
    return failure('architect', 'ARCHITECT_DELEGATION_MISSING', 'Architect delegation message is missing.');
  }
  if (!input.delivery?.workerDelivered) {
    return failure('worker', 'WORKER_DELIVERY_MISSING', 'Worker did not receive/start delegated work.');
  }
  if (!toolEvidence.some((tool) => tool.ok !== false && (!tool.agentId || tool.agentId === roles.workerAgentId))) {
    return failure('worker', 'WORKER_TOOL_EVIDENCE_MISSING', 'Worker tool execution evidence is missing.');
  }
  if (artifactEvidence.ok !== true || (marker && artifactEvidence.marker && artifactEvidence.marker !== marker)) {
    return failure('artifact', 'ARTIFACT_VERIFICATION_FAILED', 'Worker artifact proof did not verify.');
  }
  if (!messageReady(messages.workerResult, marker)) {
    return failure('worker', 'WORKER_RESULT_MISSING', 'Worker result message is missing.');
  }
  if (scenario === 'collab-channel-v2') {
    const reviewFailure = classifyReviewFailure({ roles, messages, reviewEvidence, marker, delivery: input.delivery });
    if (reviewFailure) return reviewFailure;
  }
  if (scenario === 'collab-channel-v3') {
    const taskFailure = classifyTaskFailure({ roles, channel, messages, taskEvidence });
    if (taskFailure) return taskFailure;
  }
  if (!messageReady(messages.architectFinal, marker) || !finalMatchesEvidence({
    scenario,
    marker,
    messages,
    artifactEvidence,
    reviewEvidence,
    taskEvidence,
  })) {
    return failure('final', 'FINAL_RESULT_MISMATCH', 'Architect final summary does not cite required evidence.');
  }
  return null;
}

export function formatCollabGateSummary(report) {
  const scenario = report?.scenario ?? 'collab-channel';
  const total = report?.summary?.total ?? 0;
  const passed = report?.summary?.passed ?? 0;
  if (report?.ok) {
    return `PASS ${scenario} ${passed}/${total}`;
  }
  const failedStep = Array.isArray(report?.steps)
    ? report.steps.find((step) => step.status === 'failed')
    : null;
  const code = report?.failure?.code ?? 'UNKNOWN';
  return `FAIL ${scenario} ${passed}/${total} ${code}:${failedStep?.id ?? 'unknown-step'}`;
}

function buildSteps(input, collabFailure) {
  const ids = stepIdsForScenario(input.scenario);
  return ids.map((id) => {
    const failed = failingStepForCode(collabFailure?.code) === id;
    if (failed) return step(id, 'failed', collabFailure);
    return step(id, stepPassed(id, input) ? 'passed' : 'pending');
  });
}

function stepPassed(id, input) {
  switch (id) {
    case 'foundation-preflight':
      return input.foundation?.ok === true;
    case 'collab-target-ready':
      return Boolean(input.channel.id && input.channel.replyTarget && input.roles.rolePolicy);
    case 'human-request-sent':
    case 'human-request-persisted':
      return messageReady(input.messages.humanRequest, input.marker);
    case 'architect-delivered':
      return input.delivery?.architectDelivered === true;
    case 'architect-delegated':
      return messageReady(input.messages.architectDelegation, input.marker)
        && input.messages.architectDelegation.authorId === input.roles.architectAgentId;
    case 'worker-delivered':
      return input.delivery?.workerDelivered === true;
    case 'worker-tool-evidence':
      return input.toolEvidence.some((tool) => tool.ok !== false && (!tool.agentId || tool.agentId === input.roles.workerAgentId));
    case 'worker-artifact-verified':
      return input.artifactEvidence.ok === true;
    case 'worker-result-visible':
      return messageReady(input.messages.workerResult, input.marker)
        && input.messages.workerResult.authorId === input.roles.workerAgentId;
    case 'architect-final-visible':
      return messageReady(input.messages.architectFinal, input.marker)
        && input.messages.architectFinal.authorId === input.roles.architectAgentId
        && finalMatchesEvidence(input);
    case 'reviewer-delivered':
      return input.delivery?.reviewerDelivered === true;
    case 'reviewer-validation-visible':
      return input.reviewEvidence.accepted === true
        && messageReady(input.messages.reviewerValidation, input.marker)
        && input.messages.reviewerValidation.authorId === input.roles.reviewerAgentId;
    case 'task-created':
      return Boolean(input.taskEvidence.taskId);
    case 'task-claimed-or-started':
      return Boolean(input.taskEvidence.taskId && input.taskEvidence.assigneeId === input.roles.workerAgentId && ['in_progress', 'in_review', 'done'].includes(input.taskEvidence.status));
    case 'task-review-visible':
      return input.taskEvidence.reviewVisible === true;
    case 'task-source-linked':
      return input.taskEvidence.sourceChannelId === input.channel.id
        && input.taskEvidence.sourceMessageId === input.messages.humanRequest?.id;
    default:
      return false;
  }
}

function step(id, status, stepFailure = null) {
  return {
    id,
    label: STEP_LABELS[id] ?? id,
    status,
    evidence: { source: id },
    ...(stepFailure ? { failure: stepFailure, failureCode: stepFailure.code } : {}),
  };
}

function stepIdsForScenario(scenario) {
  if (scenario === 'collab-channel-v2') return [...BASE_STEP_IDS, ...REVIEW_STEP_IDS];
  if (scenario === 'collab-channel-v3') return [...BASE_STEP_IDS, ...TASK_STEP_IDS];
  return BASE_STEP_IDS;
}

function failingStepForCode(code) {
  switch (code) {
    case 'RUNTIME_NOT_RUNNING':
      return 'foundation-preflight';
    case 'COLLAB_AUDIENCE_INCOMPLETE':
    case 'COLLAB_ROLE_POLICY_AMBIGUOUS':
    case 'TARGET_SCOPE_LEAK':
      return 'collab-target-ready';
    case 'HUMAN_REQUEST_MISSING':
      return 'human-request-persisted';
    case 'ARCHITECT_DELEGATION_MISSING':
      return 'architect-delegated';
    case 'WORKER_DELIVERY_MISSING':
      return 'worker-delivered';
    case 'WORKER_TOOL_EVIDENCE_MISSING':
      return 'worker-tool-evidence';
    case 'ARTIFACT_VERIFICATION_FAILED':
      return 'worker-artifact-verified';
    case 'WORKER_RESULT_MISSING':
    case 'WRONG_AGENT_ACTION':
    case 'DUPLICATE_ROLE_ACTION':
      return 'worker-result-visible';
    case 'REVIEWER_VALIDATION_MISSING':
    case 'REVIEWER_REJECTED_RESULT':
      return 'reviewer-validation-visible';
    case 'TASK_WORKFLOW_MISSING':
    case 'TASK_WORKFLOW_STATE_MISMATCH':
      return 'task-source-linked';
    case 'ARCHITECT_FINAL_MISSING':
    case 'FINAL_RESULT_MISMATCH':
      return 'architect-final-visible';
    default:
      return code ? 'foundation-preflight' : null;
  }
}

function classifyReviewFailure({ roles, messages, reviewEvidence, marker, delivery }) {
  if (!roles.reviewerAgentId || !roles.visibleAgentIds.includes(roles.reviewerAgentId)) {
    return failure('roles', 'COLLAB_AUDIENCE_INCOMPLETE', 'Reviewer role is missing from channel audience.');
  }
  if (!delivery?.reviewerDelivered) {
    return failure('review', 'REVIEWER_VALIDATION_MISSING', 'Reviewer did not receive validation work.');
  }
  if (!messageReady(messages.reviewerValidation, marker)) {
    return failure('review', 'REVIEWER_VALIDATION_MISSING', 'Reviewer validation message is missing.');
  }
  if (messages.reviewerValidation.authorId !== roles.reviewerAgentId) {
    return failure('roles', 'WRONG_AGENT_ACTION', 'Reviewer validation was authored by the wrong agent.');
  }
  if (reviewEvidence.accepted === false) {
    return failure('review', 'REVIEWER_REJECTED_RESULT', 'Reviewer rejected the worker result.');
  }
  if (reviewEvidence.accepted !== true) {
    return failure('review', 'REVIEWER_VALIDATION_MISSING', 'Reviewer acceptance evidence is missing.');
  }
  return null;
}

function classifyTaskFailure({ roles, channel, messages, taskEvidence }) {
  if (!taskEvidence.taskId) {
    return failure('task', 'TASK_WORKFLOW_MISSING', 'Task workflow evidence is missing.');
  }
  const stateOk = taskEvidence.ok === true
    && taskEvidence.assigneeId === roles.workerAgentId
    && taskEvidence.sourceChannelId === channel.id
    && taskEvidence.sourceMessageId === messages.humanRequest?.id
    && taskEvidence.reviewVisible === true
    && ['in_progress', 'in_review', 'done'].includes(taskEvidence.status);
  if (!stateOk) {
    return failure('task', 'TASK_WORKFLOW_STATE_MISMATCH', 'Task workflow state does not match expected collaboration flow.');
  }
  return null;
}

function finalMatchesEvidence({ scenario, marker, messages, artifactEvidence, reviewEvidence, taskEvidence }) {
  const content = String(messages.architectFinal?.content ?? '');
  if (marker && !content.includes(marker)) return false;
  if (artifactEvidence.artifactId && !content.includes(artifactEvidence.artifactId)) return false;
  if (artifactEvidence.checksum && !content.includes(artifactEvidence.checksum)) return false;
  if (scenario === 'collab-channel-v2' && reviewEvidence.accepted === true && !/review|accepted|验证|通过/i.test(content)) return false;
  if (scenario === 'collab-channel-v3') {
    if (taskEvidence.taskId && !content.includes(taskEvidence.taskId)) return false;
    if (taskEvidence.status && !content.includes(taskEvidence.status)) return false;
  }
  return true;
}

function findDuplicateRoleAction(roleTimeline) {
  const seen = new Set();
  for (const item of roleTimeline) {
    if (!item.role || !item.action) continue;
    const key = `${item.role}:${item.action}`;
    if (seen.has(key)) return item;
    seen.add(key);
  }
  return null;
}

function findWrongAgentAction(messages, roles) {
  const checks = [
    ['architect', 'delegation', messages.architectDelegation, roles.architectAgentId],
    ['worker', 'result', messages.workerResult, roles.workerAgentId],
    ['reviewer', 'validation', messages.reviewerValidation, roles.reviewerAgentId],
    ['architect', 'final', messages.architectFinal, roles.architectAgentId],
  ];
  for (const [role, action, item, expected] of checks) {
    if (!item || !expected) continue;
    if (item.authorId !== expected) return { role, action, authorId: item.authorId, expected };
  }
  return null;
}

function findScopeLeak(messages, channelId) {
  for (const item of Object.values(messages)) {
    if (!item) continue;
    if (item.targetId !== channelId) return item;
  }
  return null;
}

function requiredVisibleAgentIds(scenario, roles) {
  const required = [roles.architectAgentId, roles.workerAgentId].filter(Boolean);
  if (scenario === 'collab-channel-v2' && roles.reviewerAgentId) required.push(roles.reviewerAgentId);
  return required;
}

function messageReady(item, marker) {
  if (!item || item.visible !== true || !item.id) return false;
  return marker ? String(item.content ?? '').includes(marker) : true;
}

function normalizeScenario(scenario) {
  return COLLAB_GATE_SCENARIOS.includes(scenario) ? scenario : 'collab-channel-v1';
}

function normalizeRoles(roles) {
  const value = normalizeObject(roles) ?? {};
  return {
    humanMemberId: stringOrNull(value.humanMemberId),
    architectAgentId: stringOrNull(value.architectAgentId),
    workerAgentId: stringOrNull(value.workerAgentId),
    reviewerAgentId: stringOrNull(value.reviewerAgentId),
    visibleAgentIds: arrayOfStrings(value.visibleAgentIds),
    rolePolicy: stringOrNull(value.rolePolicy),
  };
}

function normalizeChannel(channel) {
  const value = normalizeObject(channel) ?? {};
  return {
    id: stringOrNull(value.id ?? value.channelId),
    name: stringOrNull(value.name ?? value.channelName),
    replyTarget: stringOrNull(value.replyTarget),
  };
}

function normalizeMessages(messages) {
  const value = normalizeObject(messages) ?? {};
  return {
    humanRequest: normalizeMessage(value.humanRequest),
    architectDelegation: normalizeMessage(value.architectDelegation),
    workerResult: normalizeMessage(value.workerResult),
    reviewerValidation: normalizeMessage(value.reviewerValidation),
    architectFinal: normalizeMessage(value.architectFinal),
  };
}

function normalizeMessage(item) {
  if (!item || typeof item !== 'object') return null;
  return {
    id: stringOrNull(item.id),
    authorId: stringOrNull(item.authorId ?? item.senderId),
    targetId: stringOrNull(item.targetId ?? item.channelId),
    content: String(item.content ?? ''),
    createdAt: stringOrNull(item.createdAt ?? item.time),
    visible: item.visible === true,
    raw: item,
  };
}

function normalizeToolEvidence(toolEvidence) {
  if (!Array.isArray(toolEvidence)) return [];
  return toolEvidence.map((tool) => ({
    agentId: stringOrNull(tool.agentId ?? tool.authorId),
    toolName: stringOrNull(tool.toolName ?? tool.name),
    commandPreview: stringOrNull(tool.commandPreview ?? tool.command),
    ok: tool.ok,
    raw: tool,
  }));
}

function normalizeArtifactEvidence(artifactEvidence) {
  const value = normalizeObject(artifactEvidence) ?? {};
  return {
    ok: value.ok === true,
    artifactId: stringOrNull(value.artifactId),
    checksum: stringOrNull(value.checksum),
    marker: stringOrNull(value.marker),
    workerAgentId: stringOrNull(value.workerAgentId),
    raw: value,
  };
}

function normalizeReviewEvidence(reviewEvidence, reviewerMessage) {
  const value = normalizeObject(reviewEvidence) ?? {};
  const content = String(reviewerMessage?.content ?? '');
  const inferredAccepted = /\b(REVIEWER_ACCEPTED|accepted|pass|通过)\b/i.test(content)
    ? true
    : /\b(REVIEWER_REJECTED|rejected|fail|拒绝)\b/i.test(content)
      ? false
      : undefined;
  return {
    accepted: typeof value.accepted === 'boolean' ? value.accepted : inferredAccepted,
    reviewerAgentId: stringOrNull(value.reviewerAgentId ?? reviewerMessage?.authorId),
    messageId: stringOrNull(value.messageId ?? reviewerMessage?.id),
    raw: value,
  };
}

function normalizeTaskEvidence(taskEvidence) {
  const value = normalizeObject(taskEvidence) ?? {};
  return {
    ok: value.ok === true,
    taskId: stringOrNull(value.taskId ?? value.id),
    status: stringOrNull(value.status),
    assigneeId: stringOrNull(value.assigneeId),
    sourceChannelId: stringOrNull(value.sourceChannelId ?? value.channelId),
    sourceMessageId: stringOrNull(value.sourceMessageId ?? value.messageId),
    reviewVisible: value.reviewVisible === true,
    raw: value,
  };
}

function normalizeRoleTimeline(roleTimeline, messages, roles) {
  if (Array.isArray(roleTimeline)) {
    return roleTimeline.map((item) => ({
      role: stringOrNull(item.role),
      action: stringOrNull(item.action),
      messageId: stringOrNull(item.messageId),
      agentId: stringOrNull(item.agentId),
      at: stringOrNull(item.at),
      raw: item,
    }));
  }
  const derived = [];
  if (messages.humanRequest) derived.push({ role: 'human', action: 'request', messageId: messages.humanRequest.id, agentId: roles.humanMemberId, at: messages.humanRequest.createdAt });
  if (messages.architectDelegation) derived.push({ role: 'architect', action: 'delegation', messageId: messages.architectDelegation.id, agentId: messages.architectDelegation.authorId, at: messages.architectDelegation.createdAt });
  if (messages.workerResult) derived.push({ role: 'worker', action: 'result', messageId: messages.workerResult.id, agentId: messages.workerResult.authorId, at: messages.workerResult.createdAt });
  if (messages.reviewerValidation) derived.push({ role: 'reviewer', action: 'validation', messageId: messages.reviewerValidation.id, agentId: messages.reviewerValidation.authorId, at: messages.reviewerValidation.createdAt });
  if (messages.architectFinal) derived.push({ role: 'architect', action: 'final', messageId: messages.architectFinal.id, agentId: messages.architectFinal.authorId, at: messages.architectFinal.createdAt });
  return derived;
}

function buildWarnings(input) {
  const warnings = [];
  if (!input.usage) {
    warnings.push({
      category: 'usage',
      code: 'TOKEN_USAGE_MISSING',
      message: 'Run-specific token usage evidence is missing.',
    });
  }
  if (!input.context) {
    warnings.push({
      category: 'context',
      code: 'CONTEXT_EVIDENCE_MISSING',
      message: 'Context evidence is missing.',
    });
  }
  return warnings;
}

function failure(category, code, message) {
  return { category, code, message };
}

function normalizeObject(value) {
  return value && typeof value === 'object' ? value : null;
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}
