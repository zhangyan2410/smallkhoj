import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { postDaemonRpc } from '../dist/attach/attach.js';
import { ClientHandler } from '../dist/daemon/client-handler.js';
import { AgentProxy } from '../dist/proxy/agent-proxy.js';

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

test('slock message send posts to local proxy with bearer token', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ state: 'sent', messageSeq: 7 }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const result = await runCli(['message', 'send', '--target', '#general'], {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
      SLOCK_ALLOW_WRITES: '1',
    }, 'hello from stdin\n');

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Message sent/);
    assert.equal(server.requests.length, 1);
    assert.equal(server.requests[0].req.method, 'POST');
    assert.equal(server.requests[0].req.url, '/internal/agent/agent-1/send');
    assert.equal(server.requests[0].req.headers.authorization, 'Bearer sap_cli_token');
    assert.equal(server.requests[0].req.headers['x-agent-id'], 'agent-1');
    assert.deepEqual(JSON.parse(server.requests[0].body), {
      target: '#general',
      content: 'hello from stdin',
    });
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('write-capable slock commands require explicit opt-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ state: 'sent' }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const result = await runCli(['message', 'send', '--target', '#general', 'hello'], {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Error:.*SLOCK_ALLOW_WRITES/s);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('write-capable slock commands honor target allowlist', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ state: 'sent' }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const result = await runCli(['message', 'send', '--target', '#general', 'hello'], {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
      SLOCK_ALLOW_WRITES: '1',
      SLOCK_WRITE_TARGET_ALLOWLIST: '#safe',
    });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITE_TARGET_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('slock message check maps to receive endpoint with limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ events: [] }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const result = await runCli(['message', 'check', '--limit', '3'], {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
    });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /No new messages/);
    assert.equal(server.requests[0].req.method, 'GET');
    assert.equal(server.requests[0].req.url, '/internal/agent/agent-1/receive?limit=3');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('slock CLI parity commands map to canonical local proxy endpoints', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const env = {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
      SLOCK_ALLOW_WRITES: '1',
    };

    assert.equal((await runCli(['message', 'resolve', 'msg-1'], env)).code, 0);
    assert.equal((await runCli(['thread', 'unfollow', '--target', '#general:msg-1'], env)).code, 0);
    assert.equal((await runCli(['task', 'unclaim', '--id', 'task-1', '--format', 'json'], env)).code, 0);
    assert.equal((await runCli(['profile', 'show', '--handle', '@alice', '--format', 'json'], env)).code, 0);
    assert.equal((await runCli(['reminder', 'snooze', '--id', 'rem-1', '--delay-seconds', '300', '--format', 'json'], env)).code, 0);
    assert.equal((await runCli(['reminder', 'log', '--id', 'rem-1', '--format', 'json'], env)).code, 0);

    assert.deepEqual(server.requests.map(({ req, body }) => ({ method: req.method, url: req.url, body })), [
      {
        method: 'GET',
        url: '/internal/agent/agent-1/messages/msg-1/resolve',
        body: '',
      },
      {
        method: 'POST',
        url: '/internal/agent/agent-1/threads/unfollow',
        body: JSON.stringify({ threadId: '#general:msg-1' }),
      },
      {
        method: 'POST',
        url: '/internal/agent/agent-1/tasks/task-1/unclaim',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent/agent-1/profile/%40alice',
        body: '',
      },
      {
        method: 'PATCH',
        url: '/internal/agent/agent-1/reminders/rem-1',
        body: JSON.stringify({ delaySeconds: 300 }),
      },
      {
        method: 'GET',
        url: '/internal/agent/agent-1/reminders/rem-1/log',
        body: '',
      },
    ]);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('slock memory commands map to scoped memory endpoints and write gates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-memory-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const env = {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
      SLOCK_ALLOW_WRITES: '1',
    };

    assert.equal((await runCli(['memory', 'read', '--scope', 'channel', '--id', 'ch-1', '--path', 'MEMORY.md'], env)).code, 0);
    assert.equal((await runCli(['memory', 'read', '--scope', 'agent', '--id', 'agent-1', '--path', 'private.md'], env)).code, 0);
    assert.equal((await runCli(['memory', 'search', '--scope', 'task', '--id', 'task-1', '--query', 'evidence'], env)).code, 0);
    assert.equal((await runCli(['memory', 'context', '--scope', 'task', '--id', 'task-1', '--query', 'recovery evidence', '--limit', '2'], env)).code, 0);
    assert.equal((await runCli(['memory', 'write', '--scope', 'task', '--id', 'task-1', '--path', 'progress.md'], env, 'progress body')).code, 0);
    assert.equal((await runCli(['memory', 'propose', '--scope', 'channel', '--id', 'ch-1', '--path', 'decisions/foo.md', '--reason', 'durable'], env, 'decision body')).code, 0);
    assert.equal((await runCli(['memory', 'proposals', '--scope', 'channel', '--id', 'ch-1', '--status', 'all'], env)).code, 0);
    assert.equal((await runCli(['memory', 'accept-proposal', '--id', 'proposal-1', '--note', 'promote durable decision'], env)).code, 0);
    assert.equal((await runCli(['memory', 'reject-proposal', '--id', 'proposal-2', '--note', 'keep task-local'], env)).code, 0);
    assert.equal((await runCli(['memory', 'delete', '--scope', 'task', '--id', 'task-1', '--path', 'progress/old.md'], env)).code, 0);

    assert.deepEqual(server.requests.map(({ req, body }) => ({ method: req.method, url: req.url, body })), [
      {
        method: 'GET',
        url: '/internal/agent/agent-1/memory/scopes/channel/ch-1/path/MEMORY.md',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent/agent-1/memory/scopes/agent/agent-1/path/private.md',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent/agent-1/memory/scopes/task/task-1/search?q=evidence',
        body: '',
      },
      {
        method: 'POST',
        url: '/internal/agent/agent-1/memory/context-manifest',
        body: JSON.stringify({ scopeType: 'task', scopeId: 'task-1', prompt: 'recovery evidence', topK: 2 }),
      },
      {
        method: 'PUT',
        url: '/internal/agent/agent-1/memory/scopes/task/task-1/path/progress.md',
        body: JSON.stringify({ contentText: 'progress body' }),
      },
      {
        method: 'POST',
        url: '/internal/agent/agent-1/memory/scopes/channel/ch-1/proposals',
        body: JSON.stringify({ path: 'decisions/foo.md', contentText: 'decision body', reason: 'durable' }),
      },
      {
        method: 'GET',
        url: '/internal/agent/agent-1/memory/scopes/channel/ch-1/proposals?status=all',
        body: '',
      },
      {
        method: 'POST',
        url: '/internal/agent/agent-1/memory/proposals/proposal-1/accept',
        body: JSON.stringify({ reviewNote: 'promote durable decision' }),
      },
      {
        method: 'POST',
        url: '/internal/agent/agent-1/memory/proposals/proposal-2/reject',
        body: JSON.stringify({ reviewNote: 'keep task-local' }),
      },
      {
        method: 'DELETE',
        url: '/internal/agent/agent-1/memory/scopes/task/task-1/path/progress/old.md',
        body: '',
      },
    ]);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('slock task summary and promote map to task memory handoff endpoints', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-task-memory-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const env = {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
      SLOCK_ALLOW_WRITES: '1',
    };

    assert.equal((await runCli([
      'task',
      'summary',
      '--id',
      'task-1',
      '--summary',
      'final result',
      '--progress',
      'implemented and tested',
      '--evidence',
      'evidence/ui.png',
    ], env)).code, 0);
    assert.equal((await runCli([
      'task',
      'promote',
      '--id',
      'task-1',
      '--source-path',
      'final-summary.md',
      '--channel-path',
      'tasks/task-1/final-summary.md',
      '--reason',
      'durable output',
      '--proposal',
    ], env)).code, 0);

    assert.deepEqual(server.requests.map(({ req, body }) => ({ method: req.method, url: req.url, body })), [
      {
        method: 'POST',
        url: '/internal/agent/agent-1/tasks/task-1/memory/summary',
        body: JSON.stringify({
          finalSummary: 'final result',
          progress: 'implemented and tested',
          evidence: ['evidence/ui.png'],
        }),
      },
      {
        method: 'POST',
        url: '/internal/agent/agent-1/tasks/task-1/memory/promote',
        body: JSON.stringify({
          sourcePath: 'final-summary.md',
          channelPath: 'tasks/task-1/final-summary.md',
          reason: 'durable output',
          proposal: true,
        }),
      },
    ]);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('slock memory write requires explicit write opt-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-memory-gate-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const result = await runCli(['memory', 'write', '--scope', 'channel', '--id', 'ch-1', '--path', 'MEMORY.md'], {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
    }, 'body');

    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('slock memory write conflict returns actionable instruction without sha bookkeeping', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-memory-conflict-'));
  const server = await startServer((_req, res) => {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      detail: {
        code: 'MEMORY_CONFLICT',
        currentSha256: 'abc123secretsha',
        instruction: 'Memory changed since you read it. Re-read, merge, then retry or create a proposal.',
      },
    }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const result = await runCli(['memory', 'write', '--scope', 'channel', '--id', 'ch-1', '--path', 'MEMORY.md', '--base-sha', 'oldsha'], {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
      SLOCK_ALLOW_WRITES: '1',
    }, 'body');

    assert.equal(result.code, 1);
    const error = JSON.parse(result.stderr);
    assert.equal(error.code, 'MEMORY_CONFLICT');
    assert.match(error.instruction, /Re-read/);
    assert.doesNotMatch(result.stderr, /abc123secretsha/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('AgentProxy holds sends until pending messages are read', async () => {
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/events') {
      res.end(JSON.stringify({ events: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
  const proxy = new AgentProxy();

  try {
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
    proxy.recordIncomingMessage({ seq: 9, id: 'msg-9', target: '#general', content: 'new context' }, false);

    const held = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/send`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer sap_proxy_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target: '#general', content: 'stale reply' }),
    });
    const heldBody = await held.json();

    assert.equal(held.status, 409);
    assert.equal(heldBody.state, 'held');
    assert.equal(heldBody.reason, 'pending_messages');
    assert.equal(heldBody.pendingCount, 1);
    assert.equal(upstream.requests.length, 0);

    const check = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/receive?limit=10`, {
      headers: { authorization: 'Bearer sap_proxy_token' },
    });
    assert.equal(check.status, 200);

    const sent = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/send`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer sap_proxy_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target: '#general', content: 'fresh reply' }),
    });
    const sentBody = await sent.json();

    assert.equal(sent.status, 200);
    assert.equal(sentBody.state, 'sent');
    assert.equal(upstream.requests.at(-1).req.url, '/internal/agent-api/send');
  } finally {
    proxy.stop();
    await upstream.close();
  }
});

test('AgentProxy consumes SSE event stream messages into inbox', async () => {
  const upstream = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end([
      'event: message',
      'data: {"seq":12,"id":"msg-12","target":"#general","content":"from sse"}',
      '',
      '',
    ].join('\n'));
  });
  const proxy = new AgentProxy();
  const received = [];

  try {
    await proxy.start(0);
    proxy.on('message_received', (event) => {
      received.push(event);
    });
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

    const response = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/receive`, {
      headers: { authorization: 'Bearer sap_proxy_token' },
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /from sse/);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], {
      seq: 12,
      id: 'msg-12',
      target: '#general',
      content: 'from sse',
      agentId: 'agent-1',
    });
    assert.equal(proxy.eventBuffer.snapshot().length, 1);
    assert.equal(proxy.getLastSeenSeq(), 12);
  } finally {
    proxy.stop();
    await upstream.close();
  }
});

test('AgentProxy normalizes dotted SSE message events into inbox', async () => {
  const upstream = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end([
      'event: message.created',
      'data: {"type":"message.created","legacyType":"message_received","seq":21,"eventSeq":101,"messageId":"msg-21","target":"#general","content":"from dotted sse","channelId":"channel-1"}',
      '',
      '',
    ].join('\n'));
  });
  const proxy = new AgentProxy();
  const received = [];

  try {
    await proxy.start(0);
    proxy.on('message_received', (event) => {
      received.push(event);
    });
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

    const response = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/receive`, {
      headers: { authorization: 'Bearer sap_proxy_token' },
    });
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(text, /from dotted sse/);
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], {
      type: 'message.created',
      legacyType: 'message_received',
      seq: 21,
      eventSeq: 101,
      messageId: 'msg-21',
      target: '#general',
      content: 'from dotted sse',
      channelId: 'channel-1',
      agentId: 'agent-1',
    });

    const buffered = proxy.eventBuffer.snapshot();
    assert.equal(buffered.length, 1);
    assert.equal(buffered[0].method, 'message_received');
    assert.deepEqual(buffered[0].params, received[0]);
    assert.equal(proxy.getLastSeenSeq(), 21);
  } finally {
    proxy.stop();
    await upstream.close();
  }
});

test('AgentProxy buffers non-message events without blocking sends', async () => {
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/events') {
      res.end(JSON.stringify({
        events: [{
          type: 'task_created',
          eventSeq: 7,
          taskNumber: 3,
          target: '#general',
          title: 'Implement delegated slice',
          status: 'todo',
        }],
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
  const proxy = new AgentProxy();
  const events = [];
  const messages = [];

  try {
    await proxy.start(0);
    proxy.on('event_received', event => events.push(event));
    proxy.on('message_received', event => messages.push(event));
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

    const check = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/receive?limit=10`, {
      headers: { authorization: 'Bearer sap_proxy_token' },
    });
    assert.equal(check.status, 200);

    const buffered = proxy.eventBuffer.snapshot();
    assert.equal(buffered.length, 1);
    assert.equal(buffered[0].method, 'task_created');
    assert.equal(events.length, 1);
    assert.equal(messages.length, 0);
    assert.equal(proxy.getLastSeenSeq(), 0);

    const sent = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/send`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer sap_proxy_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target: '#general', content: 'ack task event' }),
    });
    const sentBody = await sent.json();

    assert.equal(sent.status, 200);
    assert.equal(sentBody.state, 'sent');
    assert.equal(upstream.requests.at(-1).req.url, '/internal/agent-api/send');
  } finally {
    proxy.stop();
    await upstream.close();
  }
});

test('AgentProxy buffers dotted polling events and tracks message freshness', async () => {
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/events') {
      res.end(JSON.stringify({
        events: [
          {
            type: 'message.created',
            legacyType: 'message_received',
            seq: 34,
            eventSeq: 203,
            messageId: 'msg-34',
            target: '#general',
            content: 'dotted polling message',
            channelId: 'channel-1',
          },
          {
            type: 'task.updated',
            eventSeq: 204,
            payload: {
              taskId: 'task-1',
              taskNumber: 5,
              channel: '#general',
              status: 'done',
              changedBy: 'supervisor',
            },
          },
          {
            type: 'channel.member_joined',
            eventSeq: 205,
            channelId: 'channel-1',
            memberId: 'member-1',
          },
        ],
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ ok: true }));
  });
  const proxy = new AgentProxy();
  const events = [];
  const messages = [];

  try {
    await proxy.start(0);
    proxy.on('event_received', event => events.push(event));
    proxy.on('message_received', event => messages.push(event));
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

    const check = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/receive?limit=10`, {
      headers: { authorization: 'Bearer sap_proxy_token' },
    });
    assert.equal(check.status, 200);

    const buffered = proxy.eventBuffer.snapshot();
    assert.equal(buffered.length, 3);
    assert.equal(buffered[0].method, 'message_received');
    assert.equal(buffered[1].method, 'task.updated');
    assert.equal(buffered[2].method, 'channel.member_joined');
    assert.equal(messages.length, 1);
    assert.equal(events.length, 3);
    assert.equal(buffered[0].params.agentId, 'agent-1');
    assert.equal(buffered[1].params.agentId, 'agent-1');
    assert.equal(messages[0].agentId, 'agent-1');
    assert.equal(events[1].agentId, 'agent-1');
    assert.equal(proxy.getLastSeenSeq(), 34);
    assert.equal(proxy.getReadUpToSeq(), 34);

    const held = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/send`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer sap_proxy_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target: '#general', content: 'stale reply', seenUpToSeq: 33 }),
    });
    const heldBody = await held.json();

    assert.equal(held.status, 409);
    assert.equal(heldBody.reason, 'pending_messages');
    assert.equal(heldBody.pendingCount, 1);
    assert.equal(heldBody.pending[0].method, 'message_received');

    const sent = await fetch(`${proxy.getProxyUrl()}/internal/agent/agent-1/send`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer sap_proxy_token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ target: '#general', content: 'fresh reply', seenUpToSeq: 34 }),
    });
    const sentBody = await sent.json();

    assert.equal(sent.status, 200);
    assert.equal(sentBody.state, 'sent');
    assert.equal(upstream.requests.at(-1).req.url, '/internal/agent-api/send');
  } finally {
    proxy.stop();
    await upstream.close();
  }
});

test('postDaemonRpc forwards JSON-RPC to daemon endpoint', async () => {
  const proxy = new AgentProxy();

  try {
    await proxy.start(0);
    proxy.setDaemonRpcHandler(async (message) => ({
      jsonrpc: '2.0',
      id: message.id,
      result: { method: message.method },
    }));

    const response = await postDaemonRpc(proxy.getProxyUrl(), {
      jsonrpc: '2.0',
      id: 99,
      method: 'daemon/hello',
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, {
      jsonrpc: '2.0',
      id: 99,
      result: { method: 'daemon/hello' },
    });
  } finally {
    proxy.stop();
  }
});

test('ClientHandler forwards extended daemon methods through local proxy bearer auth', async () => {
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/profile/%40alice') {
      res.end(JSON.stringify({ handle: '@alice' }));
      return;
    }
    if (url.pathname === '/internal/agent-api/messages/msg-1/resolve') {
      res.end(JSON.stringify({ resolved: true, messageId: 'msg-1' }));
      return;
    }
    if (url.pathname === '/internal/agent-api/tasks/task-1/unclaim') {
      res.end(JSON.stringify({ unclaimed: true, taskId: 'task-1' }));
      return;
    }
    if (url.pathname === '/internal/agent-api/tasks/task-1/memory/summary') {
      res.end(JSON.stringify({ summarized: true, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/tasks/task-1/memory/promote') {
      res.end(JSON.stringify({ promoted: true, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/reminders/rem-1/log') {
      res.end(JSON.stringify({ reminderId: 'rem-1', entries: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/reminders/rem-1') {
      res.end(JSON.stringify({ reminderId: 'rem-1', method: req.method, body: body ? JSON.parse(body) : null }));
      return;
    }
    if (url.pathname === '/internal/agent-api/knowledge/search') {
      res.end(JSON.stringify({ results: [{ id: 'k-1', q: url.searchParams.get('q') }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/memory/scopes/agent/agent-1/path/private.md') {
      res.end(JSON.stringify({ entry: { scopeType: 'agent', scopeId: 'agent-1', path: 'private.md' } }));
      return;
    }
    if (url.pathname === '/internal/agent-api/memory/scopes/channel/ch-1/proposals') {
      res.end(JSON.stringify({ proposals: [{ id: 'proposal-1', status: url.searchParams.get('status') }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/memory/proposals/proposal-1/accept') {
      res.end(JSON.stringify({ proposal: { id: 'proposal-1', status: 'accepted' }, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/memory/proposals/proposal-2/reject') {
      res.end(JSON.stringify({ proposal: { id: 'proposal-2', status: 'rejected' }, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/memory/scopes/task/task-1/path/progress/old.md') {
      res.end(JSON.stringify({ deleted: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/memory/context-manifest') {
      res.end(JSON.stringify({ manifest: true, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/threads/follow') {
      res.end(JSON.stringify({ followed: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/threads/thread-1' && req.method === 'GET') {
      res.end(JSON.stringify({ thread: { id: 'thread-1' }, replies: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/threads/thread-1/summary' && req.method === 'POST') {
      res.end(JSON.stringify({ updated: true, body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ path: url.pathname }));
  });
  const proxy = new AgentProxy();

  try {
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

    const handler = new ClientHandler({
      getCredential: () => ({
        agentId: 'agent-1',
        serverId: 'server-1',
        token: 'sk_machine_real',
        serverUrl: upstream.url,
      }),
      getProxy: () => proxy,
      getProxyToken: () => 'sap_proxy_token',
      getConfig: () => ({ agentId: 'agent-1' }),
      getSessionManager: () => ({ list: () => [], create: () => 'session-test' }),
      getLogBuffer: () => [],
    });

    const response = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'daemon/profile.get',
      params: { handle: '@alice' },
    });

    assert.deepEqual(response, {
      jsonrpc: '2.0',
      id: 1,
      result: { handle: '@alice' },
    });
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].req.url, '/internal/agent-api/profile/%40alice');
    assert.equal(upstream.requests[0].req.headers.authorization, 'Bearer sk_machine_real');

    const knowledge = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'daemon/knowledge.search',
      params: { query: 'runtime' },
    });

    assert.deepEqual(knowledge, {
      jsonrpc: '2.0',
      id: 2,
      result: { results: [{ id: 'k-1', q: 'runtime' }] },
    });
    assert.equal(upstream.requests.length, 2);
    assert.equal(upstream.requests[1].req.url, '/internal/agent-api/knowledge/search?q=runtime');

    const memoryRead = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 30,
      method: 'daemon/memory.read',
      params: { scope: 'agent', id: 'agent-1', path: 'private.md' },
    });

    assert.deepEqual(memoryRead, {
      jsonrpc: '2.0',
      id: 30,
      result: { entry: { scopeType: 'agent', scopeId: 'agent-1', path: 'private.md' } },
    });
    assert.equal(upstream.requests.length, 3);
    assert.equal(upstream.requests[2].req.url, '/internal/agent-api/memory/scopes/agent/agent-1/path/private.md');

    const memoryProposals = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 34,
      method: 'daemon/memory.proposals',
      params: { scope: 'channel', id: 'ch-1', status: 'all' },
    });

    assert.deepEqual(memoryProposals, {
      jsonrpc: '2.0',
      id: 34,
      result: { proposals: [{ id: 'proposal-1', status: 'all' }] },
    });
    assert.equal(upstream.requests.length, 4);
    assert.equal(upstream.requests[3].req.url, '/internal/agent-api/memory/scopes/channel/ch-1/proposals?status=all');

    const memoryProposalAccept = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 35,
      method: 'daemon/memory.proposal.accept',
      params: { proposalId: 'proposal-1', reviewNote: 'durable' },
    });

    assert.deepEqual(memoryProposalAccept, {
      jsonrpc: '2.0',
      id: 35,
      result: { proposal: { id: 'proposal-1', status: 'accepted' }, body: { reviewNote: 'durable' } },
    });
    assert.equal(upstream.requests.length, 5);
    assert.equal(upstream.requests[4].req.url, '/internal/agent-api/memory/proposals/proposal-1/accept');
    assert.deepEqual(JSON.parse(upstream.requests[4].body), { reviewNote: 'durable' });

    const memoryProposalReject = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 36,
      method: 'daemon/memory.proposal.reject',
      params: { proposalId: 'proposal-2', note: 'task-local' },
    });

    assert.deepEqual(memoryProposalReject, {
      jsonrpc: '2.0',
      id: 36,
      result: { proposal: { id: 'proposal-2', status: 'rejected' }, body: { reviewNote: 'task-local' } },
    });
    assert.equal(upstream.requests.length, 6);
    assert.equal(upstream.requests[5].req.url, '/internal/agent-api/memory/proposals/proposal-2/reject');
    assert.deepEqual(JSON.parse(upstream.requests[5].body), { reviewNote: 'task-local' });

    const memoryDelete = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 37,
      method: 'daemon/memory.delete',
      params: { scope: 'task', id: 'task-1', path: 'progress/old.md' },
    });

    assert.deepEqual(memoryDelete, {
      jsonrpc: '2.0',
      id: 37,
      result: { deleted: true },
    });
    assert.equal(upstream.requests.length, 7);
    assert.equal(upstream.requests[6].req.url, '/internal/agent-api/memory/scopes/task/task-1/path/progress/old.md');

    const memoryContext = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 33,
      method: 'daemon/memory.context',
      params: { scope: 'task', id: 'task-1', prompt: 'recovery evidence', topK: 2 },
    });

    assert.deepEqual(memoryContext, {
      jsonrpc: '2.0',
      id: 33,
      result: { manifest: true, body: { scopeType: 'task', scopeId: 'task-1', prompt: 'recovery evidence', topK: 2 } },
    });
    assert.equal(upstream.requests.length, 8);
    assert.equal(upstream.requests[7].req.url, '/internal/agent-api/memory/context-manifest');
    assert.deepEqual(JSON.parse(upstream.requests[7].body), {
      scopeType: 'task',
      scopeId: 'task-1',
      prompt: 'recovery evidence',
      topK: 2,
    });

    const taskMemorySummary = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 31,
      method: 'daemon/task.memory.summary',
      params: { taskId: 'task-1', finalSummary: 'Done', evidence: ['evidence/ui.png'] },
    });

    assert.deepEqual(taskMemorySummary, {
      jsonrpc: '2.0',
      id: 31,
      result: { summarized: true, body: { finalSummary: 'Done', evidence: ['evidence/ui.png'] } },
    });
    assert.equal(upstream.requests.length, 9);
    assert.equal(upstream.requests[8].req.url, '/internal/agent-api/tasks/task-1/memory/summary');
    assert.deepEqual(JSON.parse(upstream.requests[8].body), { finalSummary: 'Done', evidence: ['evidence/ui.png'] });

    const taskMemoryPromote = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 32,
      method: 'daemon/task.memory.promote',
      params: { taskId: 'task-1', sourcePath: 'final-summary.md', proposal: true },
    });

    assert.deepEqual(taskMemoryPromote, {
      jsonrpc: '2.0',
      id: 32,
      result: { promoted: true, body: { sourcePath: 'final-summary.md', proposal: true } },
    });
    assert.equal(upstream.requests.length, 10);
    assert.equal(upstream.requests[9].req.url, '/internal/agent-api/tasks/task-1/memory/promote');
    assert.deepEqual(JSON.parse(upstream.requests[9].body), { sourcePath: 'final-summary.md', proposal: true });

    const follow = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'daemon/thread.follow',
      params: { threadId: 'thread-1' },
    });

    assert.deepEqual(follow, {
      jsonrpc: '2.0',
      id: 3,
      result: { followed: true },
    });
    assert.equal(upstream.requests.length, 11);
    assert.equal(upstream.requests[10].req.url, '/internal/agent-api/threads/follow');
    assert.deepEqual(JSON.parse(upstream.requests[10].body), { threadId: 'thread-1' });

    const threadRead = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 4,
      method: 'daemon/thread.read',
      params: { threadId: 'thread-1' },
    });

    assert.deepEqual(threadRead, {
      jsonrpc: '2.0',
      id: 4,
      result: { thread: { id: 'thread-1' }, replies: [] },
    });
    assert.equal(upstream.requests.length, 12);
    assert.equal(upstream.requests[11].req.url, '/internal/agent-api/threads/thread-1');

    const threadSummary = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 5,
      method: 'daemon/thread.summary',
      params: { threadId: 'thread-1', summary: 'Current state is clear.' },
    });

    assert.deepEqual(threadSummary, {
      jsonrpc: '2.0',
      id: 5,
      result: { updated: true, body: { summary: 'Current state is clear.' } },
    });
    assert.equal(upstream.requests.length, 13);
    assert.equal(upstream.requests[12].req.url, '/internal/agent-api/threads/thread-1/summary');
    assert.deepEqual(JSON.parse(upstream.requests[12].body), { summary: 'Current state is clear.' });

    const messageResolve = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 6,
      method: 'daemon/message.resolve',
      params: { id: 'msg-1' },
    });

    assert.deepEqual(messageResolve, {
      jsonrpc: '2.0',
      id: 6,
      result: { resolved: true, messageId: 'msg-1' },
    });
    assert.equal(upstream.requests.length, 14);
    assert.equal(upstream.requests[13].req.url, '/internal/agent-api/messages/msg-1/resolve');

    const taskUnclaim = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 7,
      method: 'daemon/task.unclaim',
      params: { id: 'task-1' },
    });

    assert.deepEqual(taskUnclaim, {
      jsonrpc: '2.0',
      id: 7,
      result: { unclaimed: true, taskId: 'task-1' },
    });
    assert.equal(upstream.requests.length, 15);
    assert.equal(upstream.requests[14].req.url, '/internal/agent-api/tasks/task-1/unclaim');

    const reminderSnooze = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 8,
      method: 'daemon/reminder.snooze',
      params: { id: 'rem-1', delaySeconds: 300 },
    });

    assert.deepEqual(reminderSnooze, {
      jsonrpc: '2.0',
      id: 8,
      result: { reminderId: 'rem-1', method: 'PATCH', body: { delaySeconds: 300 } },
    });
    assert.equal(upstream.requests.length, 16);
    assert.equal(upstream.requests[15].req.url, '/internal/agent-api/reminders/rem-1');
    assert.deepEqual(JSON.parse(upstream.requests[15].body), { delaySeconds: 300 });

    const reminderLog = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 9,
      method: 'daemon/reminder.log',
      params: { id: 'rem-1' },
    });

    assert.deepEqual(reminderLog, {
      jsonrpc: '2.0',
      id: 9,
      result: { reminderId: 'rem-1', entries: [] },
    });
    assert.equal(upstream.requests.length, 17);
    assert.equal(upstream.requests[16].req.url, '/internal/agent-api/reminders/rem-1/log');
  } finally {
    proxy.stop();
    await upstream.close();
  }
});

test('ClientHandler marks checked messages read before sending through freshness hold', async () => {
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });
  const proxy = new AgentProxy();

  try {
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
    proxy.recordIncomingMessage({ seq: 9, id: 'msg-9', target: '#general', content: 'new context' }, false);

    const handler = new ClientHandler({
      getCredential: () => ({
        agentId: 'agent-1',
        serverId: 'server-1',
        token: 'sk_machine_real',
        serverUrl: upstream.url,
      }),
      getProxy: () => proxy,
      getProxyToken: () => 'sap_proxy_token',
      getConfig: () => ({ agentId: 'agent-1' }),
      getSessionManager: () => ({ list: () => [], create: () => 'session-test' }),
      getLogBuffer: () => [],
    });

    const held = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 1,
      method: 'daemon/message.send',
      params: { target: '#general', content: 'stale reply' },
    });
    assert.equal(held.result.state, 'held');
    assert.equal(upstream.requests.length, 0);

    const checked = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 2,
      method: 'daemon/message.check',
    });
    assert.equal(checked.result.count, 1);
    assert.equal(proxy.getReadUpToSeq(), 9);

    const sent = await handler.handleMessage({
      jsonrpc: '2.0',
      id: 3,
      method: 'daemon/message.send',
      params: { target: '#general', content: 'fresh reply' },
    });

    assert.equal(sent.result.state, 'sent');
    assert.deepEqual(sent.result.body, {
      target: '#general',
      content: 'fresh reply',
      seenUpToSeq: 9,
    });
    assert.equal(upstream.requests.length, 1);
  } finally {
    proxy.stop();
    await upstream.close();
  }
});

test('slock reminder and attachment aliases route to canonical endpoints', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-cli-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  try {
    const tokenFile = join(root, 'token.txt');
    writeFileSync(tokenFile, 'sap_cli_token', 'utf-8');
    const env = {
      SLOCK_AGENT_PROXY_URL: server.url,
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
      SLOCK_ALLOW_WRITES: '1',
    };

    const createReminder = await runCli(['reminder', 'create', '--title', 'alias', '--fire-at', '2030-01-01T00:00:00Z', '--format', 'json'], env);
    assert.equal(createReminder.code, 0, createReminder.stderr);

    const deleteReminder = await runCli(['reminder', 'delete', '--id', 'rem-1', '--format', 'json'], env);
    assert.equal(deleteReminder.code, 0, deleteReminder.stderr);

    const downloadAttachment = await runCli(['attachment', 'download', '--id', 'file-1'], env);
    assert.equal(downloadAttachment.code, 0, downloadAttachment.stderr);

    assert.deepEqual(server.requests.map(({ req, body }) => ({ method: req.method, url: req.url, body })), [
      {
        method: 'POST',
        url: '/internal/agent/agent-1/reminders',
        body: JSON.stringify({ title: 'alias', fireAt: '2030-01-01T00:00:00Z' }),
      },
      {
        method: 'DELETE',
        url: '/internal/agent/agent-1/reminders/rem-1',
        body: '',
      },
      {
        method: 'GET',
        url: '/api/attachments/file-1/download',
        body: '',
      },
    ]);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('slock CLI reaches fake Slock API through AgentProxy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-e2e-'));
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });

    if (url.pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-1', channels: [{ name: 'general' }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/history') {
      res.end(JSON.stringify({ messages: [], channel: url.searchParams.get('channel') }));
      return;
    }
    if (url.pathname === '/internal/agent-api/events') {
      res.end(JSON.stringify({ events: [], since: url.searchParams.get('since'), limit: url.searchParams.get('limit') }));
      return;
    }
    if (url.pathname === '/internal/agent-api/tasks') {
      if (req.method === 'POST') {
        res.end(JSON.stringify({ task: JSON.parse(body) }));
        return;
      }
      res.end(JSON.stringify({ tasks: [], channel: url.searchParams.get('channel') }));
      return;
    }
    if (url.pathname === '/internal/agent-api/tasks/claim') {
      res.end(JSON.stringify({ claimed: true, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/tasks/update-status') {
      res.end(JSON.stringify({ updated: true, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/tasks/task-1/claim') {
      res.end(JSON.stringify({ claimed: true, body: body ? JSON.parse(body) : {} }));
      return;
    }
    if (url.pathname === '/internal/agent-api/tasks/task-1') {
      res.end(JSON.stringify({ updated: true, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/search') {
      res.end(JSON.stringify({ results: [], q: url.searchParams.get('q'), channel: url.searchParams.get('channel'), limit: url.searchParams.get('limit') }));
      return;
    }
    if (url.pathname === '/internal/agent-api/channel-members') {
      res.end(JSON.stringify({ members: [], channel: url.searchParams.get('channel') }));
      return;
    }
    if (url.pathname === '/internal/agent-api/channels/%23general/join') {
      res.end(JSON.stringify({ joined: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/channels/%23general/leave') {
      res.end(JSON.stringify({ left: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/messages/msg-1/reactions') {
      res.end(JSON.stringify({ reacted: true, body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/profile/%40alice') {
      res.end(JSON.stringify({ handle: '@alice' }));
      return;
    }
    if (url.pathname === '/internal/agent-api/profile') {
      res.end(JSON.stringify({ profile: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/profile/avatar') {
      res.end(JSON.stringify({ avatar: req.headers['content-type']?.startsWith('multipart/form-data') ?? false }));
      return;
    }
    if (url.pathname === '/internal/agent-api/integrations') {
      res.end(JSON.stringify({ integrations: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/integrations/login') {
      res.end(JSON.stringify({ login: 'github', body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/reminders') {
      if (req.method === 'POST') {
        res.end(JSON.stringify({ reminder: JSON.parse(body) }));
        return;
      }
      res.end(JSON.stringify({ reminders: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/reminders/rem-1') {
      res.end(JSON.stringify({ reminderId: 'rem-1', method: req.method, body: body ? JSON.parse(body) : null }));
      return;
    }
    if (url.pathname === '/internal/agent-api/resolve-channel') {
      res.end(JSON.stringify({ channelId: 'chan-general' }));
      return;
    }
    if (url.pathname === '/internal/agent-api/upload') {
      res.end(JSON.stringify({
        attachment: {
          multipart: req.headers['content-type']?.startsWith('multipart/form-data') ?? false,
          size: body.length,
        },
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/attachments/file-1') {
      res.end(JSON.stringify({ file: 'file-1' }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
  });
  const proxy = new AgentProxy();

  try {
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
    const uploadFile = join(root, 'report.txt');
    writeFileSync(tokenFile, 'sap_proxy_token', 'utf-8');
    writeFileSync(uploadFile, 'attachment body', 'utf-8');
    const env = {
      SLOCK_AGENT_PROXY_URL: proxy.getProxyUrl(),
      SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
      SLOCK_AGENT_ID: 'agent-1',
      SLOCK_ALLOW_WRITES: '1',
    };

    const send = await runCli(['message', 'send', '--target', '#general', '--format', 'json'], env, 'hello\n');
    assert.equal(send.code, 0, send.stderr);
    assert.equal(JSON.parse(send.stdout).state, 'sent');

    const serverInfo = await runCli(['server', 'info', '--format', 'json'], env);
    assert.equal(serverInfo.code, 0, serverInfo.stderr);
    assert.deepEqual(JSON.parse(serverInfo.stdout), { id: 'server-1', channels: [{ name: 'general' }] });

    const read = await runCli(['message', 'read', '--channel', '#general', '--limit', '2', '--format', 'json'], env);
    assert.equal(read.code, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), { messages: [], channel: '#general' });

    const check = await runCli(['message', 'check', '--limit', '5', '--format', 'json'], env);
    assert.equal(check.code, 0, check.stderr);
    assert.deepEqual(JSON.parse(check.stdout), { events: [], since: 'latest', limit: '5' });

    const tasks = await runCli(['task', 'list', '--channel', '#general', '--format', 'json'], env);
    assert.equal(tasks.code, 0, tasks.stderr);
    assert.deepEqual(JSON.parse(tasks.stdout), { tasks: [], channel: '#general' });

    const search = await runCli(['message', 'search', '--query', 'hello world', '--channel', '#general', '--limit', '4', '--format', 'json'], env);
    assert.equal(search.code, 0, search.stderr);
    assert.deepEqual(JSON.parse(search.stdout), { results: [], q: 'hello world', channel: '#general', limit: '4' });

    const members = await runCli(['channel', 'members', '--channel', '#general', '--format', 'json'], env);
    assert.equal(members.code, 0, members.stderr);
    assert.deepEqual(JSON.parse(members.stdout), { members: [], channel: '#general' });

    const profile = await runCli(['profile', 'get', '--handle', '@alice', '--format', 'json'], env);
    assert.equal(profile.code, 0, profile.stderr);
    assert.deepEqual(JSON.parse(profile.stdout), { handle: '@alice' });

    const integrations = await runCli(['integration', 'list', '--format', 'json'], env);
    assert.equal(integrations.code, 0, integrations.stderr);
    assert.deepEqual(JSON.parse(integrations.stdout), { integrations: [] });

    const reminders = await runCli(['reminder', 'list', '--format', 'json'], env);
    assert.equal(reminders.code, 0, reminders.stderr);
    assert.deepEqual(JSON.parse(reminders.stdout), { reminders: [] });

    const createTask = await runCli(['task', 'create', '--channel', '#general', '--title', 'Ship CLI', '--format', 'json'], env);
    assert.equal(createTask.code, 0, createTask.stderr);
    assert.deepEqual(JSON.parse(createTask.stdout), { task: { channel: '#general', tasks: [{ title: 'Ship CLI' }] } });

    const claimTask = await runCli(['task', 'claim', '--channel', '#general', '--number', '1', '--format', 'json'], env);
    assert.equal(claimTask.code, 0, claimTask.stderr);
    assert.deepEqual(JSON.parse(claimTask.stdout), { claimed: true, body: { channel: '#general', task_numbers: [1] } });

    const updateTask = await runCli(['task', 'update', '--channel', '#general', '--number', '1', '--status', 'done', '--format', 'json'], env);
    assert.equal(updateTask.code, 0, updateTask.stderr);
    assert.deepEqual(JSON.parse(updateTask.stdout), { updated: true, body: { channel: '#general', task_number: 1, status: 'done' } });

    const joinChannel = await runCli(['channel', 'join', '--channel', '#general', '--format', 'json'], env);
    assert.equal(joinChannel.code, 0, joinChannel.stderr);
    assert.deepEqual(JSON.parse(joinChannel.stdout), { joined: true });

    const leaveChannel = await runCli(['channel', 'leave', '--channel', '#general', '--format', 'json'], env);
    assert.equal(leaveChannel.code, 0, leaveChannel.stderr);
    assert.deepEqual(JSON.parse(leaveChannel.stdout), { left: true });

    const react = await runCli(['message', 'react', '--message-id', 'msg-1', '--reaction', '+1', '--format', 'json'], env);
    assert.equal(react.code, 0, react.stderr);
    assert.deepEqual(JSON.parse(react.stdout), { reacted: true, body: { reaction: '+1' } });

    const updateProfile = await runCli(['profile', 'update', '--status', 'busy', '--format', 'json'], env);
    assert.equal(updateProfile.code, 0, updateProfile.stderr);
    assert.deepEqual(JSON.parse(updateProfile.stdout), { profile: { status: 'busy' } });

    const avatarProfile = await runCli(['profile', 'update', '--avatar-file', uploadFile, '--format', 'json'], env);
    assert.equal(avatarProfile.code, 0, avatarProfile.stderr);
    assert.deepEqual(JSON.parse(avatarProfile.stdout), { avatar: true });

    const integrationLogin = await runCli(['integration', 'login', '--service', 'github', '--scope', 'repo,read:user', '--format', 'json'], env);
    assert.equal(integrationLogin.code, 0, integrationLogin.stderr);
    assert.deepEqual(JSON.parse(integrationLogin.stdout), { login: 'github', body: { service: 'github', scopes: ['repo', 'read:user'] } });

    const createReminder = await runCli(['reminder', 'schedule', '--channel', '#general', '--fire-at', '2030-01-01T00:00:00Z', '--title', 'standup', '--format', 'json'], env);
    assert.equal(createReminder.code, 0, createReminder.stderr);
    assert.deepEqual(JSON.parse(createReminder.stdout), { reminder: { title: 'standup', fireAt: '2030-01-01T00:00:00Z', channel: '#general' } });

    const updateReminder = await runCli(['reminder', 'update', '--id', 'rem-1', '--title', 'new title', '--format', 'json'], env);
    assert.equal(updateReminder.code, 0, updateReminder.stderr);
    assert.deepEqual(JSON.parse(updateReminder.stdout), { reminderId: 'rem-1', method: 'PATCH', body: { title: 'new title' } });

    const deleteReminder = await runCli(['reminder', 'cancel', '--id', 'rem-1', '--format', 'json'], env);
    assert.equal(deleteReminder.code, 0, deleteReminder.stderr);
    assert.deepEqual(JSON.parse(deleteReminder.stdout), { reminderId: 'rem-1', method: 'DELETE', body: null });

    const uploadAttachment = await runCli(['attachment', 'upload', '--channel', '#general', '--path', uploadFile], env);
    assert.equal(uploadAttachment.code, 0, uploadAttachment.stderr);
    const uploadData = JSON.parse(uploadAttachment.stdout);
    assert.equal(uploadData.attachment.multipart, true);
    assert.ok(uploadData.attachment.size > 0);

    const downloadAttachment = await runCli(['attachment', 'view', '--id', 'file-1'], env);
    assert.equal(downloadAttachment.code, 0, downloadAttachment.stderr);
    assert.deepEqual(JSON.parse(downloadAttachment.stdout), { file: 'file-1' });

    const upstreamRequests = upstream.requests.map(({ req, body }) => ({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      agent: req.headers['x-agent-id'],
      capabilities: req.headers['x-slock-agent-active-capabilities'],
      body,
    }));

    assert.deepEqual(upstreamRequests, [
      {
        method: 'POST',
        url: '/internal/agent-api/send',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ target: '#general', content: 'hello' }),
      },
      {
        method: 'GET',
        url: '/internal/agent-api/server',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent-api/history?channel=%23general&limit=2',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent-api/events?limit=5&since=latest',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent-api/tasks?channel=%23general',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent-api/search?q=hello+world&channel=%23general&limit=4',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent-api/channel-members?channel=%23general',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent-api/profile/%40alice',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent-api/integrations',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'GET',
        url: '/internal/agent-api/reminders',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'POST',
        url: '/internal/agent-api/tasks',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ channel: '#general', tasks: [{ title: 'Ship CLI' }] }),
      },
      {
        method: 'POST',
        url: '/internal/agent-api/tasks/claim',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ channel: '#general', task_numbers: [1] }),
      },
      {
        method: 'POST',
        url: '/internal/agent-api/tasks/update-status',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ channel: '#general', task_number: 1, status: 'done' }),
      },
      {
        method: 'POST',
        url: '/internal/agent-api/channels/%23general/join',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'POST',
        url: '/internal/agent-api/channels/%23general/leave',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'POST',
        url: '/internal/agent-api/messages/msg-1/reactions',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ reaction: '+1' }),
      },
      {
        method: 'POST',
        url: '/internal/agent-api/profile',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ status: 'busy' }),
      },
      {
        method: 'POST',
        url: '/internal/agent-api/profile/avatar',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: upstreamRequests[upstreamRequests.findIndex((item) => item.url === '/internal/agent-api/profile/avatar')].body,
      },
      {
        method: 'POST',
        url: '/internal/agent-api/integrations/login',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ service: 'github', scopes: ['repo', 'read:user'] }),
      },
      {
        method: 'POST',
        url: '/internal/agent-api/reminders',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ title: 'standup', fireAt: '2030-01-01T00:00:00Z', channel: '#general' }),
      },
      {
        method: 'PATCH',
        url: '/internal/agent-api/reminders/rem-1',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ title: 'new title' }),
      },
      {
        method: 'DELETE',
        url: '/internal/agent-api/reminders/rem-1',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
      {
        method: 'POST',
        url: '/internal/agent-api/resolve-channel',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: JSON.stringify({ target: '#general' }),
      },
      {
        method: 'POST',
        url: '/internal/agent-api/upload',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: upstreamRequests[upstreamRequests.length - 2].body,
      },
      {
        method: 'GET',
        url: '/internal/agent-api/attachments/file-1',
        auth: 'Bearer sk_machine_real',
        agent: 'agent-1',
        capabilities: 'send,read,mentions,tasks,reactions,server,channels',
        body: '',
      },
    ]);
  } finally {
    proxy.stop();
    await upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});
