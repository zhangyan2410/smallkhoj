import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildClaudeArgs,
  buildClaudeRuntimeEnv,
  buildClaudeUserMessage,
  buildSlockSystemPrompt,
  parseClaudeStreamLine,
  writeSlockSystemPromptFile,
  ClaudeRuntimeDriver,
} from '../dist/runtime/claude-runtime.js';
import {
  DaemonCore,
  buildRuntimeMemoryContextRequest,
  buildTaskRunCompletionSummary,
  extractTaskRunOutputMessageIdFromEvent,
  formatRuntimeIncomingMessage,
  formatRuntimeIncomingMessageWithMemoryContext,
  isRuntimeActionableEventType,
  normalizeRuntimeIncomingMessage,
  parseDaemonControlCommand,
  sanitizeRuntimeCommandPreview,
  selectRuntimeSessionScope,
} from '../dist/daemon/daemon.js';
import { appendDaemonConnectionParams, buildAckPayload, buildActivityPayload, buildWebSocketHeaders, parseWebSocketPayload } from '../dist/websocket.js';

const credential = {
  agentId: 'agent-123',
  serverId: 'server-123',
  token: 'sk_machine_secret',
  serverUrl: 'https://api.slock.ai',
};

function waitFor(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolveWait, rejectWait) => {
    const tick = () => {
      if (predicate()) {
        resolveWait(undefined);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        rejectWait(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test('claude runtime env prepends wrapper path and strips proxy secrets', () => {
  const env = buildClaudeRuntimeEnv({
    credential,
    workspacePath: 'D:/workspace',
    wrapperDir: 'D:/workspace/.slock',
    slockHome: 'D:/workspace/.slock',
    launchId: 'pid-test',
  }, {
    PATH: 'BASE',
    SLOCK_AGENT_TOKEN: 'secret',
    SLOCK_AGENT_PROXY_URL: 'http://127.0.0.1:1',
    SLOCK_AGENT_PROXY_TOKEN: 'sap_secret',
    SLOCK_AGENT_PROXY_TOKEN_FILE: 'token-file',
    SLOCK_AGENT_ACTIVE_CAPABILITIES: 'send',
  });

  assert.equal(env.SLOCK_AGENT_ID, 'agent-123');
  assert.equal(env.SLOCK_AGENT_LAUNCH_ID, 'pid-test');
  assert.equal(env.SLOCK_HOME, 'D:/workspace/.slock');
  assert.equal(env.SLOCK_SERVER_URL, 'https://api.slock.ai');
  assert.equal(env.PATH, `D:/workspace/.slock${process.platform === 'win32' ? ';' : ':'}BASE`);
  assert.equal(env.SLOCK_AGENT_TOKEN, undefined);
  assert.equal(env.SLOCK_AGENT_PROXY_URL, undefined);
  assert.equal(env.SLOCK_AGENT_PROXY_TOKEN_FILE, undefined);
});

test('claude args and prompt force slock CLI communication', () => {
  const args = buildClaudeArgs({
    model: 'sonnet',
    resumeSessionId: 'session-resume-1',
    systemPromptFile: 'D:/workspace/.slock/claude-system-prompt.md',
  });
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('bypassPermissions'));
  assert.ok(args.includes('EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronList,CronDelete'));
  assert.ok(args.includes('--append-system-prompt-file'));
  assert.ok(args.includes('D:/workspace/.slock/claude-system-prompt.md'));
  assert.equal(args[args.indexOf('--resume') + 1], 'session-resume-1');
  assert.equal(args.includes('--system-prompt'), false);

  const prompt = buildSlockSystemPrompt({ credential, workspacePath: 'D:/workspace', wrapperDir: 'D:/workspace/.slock' });
  assert.match(prompt, /slock CLI ONLY/);
  assert.match(prompt, /D:\/workspace\/\.slock\/slock/);
  assert.match(prompt, /slock message check/);
  assert.match(prompt, /Use freely during work/);
  assert.match(prompt, /slock message resolve/);
  assert.match(prompt, /slock server info/);
  assert.match(prompt, /slock task list/);
  assert.match(prompt, /slock task create/);
  assert.match(prompt, /slock task claim/);
  assert.match(prompt, /slock task unclaim/);
  assert.match(prompt, /slock task update/);
  assert.match(prompt, /slock memory context/);
  assert.match(prompt, /slock memory proposals/);
  assert.match(prompt, /slock memory accept-proposal/);
  assert.match(prompt, /slock memory reject-proposal/);
  assert.match(prompt, /slock memory delete/);
  assert.match(prompt, /slock reminder snooze/);
  assert.match(prompt, /slock reminder log/);
  assert.match(prompt, /slock attachment upload/);
  assert.match(prompt, /slock attachment view/);
  assert.doesNotMatch(prompt, /slock action prepare/);
  assert.match(prompt, /WRITES_NOT_ALLOWED/);
  assert.doesNotMatch(prompt, /not yet implemented/);
  assert.match(prompt, /## Messaging/);
  assert.match(prompt, /`target=` — where the message came from/);
  assert.match(prompt, /reuse the exact `target`/i);
  assert.match(prompt, /Agent ID: agent-123/);
});

test('runtime activity command preview redacts Slock proxy internals', () => {
  const preview = sanitizeRuntimeCommandPreview([
    "export SLOCK_AGENT_PROXY_URL='http://127.0.0.1:64165'",
    "export SLOCK_AGENT_PROXY_TOKEN_FILE='/Users/lee/.slock/agent-proxy-tokens/agent-1/pid-1.token'",
    "export SLOCK_AGENT_ACTIVE_CAPABILITIES='send,read'",
    "slock message send --target '#all' hello",
  ].join('\n'));

  assert.doesNotMatch(preview, /SLOCK_AGENT_PROXY_URL/);
  assert.doesNotMatch(preview, /SLOCK_AGENT_PROXY_TOKEN_FILE/);
  assert.doesNotMatch(preview, /agent-proxy-tokens/);
  assert.match(preview, /slock message send --target '#all' hello/);
});

test('claude system prompt is written under slock home', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-claude-prompt-'));
  try {
    const wrapperDir = join(root, '.slock');
    const promptFile = writeSlockSystemPromptFile({
      credential,
      workspacePath: root,
      wrapperDir,
    });

    assert.equal(promptFile, join(wrapperDir, 'claude-system-prompt.md'));
    const prompt = readFileSync(promptFile, 'utf-8');
    assert.match(prompt, /slock CLI ONLY/);
    assert.match(prompt, /Agent ID: agent-123/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('claude stream-json helpers parse output and build user input', () => {
  const event = parseClaudeStreamLine(JSON.stringify({
    type: 'system',
    subtype: 'session_init',
    session_id: 'session-123',
  }));

  assert.equal(event.type, 'system');
  assert.equal(event.session_id, 'session-123');
  assert.deepEqual(buildClaudeUserMessage('hello', 'session-123'), {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    },
    session_id: 'session-123',
  });
});

test('daemon formats inbound Slock messages for Claude runtime delivery', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'message_received',
    message: {
      target: '#general',
      id: 'msg-1',
      timestamp: '2026-05-30T00:00:00.000Z',
      sender: '@alice',
      senderType: 'human',
      content: 'please check this',
    },
  });

  assert.deepEqual(message, {
    target: '#general',
    messageId: 'msg-1',
    timestamp: '2026-05-30T00:00:00.000Z',
    sender: '@alice',
    senderType: 'human',
    content: 'please check this',
  });
  assert.equal(
    formatRuntimeIncomingMessage(message),
    '[target=#general msg=msg-1 time=2026-05-30T00:00:00.000Z sender=@alice type=human] @alice: please check this',
  );
});

test('daemon injects a selective memory context manifest into runtime prompts', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'message.created',
    channelId: 'channel-1',
    target: '#general',
    messageId: 'msg-1',
    sender: '@alice',
    content: 'continue the memory work',
  });
  const manifest = {
    policy: 'selective',
    sessionScope: { type: 'task', id: 'task-1' },
    taskMemories: [
      {
        path: 'brief.md',
        title: 'Task brief',
        snippet: 'Implement scoped memory context injection.',
        contentText: 'FULL TASK MEMORY SHOULD NOT BE INSERTED',
      },
      {
        path: 'progress.md',
        snippet: 'Backend and CLI are done; daemon injection remains.',
      },
    ],
    channelMemories: [
      {
        path: 'MEMORY.md',
        title: 'Channel memory',
        snippet: 'Use selective manifests, not full channel memory.',
        contentText: 'FULL CHANNEL MEMORY SHOULD NOT BE INSERTED',
      },
    ],
    readMore: {
      task: 'slock memory read --scope task --id task-1 --path brief.md',
      channel: 'slock memory search --scope channel --id channel-1 --query "scoped memory"',
    },
  };

  const formatted = formatRuntimeIncomingMessageWithMemoryContext(message, manifest);

  assert.match(formatted, /## Slock Memory Context/);
  assert.match(formatted, /policy=selective/);
  assert.match(formatted, /scope=task:task-1/);
  assert.match(formatted, /Task memory/);
  assert.match(formatted, /brief\.md - Task brief: Implement scoped memory context injection\./);
  assert.match(formatted, /Channel memory/);
  assert.match(formatted, /MEMORY\.md - Channel memory: Use selective manifests, not full channel memory\./);
  assert.match(formatted, /slock memory read --scope task --id task-1 --path brief\.md/);
  assert.match(formatted, /\[event=message\.created/);
  assert.doesNotMatch(formatted, /FULL TASK MEMORY SHOULD NOT BE INSERTED/);
  assert.doesNotMatch(formatted, /FULL CHANNEL MEMORY SHOULD NOT BE INSERTED/);
});

test('daemon omits memory context block when manifest has no useful entries', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'message_received',
    message: {
      target: 'dm:@alice',
      id: 'msg-2',
      sender: '@alice',
      content: 'hello in dm',
    },
  });

  assert.equal(
    formatRuntimeIncomingMessageWithMemoryContext(message, {
      policy: 'selective',
      sessionScope: { type: 'dm', id: 'alice', key: 'dm:alice' },
      channelMemories: [],
      taskMemories: [],
      readMore: [],
    }),
    formatRuntimeIncomingMessage(message),
  );
});

