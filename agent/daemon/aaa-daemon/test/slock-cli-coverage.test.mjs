/**
 * Extended test coverage for slock-cli.ts.
 *
 * Covers 27 error paths and 20 command variant behaviors not tested in the
 * main slock-cli.test.mjs file.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { AgentProxy } from '../dist/proxy/agent-proxy.js';

// ---------------------------------------------------------------------------
// Helpers (same pattern as slock-cli.test.mjs)
// ---------------------------------------------------------------------------

function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf-8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ req, body });
      handler(req, res, body);
    });
  });

  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveServer({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise(resolveClose => server.close(resolveClose)),
      });
    });
  });
}

function runCli(args, env, input = '') {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [resolve('dist/slock-cli.js'), ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolveRun({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

// ---------------------------------------------------------------------------
// Minimal base env used across error-path tests
// ---------------------------------------------------------------------------

function baseEnv(root) {
  const tokenFile = join(root, 'token.txt');
  writeFileSync(tokenFile, 'test_token', 'utf-8');
  return {
    SLOCK_AGENT_PROXY_URL: 'http://127.0.0.1:1',
    SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
    SLOCK_AGENT_ID: 'agent-1',
    SLOCK_ALLOW_WRITES: '1',
  };
}

// ===========================================================================
// ERROR PATH TESTS (items 21-47)
// ===========================================================================

test('slock CLI error paths', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-err-'));

  // #21 - Missing SLOCK_AGENT_PROXY_URL
  await t.test('#21 missing SLOCK_AGENT_PROXY_URL', async () => {
    const env = { ...baseEnv(root) };
    delete env.SLOCK_AGENT_PROXY_URL;
    const result = await runCli(['message', 'check'], env);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_SLOCK_AGENT_PROXY_URL');
  });

  // #22 - Missing SLOCK_AGENT_PROXY_TOKEN_FILE
  await t.test('#22 missing SLOCK_AGENT_PROXY_TOKEN_FILE', async () => {
    const env = { ...baseEnv(root) };
    delete env.SLOCK_AGENT_PROXY_TOKEN_FILE;
    const result = await runCli(['message', 'check'], env);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_SLOCK_AGENT_PROXY_TOKEN_FILE');
  });

  // #23 - Token file does not exist
  await t.test('#23 token file does not exist', async () => {
    const env = {
      ...baseEnv(root),
      SLOCK_AGENT_PROXY_TOKEN_FILE: join(root, 'nonexistent.txt'),
    };
    const result = await runCli(['message', 'check'], env);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'TOKEN_READ_FAILED');
  });

  // #24 - Missing SLOCK_AGENT_ID
  await t.test('#24 missing SLOCK_AGENT_ID', async () => {
    const env = { ...baseEnv(root) };
    delete env.SLOCK_AGENT_ID;
    const result = await runCli(['message', 'check'], env);
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_SLOCK_AGENT_ID');
  });

  // #25 - Unknown command
  await t.test('#25 unknown command', async () => {
    const result = await runCli(['bogus', 'command'], baseEnv(root));
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stderr).code, 'USAGE');
  });

  // #26 - send missing --target
  await t.test('#26 send missing --target', async () => {
    const result = await runCli(['message', 'send', 'hello'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_TARGET');
  });

  // #27 - send no content
  await t.test('#27 send no content', async () => {
    const result = await runCli(['message', 'send', '--target', '#general'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_CONTENT');
  });

  // #28 - react missing --message-id
  await t.test('#28 react missing --message-id', async () => {
    const result = await runCli(['message', 'react', '--reaction', '+1'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_MESSAGE_ID');
  });

  // #29 - react missing --reaction
  await t.test('#29 react missing --reaction', async () => {
    const result = await runCli(['message', 'react', '--message-id', 'msg-1'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_REACTION');
  });

  // #30 - search missing --query
  await t.test('#30 search missing --query', async () => {
    const result = await runCli(['message', 'search'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_QUERY');
  });

  // #31 - channel members missing --channel
  await t.test('#31 channel members missing --channel', async () => {
    const result = await runCli(['channel', 'members'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_CHANNEL');
  });

  // #32 - channel join/leave missing channel
  await t.test('#32 channel join missing channel', async () => {
    const result = await runCli(['channel', 'join'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_CHANNEL');
  });

  await t.test('#32 channel leave missing channel', async () => {
    const result = await runCli(['channel', 'leave'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_CHANNEL');
  });

  // #33 - task claim insufficient args
  await t.test('#33 task claim insufficient args', async () => {
    const result = await runCli(['task', 'claim'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_TASK_ID');
  });

  // #34 - task update no fields
  await t.test('#34 task update no fields', async () => {
    const result = await runCli(['task', 'update', '--id', 'task-1'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_UPDATE_FIELDS');
  });

  // #35 - task create missing --title
  await t.test('#35 task create missing --title', async () => {
    const result = await runCli(['task', 'create', '--channel', '#general'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_TITLE');
  });

  // #36 - task create missing --channel
  await t.test('#36 task create missing --channel', async () => {
    const result = await runCli(['task', 'create', '--title', 'do thing'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_CHANNEL');
  });

  // #37 - profile update no fields
  await t.test('#37 profile update no fields', async () => {
    const result = await runCli(['profile', 'update'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_UPDATE_FIELDS');
  });

  // #38 - integration login missing --service
  await t.test('#38 integration login missing --service', async () => {
    const result = await runCli(['integration', 'login'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_PROVIDER');
  });

  // #39 - reminder create missing title
  await t.test('#39 reminder create missing title', async () => {
    const result = await runCli(['reminder', 'create', '--fire-at', '2030-01-01T00:00:00Z'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_TEXT');
  });

  // #40 - reminder create missing --fire-at + --delay-seconds
  await t.test('#40 reminder create missing --fire-at and --delay-seconds', async () => {
    const result = await runCli(['reminder', 'create', '--title', 'test'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_AT');
  });

  // #41 - reminder update no fields
  await t.test('#41 reminder update no fields', async () => {
    const result = await runCli(['reminder', 'update', '--id', 'rem-1'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_UPDATE_FIELDS');
  });

  // #42 - reminder delete missing --id
  await t.test('#42 reminder delete missing --id', async () => {
    const result = await runCli(['reminder', 'delete'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_REMINDER_ID');
  });

  // #43 - attachment missing --id
  await t.test('#43 attachment view missing --id', async () => {
    const result = await runCli(['attachment', 'view'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_ATTACHMENT_ID');
  });

  // #44 - upload missing --target
  await t.test('#44 upload missing --target', async () => {
    const result = await runCli(['attachment', 'upload', '--file', '/dev/null'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_TARGET');
  });

  // #45 - upload missing --file
  await t.test('#45 upload missing --file', async () => {
    const result = await runCli(['attachment', 'upload', '--target', '#general'], baseEnv(root));
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'MISSING_FILE');
  });

  // #46 - HTTP non-200
  await t.test('#46 HTTP non-200 response', async () => {
    const server = await startServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal' }));
    });
    try {
      const result = await runCli(['message', 'check'], {
        ...baseEnv(root),
        SLOCK_AGENT_PROXY_URL: server.url,
      });
      assert.equal(result.code, 1);
      assert.ok(result.stderr.includes('error'));
    } finally {
      await server.close();
    }
  });

  // #47 - --json format error
  await t.test('#47 --json format error', async () => {
    const result = await runCli(
      ['task', 'update', '--id', 'task-1', '--json', '{invalid'],
      baseEnv(root),
    );
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).code, 'INVALID_JSON');
  });

  // Cleanup
  rmSync(root, { recursive: true, force: true });
});

// ===========================================================================
// COMMAND VARIANT TESTS (items 1-20) -- E2E through AgentProxy
// ===========================================================================

/**
 * Builds a comprehensive upstream fake server that handles all routes needed
 * by the command variant tests.
 */
