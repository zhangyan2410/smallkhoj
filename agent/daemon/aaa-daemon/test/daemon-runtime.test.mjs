import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import test from 'node:test';
import {
  daemonRuntimeWorkspacePath,
  defaultDaemonWorkspaceRoot,
} from '../dist/daemon/daemon.js';
import {
  detectClaudeCommand,
  detectCodexCommand,
  detectOpenCodeCommand,
  detectRuntimeProviders,
  detectedRuntimesForInventory,
  loadCcSwitchProviders,
  parseCcSwitchOpenCodeProviderRows,
  parseManualRuntimeProviders,
  parseOpenCodeConfigProviders,
  parseCcSwitchProviderRows,
  parseCcsClaudeListOutput,
  resolveRuntimeProviderLaunch,
} from '../dist/runtime/runtime-provider.js';

const DAEMON_PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
).version;

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
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveServer({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise(resolveClose => {
          for (const socket of sockets) socket.destroy();
          server.close(resolveClose);
        }),
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
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.pid) {
        if (process.platform === 'win32') {
          spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        } else {
          child.kill('SIGKILL');
        }
      }
      resolveWait(undefined);
    }, timeoutMs);
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

function writeFakeClaudeScript(path, marker, includeSend = true, keepAlive = false) {
  writeFileSync(path, `#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
if (process.argv.includes('--version')) {
  process.stdout.write('claude-code 0.0.0-fake\\n');
  process.exit(0);
}
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
  allowWrites: process.env.SLOCK_ALLOW_WRITES ?? null,
  writeTargetAllowlist: process.env.SLOCK_WRITE_TARGET_ALLOWLIST ?? null,
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
if (${keepAlive ? 'true' : 'false'}) {
  // Keep the fake runtime alive on Windows so the daemon has time to report
  // 'running' before the child exits. The test harness will kill the child.
  setInterval(() => {}, 1000);
}
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
  writeFileSync(path, `#!/usr/bin/env node
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

function writeVersionCommand(path, output) {
  if (/\.(mjs|cjs|js)$/i.test(path)) {
    writeFileSync(path, `#!/usr/bin/env node
if (process.argv.includes('--version')) {
  process.stdout.write(${JSON.stringify(output)});
  process.exit(0);
}
process.exit(0);
`, 'utf-8');
    chmodSync(path, 0o755);
    return;
  }
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(path)) {
    writeFileSync(path, `@echo off\r
setlocal\r
:args\r
if "%~1"=="" goto done\r
if "%~1"=="--version" (\r
  <nul set /p dummy=${output.replace(/\r?\n$/, '')}\r
  exit /b 0\r
)\r
shift\r
goto args\r
:done\r
exit /b 0\r
`, 'utf-8');
    return;
  }
  writeFileSync(path, `#!/bin/sh
case " $* " in
  *" --version "*) printf '%s' ${JSON.stringify(output)}; exit 0 ;;
esac
exit 0
`, 'utf-8');
  chmodSync(path, 0o755);
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

test('daemon detects Claude command through env override, PATH lookup, and Windows-style command shim', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-claude-command-'));
  const fakeClaudeCmd = join(root, 'claude.cmd');
  const binDir = join(root, 'bin');
  const pathClaude = join(binDir, 'claude');
  mkdirSync(binDir, { recursive: true });
  writeVersionCommand(fakeClaudeCmd, 'claude-code 1.0.0-fake\n');
  writeVersionCommand(pathClaude, 'claude-code 1.0.0-path\n');

  try {
    assert.equal(detectClaudeCommand({
      ...process.env,
      SLOCK_CLAUDE_COMMAND: fakeClaudeCmd,
      CLAUDE_COMMAND: '',
      PATH: '',
    }), fakeClaudeCmd);
    assert.equal(detectClaudeCommand({
      ...process.env,
      SLOCK_CLAUDE_COMMAND: '',
      CLAUDE_COMMAND: '',
      PATH: [binDir, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
    }), process.platform === 'win32' ? 'claude.cmd' : 'claude');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('daemon detects Codex command through env override, PATH lookup, and Windows-style command shim', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-codex-command-'));
  const fakeCodexCmd = join(root, 'codex.cmd');
  const binDir = join(root, 'bin');
  const pathCodex = join(binDir, 'codex');
  mkdirSync(binDir, { recursive: true });
  writeVersionCommand(fakeCodexCmd, 'codex-cli 1.0.0-fake\n');
  writeVersionCommand(pathCodex, 'codex-cli 1.0.0-path\n');

  try {
    assert.equal(detectCodexCommand({
      ...process.env,
      SLOCK_CODEX_COMMAND: fakeCodexCmd,
      CODEX_COMMAND: '',
      PATH: '',
    }), fakeCodexCmd);
    assert.equal(detectCodexCommand({
      ...process.env,
      SLOCK_CODEX_COMMAND: '',
      CODEX_COMMAND: '',
      PATH: [binDir, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
    }), process.platform === 'win32' ? 'codex.cmd' : 'codex');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('daemon detects OpenCode command through env override, PATH lookup, and Windows-style command shim', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-opencode-command-'));
  const fakeOpenCodeCmd = join(root, 'opencode.cmd');
  const binDir = join(root, 'bin');
  const pathOpenCode = join(binDir, 'opencode');
  mkdirSync(binDir, { recursive: true });
  writeVersionCommand(fakeOpenCodeCmd, 'opencode 1.0.0-fake\n');
  writeVersionCommand(pathOpenCode, 'opencode 1.0.0-path\n');

  try {
    assert.equal(detectOpenCodeCommand({
      ...process.env,
      SLOCK_OPENCODE_COMMAND: fakeOpenCodeCmd,
      OPENCODE_COMMAND: '',
      PATH: '',
    }), fakeOpenCodeCmd);
    assert.equal(detectOpenCodeCommand({
      ...process.env,
      SLOCK_OPENCODE_COMMAND: '',
      OPENCODE_COMMAND: '',
      PATH: [binDir, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
    }), process.platform === 'win32' ? 'opencode.cmd' : 'opencode');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('daemon reads OpenCode provider and model inventory from opencode.json without auth credentials', () => {
  const rawConfig = JSON.stringify({
    provider: {
      'kimi-for-coding': {
        options: { apiKey: 'fake_should_not_escape' },
        models: {
          k2p5: {},
          'kimi-for-coding': {},
        },
      },
      'zai-coding-plan': {
        models: {
          'glm-5.2': {},
        },
      },
    },
  });

  const providers = parseOpenCodeConfigProviders(rawConfig);
  assert.deepEqual(providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    runtime: provider.runtime,
    model: provider.model,
    source: provider.source,
    command: provider.command,
  })), [
    {
      id: 'opencode-kimi-for-coding-k2p5',
      name: 'OpenCode kimi-for-coding/k2p5',
      runtime: 'opencode',
      model: 'kimi-for-coding/k2p5',
      source: 'opencode-config',
      command: undefined,
    },
    {
      id: 'opencode-kimi-for-coding-kimi-for-coding',
      name: 'OpenCode kimi-for-coding/kimi-for-coding',
      runtime: 'opencode',
      model: 'kimi-for-coding/kimi-for-coding',
      source: 'opencode-config',
      command: undefined,
    },
    {
      id: 'opencode-zai-coding-plan-glm-5.2',
      name: 'OpenCode zai-coding-plan/glm-5.2',
      runtime: 'opencode',
      model: 'zai-coding-plan/glm-5.2',
      source: 'opencode-config',
      command: undefined,
    },
  ]);
  assert.equal(JSON.stringify(providers).includes('fake_should_not_escape'), false);

  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-opencode-config-'));
  try {
    const configDir = join(root, 'opencode');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'opencode.json'), rawConfig);
    writeFileSync(join(configDir, 'auth.json'), JSON.stringify({ credentials: [] }));
    const inventory = detectRuntimeProviders({
      HOME: root,
      XDG_CONFIG_HOME: root,
      PATH: '',
      SLOCK_RUNTIME_PROVIDERS_JSON: '',
    });
    const detected = detectedRuntimesForInventory({ runtime: 'opencode' }, inventory);
    assert.ok(detected.some(item => item.runtimeProvider === 'opencode-kimi-for-coding-k2p5' && item.model === 'kimi-for-coding/k2p5'));
    assert.equal(JSON.stringify(detected).includes('credentials'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('daemon does not implicitly discover Windows cc-switch.ps1 as a Claude provider launcher', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-no-ps1-'));
  const claudeDir = join(root, '.claude');
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, 'cc-switch.ps1'), 'Write-Output "Kimi"', 'utf-8');

  try {
    const inventory = detectRuntimeProviders({
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      PATH: '',
      SLOCK_CCS_CLAUDE_COMMAND: '',
      CCS_CLAUDE_COMMAND: '',
      SLOCK_CC_SWITCH_DB: join(root, 'missing.db'),
      CC_SWITCH_DB: '',
      SLOCK_CODEX_COMMAND: '',
      CODEX_COMMAND: '',
      SLOCK_CLAUDE_COMMAND: '',
      CLAUDE_COMMAND: '',
    });

    assert.equal(inventory.ccsClaudeCommand, undefined);
    assert.equal(JSON.stringify(inventory).includes('cc-switch.ps1'), false);
    assert.equal(inventory.providers.some(item => item.source === 'cc-switch' && item.runtime === 'claude_code'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('cc-switch provider rows are parsed into sanitized public Claude and Codex providers', () => {
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
  ], ['claude', 'codex']);

  assert.deepEqual(providers, [
    {
      id: 'codex-krill',
      name: 'krill',
      runtime: 'codex',
      model: 'gpt-5.3-codex',
      source: 'cc-switch',
    },
    {
      id: 'claude-kimi',
      name: 'Kimi',
      runtime: 'claude_code',
      model: undefined,
      source: 'cc-switch',
    },
  ]);
  const serialized = JSON.stringify(providers);
  assert.equal(serialized.includes('SECRET_TOKEN'), false);
  assert.equal(serialized.includes('OTHER_SECRET'), false);
  assert.equal(serialized.includes('api_key'), false);
  assert.equal(serialized.includes('settings_config'), false);
});

test('cc-switch Claude providers can launch OpenCode with non-enumerable provider config', () => {
  const rows = [
    {
      id: 'claude-kimi',
      app_type: 'claude',
      name: 'Kimi',
      settings_config: JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'FAKE_KIMI_SECRET',
          ANTHROPIC_BASE_URL: 'https://api.kimi.com/coding/',
          ANTHROPIC_MODEL: 'kimi-for-coding',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi-for-coding',
        },
      }),
    },
    {
      id: 'claude-minimax',
      app_type: 'claude',
      name: 'MiniMax',
      settings_config: JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'FAKE_MINIMAX_SECRET',
          ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
          ANTHROPIC_MODEL: 'MiniMax-M3',
        },
      }),
    },
    {
      id: 'claude-glm',
      app_type: 'claude',
      name: 'Zhipu GLM',
      settings_config: JSON.stringify({
        env: {
          ANTHROPIC_AUTH_TOKEN: 'FAKE_GLM_SECRET',
          ANTHROPIC_BASE_URL: 'https://open.bigmodel.cn/api/anthropic',
          ANTHROPIC_MODEL: 'glm-5.2',
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-5.2[1M]',
        },
      }),
    },
  ];

  const providers = parseCcSwitchOpenCodeProviderRows(rows);
  assert.deepEqual(providers.map(provider => ({
    id: provider.id,
    name: provider.name,
    runtime: provider.runtime,
    model: provider.model,
    source: provider.source,
  })), [
    {
      id: 'opencode-cc-switch-kimi-for-coding-k2p5',
      name: 'Kimi (OpenCode)',
      runtime: 'opencode',
      model: 'kimi-for-coding/k2p5',
      source: 'cc-switch',
    },
    {
      id: 'opencode-cc-switch-minimax-cn-coding-plan-MiniMax-M2.7',
      name: 'MiniMax (OpenCode)',
      runtime: 'opencode',
      model: 'minimax-cn-coding-plan/MiniMax-M2.7',
      source: 'cc-switch',
    },
    {
      id: 'opencode-cc-switch-zai-coding-plan-glm-5.2',
      name: 'Zhipu GLM (OpenCode)',
      runtime: 'opencode',
      model: 'zai-coding-plan/glm-5.2',
      source: 'cc-switch',
    },
  ]);

  const publicJson = JSON.stringify(providers);
  assert.equal(publicJson.includes('SECRET_'), false);
  assert.equal(publicJson.includes('ANTHROPIC_AUTH_TOKEN'), false);

  const launch = resolveRuntimeProviderLaunch('opencode-cc-switch-kimi-for-coding-k2p5', {
    opencodeCommand: 'opencode',
    providers,
  });
  assert.equal(launch.runtimeProvider, 'opencode-cc-switch-kimi-for-coding-k2p5');
  assert.equal(launch.model, 'kimi-for-coding/k2p5');
  assert.equal(JSON.stringify(launch.opencodeConfig).includes('FAKE_KIMI_SECRET'), true);
  assert.equal(JSON.stringify(launch.opencodeConfig).includes('https://api.kimi.com/coding/v1'), true);
  assert.equal(JSON.stringify(detectedRuntimesForInventory({ runtime: 'opencode' }, { providers })).includes('SECRET_'), false);
});

test('daemon loads Claude and Codex providers from the local CC Switch database command', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-cc-switch-codex-'));
  const fakeDb = join(root, 'cc-switch.db');
  const fakeSqlite = join(root, 'fake-sqlite.mjs');
  const fakeCodex = join(root, 'fake-codex.mjs');
  const fakeClaude = join(root, 'fake-claude.cmd');
  writeFileSync(fakeDb, '', 'utf-8');
  writeVersionCommand(fakeCodex, 'codex-cli 1.0.0-fake\n');
  writeVersionCommand(fakeClaude, 'claude-code 1.0.0-fake\n');
  writeFileSync(fakeSqlite, `#!/usr/bin/env node
process.stdout.write(JSON.stringify([
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
    settings_config: JSON.stringify({
      auth: { api_key: 'OTHER_SECRET' },
      config: { model: 'kimi-for-coding' },
    }),
  },
]));
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
      SLOCK_CLAUDE_COMMAND: fakeClaude,
      SLOCK_CCS_CLAUDE_COMMAND: join(root, 'missing-ccs-claude'),
    });
    const ccSwitchProviders = inventory.providers.filter(item => item.source === 'cc-switch');
    assert.deepEqual(ccSwitchProviders, [
      {
        id: 'codex-krill',
        name: 'krill',
        runtime: 'codex',
        model: 'gpt-5.3-codex',
        source: 'cc-switch',
      },
      {
        id: 'claude-kimi',
        name: 'Kimi',
        runtime: 'claude_code',
        model: 'kimi-for-coding',
        source: 'cc-switch',
      },
    ]);
    assert.deepEqual(loadCcSwitchProviders({
      ...process.env,
      SLOCK_CC_SWITCH_DB: fakeDb,
      SLOCK_SQLITE_COMMAND: fakeSqlite,
    }, root), ccSwitchProviders);
    assert.equal(inventory.claudeCommand, fakeClaude);
    assert.equal(inventory.codexCommand, fakeCodex);
    assert.equal(JSON.stringify(inventory).includes('SECRET_TOKEN'), false);
    assert.equal(JSON.stringify(inventory).includes('OTHER_SECRET'), false);
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
    {
      id: 'local-opencode-kimi',
      name: 'Local OpenCode Kimi',
      runtime: 'opencode',
      model: 'kimi-for-coding/k2p5',
      agent: 'sisyphus',
      command: '/Users/me/bin/opencode',
      commandArgs: ['serve', '--hostname', '127.0.0.1', '--port', '0'],
    },
  ]));

  assert.deepEqual(providers, [
    {
      id: 'local-codex-krill',
      name: 'Local Codex Krill',
      runtime: 'codex',
      model: 'gpt-5.3-codex',
      command: '/Users/me/bin/codex-acp-wrapper',
      commandArgs: ['--profile', 'krill'],
      source: 'manual',
    },
    {
      id: 'local-opencode-kimi',
      name: 'Local OpenCode Kimi',
      runtime: 'opencode',
      model: 'kimi-for-coding/k2p5',
      agent: 'sisyphus',
      command: '/Users/me/bin/opencode',
      commandArgs: ['serve', '--hostname', '127.0.0.1', '--port', '0'],
      source: 'manual',
    },
  ]);

  const detected = detectedRuntimesForInventory({ runtime: 'codex' }, { providers });
  const providerRuntime = detected.find(item => item.runtimeProvider === 'local-codex-krill');
  assert.equal(providerRuntime?.source, 'manual');
  assert.equal('command' in providerRuntime, false);
  assert.equal('commandArgs' in providerRuntime, false);
  const openCodeRuntime = detected.find(item => item.runtimeProvider === 'local-opencode-kimi');
  assert.equal(openCodeRuntime?.type, 'opencode');
  assert.equal(openCodeRuntime?.model, 'kimi-for-coding/k2p5');
  assert.equal(openCodeRuntime?.agent, 'sisyphus');
});

test('daemon resolves manual provider command without exposing it as CC Switch config', () => {
  const inventory = {
    providers: [{
      id: 'local-codex-krill',
      name: 'Local Codex Krill',
      runtime: 'codex',
      model: 'gpt-5.3-codex',
      command: '/Users/me/bin/codex-acp-wrapper',
      commandArgs: ['--profile', 'krill'],
      source: 'manual',
    }, {
      id: 'local-opencode-kimi',
      name: 'Local OpenCode Kimi',
      runtime: 'opencode',
      model: 'kimi-for-coding/k2p5',
      agent: 'sisyphus',
      command: '/Users/me/bin/opencode',
      commandArgs: ['serve', '--hostname', '127.0.0.1', '--port', '0'],
      source: 'manual',
    }],
  };
  const launch = resolveRuntimeProviderLaunch('local-codex-krill', inventory);

  assert.deepEqual(launch, {
    runtimeProvider: 'local-codex-krill',
    command: '/Users/me/bin/codex-acp-wrapper',
    commandArgs: ['--profile', 'krill'],
    model: 'gpt-5.3-codex',
  });
  assert.deepEqual(resolveRuntimeProviderLaunch('local-opencode-kimi', inventory), {
    runtimeProvider: 'local-opencode-kimi',
    command: '/Users/me/bin/opencode',
    commandArgs: ['serve', '--hostname', '127.0.0.1', '--port', '0'],
    model: 'kimi-for-coding/k2p5',
    agent: 'sisyphus',
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

test('daemon resolves selected CC Switch Claude provider to detected Claude command without wrapper script', () => {
  const launch = resolveRuntimeProviderLaunch('Kimi', {
    claudeCommand: '/opt/runtime/bin/claude',
    ccsClaudeCommand: 'powershell.exe|-ExecutionPolicy|Bypass|C:/Users/me/.claude/cc-switch.ps1',
    providers: [{
      id: 'claude-kimi',
      name: 'Kimi',
      runtime: 'claude_code',
      model: 'kimi-for-coding',
      source: 'cc-switch',
    }],
  });

  assert.deepEqual(launch, {
    runtimeProvider: 'claude-kimi',
    command: '/opt/runtime/bin/claude',
    model: 'kimi-for-coding',
  });
  assert.equal(JSON.stringify(launch).includes('cc-switch.ps1'), false);
  assert.equal(JSON.stringify(launch).includes('ccs-claude'), false);
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
    assert.match(runtime.serverStdout, /server-1|Channels:/);
    assert.equal(runtime.sendStatus, 0, runtime.sendStderr);
    assert.match(runtime.sendStdout, /Message sent/);
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

test('daemon machine-token startup does not imply runtime write opt-in', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-runtime-write-gate-'));
  const marker = join(root, 'runtime-marker.json');
  const fakeClaude = join(root, 'fake-claude.mjs');
  let sendRequests = 0;
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-1', channels: [{ name: 'general' }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      sendRequests += 1;
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  writeFakeClaudeScript(fakeClaude, marker, true);
  const env = { ...process.env, SLOCK_AGENT_TOKEN: 'fake_machine_env_should_be_replaced' };
  delete env.AAA_DAEMON_ALLOW_WRITES;
  delete env.AAA_DAEMON_WRITE_TARGET_ALLOWLIST;
  delete env.SLOCK_ALLOW_WRITES;
  delete env.SLOCK_WRITE_TARGET_ALLOWLIST;

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
    '--machine-token', 'fake_machine_cli_only',
  ], {
    cwd: resolve('.'),
    env,
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
    assert.match(runtime.serverStdout, /server-1|Channels:/);
    assert.notEqual(runtime.sendStatus, 0);
    assert.match(runtime.sendStderr, /WRITES_NOT_ALLOWED/);
    assert.equal(runtime.allowWrites, null);
    assert.equal(runtime.writeTargetAllowlist, null);
    assert.equal(sendRequests, 0);

    await waitFor(() => upstream.requests.some(item => item.req.url === '/internal/agent-api/server'));
    const serverRequest = upstream.requests.find(item => item.req.url === '/internal/agent-api/server');
    assert.equal(serverRequest.req.headers.authorization, 'Bearer fake_machine_cli_only');
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

test('daemon write opt-in and target allowlist are explicit runtime startup options', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-runtime-write-opt-in-'));
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
    res.end(JSON.stringify({ events: [] }));
  });

  writeFakeClaudeScript(fakeClaude, marker, true);
  const env = { ...process.env };
  delete env.AAA_DAEMON_ALLOW_WRITES;
  delete env.AAA_DAEMON_WRITE_TARGET_ALLOWLIST;
  delete env.SLOCK_ALLOW_WRITES;
  delete env.SLOCK_WRITE_TARGET_ALLOWLIST;

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
    '--machine-token', 'fake_machine_cli_only',
    '--allow-writes',
    '--write-target-allowlist', '#general',
  ], {
    cwd: resolve('.'),
    env,
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
    assert.equal(runtime.sendStatus, 0, runtime.sendStderr);
    assert.match(runtime.sendStdout, /Message sent/);
    assert.equal(runtime.allowWrites, '1');
    assert.equal(runtime.writeTargetAllowlist, '#general');

    await waitFor(() => upstream.requests.some(item => item.req.url === '/internal/agent-api/send'));
    const sendRequest = upstream.requests.find(item => item.req.url === '/internal/agent-api/send');
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

test('daemon CLI rejects historical codex_cli runtime path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-codex-cli-rejected-'));
  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--server', 'http://127.0.0.1:9',
    '--ws', 'ws://127.0.0.1:9',
    '--agent-id', 'agent-codex',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'codex_cli',
  ], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      SLOCK_AGENT_TOKEN: 'sk_machine_real',
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
    await waitForExit(daemon);
    assert.notEqual(daemon.exitCode, null, `${stdout}\n${stderr}`);
    assert.notEqual(daemon.exitCode, 0);
    assert.match(`${stdout}\n${stderr}`, /Unsupported runtime: codex_cli/);
  } finally {
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
  const agentHeartbeatBodies = [];
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
    if (url.pathname === '/internal/agent-api/heartbeat') {
      agentHeartbeatBodies.push({ headers: req.headers, body: JSON.parse(body) });
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
    assert.match(runtime.serverStdout, /server-acp|Channels:/);
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
    assert.equal('runtimeCommand' in workspace, false);
    await waitFor(() => agentHeartbeatBodies.some(item => item.body.workspaceStatus === 'running'));
    const readyHeartbeat = agentHeartbeatBodies.find(item => item.body.workspaceStatus === 'running');
    assert.equal(readyHeartbeat.headers['x-agent-id'], 'agent-acp');
    assert.equal(readyHeartbeat.body.sessionId, 'fake-acp-daemon-session');
    assert.equal(readyHeartbeat.body.cwd, root);

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

test('daemon does not mark Codex ACP ready when the child exits 127 before creating a session', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-codex-acp-exit-127-'));
  const failingAcp = join(root, 'failing-acp.mjs');
  const registerBodies = [];
  const agentHeartbeatBodies = [];
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
    if (url.pathname === '/internal/agent-api/heartbeat') {
      agentHeartbeatBodies.push(JSON.parse(body));
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/events') {
      res.end(JSON.stringify({ count: 0, events: [] }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  writeFileSync(failingAcp, 'process.exit(127);\n');

  const daemon = spawn(process.execPath, [
    resolve('dist/cmd/main.js'),
    'start',
    '--foreground',
    '--server', upstream.url,
    '--ws', 'none',
    '--agent-id', 'agent-acp-exit-127',
    '--proxy-port', '0',
    '--pid-file', join(root, 'aaa-daemon.pid'),
    '--workspace', root,
    '--runtime', 'codex',
    '--runtime-command', process.execPath,
    '--runtime-command-arg', failingAcp,
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
    await waitFor(() => /runtime agent-acp-exit-127 exited: code=127/.test(stderr));
    await waitFor(() => /runtime agent-acp-exit-127 error:/.test(stderr));
    await waitFor(() => registerBodies.some(item => (item.workspaces ?? []).some(workspace => (
      workspace.agentId === 'agent-acp-exit-127' && workspace.status === 'exited'
    ))));

    daemon.kill('SIGTERM');
    await waitForExit(daemon);

    const workspaceStates = registerBodies.flatMap(item => (
      item.workspaces ?? []
    )).filter(workspace => (
      workspace.agentId === 'agent-acp-exit-127'
    )).map(workspace => workspace.status);

    assert.ok(workspaceStates.includes('exited'), `workspace states: ${workspaceStates.join(', ')}`);
    assert.equal(workspaceStates.includes('running'), false, `workspace states: ${workspaceStates.join(', ')}`);
    assert.equal(agentHeartbeatBodies.some(item => item.workspaceStatus === 'running'), false);
    assert.doesNotMatch(stderr, /Runtime agent-acp-exit-127 ready/);
    assert.match(stderr, /runtime agent-acp-exit-127 exited: code=127/);
  } catch (err) {
    assert.fail(`${err.message}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
  } finally {
    if (daemon.exitCode === null) {
      daemon.kill('SIGTERM');
      await waitForExit(daemon);
    }
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
                allowWrites: true,
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

  writeFakeClaudeScript(fakeClaude, marker, true, true);
  chmodSync(fakeClaude, 0o755);
  const env = {
    ...process.env,
    SLOCK_AGENT_TOKEN: 'sk_machine_real',
    SLOCK_SERVER_ID: 'server-control',
    SLOCK_COMPUTER_ID: 'computer-control',
    SLOCK_CLAUDE_COMMAND: fakeClaude,
  };
  delete env.SLOCK_ALLOW_WRITES;
  delete env.AAA_DAEMON_ALLOW_WRITES;
  delete env.SLOCK_WRITE_TARGET_ALLOWLIST;
  delete env.AAA_DAEMON_WRITE_TARGET_ALLOWLIST;

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
    env,
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
    assert.match(runtime.serverStdout, /server-control|Channels:/);
    assert.equal(runtime.sendStatus, 0, runtime.sendStderr);
    assert.match(runtime.sendStdout, /Message sent/);
    assert.equal(runtime.allowWrites, '1');
    assert.equal(runtime.pathHead, join(runtimeWorkspace, '.slock'));
    assert.equal(runtime.slockHome, join(runtimeWorkspace, '.slock'));
    assert.equal(runtime.currentWorkspacePath, runtimeWorkspace);
    assert.equal(runtime.systemPromptFile, join(runtimeWorkspace, '.slock', 'claude-system-prompt.md'));
    assert.match(
      readFileSync(join(runtimeWorkspace, '.slock', 'slock'), 'utf-8'),
      /SLOCK_ALLOW_WRITES='1'/,
    );

    await waitFor(() => upstream.requests.some(item => item.req.url === '/internal/agent-api/send'));
    const sendRequest = upstream.requests.find(item => item.req.url === '/internal/agent-api/send');
    assert.deepEqual(JSON.parse(sendRequest.body), {
      target: '#general',
      content: 'hello from runtime',
    });

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
    // Windows does not deliver SIGTERM to Node processes, so graceful daemon
    // shutdown (and the resulting /daemon/shutdown call) is not observable here.
    if (process.platform !== 'win32') {
      await waitFor(() => shutdownBodies.length > 0);
      assert.equal(shutdownBodies.at(-1).status, 'offline');
    }
    await upstream.close();
    await new Promise(resolveCleanup => setTimeout(resolveCleanup, 1000));
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {
      // Windows can briefly keep spawned script directories locked after process exit.
    }
  }
});

test('daemon keeps dynamic start_runtime writes fail-closed without allowWrites', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-control-runtime-no-writes-'));
  const runtimeWorkspace = join(root, '.slock-runtimes', 'server-control', 'computer-control', 'workspace-no-writes');
  const marker = join(root, 'runtime-marker.json');
  const fakeClaude = join(root, 'fake-claude-control.mjs');
  let sendRequests = 0;
  const upstream = await startServer((req, res, body) => {
    const url = new URL(req.url, 'http://upstream.test');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (url.pathname === '/internal/agent-api/daemon/register') {
      res.end(JSON.stringify({
        registered: true,
        controlCommands: [
          {
            type: 'control',
            command: {
              type: 'start_runtime',
              agentId: 'agent-no-writes',
              workspaceId: 'workspace-no-writes',
              config: {
                runtime: 'claude_code',
              },
            },
          },
        ],
      }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/heartbeat') {
      res.end(JSON.stringify({ ok: true, controlCommands: [] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/internal/agent-api/server') {
      res.end(JSON.stringify({ id: 'server-control', channels: [{ name: 'general' }] }));
      return;
    }
    if (url.pathname === '/internal/agent-api/send') {
      sendRequests += 1;
      res.end(JSON.stringify({ state: 'sent', body: JSON.parse(body) }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });

  writeFakeClaudeScript(fakeClaude, marker, true);
  chmodSync(fakeClaude, 0o755);
  const env = {
    ...process.env,
    SLOCK_AGENT_TOKEN: 'sk_machine_real',
    SLOCK_SERVER_ID: 'server-control',
    SLOCK_COMPUTER_ID: 'computer-control',
    SLOCK_CLAUDE_COMMAND: fakeClaude,
  };
  delete env.SLOCK_ALLOW_WRITES;
  delete env.AAA_DAEMON_ALLOW_WRITES;
  delete env.SLOCK_WRITE_TARGET_ALLOWLIST;
  delete env.AAA_DAEMON_WRITE_TARGET_ALLOWLIST;

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
    env,
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

    assert.equal(runtime.agentId, 'agent-no-writes');
    assert.equal(runtime.serverStatus, 0, runtime.serverStderr);
    assert.notEqual(runtime.sendStatus, 0);
    assert.match(runtime.sendStderr, /WRITES_NOT_ALLOWED/);
    assert.equal(runtime.allowWrites, null);
    assert.doesNotMatch(
      readFileSync(join(runtimeWorkspace, '.slock', 'slock'), 'utf-8'),
      /SLOCK_ALLOW_WRITES=/,
    );
    assert.equal(sendRequests, 0);
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

test('daemon resolves selected CC Switch Claude provider through detected Claude command', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-daemon-provider-runtime-'));
  const runtimeWorkspace = join(root, 'provider-agent-workspace');
  const marker = join(root, 'provider-runtime-marker.json');
  const fakeDb = join(root, 'cc-switch.db');
  const fakeSqlite = join(root, 'fake-sqlite.mjs');
  const fakeClaude = join(root, 'fake-claude.mjs');
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

  writeFileSync(fakeDb, '', 'utf-8');
  writeFileSync(fakeSqlite, `#!/usr/bin/env node
process.stdout.write(JSON.stringify([{
  id: 'claude-kimi',
  app_type: 'claude',
  name: 'Kimi',
  settings_config: JSON.stringify({
    auth: { api_key: 'SECRET_TOKEN' },
    config: { model: 'kimi-for-coding' },
  }),
}]));
`, 'utf-8');
  chmodSync(fakeSqlite, 0o755);
  writeFakeClaudeScript(fakeClaude, marker);
  chmodSync(fakeClaude, 0o755);

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
      SLOCK_CC_SWITCH_DB: fakeDb,
      SLOCK_SQLITE_COMMAND: fakeSqlite,
      SLOCK_CLAUDE_COMMAND: fakeClaude,
      SLOCK_CCS_CLAUDE_COMMAND: join(root, 'missing-ccs-claude'),
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
    assert.equal(runtime.agentId, 'agent-provider');
    assert.equal(runtime.serverStatus, 0, runtime.serverStderr);
    assert.match(runtime.serverStdout, /server-provider|Channels:/);
    assert.equal(runtime.argv.includes('--append-system-prompt-file'), true);
    assert.equal(runtime.argv.includes('--model'), true);
    assert.equal(runtime.argv.includes('kimi-for-coding'), true);
    assert.equal(runtime.argv.includes('Kimi'), false);

    await waitFor(() => registerBodies.length > 0);
    const detected = registerBodies[0].detectedRuntimes ?? [];
    assert.ok(detected.some(item => item.runtimeProvider === 'claude-kimi' && item.provider === 'Kimi'));
    assert.equal(detected.some(item => 'runtimeCommandArgs' in item), false);
    assert.equal(JSON.stringify(detected).includes('SECRET_TOKEN'), false);
    assert.equal(JSON.stringify(detected).includes(fakeClaude), false);

    await waitFor(() => registerBodies.some(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-provider')));
    const runtimeHeartbeat = registerBodies.find(item => (item.workspaces ?? []).some(workspace => workspace.agentId === 'agent-provider'));
    const workspace = runtimeHeartbeat.workspaces.find(item => item.agentId === 'agent-provider');
    assert.equal(workspace.runtimeProvider, 'claude-kimi');
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
      assert.equal(payload.daemonVersion, DAEMON_PACKAGE_VERSION);
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
    assert.equal(firstRegister.daemonVersion, DAEMON_PACKAGE_VERSION);
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
      assert.equal(payload.daemonVersion, DAEMON_PACKAGE_VERSION);
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
    assert.equal(registerBodies[0].daemonVersion, DAEMON_PACKAGE_VERSION);
    assert.equal(daemon.exitCode, null, `daemon exited early\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
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
    assert.match(runtime.serverStdout, /server-imported|Channels:/);
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

test('daemon detected runtimes always report the four supported runtimes from local CLI detection', () => {
  // 无 ccswitch、无 provider：4 条 runtime 条目照常出现，可用性只由本机
  // CLI 检测决定（claude/codex/opencode 命中与否 + bundled Pi）。
  const detected = detectedRuntimesForInventory(
    { runtime: 'claude_code' },
    {
      claudeCommand: '/usr/local/bin/claude',
      codexCommand: undefined,
      opencodeCommand: undefined,
      providers: [],
    },
    undefined,
  );

  const byType = new Map(detected.map(item => [item.type, item]));
  assert.equal(byType.get('claude_code')?.status, 'available');
  assert.equal(byType.get('codex')?.status, 'not_installed');
  assert.equal(byType.get('opencode')?.status, 'not_installed');
  // Pi 是产品内置 runtime，检测层面恒 available，bundled layout 缺失不影响显示。
  assert.equal(byType.get('pi')?.status, 'available');
  assert.equal(byType.get('pi')?.source, 'bundled');
  // config.runtime 不再额外产生一条「假 available」条目
  assert.equal(detected.filter(item => item.type === 'claude_code').length, 1);
});

test('daemon detected runtimes keep provider entries alongside the four runtime entries', () => {
  // 有 ccswitch provider 时：4 条 runtime 条目仍在最前，provider 条目作为附加
  // 信息保留（Provider 下拉等高级用法依赖 runtimeProvider）。
  const detected = detectedRuntimesForInventory(
    { runtime: 'claude_code' },
    {
      claudeCommand: '/usr/local/bin/claude',
      codexCommand: '/usr/local/bin/codex',
      opencodeCommand: '/usr/local/bin/opencode',
      providers: [{
        id: 'codex-krill',
        name: 'krill',
        runtime: 'codex',
        model: 'gpt-5.3-codex',
        source: 'cc-switch',
      }],
    },
    { version: '0.0.0-test' },
  );

  const runtimeEntries = detected.filter(item => !item.runtimeProvider);
  assert.deepEqual(
    runtimeEntries.map(item => item.type),
    ['claude_code', 'codex', 'opencode', 'pi'],
  );
  assert.ok(runtimeEntries.every(item => item.status === 'available'));
  assert.equal(runtimeEntries.find(item => item.type === 'pi')?.source, 'bundled');
  const providerEntry = detected.find(item => item.runtimeProvider === 'codex-krill');
  assert.equal(providerEntry?.provider, 'krill');
  assert.equal(providerEntry?.source, 'cc-switch');
});
