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
import { formatRuntimeIncomingMessage, normalizeRuntimeIncomingMessage } from '../dist/daemon/daemon.js';
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
    'target=#general msg=msg-1 time=2026-05-30T00:00:00.000Z sender=@alice type=human\n\nplease check this',
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
