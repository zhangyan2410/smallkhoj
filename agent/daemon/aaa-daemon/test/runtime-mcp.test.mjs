import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import test from 'node:test';

import { buildClaudeArgs, buildClaudeRuntimeEnv, buildSlockSystemPrompt } from '../dist/runtime/claude-runtime.js';

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
  }, {
    PATH: 'BASE',
    SLOCK_AGENT_TOKEN: 'secret',
    SLOCK_AGENT_PROXY_URL: 'http://127.0.0.1:1',
    SLOCK_AGENT_PROXY_TOKEN: 'sap_secret',
    SLOCK_AGENT_PROXY_TOKEN_FILE: 'token-file',
    SLOCK_AGENT_ACTIVE_CAPABILITIES: 'send',
  });

  assert.equal(env.SLOCK_AGENT_ID, 'agent-123');
  assert.equal(env.SLOCK_SERVER_URL, 'https://api.slock.ai');
  assert.equal(env.PATH, `D:/workspace/.slock${process.platform === 'win32' ? ';' : ':'}BASE`);
  assert.equal(env.SLOCK_AGENT_TOKEN, undefined);
  assert.equal(env.SLOCK_AGENT_PROXY_URL, undefined);
  assert.equal(env.SLOCK_AGENT_PROXY_TOKEN_FILE, undefined);
});

test('claude args and prompt force slock CLI communication', () => {
  const args = buildClaudeArgs({ model: 'sonnet' });
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(args.includes('bypassPermissions'));
  assert.ok(args.includes('EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronList,CronDelete'));

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
