import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  PiRuntimeDriver,
  resolveBundledPiLayout,
  resolvePiLaunch,
} from '../dist/runtime/pi-runtime.js';
import { AgentProxy } from '../dist/proxy/agent-proxy.js';

function waitFor(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('Timed out waiting for Pi runtime event'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

test('bundled Pi layout resolves target-relative Node and Pi without PATH', () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-pi-layout-'));
  try {
    const nodePath = join(root, 'runtime', 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
    const piEntry = join(root, 'node_modules', '@mariozechner', 'pi-coding-agent', 'dist', 'cli.js');
    mkdirSync(join(nodePath, '..'), { recursive: true });
    mkdirSync(join(piEntry, '..'), { recursive: true });
    writeFileSync(nodePath, 'embedded-node');
    writeFileSync(piEntry, 'embedded-pi');

    assert.deepEqual(resolveBundledPiLayout({ SMALLKHOJ_DAEMON_INSTALL_ROOT: root }), {
      installRoot: root,
      nodePath,
      piEntry,
      version: '0.73.1',
    });
    assert.equal(resolveBundledPiLayout({ SMALLKHOJ_DAEMON_INSTALL_ROOT: join(root, 'missing') }), undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Pi launch always uses embedded Node, JSON mode, and daemon-owned session', () => {
  const launch = resolvePiLaunch({
    nodePath: '/artifact/runtime/node/bin/node',
    piEntry: '/artifact/node_modules/@mariozechner/pi-coding-agent/dist/cli.js',
    sessionPath: '/daemon/workspaces/guide/.smallkhoj/pi/session.jsonl',
    extensionPath: '/daemon/workspaces/guide/.smallkhoj/pi/extensions/provider.js',
    systemPromptPath: '/daemon/workspaces/guide/.smallkhoj/pi/smallkhoj-system-prompt.md',
    provider: 'smallkhoj-minimax',
    model: 'MiniMax-M2.1',
  });

  assert.equal(launch.command, '/artifact/runtime/node/bin/node');
  assert.deepEqual(launch.args, [
    '/artifact/node_modules/@mariozechner/pi-coding-agent/dist/cli.js',
    '-p',
    '--mode', 'json',
    '--session', '/daemon/workspaces/guide/.smallkhoj/pi/session.jsonl',
    '--extension', '/daemon/workspaces/guide/.smallkhoj/pi/extensions/provider.js',
    '--append-system-prompt', '/daemon/workspaces/guide/.smallkhoj/pi/smallkhoj-system-prompt.md',
    '--provider', 'smallkhoj-minimax',
    '--model', 'MiniMax-M2.1',
  ]);
  assert.equal(JSON.stringify(launch).includes('npx'), false);
  assert.equal(JSON.stringify(launch).includes(' pi '), false);
});

test('Pi runtime sends one prompt through stdin, maps JSON events, and reuses its session file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-pi-runtime-'));
  const marker = join(root, 'marker.json');
  const fakePi = join(root, 'fake-pi.mjs');
  writeFileSync(fakePi, `
import { readFileSync, writeFileSync } from 'node:fs';
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => prompt += chunk);
process.stdin.on('end', () => {
  writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: process.argv.slice(2), prompt, env: {
    home: process.env.PI_CODING_AGENT_DIR,
    proxy: process.env.SMALLKHOJ_LLM_PROXY_URL,
    token: process.env.SMALLKHOJ_LLM_PROXY_TOKEN,
  }}));
  process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } }) + '\\n');
  process.stdout.write(JSON.stringify({ type: 'result', session_id: 'pi-session', duration_ms: 2 }) + '\\n');
});

`);
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  const driver = new PiRuntimeDriver({
    credential: { serverUrl: 'http://127.0.0.1:8000', token: 'machine-secret', agentId: 'guide-agent' },
    workspacePath,
    nodePath: process.execPath,
    piEntry: fakePi,
    proxyUrl: 'http://127.0.0.1:4567',
    proxyToken: 'sap_scoped_test',
    model: 'MiniMax-M2.1',
  });
  const events = [];
  const exits = [];
  driver.on('stream_event', event => events.push(event));
  driver.on('exit', event => exits.push(event));

  try {
    driver.start();
    assert.equal(driver.sendUserMessage('first local prompt'), true);
    await waitFor(() => events.some(event => event.type === 'result'));
    const record = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(record.prompt, 'first local prompt');
    assert.equal(record.argv.includes('--mode'), true);
    assert.equal(record.argv.includes('json'), true);
    assert.equal(record.argv.includes('--session'), true);
    const sessionIndex = record.argv.indexOf('--session');
    assert.equal(record.argv[sessionIndex + 1], join(workspacePath, '.smallkhoj', 'pi', 'session.jsonl'));
    assert.equal(record.env.proxy, 'http://127.0.0.1:4567');
    assert.equal(record.env.token, 'sap_scoped_test');
    assert.equal(JSON.stringify(record).includes('machine-secret'), false);
    assert.equal(existsSync(record.env.home), true);
    assert.equal(driver.sessionId, 'pi-session');
    assert.equal(exits.length, 0, 'a completed one-shot turn keeps the managed driver available');
  } finally {
    driver.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('Pi runtime waits for a capacity lease, heartbeats it, and releases after the full turn', async () => {
  const records = [];
  let acquireCount = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      records.push({ url: req.url, authorization: req.headers.authorization, body: body ? JSON.parse(body) : {} });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url.endsWith('/acquire')) {
        acquireCount += 1;
        res.end(JSON.stringify({ runId: records.at(-1).body.runId, status: acquireCount === 1 ? 'waiting' : 'active', position: acquireCount === 1 ? 1 : null }));
      } else if (req.url.endsWith('/heartbeat')) {
        res.end(JSON.stringify({ runId: records.at(-1).body.runId, status: 'active' }));
      } else {
        res.end(JSON.stringify({ runId: records.at(-1).body.runId, status: 'released' }));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-pi-lease-'));
  const fakePi = join(root, 'fake-pi.mjs');
  writeFileSync(fakePi, `
process.stdin.resume();
process.stdin.on('end', () => setTimeout(() => {
  process.stdout.write(JSON.stringify({ type: 'result', session_id: 'leased-session' }) + '\\n');
}, 35));
`);
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  const driver = new PiRuntimeDriver({
    credential: { serverUrl: 'http://backend.invalid', token: 'machine-secret', agentId: 'guide-agent' },
    workspacePath,
    nodePath: process.execPath,
    piEntry: fakePi,
    proxyUrl,
    proxyToken: 'sap_capacity_test',
    manageCapacity: true,
    leasePollMs: 10,
    leaseHeartbeatMs: 10,
  });
  const events = [];
  driver.on('stream_event', event => events.push(event));

  try {
    driver.start();
    driver.sendUserMessage('leased prompt');
    await waitFor(() => records.some(record => record.url.endsWith('/release')));
    assert.equal(records.filter(record => record.url.endsWith('/acquire')).length >= 2, true);
    assert.equal(records.some(record => record.url.endsWith('/heartbeat')), true);
    assert.equal(records.every(record => record.authorization === 'Bearer sap_capacity_test'), true);
    assert.equal(events.some(event => event.type === 'capacity_waiting'), true);
    assert.equal(events.some(event => event.type === 'capacity_running'), true);
    const runIds = new Set(records.map(record => record.body.runId));
    assert.equal(runIds.size, 1);
  } finally {
    driver.stop();
    await new Promise(resolve => server.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});

test('real bundled Pi loads the scoped provider and streams through AgentProxy without provider credentials', async () => {
  const records = [];
  const backend = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const parsedBody = body ? JSON.parse(body) : {};
      records.push({ url: req.url, headers: req.headers, body: parsedBody });
      if (req.url.endsWith('/llm/runs/acquire')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ runId: parsedBody.runId, status: 'active', position: null }));
        return;
      }
      if (req.url.endsWith('/llm/runs/release')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ runId: parsedBody.runId, status: 'released' }));
        return;
      }
      if (req.url.endsWith('/llm/openai/v1/chat/completions')) {
        const model = parsedBody.model || 'MiniMax-M2.1';
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-smallkhoj-test',
          object: 'chat.completion.chunk',
          created: 1,
          model,
          choices: [{ index: 0, delta: { role: 'assistant', content: 'provider bridge ok' }, finish_reason: null }],
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-smallkhoj-test',
          object: 'chat.completion.chunk',
          created: 1,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 3, total_tokens: 4 },
        })}\n\n`);
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'unexpected test route' }));
    });
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const backendAddress = backend.address();
  const backendUrl = `http://127.0.0.1:${backendAddress.port}`;
  const proxy = new AgentProxy();
  await proxy.start(0);
  proxy.register({
    token: 'sap_real_pi_test',
    credential: {
      serverUrl: backendUrl,
      token: 'agent-machine-credential',
      agentId: 'guide-agent',
    },
    activeCapabilities: 'pi',
  });
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-real-pi-provider-'));
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  const realPiEntry = join(
    process.cwd(),
    'node_modules',
    '@mariozechner',
    'pi-coding-agent',
    'dist',
    'cli.js',
  );
  const driver = new PiRuntimeDriver({
    credential: {
      serverUrl: backendUrl,
      token: 'agent-machine-credential',
      agentId: 'guide-agent',
    },
    workspacePath,
    nodePath: process.execPath,
    piEntry: realPiEntry,
    proxyUrl: proxy.getProxyUrl(),
    proxyToken: 'sap_real_pi_test',
    provider: 'smallkhoj-minimax',
    model: 'MiniMax-M2.1',
    apiFormat: 'openai',
    manageCapacity: true,
    leasePollMs: 10,
    leaseHeartbeatMs: 10_000,
    baseEnv: {
      ...process.env,
      PI_OFFLINE: '1',
      PI_SKIP_VERSION_CHECK: '1',
    },
  });
  const events = [];
  const errors = [];
  driver.on('stream_event', event => events.push(event));
  driver.on('error', error => errors.push(error));

  try {
    driver.start();
    driver.sendUserMessage('Reply with a short confirmation and do not call tools.');
    await waitFor(() => records.some(record => record.url.endsWith('/llm/runs/release')), 15_000);

    const modelRequest = records.find(record => record.url.endsWith('/llm/openai/v1/chat/completions'));
    assert.ok(modelRequest, 'real Pi should call the generated provider endpoint');
    assert.equal(modelRequest.headers.authorization, 'Bearer agent-machine-credential');
    assert.equal(modelRequest.headers['x-agent-id'], 'guide-agent');
    assert.match(modelRequest.headers['x-smallkhoj-llm-run-id'], /^pi-/);
    assert.equal(modelRequest.body.model, 'MiniMax-M2.1');
    assert.equal(JSON.stringify(records).includes('sap_real_pi_test'), false, 'local proxy token must not reach backend');
    assert.equal(errors.length, 0);
    assert.equal(events.some(event => event.type === 'capacity_running'), true);
    assert.equal(events.some(event => event.type === 'message_end' || event.type === 'result'), true);
  } finally {
    driver.stop();
    proxy.stop();
    await new Promise(resolve => backend.close(resolve));
    rmSync(root, { recursive: true, force: true });
  }
});
