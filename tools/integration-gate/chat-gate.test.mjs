import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildChatGateReport,
  classifyChatFailure,
  formatChatGateSummary,
  isSlockMessageSendCommand,
} from './chat-gate.mjs';

const MARKER = 'CHAT-GATE:test-marker';
const EXPECTED_ACK = `ACK ${MARKER}`;

const PRODUCT_IDENTITY = {
  ok: true,
  implementationType: 'aura-standalone',
  installed: true,
  online: true,
  activeVersion: '0.2.6',
  artifactSha256: 'a'.repeat(64),
  statusComputerId: 'computer-1',
  statusDaemonId: 'daemon-1',
  computerId: 'computer-1',
  computerDaemonId: 'daemon-1',
  computerDaemonVersion: '0.2.6',
  runtimeKind: 'claude_code',
};

function baseInput(overrides = {}) {
  return {
    scenario: 'chat-reply-channel-base',
    runId: 'chat-gate-run-1',
    traceId: 'chat-gate:trace-1',
    startedAt: '2026-06-24T00:00:00.000Z',
    completedAt: '2026-06-24T00:00:12.000Z',
    foundation: { ok: true },
    agent: {
      id: 'agent-1',
      name: 'MiniMax Agent',
      computerId: 'computer-1',
      daemonId: 'daemon-1',
      runtimeProvider: 'minimax',
      runtimeModel: 'MiniMax-M3',
      runtimeKind: 'claude_code',
      sessionId: 'session-1',
    },
    target: {
      kind: 'channel',
      channelId: 'channel-1',
      channelName: 'gate-lab',
      replyTarget: '#gate-lab',
      expectedResponderAgentIds: ['agent-1'],
      visibleAgentIds: ['agent-1'],
      responderPolicy: 'one',
    },
    marker: MARKER,
    expectedAck: EXPECTED_ACK,
    messages: {
      userMessageId: 'msg-user-1',
      replies: [{
        id: 'msg-reply-1',
        authorId: 'agent-1',
        targetId: 'channel-1',
        content: EXPECTED_ACK,
        createdAt: '2026-06-24T00:00:11.000Z',
        visible: true,
      }],
    },
    delivery: {
      eventCommitted: true,
      delivered: true,
      providerThinking: true,
      runtimeIdle: true,
      timeline: [
        { kind: 'runtime_working', at: '2026-06-24T00:00:02.000Z', traceId: 'chat-gate:trace-1' },
        { kind: 'runtime_thinking', at: '2026-06-24T00:00:04.000Z', traceId: 'chat-gate:trace-1' },
        { kind: 'runtime_output', at: '2026-06-24T00:00:08.000Z', traceId: 'chat-gate:trace-1', toolName: 'Bash' },
        { kind: 'runtime_idle', at: '2026-06-24T00:00:10.000Z', traceId: 'chat-gate:trace-1' },
      ],
    },
    toolEvidence: [{
      toolName: 'Bash',
      commandPreview: `slock message send --target #gate-lab --content "${EXPECTED_ACK}"`,
      ok: true,
      isSlockMessageSend: true,
      target: '#gate-lab',
      replyMessageId: 'msg-reply-1',
      matchingMethod: 'traceId',
    }],
    usage: {
      inputTokens: 1200,
      outputTokens: 80,
      usageSource: 'claude_session_jsonl',
      runSpecific: true,
    },
    context: {
      percent: 18,
      source: 'daemon_runtime_control.inspect_context',
      runSpecific: false,
    },
    latency: {
      totalSendToVisibleMs: 12_000,
    },
    ...overrides,
  };
}