test('daemon normalizes dotted backend message events for Claude runtime delivery', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'message.created',
    legacyType: 'message_received',
    seq: 12,
    eventSeq: 99,
    traceId: 'trace-99',
    target: '#general',
    messageId: 'msg-12',
    shortId: 'm12',
    createdAt: '2026-06-05T10:00:00.000Z',
    senderId: 'member-alice',
    content: 'from dotted event',
    channelId: 'channel-1',
  });

  assert.deepEqual(message, {
    eventType: 'message.created',
    eventSeq: '99',
    traceId: 'trace-99',
    target: '#general',
    channelId: 'channel-1',
    messageId: 'msg-12',
    timestamp: '2026-06-05T10:00:00.000Z',
    content: 'from dotted event',
    senderType: 'message.created',
  });
  assert.equal(
    formatRuntimeIncomingMessage(message),
    '[event=message.created eventSeq=99 trace=trace-99 target=#general channel=channel-1 msg=msg-12 time=2026-06-05T10:00:00.000Z type=message.created] from dotted event',
  );
});

test('daemon selects runtime session scope from normalized event payloads', () => {
  const topLevel = normalizeRuntimeIncomingMessage({
    type: 'message.created',
    channelType: 'public',
    channelId: 'ch-1',
    messageId: 'msg-1',
    threadId: 'msg-1',
    senderId: 'human-1',
    content: 'top level',
  });
  const threadReply = normalizeRuntimeIncomingMessage({
    type: 'message.created',
    channelType: 'thread',
    channelId: 'ch-1',
    messageId: 'msg-2',
    threadId: 'msg-1',
    senderId: 'human-1',
    content: 'thread reply',
  });
  const taskMessage = normalizeRuntimeIncomingMessage({
    type: 'task.created',
    channelType: 'thread',
    channelId: 'ch-1',
    messageId: 'msg-3',
    threadId: 'msg-1',
    taskId: 'task-1',
    senderId: 'human-1',
    content: 'task work',
  });

  assert.equal(selectRuntimeSessionScope(topLevel)?.key, 'channel:ch-1');
  assert.equal(selectRuntimeSessionScope(threadReply)?.key, 'thread:ch-1:msg-1');
  assert.equal(selectRuntimeSessionScope(taskMessage)?.key, 'task:task-1');
});

