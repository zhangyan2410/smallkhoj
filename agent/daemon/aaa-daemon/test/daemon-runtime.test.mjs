import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

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

function waitFor(predicate, timeoutMs = 10_000) {
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
      setTimeout(tick, 100);
    };
    tick();
  });
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveWait) => {
    const timer = setTimeout(resolveWait, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      resolveWait(undefined);
    });
  });
}

function writeFakeClaudeScript(path, marker, includeSend = true) {
  writeFileSync(path, `
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const slockCommand = process.platform === 'win32' ? 'slock.cmd' : 'slock';
const serverInfo = spawnSync(slockCommand, ['server', 'info'], {
  encoding: 'utf-8',
  env: process.env,
  shell: process.platform === 'win32',
});
const result = {
  argv: process.argv.slice(2),
  serverStatus: serverInfo.status,
  serverStdout: (serverInfo.stdout || '').trim(),
  serverStderr: (serverInfo.stderr || '').trim(),
  pathHead: (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')[0],
};
if (${includeSend ? 'true' : 'false'}) {
  const send = spawnSync(slockCommand, ['message', 'send', '--target', '#general', 'hello from runtime'], {
    encoding: 'utf-8',
    env: process.env,
    shell: process.platform === 'win32',
  });
  result.sendStatus = send.status;
  result.sendStdout = (send.stdout || '').trim();
  result.sendStderr = (send.stderr || '').trim();
}
writeFileSync(${JSON.stringify(marker)}, JSON.stringify(result));
`, 'utf-8');
}

test('daemon runtime starts fake Claude with slock wrapper on PATH', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-runtime-'));
  const marker = join(root, 'runtime-marker.json');
  const fakeClaude = join(root, 'fake-claude.mjs');
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-1', channels: [{ name: 'general' }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ events: [{ seq: 3, content: 'hello' }] }));
  });

  writeFakeClaudeScript(fakeClaude, marker, true);

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--server', upstream.url,
    '--ws', 'ws://127.0.0.1:9',
    '--agent-id', 'agent-1',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'claude',
    '--runtime-command', process.execPath,
    '--runtime-command-arg', fakeClaude,
  ], {
    cwd: resolve('.'),
    env: { ...process.env, SLOCK_AGENT_TOKEN: 'sk_machine_real' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  daemon.stdout.setEncoding('utf-8');
  daemon.stderr.setEncoding('utf-8');
  daemon.stdout.on('data', chunk => { stdout += chunk; });
  daemon.stderr.on('data', chunk => { stderr += chunk; });

  try {
    await waitFor(() => existsSync(marker));
    const runtime = JSON.parse(readFileSync(marker, 'utf-8'));

    assert.equal(runtime.serverStatus, 0, runtime.serverStderr);
    assert.match(runtime.serverStdout, /"server-1"/);
    assert.equal(runtime.sendStatus, 0, runtime.sendStderr);
    assert.match(runtime.sendStdout, /"sent"/);
    assert.equal(runtime.pathHead, join(root, '.slock'));

    await waitFor(() => upstream.requests.length >= 2);
    assert.equal(upstream.requests[0].req.url, '/internal/agent-api/server');
    assert.equal(upstream.requests[0].req.headers.authorization, 'Bearer sk_machine_real');
    assert.equal(upstream.requests[0].req.headers['x-agent-id'], 'agent-1');
    assert.equal(upstream.requests[1].req.url, '/internal/agent-api/send');
    assert.deepEqual(JSON.parse(upstream.requests[1].body), {
      target: '#general',
      content: 'hello from runtime',
    });
  } catch (err) {
    assert.fail(`${err.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    daemon.kill('SIGTERM');
    await waitForExit(daemon);
    await upstream.close();
    await new Promise(resolveCleanup => setTimeout(resolveCleanup, 1000));
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Windows can briefly keep spawned script directories locked after process exit.
    }
  }
});

test('daemon start imports existing Slock runtime and Claude can call slock server info', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-import-runtime-'));
  const runtimeDir = join(root, 'existing-runtime', '.slock');
  const tokenDir = join(root, 'tokens');
  const marker = join(root, 'runtime-marker.json');
  const fakeClaude = join(root, 'fake-claude-readonly.mjs');
  mkdirSync(runtimeDir, { recursive: true });
  mkdirSync(tokenDir, { recursive: true });

  const upstream = await startServer((req, res) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-imported', channels: [{ name: 'all' }], agents: [], humans: [] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'unexpected path', path: url.pathname }));
  });

  const originalTokenFile = join(tokenDir, 'pid-test.token');
  writeFileSync(originalTokenFile, 'sap_original_proxy_token', 'utf-8');
  writeFileSync(join(runtimeDir, 'claude-mcp-config.json'), JSON.stringify({
    mcpServers: {
      chat: {
        command: 'node',
        args: [
          'chat-bridge.js',
          '--agent-id', 'agent-imported',
          '--server-url', 'https://api.slock.ai',
          '--auth-token', 'sk_machine_mcp_only',
          '--runtime', 'claude',
          '--runtime-actions-only',
        ],
      },
    },
  }), 'utf-8');
  writeFileSync(join(runtimeDir, 'slock.cmd'), [
    '@echo off',
    `set "SLOCK_AGENT_PROXY_URL=${upstream.url}"`,
    `set "SLOCK_AGENT_PROXY_TOKEN_FILE=${originalTokenFile}"`,
    'set "SLOCK_AGENT_ACTIVE_CAPABILITIES=send,read,mentions,tasks,reactions,server,channels"',
    '"node" "slock-cli.js" %*',
    '',
  ].join('\r\n'), 'utf-8');

  writeFakeClaudeScript(fakeClaude, marker, false);

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--import-slock-runtime', runtimeDir,
    '--ws', 'ws://127.0.0.1:9',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'claude',
    '--runtime-command', process.execPath,
    '--runtime-command-arg', fakeClaude,
  ], {
    cwd: resolve('.'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let stdout = '';
  let stderr = '';
  daemon.stdout.setEncoding('utf-8');
  daemon.stderr.setEncoding('utf-8');
  daemon.stdout.on('data', chunk => { stdout += chunk; });
  daemon.stderr.on('data', chunk => { stderr += chunk; });

  try {
    await waitFor(() => existsSync(marker));
    const runtime = JSON.parse(readFileSync(marker, 'utf-8'));

    assert.equal(runtime.serverStatus, 0, runtime.serverStderr);
    assert.match(runtime.serverStdout, /"server-imported"/);
    assert.equal(runtime.pathHead, join(root, '.slock'));

    await waitFor(() => upstream.requests.length >= 1);
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].req.url, '/internal/agent-api/server');
    assert.equal(upstream.requests[0].req.headers.authorization, 'Bearer sap_original_proxy_token');
    assert.equal(upstream.requests[0].req.headers['x-agent-id'], 'agent-imported');
  } catch (err) {
    assert.fail(`${err.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    daemon.kill('SIGTERM');
    await waitForExit(daemon);
    await upstream.close();
    await new Promise(resolveCleanup => setTimeout(resolveCleanup, 1000));
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Windows can briefly keep spawned script directories locked after process exit.
    }
  }
});