test('buildChatGateReport passes controlled channel only with persisted visible marker reply and slock send', () => {
  const report = buildChatGateReport(baseInput());

  assert.equal(report.scenario, 'chat-reply-channel-base');
  assert.equal(report.ok, true);
  assert.equal(report.status, 'passed');
  assert.equal(report.messages.userMessageId, 'msg-user-1');
  assert.equal(report.messages.replyMessageId, 'msg-reply-1');
  assert.equal(report.failure, null);
  assert.equal(report.steps.every((step) => step.status === 'passed' || step.status === 'warning'), true);
  assert.equal(report.steps.find((step) => step.id === 'slock-send-observed')?.status, 'passed');
  assert.equal(report.replyEvidence.visible, true);
  assert.equal(report.warnings.length, 0);
});

test('message-send evidence accepts the product Aura CLI and Windows launchers', () => {
  assert.equal(isSlockMessageSendCommand('aura message send --target "#gate-lab"'), true);
  assert.equal(isSlockMessageSendCommand('/tmp/aura message send --target #gate-lab'), true);
  assert.equal(isSlockMessageSendCommand('C:\\Users\\gate\\aura.exe message send --target #gate-lab'), true);
  assert.equal(isSlockMessageSendCommand('slock message send --target #gate-lab'), true);
  assert.equal(isSlockMessageSendCommand('aura server info'), false);
});

test('product chat gate passes when the real runtime reports Aura message send', () => {
  const report = buildChatGateReport(baseInput({
    scenario: 'product-chat-reply-claude',
    installationIdentity: PRODUCT_IDENTITY,
    toolEvidence: [{
      toolName: 'Bash',
      commandPreview: 'aura message send --target "#gate-lab"',
      ok: true,
      target: '#gate-lab',
      replyMessageId: 'msg-reply-1',
    }],
  }));

  assert.equal(report.ok, true);
  assert.equal(report.failure, null);
  assert.equal(report.steps.find((step) => step.id === 'slock-send-observed')?.status, 'passed');
});

test('product chat gate binds installation identity before accepting runtime evidence', () => {
  const report = buildChatGateReport(baseInput({
    scenario: 'product-chat-reply-claude',
    installationIdentity: PRODUCT_IDENTITY,
  }));

  assert.equal(report.ok, true);
  assert.equal(report.status, 'passed');
  assert.equal(report.steps.length, 12);
  assert.equal(report.steps.find((step) => step.id === 'installed-aura-bound')?.status, 'passed');
});

test('product chat gate fails closed on missing Aura identity before chat evidence', () => {
  const report = buildChatGateReport(baseInput({
    scenario: 'product-chat-reply-claude',
  }));

  assert.equal(report.ok, false);
  assert.equal(report.failure.code, 'AURA_INSTALLATION_IDENTITY_MISSING');
  assert.equal(report.steps.find((step) => step.id === 'installed-aura-bound')?.status, 'failed');
  assert.equal(report.steps.find((step) => step.id === 'user-message-sent')?.status, 'pending');
});

test('product release expectation failure maps to the installed Aura step', () => {
  const report = buildChatGateReport(baseInput({
    scenario: 'product-chat-reply-claude',
    installationIdentity: {
      ...PRODUCT_IDENTITY,
      ok: false,
      failureCode: 'AURA_RELEASE_EXPECTATION_REQUIRED',
      failureReason: 'release identity missing',
    },
  }));

  assert.equal(report.failure.code, 'AURA_RELEASE_EXPECTATION_REQUIRED');
  assert.equal(report.steps.find((step) => step.id === 'installed-aura-bound')?.status, 'failed');
});

test('runtime idle without a persisted visible reply fails as AGENT_REPLY_MISSING', () => {
  const report = buildChatGateReport(baseInput({
    messages: {
      userMessageId: 'msg-user-1',
      replies: [],
    },
  }));

  assert.equal(report.ok, false);
  assert.equal(report.status, 'failed');
  assert.equal(report.failure.code, 'AGENT_REPLY_MISSING');
  assert.equal(report.steps.find((step) => step.id === 'runtime-idle')?.status, 'passed');
  assert.equal(report.steps.find((step) => step.id === 'reply-persisted')?.status, 'failed');
});