test('daemon requests memory manifests only for shared channel thread and task scopes', () => {
  assert.deepEqual(buildRuntimeMemoryContextRequest({ type: 'channel', channelId: 'ch-1', key: 'channel:ch-1' }, 'prompt'), {
    scopeType: 'channel',
    scopeId: 'ch-1',
    prompt: 'prompt',
    topK: 3,
  });
  assert.deepEqual(buildRuntimeMemoryContextRequest({ type: 'task', taskId: 'task-1', key: 'task:task-1' }, 'prompt'), {
    scopeType: 'task',
    scopeId: 'task-1',
    prompt: 'prompt',
    topK: 3,
  });
  assert.deepEqual(buildRuntimeMemoryContextRequest({ type: 'thread', channelId: 'ch-1', rootMessageId: 'msg-1', key: 'thread:ch-1:msg-1' }, 'prompt'), {
    scopeType: 'thread',
    scopeId: 'msg-1',
    prompt: 'prompt',
    topK: 3,
  });
  assert.equal(buildRuntimeMemoryContextRequest({ type: 'dm', peerMemberId: 'human-1', key: 'dm:human-1' }, 'prompt'), null);
});

test('daemon treats reply-safe DM targets as DM scope even when channelType is absent', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'message_received',
    target: 'dm:@alice',
    channelId: 'dm-channel-1',
    senderId: 'human-1',
    content: 'private question',
  });
  const scope = selectRuntimeSessionScope(message);

  assert.equal(scope?.key, 'dm:human-1');
  assert.equal(buildRuntimeMemoryContextRequest(scope, 'prompt'), null);
});

test('daemon formats non-message Slock events for Claude runtime delivery', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'task_created',
    eventSeq: 7,
    taskNumber: 3,
    target: '#general',
    actorId: 'supervisor',
    title: 'Implement delegated slice',
    status: 'todo',
    details: {
      assignee: '@aaa',
      priority: 'high',
    },
  });

  assert.deepEqual(message, {
    eventType: 'task_created',
    eventSeq: '7',
    target: '#general',
    taskNumber: '3',
    status: 'todo',
    title: 'Implement delegated slice',
    actor: 'supervisor',
    senderType: 'task_created',
    assignee: '@aaa',
    content: [
      'title=Implement delegated slice',
      'status=todo',
      'assignee=@aaa',
      'priority=high',
    ].join('\n'),
  });
  assert.equal(
    formatRuntimeIncomingMessage(message),
    [
      '[event=task_created eventSeq=7 target=#general task=#3 status=todo actor=supervisor assignee=@aaa type=task_created] You have been assigned this Slock task. Treat this event as an actionable work request, not as a passive system notification.',
      'Use `slock task claim` for this task if it is still todo, do the requested work, then use `slock task update --status in_review` when ready for human review.',
      'Post progress and the final result back to #general with `slock message send --target "#general"`.',
      '',
      'title=Implement delegated slice',
      'status=todo',
      'assignee=@aaa',
      'priority=high',
    ].join('\n'),
  );
});