function buildUpstreamHandler() {
  return (req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });

    const pathname = url.pathname;

    // message send
    if (pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }

    // message check / events
    if (pathname === '/internal/agent-api/events') {
      const params = Object.fromEntries(url.searchParams.entries());
      res.end(JSON.stringify({ events: [], ...params }));
      return;
    }

    // message read / history
    if (pathname === '/internal/agent-api/history') {
      res.end(JSON.stringify({ messages: [], channel: url.searchParams.get('channel') }));
      return;
    }

    // message search
    if (pathname === '/internal/agent-api/search') {
      res.end(JSON.stringify({
        results: [],
        q: url.searchParams.get('q'),
        channel: url.searchParams.get('channel'),
        limit: url.searchParams.get('limit'),
      }));
      return;
    }

    // message reactions
    if (pathname === '/internal/agent-api/messages/msg-1/reactions') {
      res.end(JSON.stringify({ reacted: true, method: req.method, body: JSON.parse(body) }));
      return;
    }
    if (pathname === '/internal/agent-api/messages/msg-2/reactions') {
      res.end(JSON.stringify({ reacted: true, method: req.method, body: JSON.parse(body) }));
      return;
    }

    // channel members
    if (pathname === '/internal/agent-api/channel-members') {
      res.end(JSON.stringify({ members: [], channel: url.searchParams.get('channel') }));
      return;
    }

    // channel join/leave with explicit channel-id
    if (pathname === '/internal/agent-api/channels/chan-explicit-id/join') {
      res.end(JSON.stringify({ joined: true, channelId: 'chan-explicit-id' }));
      return;
    }
    if (pathname === '/internal/agent-api/channels/chan-explicit-id/leave') {
      res.end(JSON.stringify({ left: true, channelId: 'chan-explicit-id' }));
      return;
    }

    // server info
    if (pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-1' }));
      return;
    }

    // task list
    if (pathname === '/internal/agent-api/tasks' && req.method === 'GET') {
      res.end(JSON.stringify({ tasks: [] }));
      return;
    }

    // task create
    if (pathname === '/internal/agent-api/tasks' && req.method === 'POST') {
      res.end(JSON.stringify({ task: JSON.parse(body) }));
      return;
    }

    // task claim by channel+number
    if (pathname === '/internal/agent-api/tasks/claim') {
      res.end(JSON.stringify({ claimed: true, body: JSON.parse(body) }));
      return;
    }

    // task claim by id
    if (pathname === '/internal/agent-api/tasks/task-42/claim') {
      res.end(JSON.stringify({ claimed: true, taskId: 'task-42', body: body ? JSON.parse(body) : {} }));
      return;
    }

    // task update-status
    if (pathname === '/internal/agent-api/tasks/update-status') {
      res.end(JSON.stringify({ updated: true, body: JSON.parse(body) }));
      return;
    }

    // task patch by id
    if (pathname === '/internal/agent-api/tasks/task-99') {
      res.end(JSON.stringify({ updated: true, taskId: 'task-99', body: JSON.parse(body) }));
      return;
    }

    // profile update (POST to /profile)
    if (pathname === '/internal/agent-api/profile' && req.method === 'POST') {
      res.end(JSON.stringify({ profile: JSON.parse(body) }));
      return;
    }

    // profile get (self, GET /profile with no handle)
    if (pathname === '/internal/agent-api/profile') {
      res.end(JSON.stringify({ handle: '@self', method: req.method }));
      return;
    }

    // profile get (by handle)
    if (pathname === '/internal/agent-api/profile/%40bob') {
      res.end(JSON.stringify({ handle: '@bob' }));
      return;
    }

    // reminder list
    if (pathname === '/internal/agent-api/reminders' && req.method === 'GET') {
      res.end(JSON.stringify({ reminders: [] }));
      return;
    }

    // reminder create
    if (pathname === '/internal/agent-api/reminders' && req.method === 'POST') {
      res.end(JSON.stringify({ reminder: JSON.parse(body) }));
      return;
    }

    // reminder update
    if (pathname === '/internal/agent-api/reminders/rem-7') {
      res.end(JSON.stringify({ reminderId: 'rem-7', method: req.method, body: body ? JSON.parse(body) : null }));
      return;
    }

    // resolve-channel
    if (pathname === '/internal/agent-api/resolve-channel') {
      res.end(JSON.stringify({ channelId: 'chan-resolved' }));
      return;
    }

    // upload
    if (pathname === '/internal/agent-api/upload') {
      res.end(JSON.stringify({
        attachment: {
          multipart: req.headers['content-type']?.startsWith('multipart/form-data') ?? false,
          size: body.length,
        },
      }));
      return;
    }

    // attachment view
    if (pathname === '/internal/agent-api/attachments/att-1') {
      res.end(JSON.stringify({ file: 'att-1' }));
      return;
    }

    // attachment download
    if (pathname === '/internal/agent-api/attachments/att-2/download') {
      res.end(JSON.stringify({ file: 'att-2', downloaded: true }));
      return;
    }

    // Catch-all 404
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path: pathname }));
  };
}