test('provider output without slock message send does not pass even when runtime reached idle', () => {
  const report = buildChatGateReport(baseInput({
    toolEvidence: [{
      toolName: 'Bash',
      commandPreview: 'echo plain provider answer',
      ok: true,
      isSlockMessageSend: false,
    }],
  }));

  assert.equal(report.ok, false);
  assert.equal(report.failure.code, 'SLOCK_SEND_MISSING');
  assert.equal(report.steps.find((step) => step.id === 'slock-send-observed')?.status, 'failed');
});

test('slock send evidence matches generated wrapper path command previews', () => {
  const report = buildChatGateReport(baseInput({
    toolEvidence: [{
      toolName: 'Bash',
      commandPreview: `/Users/code/project/smallkhoj/.slock/slock message send --target "#gate-lab" <<'SLOCKMSG'\n${EXPECTED_ACK}\nSLOCKMSG`,
      ok: true,
      isSlockMessageSend: false,
      target: '#gate-lab',
      matchingMethod: 'fallbackWindow',
    }],
  }));

  assert.equal(report.ok, true);
  assert.equal(report.steps.find((step) => step.id === 'slock-send-observed')?.status, 'passed');
});

test('wrong marker or wrong target reply fails as REPLY_MARKER_MISMATCH', () => {
  const wrongMarker = buildChatGateReport(baseInput({
    messages: {
      userMessageId: 'msg-user-1',
      replies: [{
        id: 'msg-reply-1',
        authorId: 'agent-1',
        targetId: 'channel-1',
        content: 'ACK a different marker',
        createdAt: '2026-06-24T00:00:11.000Z',
        visible: true,
      }],
    },
  }));
  assert.equal(wrongMarker.failure.code, 'REPLY_MARKER_MISMATCH');

  const wrongTarget = buildChatGateReport(baseInput({
    messages: {
      userMessageId: 'msg-user-1',
      replies: [{
        id: 'msg-reply-1',
        authorId: 'agent-1',
        targetId: 'other-channel',
        content: EXPECTED_ACK,
        createdAt: '2026-06-24T00:00:11.000Z',
        visible: true,
      }],
    },
  }));
  assert.equal(wrongTarget.failure.code, 'REPLY_MARKER_MISMATCH');
});