test('daemon formats dotted assigned task creation as actionable runtime work', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'task.created',
    eventSeq: 52,
    payload: {
      taskId: 'task-9',
      taskNumber: 9,
      channel: 'dm:@zy-ean',
      targetAgentId: 'agent-123',
      assignee: '@glm1',
      assigneeId: 'agent-123',
      creator: '@zy-ean',
      title: 'Write a short update',
      status: 'todo',
    },
  });

  assert.deepEqual(message, {
    eventType: 'task.created',
    eventSeq: '52',
    target: 'dm:@zy-ean',
    taskId: 'task-9',
    taskNumber: '9',
    status: 'todo',
    title: 'Write a short update',
    actor: 'agent-123',
    senderType: 'task.created',
    assignee: '@glm1',
    assigneeId: 'agent-123',
    content: [
      'title=Write a short update',
      'status=todo',
    ].join('\n'),
  });
  assert.equal(
    formatRuntimeIncomingMessage(message),
    [
      '[event=task.created eventSeq=52 target=dm:@zy-ean task=#9 status=todo actor=agent-123 assignee=@glm1 type=task.created] You have been assigned this Slock task. Treat this event as an actionable work request, not as a passive system notification.',
      'Use `slock task claim` for this task if it is still todo, do the requested work, then use `slock task update --status in_review` when ready for human review.',
      'Post progress and the final result back to dm:@zy-ean with `slock message send --target "dm:@zy-ean"`.',
      '',
      'title=Write a short update',
      'status=todo',
    ].join('\n'),
  );
});

test('daemon formats task run identity and scoped context guidance for assigned tasks', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'task.created',
    eventSeq: 61,
    payload: {
      taskId: 'task-10',
      taskRunId: 'run-10',
      taskNumber: 10,
      channel: '#work',
      targetAgentId: 'agent-worker',
      assignee: '@worker',
      title: 'Implement TaskRun worker slice',
      status: 'todo',
      promptProfile: 'task.worker',
      contextSessionId: 'task:task-10:role:worker:run:run-10',
    },
  });

  assert.equal(message?.taskRunId, 'run-10');
  assert.equal(message?.promptProfile, 'task.worker');
  assert.equal(message?.contextSessionId, 'task:task-10:role:worker:run:run-10');
  assert.match(
    formatRuntimeIncomingMessage(message),
    /\[event=task\.created eventSeq=61 target=#work task=#10 run=run-10 status=todo/,
  );
  assert.match(
    formatRuntimeIncomingMessage(message),
    /TaskRun run-10 uses prompt profile task\.worker and context session task:task-10:role:worker:run:run-10\./,
  );
  assert.match(
    formatRuntimeIncomingMessage(message),
    /Treat this as a run-scoped context boundary; do not assume unrelated channel or previous task context is already loaded\./,
  );
});

test('daemon formats task run template and role policy guidance for assigned tasks', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'task.created',
    eventSeq: 62,
    payload: {
      taskId: 'task-11',
      taskRunId: 'run-11',
      taskNumber: 11,
      channel: '#research',
      assignee: '@minimax',
      title: 'Research TaskRun models',
      status: 'todo',
      promptProfile: 'task.researcher',
      contextSessionId: 'task:task-11:role:researcher:run:run-11',
      template: {
        slug: 'research-analyst',
        name: 'Research Analyst',
        toolPolicy: { allowedToolGroups: ['slock', 'web'], writeSlockCommands: true },
        skillPolicy: { requiredSkills: ['research'] },
        memoryPolicy: { readScopes: ['channel', 'task'], writeScopes: ['task'] },
        outputPolicy: { expectedOutputTypes: ['message', 'memory'], channelMessageRequired: true },
      },
      role: {
        roleKey: 'researcher',
        displayName: 'Researcher',
        purpose: 'Collect facts and write sourced notes.',
        loopPolicy: { completionPolicy: 'single_turn_result' },
      },
      completionPolicy: 'single_turn_result',
    },
  });

  assert.equal(message?.taskRunTemplate?.slug, 'research-analyst');
  assert.equal(message?.taskRunRole?.roleKey, 'researcher');
  assert.equal(message?.completionPolicy, 'single_turn_result');
  const formatted = formatRuntimeIncomingMessage(message);
  assert.match(formatted, /TaskRun Template:/);
  assert.match(formatted, /- Template: Research Analyst \(research-analyst\)/);
  assert.match(formatted, /- Role: Researcher \(researcher\) - Collect facts and write sourced notes\./);
  assert.match(formatted, /- Tools: slock, web; slock writes allowed/);
  assert.match(formatted, /- Skills: research/);
  assert.match(formatted, /- Memory: read channel, task; write task/);
  assert.match(formatted, /- Outputs: message, memory; channel message required/);
  assert.match(formatted, /- Completion: single_turn_result/);
});

test('daemon reports task run lifecycle updates to the agent API', async () => {
  const daemon = new DaemonCore({
    agentId: 'agent-123',
    serverUrl: 'https://api.slock.ai',
    wsUrl: 'none',
    credentialPath: '',
    proxyPort: 0,
    logLevel: 'debug',
  });
  daemon.credential = credential;
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await daemon.reportTaskRunLifecycle({
      agentId: 'agent-123',
      taskRunId: 'run-10',
      status: 'completed',
      runtimeSessionId: 'provider-session-1',
      tokenUsage: { inputTokens: 10, outputTokens: 2 },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.slock.ai/internal/agent-api/task-runs/run-10/lifecycle');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer sk_machine_secret');
  assert.equal(calls[0].options.headers['X-Agent-Id'], 'agent-123');
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.status, 'completed');
  assert.equal(body.runtimeSessionId, 'provider-session-1');
  assert.deepEqual(body.tokenUsage, { inputTokens: 10, outputTokens: 2 });
});

