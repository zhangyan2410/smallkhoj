import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { parseCcsClaudeListOutput } from '../dist/runtime/runtime-provider.js';

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
  slockHome: process.env.SLOCK_HOME,
  agentId: process.env.SLOCK_AGENT_ID,
  currentWorkspacePath: process.env.SLOCK_CURRENT_WORKSPACE_PATH,
  launchId: process.env.SLOCK_AGENT_LAUNCH_ID,
};
const promptFlagIndex = result.argv.indexOf('--append-system-prompt-file');
result.systemPromptFile = promptFlagIndex >= 0 ? result.argv[promptFlagIndex + 1] : null;
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

function writeFakeCcsClaudeScript(path, marker) {
  writeFileSync(path, `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === 'list') {
  process.stdout.write('current  name       id        model\\n');
  process.stdout.write('*        Kimi       kimi-id   kimi-for-coding\\n');
  process.stdout.write('         Zhipu GLM  glm-id    glm-5.1\\n');
  process.exit(0);
}
const slockCommand = process.platform === 'win32' ? 'slock.cmd' : 'slock';
const serverInfo = spawnSync(slockCommand, ['server', 'info'], {
  encoding: 'utf-8',
  env: process.env,
  shell: process.platform === 'win32',
});
const result = {
  provider: args[0],
  model: args[1],
  managedArgs: args.slice(2),
  serverStatus: serverInfo.status,
  serverStdout: (serverInfo.stdout || '').trim(),
  serverStderr: (serverInfo.stderr || '').trim(),
  agentId: process.env.SLOCK_AGENT_ID,
};
writeFileSync(${JSON.stringify(marker)}, JSON.stringify(result));
`, 'utf-8');
  chmodSync(path, 0o755);
}