test('slock CLI command variants', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cov-'));
  const upstream = await startServer(buildUpstreamHandler());
  const proxy = new AgentProxy();

  await proxy.start(0);
  proxy.register({
    token: 'sap_proxy_token',
    activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
    credential: {
      agentId: 'agent-1',
      serverId: 'server-1',
      token: 'sk_machine_real',
      serverUrl: upstream.url,
    },
  });

  const tokenFile = join(root, 'token.txt');
  const uploadFile = join(root, 'upload.txt');
  writeFileSync(tokenFile, 'sap_proxy_token', 'utf-8');
  writeFileSync(uploadFile, 'upload content here', 'utf-8');
  const env = {
    SLOCK_AGENT_PROXY_URL: proxy.getProxyUrl(),
    SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
    SLOCK_AGENT_ID: 'agent-1',
    SLOCK_ALLOW_WRITES: '1',
  };

  try {

    // #1 - message send inline positional content
    await t.test('#1 message send inline positional content', async () => {
      const result = await runCli(['message', 'send', '--target', '#general', 'hello', 'world'], env);
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.state, 'sent');
      assert.deepEqual(parsed.body, { target: '#general', content: 'hello world' });
    });

    // #2 - message send --attachment-id with multiple IDs
    await t.test('#2 message send --attachment-id multiple', async () => {
      const result = await runCli(
        ['message', 'send', '--target', '#general', '--attachment-id', 'att-1', '--attachment-id', 'att-2', 'with files'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.state, 'sent');
      assert.deepEqual(parsed.body, {
        target: '#general',
        content: 'with files',
        attachmentIds: ['att-1', 'att-2'],
      });
    });

    // #3 - message react --remove (DELETE method)
    await t.test('#3 message react --remove uses DELETE', async () => {
      const result = await runCli(
        ['message', 'react', '--message-id', 'msg-1', '--reaction', '+1', '--remove'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.method, 'DELETE');
      assert.deepEqual(parsed.body, { reaction: '+1' });
    });

    // #4 - message check without --limit (bare check)
    await t.test('#4 message check bare (no --limit)', async () => {
      const result = await runCli(['message', 'check'], env);
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      // Proxy injects since=latest; just verify events is empty
      assert.ok(Array.isArray(parsed.events));
      assert.equal(parsed.events.length, 0);
    });

    // #5 - channel join/leave --channel-id (explicit channelId)
    await t.test('#5 channel join with --channel-id', async () => {
      const result = await runCli(
        ['channel', 'join', '--channel', '#test', '--channel-id', 'chan-explicit-id'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.joined, true);
      assert.equal(parsed.channelId, 'chan-explicit-id');
    });

    await t.test('#5 channel leave with --channel-id', async () => {
      const result = await runCli(
        ['channel', 'leave', '--channel', '#test', '--channel-id', 'chan-explicit-id'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.left, true);
      assert.equal(parsed.channelId, 'chan-explicit-id');
    });

    // #6 - task claim --id <taskId>
    await t.test('#6 task claim by task ID', async () => {
      const result = await runCli(['task', 'claim', '--id', 'task-42'], env);
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.claimed, true);
      assert.equal(parsed.taskId, 'task-42');
    });

    // #7 - task claim --message-id
    await t.test('#7 task claim by --message-id', async () => {
      const result = await runCli(
        ['task', 'claim', '--channel', '#general', '--message-id', 'msg-a', '--message-id', 'msg-b'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.claimed, true);
      assert.deepEqual(parsed.body, {
        channel: '#general',
        message_ids: ['msg-a', 'msg-b'],
      });
    });

    // #8 - task claim --assignee
    await t.test('#8 task claim with --assignee', async () => {
      const result = await runCli(
        ['task', 'claim', '--id', 'task-42', '--assignee', '@bot'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.claimed, true);
      assert.deepEqual(parsed.body, { assignee: '@bot' });
    });

    // #9 - task update --id --title/--assignee (PATCH by task ID)
    await t.test('#9 task update --id with --title and --assignee', async () => {
      const result = await runCli(
        ['task', 'update', '--id', 'task-99', '--title', 'new title', '--assignee', '@dev'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.updated, true);
      assert.equal(parsed.taskId, 'task-99');
      assert.deepEqual(parsed.body, { title: 'new title', assignee: '@dev' });
    });

    // #10 - task update --json
    await t.test('#10 task update --json data field', async () => {
      const result = await runCli(
        ['task', 'update', '--id', 'task-99', '--json', '{"priority":"high"}'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.updated, true);
      assert.deepEqual(parsed.body, { data: { priority: 'high' } });
    });

    // #11 - task create positional title (without --title flag)
    await t.test('#11 task create positional title', async () => {
      const result = await runCli(['task', 'create', '--channel', '#general', 'Build feature'], env);
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.task.title, 'Build feature');
      assert.equal(parsed.task.channel, '#general');
    });

    // #12 - task create --assignee/--status/--message-id/--json
    // Note: must use positional title (not --title flag) to trigger the
    // single-task code path with extended fields. Using --title triggers
    // the batch path which ignores assignee/status/messageId/data.
    await t.test('#12 task create extended fields', async () => {
      const result = await runCli(
        [
          'task', 'create', '--channel', '#general', 'Ship it',
          '--assignee', '@dev', '--status', 'in_progress',
          '--message-id', 'msg-10', '--json', '{"sprint":3}',
        ],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.deepEqual(parsed.task, {
        title: 'Ship it',
        channel: '#general',
        assignee: '@dev',
        status: 'in_progress',
        messageId: 'msg-10',
        data: { sprint: 3 },
      });
    });

    // #13 - task create multiple --title (batch)
    await t.test('#13 task create multiple --title batch', async () => {
      const result = await runCli(
        ['task', 'create', '--channel', '#general', '--title', 'Task A', '--title', 'Task B'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.deepEqual(parsed.task, {
        channel: '#general',
        tasks: [{ title: 'Task A' }, { title: 'Task B' }],
      });
    });

    // #14 - profile get without --handle (own profile)
    await t.test('#14 profile get own (no --handle)', async () => {
      const result = await runCli(['profile', 'get'], env);
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.handle, '@self');
    });

    // #15 - profile update --display-name/--description/--avatar-url/--json
    await t.test('#15 profile update non-status fields', async () => {
      const result = await runCli(
        [
          'profile', 'update',
          '--display-name', 'Alice',
          '--description', 'An agent',
          '--avatar-url', 'https://img.test/alice.png',
          '--json', '{"theme":"dark"}',
        ],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.deepEqual(parsed.profile, {
        displayName: 'Alice',
        description: 'An agent',
        avatarUrl: 'https://img.test/alice.png',
        data: { theme: 'dark' },
      });
    });

    // #16 - reminder create --delay-seconds
    await t.test('#16 reminder create --delay-seconds', async () => {
      const result = await runCli(
        ['reminder', 'create', '--title', 'delayed task', '--delay-seconds', '300'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.deepEqual(parsed.reminder, {
        title: 'delayed task',
        delaySeconds: 300,
      });
    });

    // #17 - reminder create --repeat/--msg-id/--json
    await t.test('#17 reminder create --repeat/--msg-id/--json', async () => {
      const result = await runCli(
        [
          'reminder', 'create',
          '--title', 'standup',
          '--fire-at', '2030-06-01T09:00:00Z',
          '--repeat', 'daily',
          '--msg-id', 'msg-55',
          '--json', '{"timezone":"UTC"}',
        ],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.deepEqual(parsed.reminder, {
        title: 'standup',
        fireAt: '2030-06-01T09:00:00Z',
        repeat: 'daily',
        msgId: 'msg-55',
        data: { timezone: 'UTC' },
      });
    });

    // #18 - reminder update --done
    await t.test('#18 reminder update --done', async () => {
      const result = await runCli(
        ['reminder', 'update', '--id', 'rem-7', '--done'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.reminderId, 'rem-7');
      assert.equal(parsed.method, 'PATCH');
      assert.deepEqual(parsed.body, { done: true });
    });

    // #19 - reminder update --in/--cadence alias flags
    await t.test('#19 reminder update --in/--cadence alias flags', async () => {
      const result = await runCli(
        ['reminder', 'update', '--id', 'rem-7', '--in', '600', '--cadence', 'weekly'],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.reminderId, 'rem-7');
      assert.deepEqual(parsed.body, {
        delaySeconds: 600,
        repeat: 'weekly',
      });
    });

    // #20 - attachment download --output <file> (rawOutputFile)
    await t.test('#20 attachment download --output file', async () => {
      const outputFile = join(root, 'downloaded.json');
      const result = await runCli(
        ['attachment', 'download', '--id', 'att-2', '--output', outputFile],
        env,
      );
      assert.equal(result.code, 0, result.stderr);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.output, outputFile);
      // Verify the file was actually written
      const contents = readFileSync(outputFile, 'utf-8');
      assert.deepEqual(JSON.parse(contents), { file: 'att-2', downloaded: true });
    });

  } finally {
    proxy.stop();
    await upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});
