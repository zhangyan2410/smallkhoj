import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCollabGateReport,
  classifyCollabFailure,
  formatCollabGateSummary,
} from './collab-gate.mjs';

const MARKER = 'COLLAB-GATE:test-marker';
const CHANNEL_ID = 'channel-1';

function message(overrides = {}) {
  return {
    id: overrides.id ?? 'msg-1',
    authorId: overrides.authorId ?? 'agent-architect',
    targetId: overrides.targetId ?? CHANNEL_ID,
    content: overrides.content ?? MARKER,
    createdAt: overrides.createdAt ?? '2026-06-24T00:00:00.000Z',
    visible: overrides.visible ?? true,
  };
}

function baseInput(overrides = {}) {
  return {
    scenario: 'collab-channel-v1',
    runId: 'collab-run-1',
    traceId: 'collab-trace-1',
    startedAt: '2026-06-24T00:00:00.000Z',
    completedAt: '2026-06-24T00:00:20.000Z',
    foundation: { ok: true },
    marker: MARKER,
    channel: {
      id: CHANNEL_ID,
      name: 'gate-lab',
      replyTarget: '#gate-lab',
    },
    roles: {
      humanMemberId: 'human-1',
      architectAgentId: 'agent-architect',
      workerAgentId: 'agent-worker',
      visibleAgentIds: ['agent-architect', 'agent-worker'],
      rolePolicy: 'architect-delegates-worker',
    },
    messages: {
      humanRequest: message({
        id: 'msg-human',
        authorId: 'human-1',
        content: `[COLLAB:${MARKER}:HUMAN_REQUEST] build proof`,
        createdAt: '2026-06-24T00:00:01.000Z',
      }),
      architectDelegation: message({
        id: 'msg-architect-delegation',
        authorId: 'agent-architect',
        content: `[COLLAB:${MARKER}:ARCHITECT_DELEGATION] @worker create proof`,
        createdAt: '2026-06-24T00:00:05.000Z',
      }),
      workerResult: message({
        id: 'msg-worker-result',
        authorId: 'agent-worker',
        content: `[COLLAB:${MARKER}:WORKER_RESULT] proof=artifact-1 checksum=sha256:abc`,
        createdAt: '2026-06-24T00:00:12.000Z',
      }),
      architectFinal: message({
        id: 'msg-architect-final',
        authorId: 'agent-architect',
        content: `[COLLAB:${MARKER}:ARCHITECT_FINAL] worker proof artifact-1 checksum=sha256:abc`,
        createdAt: '2026-06-24T00:00:18.000Z',
      }),
    },
    delivery: {
      architectDelivered: true,
      workerDelivered: true,
      reviewerDelivered: true,
    },
    toolEvidence: [{
      agentId: 'agent-worker',
      toolName: 'Bash',
      commandPreview: 'node create-proof.mjs',
      ok: true,
    }],
    artifactEvidence: {
      ok: true,
      artifactId: 'artifact-1',
      checksum: 'sha256:abc',
      marker: MARKER,
      workerAgentId: 'agent-worker',
    },
    latency: {
      totalRequestToFinalMs: 17_000,
    },
    usage: {
      usageSource: 'session-jsonl',
      runSpecific: true,
      inputTokens: 1000,
      outputTokens: 200,
    },
    context: {
      percent: 18,
      source: 'daemon_runtime_control.inspect_context',
    },
    ...overrides,
  };
}

test('V1 passes only with human request, architect delegation, worker proof, worker result, and final summary', () => {
  const report = buildCollabGateReport(baseInput());

  assert.equal(report.scenario, 'collab-channel-v1');
  assert.equal(report.ok, true);
  assert.equal(report.status, 'passed');
  assert.equal(report.failure, null);
  assert.equal(report.steps.every((step) => step.status === 'passed'), true);
  assert.equal(report.artifactEvidence.ok, true);
  assert.equal(report.messages.architectFinal.id, 'msg-architect-final');
});

test('missing architect delegation fails before worker evidence can pass', () => {
  const report = buildCollabGateReport(baseInput({
    messages: {
      ...baseInput().messages,
      architectDelegation: null,
    },
  }));

  assert.equal(report.ok, false);
  assert.equal(report.failure.code, 'ARCHITECT_DELEGATION_MISSING');
  assert.equal(report.steps.find((step) => step.id === 'architect-delegated')?.status, 'failed');
});

test('worker result without tool or artifact proof does not pass', () => {
  const missingTool = buildCollabGateReport(baseInput({ toolEvidence: [] }));
  assert.equal(missingTool.failure.code, 'WORKER_TOOL_EVIDENCE_MISSING');

  const badArtifact = buildCollabGateReport(baseInput({
    artifactEvidence: {
      ok: false,
      artifactId: 'artifact-1',
      checksum: 'sha256:wrong',
    },
  }));
  assert.equal(badArtifact.failure.code, 'ARTIFACT_VERIFICATION_FAILED');
});

