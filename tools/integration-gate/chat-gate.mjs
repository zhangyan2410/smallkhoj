import { classifyLimitFailure } from './foundation-gate.mjs';

export const CHAT_GATE_SCENARIOS = [
  'chat-reply-channel-base',
  'chat-reply-channel-group',
  'chat-reply-dm',
];

export const CHAT_GATE_STEP_IDS = [
  'foundation-preflight',
  'chat-target-ready',
  'user-message-sent',
  'user-message-persisted',
  'runtime-delivered',
  'provider-thinking',
  'tool-output',
  'slock-send-observed',
  'runtime-idle',
  'reply-persisted',
  'reply-visible',
];

const STEP_LABELS = {
  'foundation-preflight': 'Foundation preflight',
  'chat-target-ready': 'Chat target ready',
  'user-message-sent': 'User message sent',
  'user-message-persisted': 'User message persisted',
  'runtime-delivered': 'Runtime delivered',
  'provider-thinking': 'Provider thinking',
  'tool-output': 'Tool output',
  'slock-send-observed': 'Slock send observed',
  'runtime-idle': 'Runtime idle',
  'reply-persisted': 'Reply persisted',
  'reply-visible': 'Reply visible',
};

export function buildChatGateReport(input = {}) {
  const scenario = normalizeScenario(input.scenario);
  const target = normalizeTarget(input.target, scenario);
  const marker = stringOrNull(input.marker);
  const expectedAck = stringOrNull(input.expectedAck) ?? marker;
  const messages = normalizeMessages(input.messages);
  const replies = messages.replies;
  const relevantReplies = replies.filter((reply) => isReplyForScenario(reply, target, scenario));
  const matchingReplies = relevantReplies.filter((reply) => replyMatchesAck(reply, expectedAck, marker));
  const selectedReply = matchingReplies[0] ?? relevantReplies[0] ?? null;
  const slockSendEvidence = normalizeToolEvidence(input.toolEvidence)
    .find((tool) => tool.isSlockMessageSend === true || isSlockMessageSendCommand(tool.commandPreview));
  const delivery = normalizeDelivery(input.delivery);
  const warnings = buildWarnings(input);
  const failure = classifyChatFailure({
    ...input,
    scenario,
    target,
    marker,
    expectedAck,
    messages: {
      ...messages,
      replies,
      selectedReply,
      relevantReplies,
      matchingReplies,
    },
    delivery,
    toolEvidence: normalizeToolEvidence(input.toolEvidence),
  });
  const steps = buildSteps({
    input,
    scenario,
    target,
    messages,
    delivery,
    slockSendEvidence,
    selectedReply,
    matchingReplies,
    failure,
  });
  const failedSteps = steps.filter((step) => step.status === 'failed');
  const ok = !failure && failedSteps.length === 0;
  const status = ok ? (warnings.length > 0 ? 'warning' : 'passed') : 'failed';

  return {
    scenario,
    runId: stringOrNull(input.runId) ?? `chat-gate-${Date.now()}`,
    traceId: stringOrNull(input.traceId) ?? null,
    status,
    ok,
    startedAt: stringOrNull(input.startedAt) ?? null,
    completedAt: stringOrNull(input.completedAt) ?? null,
    agentId: stringOrNull(input.agent?.id ?? input.agentId) ?? null,
    agentName: stringOrNull(input.agent?.name ?? input.agentName) ?? null,
    computerId: stringOrNull(input.agent?.computerId ?? input.computerId) ?? null,
    daemonId: stringOrNull(input.agent?.daemonId ?? input.daemonId) ?? null,
    runtimeProvider: stringOrNull(input.agent?.runtimeProvider ?? input.runtimeProvider) ?? null,
    runtimeModel: stringOrNull(input.agent?.runtimeModel ?? input.runtimeModel) ?? null,
    runtimeKind: stringOrNull(input.agent?.runtimeKind ?? input.runtimeKind) ?? null,
    sessionId: stringOrNull(input.agent?.sessionId ?? input.sessionId) ?? null,
    agent: input.agent ?? null,
    target,
    marker,
    expectedAck,
    messages: {
      userMessageId: messages.userMessageId,
      replyMessageId: selectedReply?.id ?? null,
      replies,
    },
    userMessageId: messages.userMessageId,
    replyMessageId: selectedReply?.id ?? null,
    steps,
    latency: input.latency ?? {},
    usage: normalizeUsage(input.usage),
    context: normalizeContext(input.context),
    runtimeTimeline: Array.isArray(delivery.timeline) ? delivery.timeline : [],
    toolEvidence: normalizeToolEvidence(input.toolEvidence),
    replyEvidence: buildReplyEvidence({ selectedReply, matchingReplies, target, expectedAck, marker, scenario }),
    audienceEvidence: buildAudienceEvidence(target, replies),
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

export function isSlockMessageSendCommand(commandPreview) {
  return /(?:^|[\s"'`])(?:\S*\/)?slock(?:\.(?:cmd|ps1))?\s+message\s+send\b/i.test(String(commandPreview ?? ''));
}

export function classifyChatFailure(input = {}) {
  const scenario = normalizeScenario(input.scenario);
  const target = normalizeTarget(input.target, scenario);
  const messages = normalizeMessages(input.messages);
  const delivery = normalizeDelivery(input.delivery);
  const tools = normalizeToolEvidence(input.toolEvidence);
  const expectedAck = stringOrNull(input.expectedAck) ?? stringOrNull(input.marker);
  const marker = stringOrNull(input.marker);
  const limitFailure = findLimitFailure(input);
  if (limitFailure) return limitFailure;

  if (!input.foundation?.ok) {
    return failure('foundation', 'RUNTIME_NOT_RUNNING', 'Foundation readiness is missing or failed.');
  }
  if (!targetReady(target, scenario)) {
    return scenario === 'chat-reply-dm'
      ? failure('dm_target', 'DM_TARGET_RESOLUTION_FAILED', 'DM target could not be resolved.')
      : failure('chat_target', 'CHAT_MESSAGE_SEND_FAILED', 'Chat target is not ready.');
  }
  if (scenario === 'chat-reply-channel-group') {
    const groupFailure = classifyChannelGroupFailure(target, messages.replies);
    if (groupFailure) return groupFailure;
  }
  if (!messages.userMessageId) {
    return failure('chat_send', 'CHAT_MESSAGE_SEND_FAILED', 'User marker message was not sent.');
  }
  if (input.eventCommitted === false || delivery.eventCommitted === false) {
    return failure('event_commit', 'CHAT_EVENT_COMMIT_MISSING', 'User message event commit evidence is missing.');
  }
  if (!delivery.delivered) {
    return failure('runtime_delivery', 'DAEMON_DELIVERY_MISSING', 'No daemon or runtime delivery evidence appeared.');
  }
  if (!delivery.providerThinking) {
    return failure('provider', 'RUNTIME_STUCK_BEFORE_THINKING', 'Runtime did not reach provider thinking.');
  }
  if (tools.length === 0 && delivery.runtimeIdle) {
    return failure('tool', 'TOOL_CALL_MISSING', 'Runtime completed without tool evidence.');
  }
  const slockSend = tools.find((tool) => tool.isSlockMessageSend === true || isSlockMessageSendCommand(tool.commandPreview));
  if (!slockSend) {
    return failure('tool', 'SLOCK_SEND_MISSING', 'No slock message send evidence was observed.');
  }
  if (slockSend.ok === false) {
    return failure('tool', 'SLOCK_SEND_FAILED', 'slock message send failed or returned no usable reply id.');
  }
  if (!delivery.runtimeIdle) {
    return failure('provider', 'PROVIDER_THINKING_TIMEOUT', 'Provider/runtime did not reach a terminal idle result.');
  }

  const relevantReplies = messages.replies.filter((reply) => isReplyForScenario(reply, target, scenario));
  if (messages.replies.length === 0 || relevantReplies.length === 0) {
    if (messages.replies.length === 0) {
      return failure('reply', 'AGENT_REPLY_MISSING', 'No agent-authored reply was persisted in the same target.');
    }
    return scenario === 'chat-reply-dm'
      ? failure('dm_target', 'DM_REPLY_TARGET_MISMATCH', 'DM reply appeared in the wrong peer conversation.')
      : failure('reply', 'REPLY_MARKER_MISMATCH', 'Reply was persisted in the wrong target.');
  }
  const matchingReplies = relevantReplies.filter((reply) => replyMatchesAck(reply, expectedAck, marker));
  if (matchingReplies.length === 0) {
    return scenario === 'chat-reply-dm' && target.kind === 'dm'
      ? failure('dm_target', 'DM_REPLY_TARGET_MISMATCH', 'DM reply target or marker did not match.')
      : failure('reply', 'REPLY_MARKER_MISMATCH', 'Reply was present but author, target, order, or marker did not match.');
  }
  if (!matchingReplies.some((reply) => reply.visible === true)) {
    return failure('visibility', 'REPLY_VISIBILITY_MISSING', 'Reply was persisted but not product-visible.');
  }
  return null;
}

export function formatChatGateSummary(report) {
  const total = report?.summary?.total ?? 0;
  const passed = report?.summary?.passed ?? 0;
  const scenario = report?.scenario ?? 'chat-reply';
  if (report?.ok) {
    return `PASS ${scenario} ${passed}/${total}`;
  }
  const failedStep = Array.isArray(report?.steps)
    ? report.steps.find((step) => step.status === 'failed')
    : null;
  const code = report?.failure?.code ?? 'UNKNOWN';
  const stepId = failedStep?.id ?? 'unknown-step';
  return `FAIL ${scenario} ${passed}/${total} ${code}:${stepId}`;
}

function buildSteps({
  input,
  scenario,
  target,
  messages,
  delivery,
  slockSendEvidence,
  selectedReply,
  matchingReplies,
  failure,
}) {
  return CHAT_GATE_STEP_IDS.map((id) => {
    const failed = failingStepForCode(failure?.code) === id;
    if (failed) {
      return step(id, 'failed', evidenceForStep(id), failure);
    }
    const status = stepPassed(id, {
      input,
      scenario,
      target,
      messages,
      delivery,
      slockSendEvidence,
      selectedReply,
      matchingReplies,
    }) ? 'passed' : 'pending';
    return step(id, status, evidenceForStep(id));
  });
}

function stepPassed(id, context) {
  const {
    input,
    scenario,
    target,
    messages,
    delivery,
    slockSendEvidence,
    selectedReply,
    matchingReplies,
  } = context;
  switch (id) {
    case 'foundation-preflight':
      return input.foundation?.ok === true;
    case 'chat-target-ready':
      return targetReady(target, scenario);
    case 'user-message-sent':
    case 'user-message-persisted':
      return Boolean(messages.userMessageId);
    case 'runtime-delivered':
      return delivery.delivered === true;
    case 'provider-thinking':
      return delivery.providerThinking === true;
    case 'tool-output':
      return normalizeToolEvidence(input.toolEvidence).length > 0;
    case 'slock-send-observed':
      return Boolean(slockSendEvidence);
    case 'runtime-idle':
      return delivery.runtimeIdle === true;
    case 'reply-persisted':
      return Boolean(selectedReply && matchingReplies.length > 0);
    case 'reply-visible':
      return matchingReplies.some((reply) => reply.visible === true);
    default:
      return false;
  }
}

function evidenceForStep(id) {
  return { source: id };
}

function step(id, status, evidence, stepFailure = null) {
  return {
    id,
    label: STEP_LABELS[id] ?? id,
    status,
    evidence,
    ...(stepFailure ? { failure: stepFailure, failureCode: stepFailure.code } : {}),
  };
}

function failingStepForCode(code) {
  switch (code) {
    case 'RUNTIME_NOT_RUNNING':
      return 'foundation-preflight';
    case 'DM_TARGET_RESOLUTION_FAILED':
    case 'CHANNEL_AUDIENCE_AMBIGUOUS':
    case 'CHAT_MESSAGE_SEND_FAILED':
      return 'chat-target-ready';
    case 'CHAT_EVENT_COMMIT_MISSING':
      return 'user-message-persisted';
    case 'DAEMON_DELIVERY_MISSING':
    case 'RUNTIME_DELIVERY_QUEUED_TIMEOUT':
      return 'runtime-delivered';
    case 'RUNTIME_STUCK_BEFORE_THINKING':
      return 'provider-thinking';
    case 'TOOL_CALL_MISSING':
      return 'tool-output';
    case 'SLOCK_SEND_MISSING':
    case 'SLOCK_SEND_FAILED':
      return 'slock-send-observed';
    case 'PROVIDER_THINKING_TIMEOUT':
      return 'runtime-idle';
    case 'AGENT_REPLY_MISSING':
    case 'REPLY_MARKER_MISMATCH':
    case 'CHANNEL_WRONG_AGENT_REPLY':
    case 'CHANNEL_EXPECTED_REPLY_MISSING':
    case 'CHANNEL_DUPLICATE_REPLY_POLICY_VIOLATION':
    case 'DM_REPLY_TARGET_MISMATCH':
      return 'reply-persisted';
    case 'REPLY_VISIBILITY_MISSING':
      return 'reply-visible';
    default:
      return code ? 'foundation-preflight' : null;
  }
}

function classifyChannelGroupFailure(target, replies) {
  const visibleAgentIds = arrayOfStrings(target.visibleAgentIds);
  const expectedResponderAgentIds = arrayOfStrings(target.expectedResponderAgentIds);
  if (visibleAgentIds.length < 2 || expectedResponderAgentIds.length === 0 || !target.responderPolicy) {
    return failure('channel_group', 'CHANNEL_AUDIENCE_AMBIGUOUS', 'Channel group audience or responder policy is ambiguous.');
  }

  const relevantReplies = replies.filter((reply) => reply.targetId === target.channelId);
  const replyAuthorIds = relevantReplies.map((reply) => reply.authorId).filter(Boolean);
  const wrongAuthor = replyAuthorIds.find((authorId) => !expectedResponderAgentIds.includes(authorId));
  if (wrongAuthor) {
    return failure('channel_group', 'CHANNEL_WRONG_AGENT_REPLY', `Unexpected channel responder: ${wrongAuthor}.`);
  }
  const missing = expectedResponderAgentIds.find((agentId) => !replyAuthorIds.includes(agentId));
  if (missing) {
    return failure('channel_group', 'CHANNEL_EXPECTED_REPLY_MISSING', `Expected channel responder missing: ${missing}.`);
  }
  if (target.responderPolicy === 'one') {
    if (relevantReplies.length !== 1 || new Set(replyAuthorIds).size !== 1) {
      return failure('channel_group', 'CHANNEL_DUPLICATE_REPLY_POLICY_VIOLATION', 'Channel one-responder policy was violated.');
    }
  }
  return null;
}

function findLimitFailure(input) {
  const candidates = [
    input.limitError,
    input.error,
    input.providerError,
    input.runtimeError,
    input.delivery?.error,
  ].filter(Boolean);
  if (input.limitFailure?.code && input.limitFailure?.category) return input.limitFailure;
  if (candidates.length === 0) return null;
  return classifyLimitFailure(candidates.join('\n'));
}

function targetReady(target, scenario) {
  if (scenario === 'chat-reply-dm') {
    return target.kind === 'dm' && Boolean(target.resolved !== false && target.dmId && target.userMemberId && target.agentMemberId);
  }
  if (scenario === 'chat-reply-channel-group') {
    return target.kind === 'channel-group' && Boolean(target.channelId && target.replyTarget);
  }
  return target.kind === 'channel' && Boolean(target.channelId && target.replyTarget);
}

function isReplyForScenario(reply, target, scenario) {
  if (!reply || typeof reply !== 'object') return false;
  if (scenario === 'chat-reply-dm') return reply.targetId === target.dmId;
  return reply.targetId === target.channelId;
}

function replyMatchesAck(reply, expectedAck, marker) {
  const content = String(reply?.content ?? '');
  const matchesAck = expectedAck ? content.includes(expectedAck) : true;
  const matchesMarker = marker ? content.includes(marker) : true;
  return matchesAck || matchesMarker;
}

function buildReplyEvidence({ selectedReply, matchingReplies, target, expectedAck, marker, scenario }) {
  return {
    replyMessageId: selectedReply?.id ?? null,
    authorId: selectedReply?.authorId ?? null,
    targetId: selectedReply?.targetId ?? null,
    expectedTargetId: scenario === 'chat-reply-dm' ? target.dmId ?? null : target.channelId ?? null,
    markerMatch: selectedReply ? replyMatchesAck(selectedReply, expectedAck, marker) : false,
    visible: matchingReplies.some((reply) => reply.visible === true),
    matchingReplyCount: matchingReplies.length,
  };
}

function buildAudienceEvidence(target, replies) {
  if (target.kind !== 'channel-group') return null;
  const byAuthor = {};
  for (const reply of replies) {
    if (!reply.authorId) continue;
    byAuthor[reply.authorId] = (byAuthor[reply.authorId] ?? 0) + 1;
  }
  return {
    visibleAgentIds: arrayOfStrings(target.visibleAgentIds),
    expectedResponderAgentIds: arrayOfStrings(target.expectedResponderAgentIds),
    responderPolicy: target.responderPolicy ?? null,
    repliesByAuthor: byAuthor,
  };
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

function normalizeScenario(scenario) {
  if (CHAT_GATE_SCENARIOS.includes(scenario)) return scenario;
  return 'chat-reply-channel-base';
}

function normalizeTarget(target, scenario) {
  const value = target && typeof target === 'object' ? target : {};
  const fallbackKind = scenario === 'chat-reply-dm'
    ? 'dm'
    : scenario === 'chat-reply-channel-group'
      ? 'channel-group'
      : 'channel';
  return {
    ...value,
    kind: value.kind ?? fallbackKind,
    visibleAgentIds: arrayOfStrings(value.visibleAgentIds),
    expectedResponderAgentIds: arrayOfStrings(value.expectedResponderAgentIds),
  };
}

function normalizeMessages(messages) {
  const value = messages && typeof messages === 'object' ? messages : {};
  return {
    userMessageId: stringOrNull(value.userMessageId ?? value.userMessage?.id),
    replies: Array.isArray(value.replies)
      ? value.replies.map((reply) => ({
        id: stringOrNull(reply.id),
        authorId: stringOrNull(reply.authorId ?? reply.agentId),
        targetId: stringOrNull(reply.targetId ?? reply.channelId ?? reply.dmId),
        content: String(reply.content ?? ''),
        createdAt: stringOrNull(reply.createdAt),
        visible: reply.visible === true,
        raw: reply,
      }))
      : [],
  };
}

function normalizeDelivery(delivery) {
  const value = delivery && typeof delivery === 'object' ? delivery : {};
  return {
    eventCommitted: value.eventCommitted !== false,
    delivered: value.delivered === true,
    providerThinking: value.providerThinking === true,
    runtimeIdle: value.runtimeIdle === true,
    timeline: Array.isArray(value.timeline) ? value.timeline : [],
    error: value.error,
  };
}

function normalizeToolEvidence(toolEvidence) {
  if (!Array.isArray(toolEvidence)) return [];
  return toolEvidence.map((tool) => ({
    toolName: stringOrNull(tool.toolName ?? tool.name),
    toolId: stringOrNull(tool.toolId ?? tool.id),
    commandPreview: stringOrNull(tool.commandPreview ?? tool.command),
    isSlockMessageSend: tool.isSlockMessageSend === true,
    ok: tool.ok,
    target: stringOrNull(tool.target),
    replyMessageId: stringOrNull(tool.replyMessageId),
    matchingMethod: stringOrNull(tool.matchingMethod),
    raw: tool,
  }));
}

function normalizeUsage(usage) {
  return usage && typeof usage === 'object' ? usage : null;
}

function normalizeContext(context) {
  return context && typeof context === 'object' ? context : null;
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value : null;
}

function failure(category, code, message) {
  return { category, code, message };
}
