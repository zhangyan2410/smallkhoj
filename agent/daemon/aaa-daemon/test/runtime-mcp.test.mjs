import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
  formatRuntimeIncomingMessage,
  normalizeRuntimeIncomingMessage,
  parseDaemonControlCommand,
} from '../dist/daemon/daemon.js';
import { buildAckPayload, buildActivityPayload, parseWebSocketPayload } from '../dist/websocket.js';

const credential = {
  agentId: 'agent-123',
  serverId: 'server-123',
  token: 'sk_machine_secret',
  serverUrl: 'https://api.slock.ai',
};

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

  const prompt = buildSlockSystemPrompt({ credential, workspacePath: 'D:/workspace' });
  assert.match(prompt, /slock CLI ONLY/);
  assert.match(prompt, /Supported commands in this daemon build/);
  assert.match(prompt, /slock message check/);
  assert.match(prompt, /slock server info/);
  assert.match(prompt, /slock task list\|create\|claim\|update/);
  assert.match(prompt, /slock attachment view\|download\|upload/);
  assert.match(prompt, /WRITES_NOT_ALLOWED/);
  assert.doesNotMatch(prompt, /not yet implemented/);
  assert.match(prompt, /Message Targets/);
  assert.match(prompt, /Reuse the exact `target=` value/);
  assert.match(prompt, /Never use `channel=` or a bare channel UUID/);
  assert.match(prompt, /Agent ID: agent-123/);
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

test('daemon normalizes dotted backend message events for Claude runtime delivery', () => {
  const message = normalizeRuntimeIncomingMessage({
    type: 'message.created',
    legacyType: 'message_received',
    seq: 12,
    eventSeq: 99,
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
    target: '#general',
    channelId: 'channel-1',
    messageId: 'msg-12',
    timestamp: '2026-06-05T10:00:00.000Z',
    content: 'from dotted event',
    senderType: 'message.created',
  });
  assert.equal(
    formatRuntimeIncomingMessage(message),
    '[event=message.created eventSeq=99 target=#general channel=channel-1 msg=msg-12 time=2026-06-05T10:00:00.000Z type=message.created] from dotted event',
  );
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
      '[event=task_created eventSeq=7 target=#general task=#3 status=todo actor=supervisor type=task_created] title=Implement delegated slice',
      'status=todo',
      'assignee=@aaa',
      'priority=high',
    ].join('\n'),
  );
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
