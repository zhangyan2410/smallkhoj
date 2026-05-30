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
    assert.deepEqual(JSON.parse(result.stdout), { state: 'sent', messageSeq: 7 });
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
    assert.equal(JSON.parse(result.stderr).code, 'WRITES_NOT_ALLOWED');
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
    assert.equal(JSON.parse(result.stderr).code, 'WRITE_TARGET_NOT_ALLOWED');
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
    assert.deepEqual(JSON.parse(result.stdout), { events: [] });
    assert.equal(server.requests[0].req.method, 'GET');
    assert.equal(server.requests[0].req.url, '/internal/agent/agent-1/receive?limit=3');
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
    });
    assert.equal(proxy.eventBuffer.snapshot().length, 1);
    assert.equal(proxy.getLastSeenSeq(), 12);
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
  const upstream = await startServer((req, res) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/profile/%40alice') {
      res.end(JSON.stringify({ handle: '@alice' }));
      return;
    }
    if (url.pathname === '/internal/agent-api/knowledge/search') {
      res.end(JSON.stringify({ results: [{ id: 'k-1', q: url.searchParams.get('q') }] }));
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

    const createReminder = await runCli(['reminder', 'create', '--title', 'alias', '--fire-at', '2030-01-01T00:00:00Z'], env);
    assert.equal(createReminder.code, 0, createReminder.stderr);

    const deleteReminder = await runCli(['reminder', 'delete', '--id', 'rem-1'], env);
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

    const send = await runCli(['message', 'send', '--target', '#general'], env, 'hello\n');
    assert.equal(send.code, 0, send.stderr);
    assert.equal(JSON.parse(send.stdout).state, 'sent');

    const serverInfo = await runCli(['server', 'info'], env);
    assert.equal(serverInfo.code, 0, serverInfo.stderr);
    assert.deepEqual(JSON.parse(serverInfo.stdout), { id: 'server-1', channels: [{ name: 'general' }] });

    const read = await runCli(['message', 'read', '--channel', '#general', '--limit', '2'], env);
    assert.equal(read.code, 0, read.stderr);
    assert.deepEqual(JSON.parse(read.stdout), { messages: [], channel: '#general' });

    const check = await runCli(['message', 'check', '--limit', '5'], env);
    assert.equal(check.code, 0, check.stderr);
    assert.deepEqual(JSON.parse(check.stdout), { events: [], since: 'latest', limit: '5' });

    const tasks = await runCli(['task', 'list', '--channel', '#general'], env);
    assert.equal(tasks.code, 0, tasks.stderr);
    assert.deepEqual(JSON.parse(tasks.stdout), { tasks: [], channel: '#general' });

    const search = await runCli(['message', 'search', '--query', 'hello world', '--channel', '#general', '--limit', '4'], env);
    assert.equal(search.code, 0, search.stderr);
    assert.deepEqual(JSON.parse(search.stdout), { results: [], q: 'hello world', channel: '#general', limit: '4' });

    const members = await runCli(['channel', 'members', '--channel', '#general'], env);
    assert.equal(members.code, 0, members.stderr);
    assert.deepEqual(JSON.parse(members.stdout), { members: [], channel: '#general' });

    const profile = await runCli(['profile', 'get', '--handle', '@alice'], env);
    assert.equal(profile.code, 0, profile.stderr);
    assert.deepEqual(JSON.parse(profile.stdout), { handle: '@alice' });

    const integrations = await runCli(['integration', 'list'], env);
    assert.equal(integrations.code, 0, integrations.stderr);
    assert.deepEqual(JSON.parse(integrations.stdout), { integrations: [] });

    const reminders = await runCli(['reminder', 'list'], env);
    assert.equal(reminders.code, 0, reminders.stderr);
    assert.deepEqual(JSON.parse(reminders.stdout), { reminders: [] });

    const createTask = await runCli(['task', 'create', '--channel', '#general', '--title', 'Ship CLI'], env);
    assert.equal(createTask.code, 0, createTask.stderr);
    assert.deepEqual(JSON.parse(createTask.stdout), { task: { channel: '#general', tasks: [{ title: 'Ship CLI' }] } });

    const claimTask = await runCli(['task', 'claim', '--channel', '#general', '--number', '1'], env);
    assert.equal(claimTask.code, 0, claimTask.stderr);
    assert.deepEqual(JSON.parse(claimTask.stdout), { claimed: true, body: { channel: '#general', task_numbers: [1] } });

    const updateTask = await runCli(['task', 'update', '--channel', '#general', '--number', '1', '--status', 'done'], env);
    assert.equal(updateTask.code, 0, updateTask.stderr);
    assert.deepEqual(JSON.parse(updateTask.stdout), { updated: true, body: { channel: '#general', task_number: 1, status: 'done' } });

    const joinChannel = await runCli(['channel', 'join', '--channel', '#general'], env);
    assert.equal(joinChannel.code, 0, joinChannel.stderr);
    assert.deepEqual(JSON.parse(joinChannel.stdout), { joined: true });

    const leaveChannel = await runCli(['channel', 'leave', '--channel', '#general'], env);
    assert.equal(leaveChannel.code, 0, leaveChannel.stderr);
    assert.deepEqual(JSON.parse(leaveChannel.stdout), { left: true });

    const react = await runCli(['message', 'react', '--message-id', 'msg-1', '--reaction', '+1'], env);
    assert.equal(react.code, 0, react.stderr);
    assert.deepEqual(JSON.parse(react.stdout), { reacted: true, body: { reaction: '+1' } });

    const updateProfile = await runCli(['profile', 'update', '--status', 'busy'], env);
    assert.equal(updateProfile.code, 0, updateProfile.stderr);
    assert.deepEqual(JSON.parse(updateProfile.stdout), { profile: { status: 'busy' } });

    const avatarProfile = await runCli(['profile', 'update', '--avatar-file', uploadFile], env);
    assert.equal(avatarProfile.code, 0, avatarProfile.stderr);
    assert.deepEqual(JSON.parse(avatarProfile.stdout), { avatar: true });

    const integrationLogin = await runCli(['integration', 'login', '--service', 'github', '--scope', 'repo,read:user'], env);
    assert.equal(integrationLogin.code, 0, integrationLogin.stderr);
    assert.deepEqual(JSON.parse(integrationLogin.stdout), { login: 'github', body: { service: 'github', scopes: ['repo', 'read:user'] } });

    const createReminder = await runCli(['reminder', 'schedule', '--channel', '#general', '--fire-at', '2030-01-01T00:00:00Z', '--title', 'standup'], env);
    assert.equal(createReminder.code, 0, createReminder.stderr);
    assert.deepEqual(JSON.parse(createReminder.stdout), { reminder: { title: 'standup', fireAt: '2030-01-01T00:00:00Z', channel: '#general' } });

    const updateReminder = await runCli(['reminder', 'update', '--id', 'rem-1', '--title', 'new title'], env);
    assert.equal(updateReminder.code, 0, updateReminder.stderr);
    assert.deepEqual(JSON.parse(updateReminder.stdout), { reminderId: 'rem-1', method: 'PATCH', body: { title: 'new title' } });

    const deleteReminder = await runCli(['reminder', 'cancel', '--id', 'rem-1'], env);
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