test('daemon extracts output message id from slock send tool result', () => {
  const event = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          content: '{"state":"sent","traceId":"agent-send:abc","messageId":"3a62b890-31c9-433c-9d2d-fb3c763ec1ae","shortId":"3859bf25","target":"#33"}',
        },
      ],
    },
  };

  assert.equal(
    extractTaskRunOutputMessageIdFromEvent(event),
    '3a62b890-31c9-433c-9d2d-fb3c763ec1ae',
  );
});

test('daemon builds task run completion usage summary from result event', () => {
  const summary = buildTaskRunCompletionSummary(
    {
      type: 'result',
      duration_ms: 493632,
      duration_api_ms: 767509,
      num_turns: 46,
      total_cost_usd: 5.00946,
      usage: {
        input_tokens: 45177,
        output_tokens: 13236,
        cache_read_input_tokens: 1249553,
      },
    },
    {
      source: 'provider-stream-json',
      inputTokens: 45177,
      outputTokens: 13236,
      cacheReadInputTokens: 1249553,
    },
    {
      toolUseCount: 17,
      toolResultCount: 16,
      outputMessageId: '3a62b890-31c9-433c-9d2d-fb3c763ec1ae',
    },
    {
      source: 'runtime_usage_event',
      knownTokens: 101,
      contextWindow: 258400,
      occupancyRatio: 101 / 258400,
    },
  );

  assert.deepEqual(summary.tokenUsage, {
    source: 'provider-stream-json',
    inputTokens: 45177,
    outputTokens: 13236,
    cacheReadInputTokens: 1249553,
    totalTokens: 1307966,
    durationMs: 493632,
    durationApiMs: 767509,
    numTurns: 46,
    totalCostUsd: 5.00946,
  });
  assert.deepEqual(summary.toolUsageSummary, {
    toolUseCount: 17,
    toolResultCount: 16,
  });
  assert.deepEqual(summary.contextUsage, {
    source: 'runtime_usage_event',
    knownTokens: 101,
    contextWindow: 258400,
    occupancyRatio: 101 / 258400,
  });
  assert.equal(summary.outputMessageId, '3a62b890-31c9-433c-9d2d-fb3c763ec1ae');
});

test('daemon extracts task run context window from model usage entries', () => {
  const summary = buildTaskRunCompletionSummary(
    {
      type: 'result',
      usage: {
        input_tokens: 100,
        output_tokens: 20,
      },
      modelUsage: {
        'MiniMax-M3': {
          inputTokens: 100,
          outputTokens: 20,
          contextWindow: 200000,
        },
        total: {
          inputTokens: 100,
          outputTokens: 20,
        },
      },
    },
    undefined,
    {
      toolUseCount: 1,
      toolResultCount: 1,
    },
  );

  assert.equal(summary.contextUsage.knownTokens, 120);
  assert.equal(summary.contextUsage.contextWindow, 200000);
  assert.equal(summary.contextUsage.occupancyRatio, 120 / 200000);
});

test('daemon excludes cache reads from fallback task run context occupancy', () => {
  const summary = buildTaskRunCompletionSummary(
    {
      type: 'result',
      usage: {
        input_tokens: 14322,
        output_tokens: 4754,
        cache_read_input_tokens: 329856,
      },
      modelUsage: {
        'MiniMax-M3': {
          contextWindow: 200000,
        },
      },
    },
    {
      source: 'provider-stream-json',
      inputTokens: 14322,
      outputTokens: 4754,
      cacheReadInputTokens: 329856,
    },
    {
      toolUseCount: 13,
      toolResultCount: 13,
    },
  );

  assert.equal(summary.tokenUsage.totalTokens, 348932);
  assert.equal(summary.contextUsage.knownTokens, 19076);
  assert.equal(summary.contextUsage.contextWindow, 200000);
  assert.equal(summary.contextUsage.occupancyRatio, 19076 / 200000);
});

test('daemon normalizes dotted task events from backend payloads', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'task.claimed',
    eventSeq: 44,
    payload: {
      taskId: 'task-1',
      taskNumber: 8,
      channel: '#general',
      assigneeId: 'agent-123',
      changedBy: 'supervisor',
      status: 'in_progress',
      title: 'Pick up worker slice',
    },
    timestamp: '2026-06-05T10:05:00.000Z',
  });

  assert.deepEqual(message, {
    eventType: 'task.claimed',
    eventSeq: '44',
    target: '#general',
    taskId: 'task-1',
    taskNumber: '8',
    status: 'in_progress',
    title: 'Pick up worker slice',
    timestamp: '2026-06-05T10:05:00.000Z',
    actor: 'supervisor',
    senderType: 'task.claimed',
    assigneeId: 'agent-123',
    content: [
      'title=Pick up worker slice',
      'status=in_progress',
    ].join('\n'),
  });
  assert.equal(
    formatRuntimeIncomingMessage(message),
    [
      '[event=task.claimed eventSeq=44 target=#general task=#8 status=in_progress time=2026-06-05T10:05:00.000Z actor=supervisor type=task.claimed] title=Pick up worker slice',
      'status=in_progress',
    ].join('\n'),
  );
});