test('channel group gate classifies ambiguous audience, wrong agent, missing expected, and duplicates', () => {
  assert.equal(classifyChatFailure(baseInput({
    scenario: 'chat-reply-channel-group',
    target: {
      kind: 'channel-group',
      channelId: 'channel-1',
      channelName: 'gate-lab',
      replyTarget: '#gate-lab',
      visibleAgentIds: [],
      expectedResponderAgentIds: ['agent-1'],
      responderPolicy: 'one',
    },
  })).code, 'CHANNEL_AUDIENCE_AMBIGUOUS');

  assert.equal(classifyChatFailure(baseInput({
    scenario: 'chat-reply-channel-group',
    target: {
      kind: 'channel-group',
      channelId: 'channel-1',
      channelName: 'gate-lab',
      replyTarget: '#gate-lab',
      visibleAgentIds: ['agent-1'],
      expectedResponderAgentIds: ['agent-1'],
      responderPolicy: 'one',
    },
  })).code, 'CHANNEL_AUDIENCE_AMBIGUOUS');

  assert.equal(classifyChatFailure(baseInput({
    scenario: 'chat-reply-channel-group',
    target: {
      kind: 'channel-group',
      channelId: 'channel-1',
      channelName: 'gate-lab',
      replyTarget: '#gate-lab',
      visibleAgentIds: ['agent-1', 'agent-2'],
      expectedResponderAgentIds: ['agent-1'],
      responderPolicy: 'one',
    },
    messages: {
      userMessageId: 'msg-user-1',
      replies: [{
        id: 'msg-reply-2',
        authorId: 'agent-2',
        targetId: 'channel-1',
        content: EXPECTED_ACK,
        visible: true,
      }],
    },
  })).code, 'CHANNEL_WRONG_AGENT_REPLY');

  assert.equal(classifyChatFailure(baseInput({
    scenario: 'chat-reply-channel-group',
    target: {
      kind: 'channel-group',
      channelId: 'channel-1',
      channelName: 'gate-lab',
      replyTarget: '#gate-lab',
      visibleAgentIds: ['agent-1', 'agent-2'],
      expectedResponderAgentIds: ['agent-1', 'agent-2'],
      responderPolicy: 'all',
    },
    messages: {
      userMessageId: 'msg-user-1',
      replies: [{
        id: 'msg-reply-1',
        authorId: 'agent-1',
        targetId: 'channel-1',
        content: EXPECTED_ACK,
        visible: true,
      }],
    },
  })).code, 'CHANNEL_EXPECTED_REPLY_MISSING');

  assert.equal(classifyChatFailure(baseInput({
    scenario: 'chat-reply-channel-group',
    target: {
      kind: 'channel-group',
      channelId: 'channel-1',
      channelName: 'gate-lab',
      replyTarget: '#gate-lab',
      visibleAgentIds: ['agent-1', 'agent-2'],
      expectedResponderAgentIds: ['agent-1'],
      responderPolicy: 'one',
    },
    messages: {
      userMessageId: 'msg-user-1',
      replies: [
        { id: 'msg-reply-1', authorId: 'agent-1', targetId: 'channel-1', content: EXPECTED_ACK, visible: true },
        { id: 'msg-reply-2', authorId: 'agent-1', targetId: 'channel-1', content: EXPECTED_ACK, visible: true },
      ],
    },
  })).code, 'CHANNEL_DUPLICATE_REPLY_POLICY_VIOLATION');
});

test('DM gate classifies target resolution and wrong peer target separately', () => {
  assert.equal(classifyChatFailure(baseInput({
    scenario: 'chat-reply-dm',
    target: {
      kind: 'dm',
      dmId: null,
      userMemberId: 'human-1',
      agentMemberId: 'agent-1',
      replyTarget: 'dm:@human',
      resolved: false,
    },
  })).code, 'DM_TARGET_RESOLUTION_FAILED');

  assert.equal(classifyChatFailure(baseInput({
    scenario: 'chat-reply-dm',
    target: {
      kind: 'dm',
      dmId: 'dm-1',
      userMemberId: 'human-1',
      agentMemberId: 'agent-1',
      replyTarget: 'dm:@human',
      resolved: true,
    },
    messages: {
      userMessageId: 'msg-user-1',
      replies: [{
        id: 'msg-reply-1',
        authorId: 'agent-1',
        targetId: 'dm-2',
        content: EXPECTED_ACK,
        visible: true,
      }],
    },
  })).code, 'DM_REPLY_TARGET_MISMATCH');
});

test('missing run-specific token or context evidence is warning, not chat pass blocker', () => {
  const report = buildChatGateReport(baseInput({
    usage: null,
    context: null,
  }));

  assert.equal(report.ok, true);
  assert.equal(report.status, 'warning');
  assert.deepEqual(report.warnings.map((warning) => warning.code), [
    'TOKEN_USAGE_MISSING',
    'CONTEXT_EVIDENCE_MISSING',
  ]);
});

test('formatChatGateSummary keeps pass output compact and failure output actionable', () => {
  assert.equal(
    formatChatGateSummary(buildChatGateReport(baseInput())),
    'PASS chat-reply-channel-base 11/11'
  );

  const failing = buildChatGateReport(baseInput({
    messages: { userMessageId: 'msg-user-1', replies: [] },
  }));
  assert.match(
    formatChatGateSummary(failing),
    /^FAIL chat-reply-channel-base 9\/11 AGENT_REPLY_MISSING:reply-persisted$/
  );
});
