import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  daemonRuntimeWorkspacePath,
  defaultDaemonWorkspaceRoot,
} from '../dist/daemon/daemon.js';
import {
  detectRuntimeProviders,
  detectedRuntimesForInventory,
  parseManualRuntimeProviders,
  parseCcSwitchProviderRows,
  parseCcsClaudeListOutput,
  resolveRuntimeProviderLaunch,
} from '../dist/runtime/runtime-provider.js';

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

test('daemon default workspace root is stable and configurable', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-workspace-root-'));
  try {
    assert.equal(
      defaultDaemonWorkspaceRoot({ SMALLKHOJ_DAEMON_WORKSPACE_ROOT: join(root, 'explicit') }),
      join(root, 'explicit'),
    );
    assert.equal(
      defaultDaemonWorkspaceRoot({ SMALLKHOJ_DAEMON_HOME: join(root, 'daemon-home') }),
      join(root, 'daemon-home', 'workspaces'),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('daemon runtime workspace path isolates different computers on the same server', () => {
  const root = join(tmpdir(), 'smallkhoj-daemon-workspaces');
  const first = daemonRuntimeWorkspacePath(root, {
    serverId: 'server-a',
    computerId: 'computer-one',
    workspaceId: 'workspace-shared',
  });
  const second = daemonRuntimeWorkspacePath(root, {
    serverId: 'server-a',
    computerId: 'computer-two',
    workspaceId: 'workspace-shared',
  });

  assert.equal(first, join(root, '.slock-runtimes', 'server-a', 'computer-one', 'workspace-shared'));
  assert.equal(second, join(root, '.slock-runtimes', 'server-a', 'computer-two', 'workspace-shared'));
  assert.notEqual(first, second);
  assert.equal(
    daemonRuntimeWorkspacePath(root, {
      serverId: 'server-a',
      machineId: 'machine-fallback',
      agentId: 'agent-only',
    }),
    join(root, '.slock-runtimes', 'server-a', 'machine-fallback', 'agent-only'),
  );
});

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
process.stdout.write(JSON.stringify({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', id: 'warmup-slock', name: 'Bash', input: { command: 'slock server info' } }] },
}) + '\\n');
process.stdout.write(JSON.stringify({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: 'warmup-slock', content: serverInfo.stdout || serverInfo.stderr || '' }] },
}) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', duration_ms: 1 }) + '\\n');
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

function writeFakeCodexScript(path, marker) {
  writeFileSync(path, `
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

if (process.argv.includes('--version')) {
  process.stdout.write('codex-cli 0.0.0-fake\\n');
  process.exit(0);
}

let prompt = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => { prompt += chunk; });
process.stdin.on('end', () => {
  const slockCommand = process.platform === 'win32' ? 'slock.cmd' : 'slock';
  const serverInfo = spawnSync(slockCommand, ['server', 'info'], {
    encoding: 'utf-8',
    env: process.env,
    shell: process.platform === 'win32',
  });
  const result = {
    argv: process.argv.slice(2),
    prompt,
    serverStatus: serverInfo.status,
    serverStdout: (serverInfo.stdout || '').trim(),
    serverStderr: (serverInfo.stderr || '').trim(),
    pathHead: (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')[0],
    slockHome: process.env.SLOCK_HOME,
    agentId: process.env.SLOCK_AGENT_ID,
    currentWorkspacePath: process.env.SLOCK_CURRENT_WORKSPACE_PATH,
    launchId: process.env.SLOCK_AGENT_LAUNCH_ID,
  };
  process.stdout.write(JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'checked slock server info' }] },
  }) + '\\n');
  writeFileSync(${JSON.stringify(marker)}, JSON.stringify(result));
});
`, 'utf-8');
}

function writeFakeAcpScript(path, marker) {
  writeFileSync(path, `
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true }, authMethods: [] } });
    } else if (msg.method === 'session/new') {
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId: 'fake-acp-daemon-session' } });
    } else if (msg.method === 'session/load') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
    } else if (msg.method === 'session/prompt') {
      const slockCommand = process.platform === 'win32' ? 'slock.cmd' : 'slock';
      const serverInfo = spawnSync(slockCommand, ['server', 'info'], {
        encoding: 'utf-8',
        env: process.env,
        shell: process.platform === 'win32',
      });
      const prompt = (msg.params.prompt ?? []).map(block => block.text ?? '').join('\\n');
      const warmup = prompt.includes('startup readiness check');
      const targetMatch = prompt.match(/\\btarget=([^\\s\\]]+)/);
      const target = targetMatch?.[1] ?? '#general';
      const sendResult = warmup ? null : spawnSync(slockCommand, ['message', 'send', '--target', target, 'fake codex acp reply'], {
        encoding: 'utf-8',
        env: process.env,
        shell: process.platform === 'win32',
      });
      const result = {
        argv: process.argv.slice(2),
        cwd: process.cwd(),
        prompt,
        warmup,
        target,
        serverStatus: serverInfo.status,
        serverStdout: (serverInfo.stdout || '').trim(),
        serverStderr: (serverInfo.stderr || '').trim(),
        sendStatus: sendResult?.status,
        sendStdout: (sendResult?.stdout || '').trim(),
        sendStderr: (sendResult?.stderr || '').trim(),
        pathHead: (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')[0],
        slockHome: process.env.SLOCK_HOME,
        agentId: process.env.SLOCK_AGENT_ID,
        currentWorkspacePath: process.env.SLOCK_CURRENT_WORKSPACE_PATH,
        launchId: process.env.SLOCK_AGENT_LAUNCH_ID,
        sessionId: msg.params.sessionId,
      };
      writeFileSync(${JSON.stringify(marker)}, JSON.stringify(result));
      notify(msg.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'fake acp warmup ok' } });
      notify(msg.params.sessionId, { sessionUpdate: 'usage_update', used: 123, size: 258400 });
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          stopReason: 'end_turn',
          usage: { totalTokens: 123, inputTokens: 100, cachedReadTokens: 12, outputTokens: 23 }
        }
      });
    } else if (msg.method === 'session/cancel') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
    }
  }
});

function send(frame) {
  process.stdout.write(JSON.stringify(frame) + '\\n');
}

function notify(sessionId, update) {
  send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } });
}
`, 'utf-8');
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

test('cc-switch Codex provider rows are parsed into sanitized public Codex providers', () => {
  const providers = parseCcSwitchProviderRows([
    {
      id: 'codex-krill',
      app_type: 'codex',
      name: 'krill',
      settings_config: JSON.stringify({
        auth: { api_key: 'SECRET_TOKEN' },
        config: { model: 'gpt-5.3-codex' },
      }),
    },
    {
      id: 'claude-kimi',
      app_type: 'claude',
      name: 'Kimi',
      settings_config: JSON.stringify({ auth: { api_key: 'OTHER_SECRET' } }),
    },
  ], 'codex');

  assert.deepEqual(providers, [{
    id: 'codex-krill',
    name: 'krill',
    runtime: 'codex',
    model: 'gpt-5.3-codex',
    source: 'cc-switch',
  }]);
  const serialized = JSON.stringify(providers);
  assert.equal(serialized.includes('SECRET_TOKEN'), false);
  assert.equal(serialized.includes('api_key'), false);
  assert.equal(serialized.includes('settings_config'), false);
});

test('daemon loads Codex providers from the local CC Switch database command', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-cc-switch-codex-'));
  const fakeDb = join(root, 'cc-switch.db');
  const fakeSqlite = join(root, 'fake-sqlite.mjs');
  const fakeCodex = join(root, 'fake-codex.mjs');
  writeFileSync(fakeDb, '', 'utf-8');
  writeFakeCodexScript(fakeCodex, join(root, 'unused-marker.json'));
  chmodSync(fakeCodex, 0o755);
  writeFileSync(fakeSqlite, `#!/usr/bin/env node
process.stdout.write(JSON.stringify([{
  id: 'codex-krill',
  app_type: 'codex',
  name: 'krill',
  settings_config: JSON.stringify({
    auth: { api_key: 'SECRET_TOKEN' },
    config: { model: 'gpt-5.3-codex' },
  }),
}]));
`, 'utf-8');
  chmodSync(fakeSqlite, 0o755);

  try {
    const inventory = detectRuntimeProviders({
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      SLOCK_CC_SWITCH_DB: fakeDb,
      SLOCK_SQLITE_COMMAND: fakeSqlite,
      SLOCK_CODEX_COMMAND: fakeCodex,
      SLOCK_CCS_CLAUDE_COMMAND: join(root, 'missing-ccs-claude'),
    });
    const codexProviders = inventory.providers.filter(item => item.runtime === 'codex');
    assert.deepEqual(codexProviders, [{
      id: 'codex-krill',
      name: 'krill',
      runtime: 'codex',
      model: 'gpt-5.3-codex',
      source: 'cc-switch',
    }]);
    assert.equal(JSON.stringify(inventory).includes('SECRET_TOKEN'), false);
    assert.equal(inventory.providers.some(item => item.runtime === 'codex_cli'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('manual runtime provider JSON is parsed into local launch-only provider config', () => {
  const providers = parseManualRuntimeProviders(JSON.stringify([
    {
      id: 'local-codex-krill',
      name: 'Local Codex Krill',
      runtime: 'codex',
      model: 'gpt-5.3-codex',
      command: '/Users/me/bin/codex-acp-wrapper',
      commandArgs: ['--profile', 'krill'],
    },
  ]));

  assert.deepEqual(providers, [{
    id: 'local-codex-krill',
    name: 'Local Codex Krill',
    runtime: 'codex',
    model: 'gpt-5.3-codex',
    command: '/Users/me/bin/codex-acp-wrapper',
    commandArgs: ['--profile', 'krill'],
    source: 'manual',
  }]);

  const detected = detectedRuntimesForInventory({ runtime: 'codex' }, { providers });
  const providerRuntime = detected.find(item => item.runtimeProvider === 'local-codex-krill');
  assert.equal(providerRuntime?.source, 'manual');
  assert.equal('command' in providerRuntime, false);
  assert.equal('commandArgs' in providerRuntime, false);
});

test('daemon resolves manual provider command without exposing it as CC Switch config', () => {
  const launch = resolveRuntimeProviderLaunch('local-codex-krill', {
    providers: [{
      id: 'local-codex-krill',
      name: 'Local Codex Krill',
      runtime: 'codex',
      model: 'gpt-5.3-codex',
      command: '/Users/me/bin/codex-acp-wrapper',
      commandArgs: ['--profile', 'krill'],
      source: 'manual',
    }],
  });

  assert.deepEqual(launch, {
    runtimeProvider: 'local-codex-krill',
    command: '/Users/me/bin/codex-acp-wrapper',
    commandArgs: ['--profile', 'krill'],
    model: 'gpt-5.3-codex',
  });
});

test('daemon detected runtimes include CC Switch Codex providers as public codex', () => {
  const detected = detectedRuntimesForInventory(
    { runtime: 'codex' },
    {
      providers: [{
        id: 'codex-krill',
        name: 'krill',
        runtime: 'codex',
        model: 'gpt-5.3-codex',
        source: 'cc-switch',
      }],
    },
  );

  assert.ok(detected.some(item => (
    item.type === 'codex'
    && item.provider === 'krill'
    && item.runtimeProvider === 'codex-krill'
    && item.model === 'gpt-5.3-codex'
    && item.source === 'cc-switch'
  )));
  assert.equal(JSON.stringify(detected).includes('codex_acp'), false);
});

test('daemon resolves selected CC Switch Codex provider without exposing launch credentials', () => {
  const launch = resolveRuntimeProviderLaunch('krill', {
    codexCommand: 'codex',
    providers: [{
      id: 'codex-krill',
      name: 'krill',
      runtime: 'codex',
      model: 'gpt-5.3-codex',
      source: 'cc-switch',
    }],
  });

  assert.deepEqual(launch, {
    runtimeProvider: 'codex-krill',
    model: 'gpt-5.3-codex',
  });
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
    const systemPrompt = readFileSync(runtime.systemPromptFile, 'utf-8');
    assert.match(systemPrompt, /slock CLI ONLY/);
    assert.match(systemPrompt, new RegExp(join(root, '.slock', 'slock').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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

test('daemon runtime starts fake Codex with slock wrapper on PATH', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-codex-runtime-'));
  const marker = join(root, 'codex-runtime-marker.json');
  const fakeCodex = join(root, 'fake-codex.mjs');
  const upstream = await startServer((req, res) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-codex', channels: [{ name: 'general' }] }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  writeFakeCodexScript(fakeCodex, marker);

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--server', upstream.url,
    '--ws', 'ws://127.0.0.1:9',
    '--agent-id', 'agent-codex',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'codex_cli',
    '--runtime-command', process.execPath,
    '--runtime-command-arg', fakeCodex,
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
    assert.match(runtime.serverStdout, /"server-codex"/);
    assert.equal(runtime.pathHead, join(root, '.slock'));
    assert.equal(runtime.slockHome, join(root, '.slock'));
    assert.match(runtime.launchId, /^pid-/);
    assert.equal(runtime.argv.includes('exec'), true);
    assert.equal(runtime.argv.includes('--json'), true);
    assert.match(runtime.prompt, /Codex Runtime Notes/);
    assert.match(runtime.prompt, new RegExp(`Run \`${join(root, '.slock', 'slock').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} server info\` once`));
    assert.match(readFileSync(join(root, '.slock', 'codex-slock-prompt.md'), 'utf-8'), /Codex Runtime Notes/);

    await waitFor(() => upstream.requests.some(item => item.req.url === '/internal/agent-api/server'));
    const serverRequest = upstream.requests.find(item => item.req.url === '/internal/agent-api/server');
    assert.equal(serverRequest.req.headers.authorization, 'Bearer sk_machine_real');
    assert.equal(serverRequest.req.headers['x-agent-id'], 'agent-codex');
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

test('daemon starts public Codex runtime with ACP implementation and reports workspace heartbeat', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-codex-acp-runtime-'));
  const marker = join(root, 'codex-acp-marker.json');
  const fakeAcp = join(root, 'fake-acp.mjs');
  const registerBodies = [];
  const activityBodies = [];
  const sendBodies = [];
  const memoryContextBodies = [];
  let releaseInbound = false;
  let inboundDelivered = false;
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/daemon/register' || url.pathname === '/internal/agent-api/daemon/heartbeat') {
      registerBodies.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true, registered: true, controlCommands: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/activity') {
      activityBodies.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-acp', channels: [{ name: 'general' }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      sendBodies.push({ headers: req.headers, body: JSON.parse(body) });
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    if (url.pathname === '/internal/agent-api/memory/context-manifest') {
      memoryContextBodies.push({ headers: req.headers, body: JSON.parse(body) });
      res.end(JSON.stringify({
        policy: 'selective',
        sessionScope: { type: 'channel', id: 'channel-general' },
        channelMemories: [{
          path: 'MEMORY.md',
          title: 'Runtime memory policy',
          snippet: 'Inject only short channel memory snippets.',
          contentText: 'FULL CHANNEL MEMORY MUST NOT BE SENT TO RUNTIME',
        }],
        taskMemories: [],
        readMore: {
          channel: 'slock memory search --scope channel --id channel-general --query <terms>',
        },
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/events') {
      if (releaseInbound && !inboundDelivered) {
        inboundDelivered = true;
        res.end(JSON.stringify({
          count: 1,
          eventLogCursor: '1',
          events: [{
            type: 'message_received',
            eventSeq: '1',
            messageId: 'msg-acp-1',
            target: '#general',
            channelId: 'channel-general',
            sender: 'human',
            actor: 'human-1',
            content: 'please reply from codex acp',
          }],
        }));
        return;
      }
      res.end(JSON.stringify({ count: 0, events: [] }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  writeFakeAcpScript(fakeAcp, marker);

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--server', upstream.url,
    '--ws', 'none',
    '--agent-id', 'agent-acp',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'codex',
    '--runtime-command', process.execPath,
    '--runtime-command-arg', fakeAcp,
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

    assert.equal(runtime.agentId, 'agent-acp');
    assert.equal(runtime.serverStatus, 0, runtime.serverStderr);
    assert.match(runtime.serverStdout, /"server-acp"/);
    assert.equal(runtime.pathHead, join(root, '.slock'));
    assert.equal(runtime.slockHome, join(root, '.slock'));
    assert.equal(runtime.currentWorkspacePath, root);
    assert.equal(runtime.sessionId, 'fake-acp-daemon-session');
    assert.match(runtime.prompt, /Codex ACP Runtime Notes/);
    assert.match(runtime.prompt, new RegExp(`Run \`${join(root, '.slock', 'slock').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} server info\` once`));

    await waitFor(() => registerBodies.some(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-acp' && workspace.runtime === 'codex' && workspace.status === 'running')));
    const runtimeHeartbeat = registerBodies.find(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-acp' && workspace.runtime === 'codex' && workspace.status === 'running'));
    const workspace = runtimeHeartbeat.workspaces.find(item => item.agentId === 'agent-acp');
    assert.equal(workspace.runtime, 'codex');
    assert.equal(workspace.status, 'running');
    assert.equal(workspace.sessionId, 'fake-acp-daemon-session');
    assert.equal(workspace.cwd, root);
    assert.equal(typeof workspace.pid, 'number');

    await waitFor(() => activityBodies.some(item => item.type === 'runtime_idle'));
    const idle = activityBodies.find(item => item.type === 'runtime_idle');
    assert.equal(idle.description, 'Idle');

    releaseInbound = true;
    await waitFor(() => sendBodies.length > 0, 8_000);
    assert.equal(sendBodies[0].headers['x-agent-id'], 'agent-acp');
    assert.equal(sendBodies[0].body.target, '#general');
    assert.equal(sendBodies[0].body.content, 'fake codex acp reply');
    await waitFor(() => memoryContextBodies.length > 0);
    assert.equal(memoryContextBodies[0].headers['x-agent-id'], 'agent-acp');
    assert.deepEqual(memoryContextBodies[0].body, {
      scopeType: 'channel',
      scopeId: 'channel-general',
      prompt: '[eventSeq=1 target=#general channel=channel-general msg=msg-acp-1 sender=human actor=human-1 type=message_received] human: please reply from codex acp',
      topK: 3,
    });
    await waitFor(() => {
      const latestRuntime = JSON.parse(readFileSync(marker, 'utf-8'));
      return latestRuntime.prompt.includes('## Slock Memory Context');
    });
    const inboundRuntime = JSON.parse(readFileSync(marker, 'utf-8'));
    assert.match(inboundRuntime.prompt, /MEMORY\.md - Runtime memory policy: Inject only short channel memory snippets\./);
    assert.doesNotMatch(inboundRuntime.prompt, /FULL CHANNEL MEMORY MUST NOT BE SENT TO RUNTIME/);

    await waitFor(() => activityBodies.some(item => item.type === 'runtime_working'));
    const working = activityBodies.find(item => item.type === 'runtime_working');
    assert.equal(working.description, 'Working on message');
    assert.equal(working.details.target, '#general');
    await waitFor(() => activityBodies.filter(item => item.type === 'runtime_idle').length >= 2);
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
  const runtimeWorkspace = join(root, '.slock-runtimes', 'server-control', 'computer-control', 'workspace-dynamic');
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
    env: {
      ...process.env,
      SLOCK_AGENT_TOKEN: 'sk_machine_real',
      SLOCK_SERVER_ID: 'server-control',
      SLOCK_COMPUTER_ID: 'computer-control',
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

    assert.equal(runtime.agentId, 'agent-dynamic');
    assert.equal(runtime.serverStatus, 0, runtime.serverStderr);
    assert.match(runtime.serverStdout, /"server-control"/);
    assert.equal(runtime.sendStatus, 0, runtime.sendStderr);
    assert.match(runtime.sendStdout, /"sent"/);
    assert.equal(runtime.pathHead, join(runtimeWorkspace, '.slock'));
    assert.equal(runtime.slockHome, join(runtimeWorkspace, '.slock'));
    assert.equal(runtime.currentWorkspacePath, runtimeWorkspace);
    assert.equal(runtime.systemPromptFile, join(runtimeWorkspace, '.slock', 'claude-system-prompt.md'));

    await waitFor(() => registerBodies.some(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-dynamic' && workspace.status === 'running')));
    const runtimeHeartbeat = registerBodies.find(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-dynamic' && workspace.status === 'running'));
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

test('daemon foreground process stays alive after machine connect without runtime child', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-foreground-keepalive-'));
  const registerBodies = [];
  const connectToken = 'sk_connect_keepalive';
  const machineToken = 'sk_machine_keepalive';
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/daemon/connect') {
      assert.equal(req.headers.authorization, `Bearer ${connectToken}`);
      res.end(JSON.stringify({
        connected: true,
        daemonId: 'daemon-keepalive',
        machineToken,
        computer: { serverId: 'server-keepalive' },
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/register' || url.pathname === '/internal/agent-api/daemon/heartbeat') {
      registerBodies.push(JSON.parse(body));
      assert.equal(req.headers.authorization, `Bearer ${machineToken}`);
      res.end(JSON.stringify({ ok: true, controlCommands: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--server', upstream.url,
    '--ws', 'none',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'none',
    '--register-daemon',
  ], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      SLOCK_CONNECT_TOKEN: connectToken,
      AAA_DAEMON_MACHINE_ID_FILE: join(root, 'machine-id'),
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
    await waitFor(() => registerBodies.length > 0);
    await new Promise(resolveWait => setTimeout(resolveWait, 1200));
    assert.equal(daemon.exitCode, null, `daemon exited early\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    daemon.kill('SIGTERM');
    await waitForExit(daemon);
    await upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('smallkhoj-daemon packaged CLI connect starts daemon with one-time ticket', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-daemon-cli-connect-'));
  const registerBodies = [];
  const connectToken = 'sk_connect_cli';
  const machineToken = 'sk_machine_cli';
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/daemon/connect') {
      assert.equal(req.headers.authorization, `Bearer ${connectToken}`);
      const payload = JSON.parse(body);
      assert.equal(payload.daemonVersion, '0.2.0');
      res.end(JSON.stringify({
        connected: true,
        daemonId: 'daemon-cli-connect',
        machineToken,
        computer: { serverId: 'server-cli-connect' },
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/register' || url.pathname === '/internal/agent-api/daemon/heartbeat') {
      registerBodies.push(JSON.parse(body));
      assert.equal(req.headers.authorization, `Bearer ${machineToken}`);
      res.end(JSON.stringify({ ok: true, controlCommands: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'connect',
    '--token', connectToken,
    '--server', upstream.url,
    '--ws', 'none',
    '--proxy-port', '0',
    '--pid-file', join(root, 'smallkhoj-daemon.pid'),
    '--workspace', root,
  ], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      AAA_DAEMON_MACHINE_ID_FILE: join(root, 'machine-id'),
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
    await waitFor(() => registerBodies.length > 0 || daemon.exitCode !== null);
    if (registerBodies.length === 0) {
      assert.fail(`packaged CLI connect exited before daemon registration\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    const firstRegister = registerBodies[0];
    assert.equal(firstRegister.daemonVersion, '0.2.0');
    assert.equal(firstRegister.workspaces.length, 0);
    assert.equal(daemon.exitCode, null, `daemon exited early\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    daemon.kill('SIGTERM');
    await waitForExit(daemon);
    await upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('smallkhoj-daemon supports Raft-style one-line npx onboarding arguments', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-daemon-npx-onboarding-'));
  const registerBodies = [];
  const connectToken = 'sk_connect_npx_style';
  const machineToken = 'sk_machine_npx_style';
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/daemon/connect') {
      assert.equal(req.headers.authorization, `Bearer ${connectToken}`);
      const payload = JSON.parse(body);
      assert.equal(payload.daemonVersion, '0.2.0');
      res.end(JSON.stringify({
        connected: true,
        daemonId: 'daemon-npx-style-connect',
        machineToken,
        computer: { serverId: 'server-npx-style-connect' },
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/register' || url.pathname === '/internal/agent-api/daemon/heartbeat') {
      registerBodies.push(JSON.parse(body));
      assert.equal(req.headers.authorization, `Bearer ${machineToken}`);
      res.end(JSON.stringify({ ok: true, controlCommands: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    '--server-url', upstream.url,
    '--api-key', connectToken,
  ], {
    cwd: root,
    env: {
      ...process.env,
      AAA_DAEMON_MACHINE_ID_FILE: join(root, 'machine-id'),
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
    await waitFor(() => registerBodies.length > 0 || daemon.exitCode !== null);
    if (registerBodies.length === 0) {
      assert.fail(`one-line npx-style onboarding exited before daemon registration\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    assert.equal(registerBodies[0].daemonVersion, '0.2.0');
    assert.equal(daemon.exitCode, null, `daemon exited early\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    daemon.kill('SIGTERM');
    await waitForExit(daemon);
    await upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('smallkhoj-daemon connect uses a computer-scoped default runtime workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-daemon-computer-workspace-'));
  const workspaceRoot = join(root, 'workspace-root');
  const fakeClaude = join(root, 'fake-claude-computer-workspace.mjs');
  const marker = join(root, 'runtime-marker.json');
  const connectToken = 'sk_connect_computer_workspace';
  const machineToken = 'sk_machine_computer_workspace';
  const serverId = 'server-connect-workspace';
  const computerId = 'computer-connect-workspace';
  const workspaceId = 'workspace-connect-runtime';
  const runtimeWorkspace = daemonRuntimeWorkspacePath(workspaceRoot, {
    serverId,
    computerId,
    workspaceId,
  });
  const registerBodies = [];
  let issuedStart = false;
  let connectedMachineId = null;
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/daemon/connect') {
      assert.equal(req.headers.authorization, `Bearer ${connectToken}`);
      const payload = JSON.parse(body);
      assert.equal(typeof payload.machineId, 'string');
      assert.notEqual(payload.machineId.trim(), '');
      connectedMachineId = payload.machineId;
      res.end(JSON.stringify({
        connected: true,
        daemonId: 'daemon-computer-workspace',
        machineToken,
        computer: { id: computerId, serverId, machineId: payload.machineId },
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/register' || url.pathname === '/internal/agent-api/daemon/heartbeat') {
      registerBodies.push(JSON.parse(body));
      assert.equal(req.headers.authorization, `Bearer ${machineToken}`);
      const controlCommands = issuedStart
        ? []
        : [
            {
              type: 'control',
              command: {
                type: 'start_runtime',
                agentId: 'agent-connect-runtime',
                workspaceId,
                config: {
                  runtime: 'claude_code',
                  runtimeCommand: process.execPath,
                  runtimeCommandArgs: [fakeClaude],
                },
              },
            },
          ];
      issuedStart = true;
      res.end(JSON.stringify({ ok: true, registered: true, controlCommands }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: serverId, channels: [{ name: 'general' }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  writeFakeClaudeScript(fakeClaude, marker);

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'connect',
    '--token', connectToken,
    '--server', upstream.url,
    '--ws', 'none',
    '--proxy-port', '0',
    '--pid-file', join(root, 'smallkhoj-daemon.pid'),
  ], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      AAA_DAEMON_MACHINE_ID_FILE: join(root, 'machine-id'),
      SMALLKHOJ_DAEMON_WORKSPACE_ROOT: workspaceRoot,
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
    await waitFor(() => existsSync(marker), 15_000);
    const runtime = JSON.parse(readFileSync(marker, 'utf-8'));
    assert.equal(connectedMachineId, readFileSync(join(root, 'machine-id'), 'utf-8').trim());
    assert.equal(runtime.currentWorkspacePath, runtimeWorkspace);
    assert.equal(runtime.slockHome, join(runtimeWorkspace, '.slock'));
    assert.equal(runtime.pathHead, join(runtimeWorkspace, '.slock'));

    await waitFor(() => registerBodies.some(item => (item.workspaces ?? []).some(workspace => workspace.workspaceId === workspaceId && workspace.status === 'running')));
    const runtimeHeartbeat = registerBodies.find(item => (item.workspaces ?? []).some(workspace => workspace.workspaceId === workspaceId && workspace.status === 'running'));
    const workspace = runtimeHeartbeat.workspaces.find(item => item.workspaceId === workspaceId);
    assert.equal(workspace.cwd, runtimeWorkspace);
  } catch (err) {
    assert.fail(`${err.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    daemon.kill('SIGTERM');
    await waitForExit(daemon);
    await upstream.close();
    await new Promise(resolveCleanup => setTimeout(resolveCleanup, 1000));
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
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
    if (url.pathname === '/internal/agent-api/server') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'server-imported', channels: [{ name: 'all' }], agents: [], humans: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/activity') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
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

    await waitFor(() => upstream.requests.some(item => item.req.url === '/internal/agent-api/server'));
    const serverRequests = upstream.requests.filter(item => item.req.url === '/internal/agent-api/server');
    assert.equal(serverRequests.length, 1);
    assert.equal(serverRequests[0].req.headers.authorization, 'Bearer sap_original_proxy_token');
    assert.equal(serverRequests[0].req.headers['x-agent-id'], 'agent-imported');
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