test('daemon formats thread summary requests for runtime delivery', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'thread.summary_requested',
    eventSeq: 55,
    payload: {
      targetAgentId: 'agent-123',
      target: '#general:abc123ef',
      threadId: 'thread-1',
      threadShortId: 'abc123ef',
      messageId: 'thread-1',
      content: 'Summarize this thread and write it back with slock thread summary.',
      replyCount: 4,
      summaryMaxChars: 300,
    },
    timestamp: '2026-06-05T10:08:00.000Z',
  });

  assert.deepEqual(message, {
    eventType: 'thread.summary_requested',
    eventSeq: '55',
    target: '#general:abc123ef',
    messageId: 'thread-1',
    timestamp: '2026-06-05T10:08:00.000Z',
    actor: 'agent-123',
    senderType: 'thread.summary_requested',
    content: 'Summarize this thread and write it back with slock thread summary.',
  });
  assert.equal(
    formatRuntimeIncomingMessage(message),
    [
      '[event=thread.summary_requested eventSeq=55 target=#general:abc123ef msg=thread-1 time=2026-06-05T10:08:00.000Z actor=agent-123 type=thread.summary_requested] Summarize this thread and write it back with slock thread summary.',
    ].join('\n'),
  );
});

test('daemon formats task memory requests as actionable one-shot reminders', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'task.memory_requested',
    eventSeq: 66,
    payload: {
      targetAgentId: 'agent-123',
      actorId: 'operator-1',
      target: '#general:abc123ef',
      taskId: 'task-1',
      taskNumber: 8,
      status: 'in_review',
      title: 'Pick up worker slice',
      content: 'Write final task memory with slock task summary.',
    },
    timestamp: '2026-06-05T10:09:00.000Z',
  });

  assert.equal(isRuntimeActionableEventType('task.memory_requested'), true);
  assert.equal(isRuntimeActionableEventType('task_memory_requested'), true);
  assert.deepEqual(message, {
    eventType: 'task.memory_requested',
    eventSeq: '66',
    target: '#general:abc123ef',
    taskId: 'task-1',
    taskNumber: '8',
    status: 'in_review',
    title: 'Pick up worker slice',
    timestamp: '2026-06-05T10:09:00.000Z',
    actor: 'operator-1',
    senderType: 'task.memory_requested',
    content: 'Write final task memory with slock task summary.',
  });
  assert.equal(
    formatRuntimeIncomingMessage(message),
    '[event=task.memory_requested eventSeq=66 target=#general:abc123ef task=#8 status=in_review time=2026-06-05T10:09:00.000Z actor=operator-1 type=task.memory_requested] Write final task memory with slock task summary.',
  );
});

test('daemon runtime delivery gate ignores non-actionable event noise', () => {
  assert.equal(isRuntimeActionableEventType('task.created'), true);
  assert.equal(isRuntimeActionableEventType('task_created'), true);
  assert.equal(isRuntimeActionableEventType('task.memory_requested'), true);
  assert.equal(isRuntimeActionableEventType('task_memory_requested'), true);
  assert.equal(isRuntimeActionableEventType('thread.summary_requested'), true);
  assert.equal(isRuntimeActionableEventType('thread_summary_requested'), true);

  assert.equal(isRuntimeActionableEventType('task.updated'), false);
  assert.equal(isRuntimeActionableEventType('task.claimed'), false);
  assert.equal(isRuntimeActionableEventType('thread.followed'), false);
  assert.equal(isRuntimeActionableEventType('memory.updated'), false);
  assert.equal(isRuntimeActionableEventType('memory.proposal.created'), false);
  assert.equal(isRuntimeActionableEventType('runtime.idle'), false);
  assert.equal(isRuntimeActionableEventType('workspace.heartbeat'), false);
});