test('wrong agent and duplicate role actions are classified as role policy failures', () => {
  const wrongAgent = classifyCollabFailure(baseInput({
    messages: {
      ...baseInput().messages,
      workerResult: message({
        id: 'msg-worker-result',
        authorId: 'agent-architect',
        content: `[COLLAB:${MARKER}:WORKER_RESULT] wrong role`,
        createdAt: '2026-06-24T00:00:12.000Z',
      }),
    },
  }));
  assert.equal(wrongAgent.code, 'WRONG_AGENT_ACTION');

  const duplicate = classifyCollabFailure(baseInput({
    roleTimeline: [
      { role: 'worker', action: 'result', messageId: 'msg-worker-result-1', agentId: 'agent-worker' },
      { role: 'worker', action: 'result', messageId: 'msg-worker-result-2', agentId: 'agent-worker' },
    ],
  }));
  assert.equal(duplicate.code, 'DUPLICATE_ROLE_ACTION');
});

test('V2 requires accepted reviewer validation before architect final can pass', () => {
  const report = buildCollabGateReport(baseInput({
    scenario: 'collab-channel-v2',
    roles: {
      ...baseInput().roles,
      reviewerAgentId: 'agent-reviewer',
      visibleAgentIds: ['agent-architect', 'agent-worker', 'agent-reviewer'],
      rolePolicy: 'architect-worker-reviewer',
    },
    messages: {
      ...baseInput().messages,
      reviewerValidation: message({
        id: 'msg-reviewer',
        authorId: 'agent-reviewer',
        content: `[COLLAB:${MARKER}:REVIEWER_ACCEPTED] artifact-1 checksum=sha256:abc accepted`,
        createdAt: '2026-06-24T00:00:15.000Z',
      }),
      architectFinal: message({
        id: 'msg-architect-final',
        authorId: 'agent-architect',
        content: `[COLLAB:${MARKER}:ARCHITECT_FINAL] worker artifact-1 reviewer accepted checksum=sha256:abc`,
        createdAt: '2026-06-24T00:00:18.000Z',
      }),
    },
    reviewEvidence: {
      accepted: true,
      reviewerAgentId: 'agent-reviewer',
      messageId: 'msg-reviewer',
    },
  }));

  assert.equal(report.ok, true);
  assert.equal(report.steps.find((step) => step.id === 'reviewer-validation-visible')?.status, 'passed');

  const missingReview = buildCollabGateReport(baseInput({ scenario: 'collab-channel-v2' }));
  assert.equal(missingReview.failure.code, 'COLLAB_AUDIENCE_INCOMPLETE');
});

test('V2 reviewer rejection fails explicitly', () => {
  const report = buildCollabGateReport(baseInput({
    scenario: 'collab-channel-v2',
    roles: {
      ...baseInput().roles,
      reviewerAgentId: 'agent-reviewer',
      visibleAgentIds: ['agent-architect', 'agent-worker', 'agent-reviewer'],
      rolePolicy: 'architect-worker-reviewer',
    },
    messages: {
      ...baseInput().messages,
      reviewerValidation: message({
        id: 'msg-reviewer',
        authorId: 'agent-reviewer',
        content: `[COLLAB:${MARKER}:REVIEWER_REJECTED] checksum mismatch`,
      }),
    },
    reviewEvidence: {
      accepted: false,
      reviewerAgentId: 'agent-reviewer',
      messageId: 'msg-reviewer',
    },
  }));

  assert.equal(report.ok, false);
  assert.equal(report.failure.code, 'REVIEWER_REJECTED_RESULT');
});

test('V3 requires task workflow evidence linked to source channel and expected worker', () => {
  const report = buildCollabGateReport(baseInput({
    scenario: 'collab-channel-v3',
    taskEvidence: {
      ok: true,
      taskId: 'task-1',
      status: 'in_review',
      assigneeId: 'agent-worker',
      sourceChannelId: CHANNEL_ID,
      sourceMessageId: 'msg-human',
      reviewVisible: true,
    },
    messages: {
      ...baseInput().messages,
      architectFinal: message({
        id: 'msg-architect-final',
        authorId: 'agent-architect',
        content: `[COLLAB:${MARKER}:ARCHITECT_FINAL] task-1 in_review worker artifact-1 checksum=sha256:abc`,
      }),
    },
  }));

  assert.equal(report.ok, true);
  assert.equal(report.steps.find((step) => step.id === 'task-source-linked')?.status, 'passed');

  const mismatch = buildCollabGateReport(baseInput({
    scenario: 'collab-channel-v3',
    taskEvidence: {
      ok: false,
      taskId: 'task-1',
      status: 'todo',
      assigneeId: 'other-agent',
      sourceChannelId: 'other-channel',
      sourceMessageId: 'msg-human',
      reviewVisible: false,
    },
  }));
  assert.equal(mismatch.failure.code, 'TASK_WORKFLOW_STATE_MISMATCH');
});

test('formatCollabGateSummary keeps pass compact and failure actionable', () => {
  assert.equal(
    formatCollabGateSummary(buildCollabGateReport(baseInput())),
    'PASS collab-channel-v1 11/11',
  );

  assert.equal(
    formatCollabGateSummary(buildCollabGateReport(baseInput({ toolEvidence: [] }))),
    'FAIL collab-channel-v1 10/11 WORKER_TOOL_EVIDENCE_MISSING:worker-tool-evidence',
  );
});