test('ccs-claude provider list output is parsed into sanitized providers', () => {
  const providers = parseCcsClaudeListOutput([
    'current  name         id                                    model',
    '*        Kimi         960d8ddd-b880-4af0-8544-e1412b4772c7  kimi-for-coding',
    '         Zhipu GLM    15955baf-aff7-42cb-afbd-bb561752f081  glm-5.1',
  ].join('\n'));

  assert.deepEqual(providers.map(item => ({
    id: item.id,
    name: item.name,
    runtime: item.runtime,
    model: item.model,
    source: item.source,
  })), [
    { id: 'Kimi', name: 'Kimi', runtime: 'claude_code', model: 'kimi-for-coding', source: 'cc-switch' },
    { id: 'Zhipu GLM', name: 'Zhipu GLM', runtime: 'claude_code', model: 'glm-5.1', source: 'cc-switch' },
  ]);
});

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
    env: { ...process.env, SLOCK_AGENT_TOKEN: 'sk_machine_real', SLOCK_ALLOW_WRITES: '1' },
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
    assert.equal(runtime.slockHome, join(root, '.slock'));
    assert.match(runtime.launchId, /^pid-/);
    assert.equal(runtime.systemPromptFile, join(root, '.slock', 'claude-system-prompt.md'));
    assert.match(readFileSync(runtime.systemPromptFile, 'utf-8'), /slock CLI ONLY/);
    assert.equal(runtime.argv.includes('--system-prompt'), false);

    await waitFor(() => upstream.requests.some(item => item.req.url === '/internal/agent-api/server'));
    await waitFor(() => upstream.requests.some(item => item.req.url === '/internal/agent-api/send'));
    const serverRequest = upstream.requests.find(item => item.req.url === '/internal/agent-api/server');
    const sendRequest = upstream.requests.find(item => item.req.url === '/internal/agent-api/send');
    assert.equal(serverRequest.req.headers.authorization, 'Bearer sk_machine_real');
    assert.equal(serverRequest.req.headers['x-agent-id'], 'agent-1');
    assert.deepEqual(JSON.parse(sendRequest.body), {
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

test('daemon handles backend start_runtime control command dynamically', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-control-runtime-'));
  const runtimeWorkspace = join(root, 'dynamic-agent-workspace');
  const marker = join(root, 'runtime-marker.json');
  const fakeClaude = join(root, 'fake-claude-control.mjs');
  const registerBodies = [];
  const shutdownBodies = [];
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/daemon/register') {
      registerBodies.push(JSON.parse(body));
      res.end(JSON.stringify({
        registered: true,
        controlCommands: [
          {
            type: 'control',
            command: {
              type: 'start_runtime',
              agentId: 'agent-dynamic',
              workspaceId: 'workspace-dynamic',
              config: {
                runtime: 'claude_code',
                runtimeCommand: process.execPath,
                runtimeCommandArgs: [fakeClaude],
                workspacePath: runtimeWorkspace,
              },
            },
          },
        ],
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/heartbeat') {
      registerBodies.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true, controlCommands: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/shutdown') {
      shutdownBodies.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-control', channels: [{ name: 'general' }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  writeFakeClaudeScript(fakeClaude, marker, true);

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--server', upstream.url,
    '--ws', 'none',
    '--agent-id', 'bootstrap-agent',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'none',
    '--register-daemon',
  ], {
    cwd: resolve('.'),
    env: { ...process.env, SLOCK_AGENT_TOKEN: 'sk_machine_real', SLOCK_ALLOW_WRITES: '1' },
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

    assert.equal(runtime.agentId, 'agent-dynamic');
    assert.equal(runtime.serverStatus, 0, runtime.serverStderr);
    assert.match(runtime.serverStdout, /"server-control"/);
    assert.equal(runtime.sendStatus, 0, runtime.sendStderr);
    assert.match(runtime.sendStdout, /"sent"/);
    assert.equal(runtime.pathHead, join(runtimeWorkspace, '.slock'));
    assert.equal(runtime.slockHome, join(runtimeWorkspace, '.slock'));
    assert.equal(runtime.currentWorkspacePath, runtimeWorkspace);
    assert.equal(runtime.systemPromptFile, join(runtimeWorkspace, '.slock', 'claude-system-prompt.md'));

    await waitFor(() => registerBodies.some(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-dynamic')));
    const runtimeHeartbeat = registerBodies.find(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-dynamic'));
    const workspace = runtimeHeartbeat.workspaces.find(item => item.agentId === 'agent-dynamic');
    assert.equal(workspace.workspaceId, 'workspace-dynamic');
    assert.equal(workspace.runtime, 'claude_code');
    assert.equal(workspace.status, 'running');
    assert.equal(workspace.cwd, runtimeWorkspace);

    await waitFor(() => upstream.requests.some(item => item.req.url === '/internal/agent-api/server'));
    const serverRequest = upstream.requests.find(item => item.req.url === '/internal/agent-api/server');
    assert.equal(serverRequest.req.headers['x-agent-id'], 'agent-dynamic');
  } catch (err) {
    assert.fail(`${err.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    daemon.kill('SIGTERM');
    await waitForExit(daemon);
    await waitFor(() => shutdownBodies.length > 0);
    assert.equal(shutdownBodies.at(-1).status, 'offline');
    await upstream.close();
    await new Promise(resolveCleanup => setTimeout(resolveCleanup, 1000));
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Windows can briefly keep spawned script directories locked after process exit.
    }
  }
});

test('daemon resolves selected runtimeProvider locally through ccs-claude', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-provider-runtime-'));
  const runtimeWorkspace = join(root, 'provider-agent-workspace');
  const marker = join(root, 'provider-runtime-marker.json');
  const fakeCcsClaude = join(root, 'fake-ccs-claude.mjs');
  const registerBodies = [];
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/daemon/register') {
      registerBodies.push(JSON.parse(body));
      res.end(JSON.stringify({
        registered: true,
        controlCommands: [
          {
            type: 'control',
            command: {
              type: 'start_runtime',
              agentId: 'agent-provider',
              workspaceId: 'workspace-provider',
              config: {
                runtime: 'claude_code',
                runtimeProvider: 'Kimi',
                workspacePath: runtimeWorkspace,
              },
            },
          },
        ],
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/heartbeat') {
      registerBodies.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true, controlCommands: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-provider', channels: [{ name: 'general' }] }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  writeFakeCcsClaudeScript(fakeCcsClaude, marker);

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--server', upstream.url,
    '--ws', 'none',
    '--agent-id', 'bootstrap-agent',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'none',
    '--register-daemon',
  ], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      SLOCK_AGENT_TOKEN: 'sk_machine_real',
      SLOCK_CCS_CLAUDE_COMMAND: fakeCcsClaude,
      SLOCK_ALLOW_WRITES: '1',
    },
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
    assert.equal(runtime.provider, 'Kimi');
    assert.equal(runtime.model, 'kimi-for-coding');
    assert.equal(runtime.agentId, 'agent-provider');
    assert.equal(runtime.serverStatus, 0, runtime.serverStderr);
    assert.match(runtime.serverStdout, /"server-provider"/);
    assert.equal(runtime.managedArgs.includes('--append-system-prompt-file'), true);

    await waitFor(() => registerBodies.length > 0);
    const detected = registerBodies[0].detectedRuntimes ?? [];
    assert.ok(detected.some(item => item.runtimeProvider === 'Kimi' && item.provider === 'Kimi'));
    assert.equal(detected.some(item => 'runtimeCommandArgs' in item), false);

    await waitFor(() => registerBodies.some(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-provider')));
    const runtimeHeartbeat = registerBodies.find(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-provider'));
    const workspace = runtimeHeartbeat.workspaces.find(item => item.agentId === 'agent-provider');
    assert.equal(workspace.runtimeProvider, 'Kimi');
    assert.equal('runtimeCommand' in workspace, false);
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
    assert.equal(runtime.slockHome, join(root, '.slock'));
    assert.match(runtime.launchId, /^pid-/);
    assert.equal(runtime.systemPromptFile, join(root, '.slock', 'claude-system-prompt.md'));
    assert.match(readFileSync(runtime.systemPromptFile, 'utf-8'), /Agent ID: agent-imported/);
    assert.equal(runtime.argv.includes('--system-prompt'), false);

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