test('websocket helpers classify messages and build ack/activity payloads', () => {
  const [event] = parseWebSocketPayload(JSON.stringify({
    type: 'message_received',
    message: {
      id: 'msg-1',
      seq: 42,
      content: 'hello',
    },
  }));

  assert.equal(event.type, 'message');
  assert.deepEqual(event.message, {
    id: 'msg-1',
    seq: 42,
    content: 'hello',
  });
  const ack = buildAckPayload(event.message);
  assert.equal(ack.type, 'ack');
  assert.equal(ack.message_id, 'msg-1');
  assert.equal(ack.seq, 42);

  const activity = buildActivityPayload('active');
  assert.equal(activity.type, 'activity');
  assert.equal(activity.status, 'active');
  assert.match(activity.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('websocket helper appends daemon id and event cursor to connection URL', () => {
  assert.equal(
    appendDaemonConnectionParams('ws://127.0.0.1:8000/internal/agent-api/ws', 42, 'daemon-123'),
    'ws://127.0.0.1:8000/internal/agent-api/ws?eventLogCursor=42&daemonId=daemon-123',
  );
});

test('websocket headers include computer id for machine-token daemon auth', () => {
  assert.deepEqual(buildWebSocketHeaders({
    agentId: 'agent-123',
    serverId: 'server-123',
    computerId: 'computer-123',
    token: 'fake_machine_secret',
    serverUrl: 'https://api.slock.ai',
  }), {
    Authorization: 'Bearer fake_machine_secret',
    'X-Agent-Id': 'agent-123',
    'X-Computer-Id': 'computer-123',
  });
});

test('websocket helpers accept dotted message and task event names', () => {
  const [messageEvent] = parseWebSocketPayload(JSON.stringify({
    type: 'message.created',
    seq: 13,
    messageId: 'msg-13',
    target: '#general',
    content: 'hello dotted ws',
  }));

  assert.equal(messageEvent.type, 'message');
  assert.deepEqual(messageEvent.message, {
    type: 'message.created',
    seq: 13,
    messageId: 'msg-13',
    target: '#general',
    content: 'hello dotted ws',
  });

  const [taskEvent] = parseWebSocketPayload(JSON.stringify({
    jsonrpc: '2.0',
    method: 'task.updated',
    params: {
      taskId: 'task-1',
      status: 'done',
    },
  }));

  assert.equal(taskEvent.type, 'event');
  assert.deepEqual(taskEvent.event, {
    type: 'task.updated',
    taskId: 'task-1',
    status: 'done',
  });

  const [threadEvent] = parseWebSocketPayload(JSON.stringify({
    type: 'thread.summary_requested',
    targetAgentId: 'agent-123',
    target: '#general:abc123ef',
    content: 'Summarize this thread.',
  }));

  assert.equal(threadEvent.type, 'event');
  assert.deepEqual(threadEvent.event, {
    type: 'thread.summary_requested',
    targetAgentId: 'agent-123',
    target: '#general:abc123ef',
    content: 'Summarize this thread.',
  });
});

test('websocket helpers classify daemon control commands', () => {
  const [rawControl] = parseWebSocketPayload(JSON.stringify({
    type: 'control',
    command: {
      type: 'start_runtime',
      agentId: 'agent-control',
      workspaceId: 'workspace-control',
      config: {
        runtime: 'claude_code',
        runtimeModel: 'glm-5.1',
      },
    },
  }));

  assert.equal(rawControl.type, 'control');
  assert.deepEqual(parseDaemonControlCommand(rawControl.command), {
    type: 'start_runtime',
    agentId: 'agent-control',
    workspaceId: 'workspace-control',
    config: {
      runtime: 'claude_code',
      runtimeModel: 'glm-5.1',
      workspaceId: 'workspace-control',
    },
  });

  const [rpcControl] = parseWebSocketPayload(JSON.stringify({
    jsonrpc: '2.0',
    method: 'daemon.command.start_runtime',
    params: {
      agent_id: 'agent-rpc',
      workspace_id: 'workspace-rpc',
      config: {
        runtime_command: 'claude',
        workspace_path: '/tmp/agent-rpc',
      },
    },
  }));

  assert.equal(rpcControl.type, 'control');
  assert.deepEqual(parseDaemonControlCommand(rpcControl.command), {
    type: 'start_runtime',
    agentId: 'agent-rpc',
    workspaceId: 'workspace-rpc',
    config: {
      runtimeCommand: 'claude',
      workspacePath: '/tmp/agent-rpc',
      workspaceId: 'workspace-rpc',
    },
  });
});

test('claude runtime sends stream-json user messages with captured session id', () => {
  const driver = new ClaudeRuntimeDriver({
    credential,
    workspacePath: 'D:/workspace',
    wrapperDir: 'D:/workspace/.slock',
  });
  const writes = [];
  driver.child = {
    stdin: {
      writable: true,
      write(chunk) {
        writes.push(String(chunk));
        return true;
      },
    },
  };

  driver.emitLines('stdout', `${JSON.stringify({
    type: 'system',
    subtype: 'session_init',
    session_id: 'session-123',
  })}\n`);

  assert.equal(driver.sessionId, 'session-123');
  assert.equal(driver.sendUserMessage('hello'), true);

  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    },
    session_id: 'session-123',
  });
});

test('claude runtime uses resume session id before init event arrives', () => {
  const driver = new ClaudeRuntimeDriver({
    credential,
    workspacePath: 'D:/workspace',
    wrapperDir: 'D:/workspace/.slock',
    resumeSessionId: 'session-resume-1',
  });
  const writes = [];
  driver.child = {
    stdin: {
      writable: true,
      write(chunk) {
        writes.push(String(chunk));
        return true;
      },
    },
  };

  assert.equal(driver.sessionId, 'session-resume-1');
  assert.equal(driver.sendUserMessage('hello after resume'), true);
  assert.equal(JSON.parse(writes[0]).session_id, 'session-resume-1');
});

test('claude runtime send options can isolate a new scoped session from the current session', () => {
  const driver = new ClaudeRuntimeDriver({
    credential,
    workspacePath: 'D:/workspace',
    wrapperDir: 'D:/workspace/.slock',
    resumeSessionId: 'session-resume-1',
  });
  const writes = [];
  driver.child = {
    stdin: {
      writable: true,
      write(chunk) {
        writes.push(String(chunk));
        return true;
      },
    },
  };

  assert.equal(driver.sendUserMessage('new task scope', { sessionId: null, sessionScopeKey: 'task:task-1' }), true);
  assert.equal(JSON.parse(writes[0]).session_id, undefined);
});

test('claude runtime send options can route to an existing scoped provider session', () => {
  const driver = new ClaudeRuntimeDriver({
    credential,
    workspacePath: 'D:/workspace',
    wrapperDir: 'D:/workspace/.slock',
    resumeSessionId: 'session-channel-1',
  });
  const writes = [];
  const sent = [];
  driver.on('message_sent', (payload) => sent.push(payload));
  driver.child = {
    stdin: {
      writable: true,
      write(chunk) {
        writes.push(String(chunk));
        return true;
      },
    },
  };

  assert.equal(driver.sendUserMessage('existing task scope', { sessionId: 'session-task-1', sessionScopeKey: 'task:task-1' }), true);
  assert.equal(JSON.parse(writes[0]).session_id, 'session-task-1');
  assert.equal(sent[0].sessionScopeKey, 'task:task-1');
  assert.equal(sent[0].session_id, 'session-task-1');
});

test('claude runtime queues messages while busy and flushes at result boundary', () => {
  const driver = new ClaudeRuntimeDriver({
    credential,
    workspacePath: 'D:/workspace',
    wrapperDir: 'D:/workspace/.slock',
  });
  const writes = [];
  driver.child = {
    stdin: {
      writable: true,
      write(chunk) {
        writes.push(String(chunk));
        return true;
      },
    },
  };

  driver.emitLines('stdout', `${JSON.stringify({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }],
    },
  })}\n`);

  assert.equal(driver.busy, true);
  assert.equal(driver.sendUserMessage('queued hello'), false);
  assert.equal(driver.queuedMessageCount, 1);
  assert.equal(writes.length, 0);

  driver.emitLines('stdout', `${JSON.stringify({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'done' }],
    },
  })}\n`);
  assert.equal(writes.length, 0);

  driver.emitLines('stdout', `${JSON.stringify({ type: 'result', stop_reason: 'end_turn' })}\n`);

  assert.equal(driver.queuedMessageCount, 0);
  assert.equal(writes.length, 1);
  assert.equal(JSON.parse(writes[0]).message.content[0].text, 'queued hello');
});

test('claude runtime stop terminates wrapper child process group', async (t) => {
  if (process.platform === 'win32') {
    t.skip('process group signal behavior is POSIX-specific');
    return;
  }

  const root = mkdtempSync(join(tmpdir(), 'aaa-claude-stop-tree-'));
  const marker = join(root, 'grandchild-pid.txt');
  const fakeClaude = join(root, 'fake-claude-wrapper.mjs');
  const grandchild = join(root, 'grandchild.mjs');
  let grandchildPid = null;

  writeFileSync(grandchild, `
setInterval(() => {}, 1000);
`, 'utf-8');
  writeFileSync(fakeClaude, `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const child = spawn(process.execPath, [${JSON.stringify(grandchild)}], {
  stdio: ['ignore', 'ignore', 'ignore'],
});
writeFileSync(${JSON.stringify(marker)}, String(child.pid));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'session_init', session_id: 'stop-tree-session' }) + '\\n');
setInterval(() => {}, 1000);
`, 'utf-8');

  const driver = new ClaudeRuntimeDriver({
    credential,
    workspacePath: root,
    wrapperDir: join(root, '.slock'),
    command: process.execPath,
    commandArgs: [fakeClaude],
  });

  try {
    driver.start();
    await waitFor(() => existsSync(marker));
    grandchildPid = Number(readFileSync(marker, 'utf-8'));
    assert.ok(Number.isInteger(grandchildPid));
    assert.equal(processExists(grandchildPid), true);

    driver.stop();
    await waitFor(() => !processExists(grandchildPid), 5_000);
  } finally {
    if (grandchildPid && processExists(grandchildPid)) {
      try {
        process.kill(grandchildPid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('claude runtime stop force-kills process group when SIGTERM is ignored', async (t) => {
  if (process.platform === 'win32') {
    t.skip('process group signal behavior is POSIX-specific');
    return;
  }

  const root = mkdtempSync(join(tmpdir(), 'aaa-claude-stop-force-'));
  const marker = join(root, 'grandchild-pid.txt');
  const fakeClaude = join(root, 'fake-claude-wrapper.mjs');
  const grandchild = join(root, 'grandchild-ignore-term.mjs');
  let grandchildPid = null;

  writeFileSync(grandchild, `
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);
`, 'utf-8');
  writeFileSync(fakeClaude, `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {});
const child = spawn(process.execPath, [${JSON.stringify(grandchild)}], {
  stdio: ['ignore', 'ignore', 'ignore'],
});
writeFileSync(${JSON.stringify(marker)}, String(child.pid));
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'session_init', session_id: 'force-stop-session' }) + '\\n');
setInterval(() => {}, 1000);
`, 'utf-8');

  const driver = new ClaudeRuntimeDriver({
    credential,
    workspacePath: root,
    wrapperDir: join(root, '.slock'),
    command: process.execPath,
    commandArgs: [fakeClaude],
  });

  try {
    driver.start();
    await waitFor(() => existsSync(marker));
    grandchildPid = Number(readFileSync(marker, 'utf-8'));
    assert.ok(Number.isInteger(grandchildPid));
    assert.equal(processExists(grandchildPid), true);

    driver.stop();
    await waitFor(() => !processExists(grandchildPid), 6_000);
  } finally {
    if (grandchildPid && processExists(grandchildPid)) {
      try {
        process.kill(grandchildPid, 'SIGKILL');
      } catch {
        // Already gone.
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test('chat bridge exposes only runtime_profile_migration_done MCP tool', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/chat-bridge.js', '--agent-id', 'agent-123', '--runtime', 'claude', '--runtime-actions-only'],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'aaa-test-client', version: '0.0.1' });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map(tool => tool.name), ['runtime_profile_migration_done']);

    const result = await client.callTool({
      name: 'runtime_profile_migration_done',
      arguments: { migration_key: 'legacy' },
    });
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /no longer required/);
  } finally {
    await client.close();
  }
});
