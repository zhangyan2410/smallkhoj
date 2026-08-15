import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeSlockWrapper } from '../dist/runtime/slock-wrapper.js';
import { CodexAcpRuntimeDriver, buildCodexAcpSlockPrompt, codexAcpCompatibilityArgs, resolveCodexAcpLaunchCommand } from '../dist/runtime/codex-acp-runtime.js';
import { buildCodexRuntimeEnv, buildCodexSlockPrompt } from '../dist/runtime/codex-runtime.js';

function waitFor(predicate, timeoutMs = 5_000) {
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
      setTimeout(tick, 50);
    };
    tick();
  });
}

function fakeAcpEval(marker) {
  return `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

let nextId = 1;
let buffer = '';
let inFlightPrompts = 0;
process.stdin.setEncoding('utf8');
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
      const sessionId = 'fake-acp-session-' + nextId++;
      writeMarker({ sessions: [{ type: 'new', sessionId, cwd: msg.params.cwd, mcpServers: msg.params.mcpServers ?? [] }] });
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId } });
    } else if (msg.method === 'session/load') {
      writeMarker({ sessions: [{ type: 'load', sessionId: msg.params.sessionId, cwd: msg.params.cwd, mcpServers: msg.params.mcpServers ?? [] }] });
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
    } else if (msg.method === 'session/prompt') {
      const promptText = (msg.params.prompt ?? []).map(block => block.text ?? '').join('\\n');
      const promptIndex = ++inFlightPrompts;
      writeMarker({ prompts: [{ sessionId: msg.params.sessionId, text: promptText }] });
      notify(msg.params.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'chunk-' + promptIndex } });
      notify(msg.params.sessionId, { sessionUpdate: 'usage_update', used: 100 + promptIndex, size: 258400 });
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            stopReason: 'end_turn',
            usage: {
              totalTokens: 100 + promptIndex,
              inputTokens: 80,
              cachedReadTokens: 20,
              outputTokens: 20,
              thoughtTokens: 3
            }
          }
        });
      }, 100);
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

function writeMarker(patch) {
  const path = ${JSON.stringify(marker)};
  const current = existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : { sessions: [], prompts: [] };
  if (patch.sessions) current.sessions.push(...patch.sessions);
  if (patch.prompts) current.prompts.push(...patch.prompts);
  writeFileSync(path, JSON.stringify(current));
}
`;
}

function makeDriver(root, marker, extra = {}) {
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  const credential = {
    serverUrl: 'http://127.0.0.1:9',
    token: 'sk_machine_test',
    agentId: 'agent-acp',
  };
  const wrapper = writeSlockWrapper({
    workspacePath,
    proxyUrl: 'http://127.0.0.1:9',
    proxyToken: 'proxy-token',
    credential,
    activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
  });
  const driver = new CodexAcpRuntimeDriver({
    credential,
    workspacePath,
    wrapperDir: wrapper.wrapperDir,
    slockHome: wrapper.slockHome,
    launchId: wrapper.launchId,
    command: process.execPath,
    commandArgs: ['--input-type=module', '--eval', fakeAcpEval(marker)],
    ...extra,
  });
  return { driver, workspacePath, wrapper };
}

test('codex acp runtime creates a session and emits daemon-compatible stream lifecycle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-runtime-'));
  const marker = join(root, 'marker.json');
  const { driver, workspacePath } = makeDriver(root, marker);
  const sessions = [];
  const sent = [];
  const events = [];
  const exits = [];
  driver.on('session', event => sessions.push(event));
  driver.on('message_sent', event => sent.push(event));
  driver.on('stream_event', event => events.push(event));
  driver.on('exit', event => exits.push(event));

  try {
    driver.start();
    driver.sendUserMessage('hello acp');

    await waitFor(() => events.some(event => event.type === 'result'));
    assert.equal(sessions.length, 1);
    assert.match(sessions[0].sessionId, /^fake-acp-session-/);
    assert.equal(driver.sessionId, sessions[0].sessionId);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'codex_acp_prompt');
    assert.equal(sent[0].session_id, sessions[0].sessionId);

    const assistant = events.find(event => event.type === 'item_delta' && event.delta?.type === 'text');
    assert.equal(assistant.runtime, 'codex_acp');
    assert.equal(assistant.delta.text, 'chunk-1');

    const usage = events.find(event => event.type === 'session_ended');
    assert.equal(usage.runtime, 'codex_acp');
    assert.equal(usage.stats.contextTokens, 101);
    assert.equal(usage.stats.contextWindow, 258400);

    const result = events.find(event => event.type === 'result');
    assert.equal(result.runtime, 'codex_acp');
    assert.equal(result.subtype, 'success');
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(result.usage.input_tokens, 80);
    assert.equal(result.usage.cache_read_input_tokens, 20);
    assert.equal(result.usage.output_tokens, 20);
    assert.equal(result.usage.total_tokens, 101);
    assert.equal(result.usage.context_window, 258400);

    const record = JSON.parse(readFileSync(marker, 'utf-8'));
    assert.equal(record.sessions[0].cwd, workspacePath);
    // G2: Slock instructions live in the workspace AGENTS.md (system-prompt
    // slot); the per-turn prompt carries only the bare event text.
    assert.equal(record.prompts[0].text, 'hello acp');
    const instructions = readFileSync(join(workspacePath, 'AGENTS.md'), 'utf-8');
    assert.match(instructions, /daemon-managed ACP resident runtime/);
    assert.match(instructions, /aura CLI ONLY/);
  } finally {
    driver.stop();
    await waitFor(() => exits.length > 0 || !driver.pid).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});

test('codex acp runtime keeps package args when daemon config supplies empty runtime args', () => {
  const launch = resolveCodexAcpLaunchCommand({ commandArgs: [] });
  assert.match(launch.command, /^npx(\.cmd)?$/);
  assert.deepEqual(launch.args, ['-y', '@zed-industries/codex-acp@0.16.0']);
});

test('pinned ACP overrides newer max reasoning config without mutating user config', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-compat-'));
  const releaseRoot = join(root, 'release');
  const sidecar = join(releaseRoot, 'sidecars', 'codex-acp', 'codex-acp');
  const codexHome = join(root, 'codex-home');
  mkdirSync(join(releaseRoot, 'sidecars', 'codex-acp'), { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  writeFileSync(sidecar, 'binary');
  const config = 'model = "gpt-5.6-sol"\nmodel_reasoning_effort = "max"\n';
  writeFileSync(join(codexHome, 'config.toml'), config);
  const env = { AURA_RELEASE_ROOT: releaseRoot, CODEX_HOME: codexHome, PATH: '' };
  try {
    assert.deepEqual(codexAcpCompatibilityArgs(env), ['-c', 'model_reasoning_effort=xhigh']);
    assert.deepEqual(resolveCodexAcpLaunchCommand({ command: 'npx', commandArgs: [], baseEnv: env }), {
      command: sidecar,
      args: ['-c', 'model_reasoning_effort=xhigh'],
    });
    assert.equal(readFileSync(join(codexHome, 'config.toml'), 'utf8'), config);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('codex prompts use only the PATH-injected aura collaboration command', () => {
  const options = {
    credential: { serverUrl: 'http://127.0.0.1:9', token: 'fake_machine_test', agentId: 'agent-acp' },
    workspacePath: '/tmp/workspace',
    wrapperDir: '/tmp/workspace/.slock',
  };
  const execPrompt = buildCodexSlockPrompt(options);
  const acpPrompt = buildCodexAcpSlockPrompt(options);

  for (const prompt of [execPrompt, acpPrompt]) {
    assert.match(prompt, /aura CLI ONLY/);
    assert.match(prompt, /aura message send/);
    assert.doesNotMatch(prompt, /\/tmp\/workspace\/\.slock\/(?:slock|raft|aura)/);
    assert.doesNotMatch(prompt, /`(?:slock|raft)\s+(?:message|task|server|channel|thread)\b/i);
  }
  assert.match(acpPrompt, /pipe `printf` output into bare `aura message send`/);
});

test('codex acp runtime resolves npx.cmd on Windows PATH', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-runtime-npx-path-'));
  try {
    writeFileSync(join(root, 'npx.cmd'), '@echo off\r\n');
    assert.deepEqual(resolveCodexAcpLaunchCommand({ commandArgs: [], baseEnv: { PATH: root } }), {
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['-y', '@zed-industries/codex-acp@0.16.0'],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('codex runtime env drops outer npx package selectors without dropping registry config', () => {
  const env = buildCodexRuntimeEnv({
    credential: {
      serverUrl: 'http://127.0.0.1:9',
      token: 'sk_machine_test',
      agentId: 'agent-acp-env',
    },
    workspacePath: '/tmp/codex-acp-env-workspace',
    wrapperDir: '/tmp/codex-acp-env-wrapper',
  }, {
    PATH: process.env.PATH ?? '',
    npm_config_package: '/tmp/smallkhoj-daemon.tgz',
    NPM_CONFIG_PACKAGE: '/tmp/SMALLKHOJ-DAEMON-UPPER.tgz',
    npm_config_registry: 'https://registry.example.test/',
  });

  assert.equal(env.npm_config_package, undefined);
  assert.equal(env.NPM_CONFIG_PACKAGE, undefined);
  assert.equal(env.npm_config_registry, 'https://registry.example.test/');
});

test('codex acp runtime sends allowlisted control slash prompts without Slock wrapper', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-control-'));
  const marker = join(root, 'marker.json');
  const { driver } = makeDriver(root, marker);
  const events = [];
  driver.on('stream_event', event => events.push(event));

  try {
    driver.start();
    driver.sendUserMessage('/compact', { control: true });

    await waitFor(() => events.some(event => event.type === 'result'));
    const record = JSON.parse(readFileSync(marker, 'utf-8'));
    assert.equal(record.prompts[0].text, '/compact');
    assert.equal(record.prompts[0].text.startsWith('/'), true);
    assert.equal(record.prompts[0].text.includes('aura CLI ONLY'), false);
  } finally {
    driver.stop();
    await waitFor(() => !driver.pid).catch(() => {});
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});

test('codex acp runtime queues one prompt while another is in flight', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-queue-'));
  const marker = join(root, 'marker.json');
  const { driver } = makeDriver(root, marker);
  const events = [];
  driver.on('stream_event', event => events.push(event));

  try {
    driver.start();
    driver.sendUserMessage('first');
    const queued = driver.sendUserMessage('second');

    assert.equal(queued, false);
    await waitFor(() => events.filter(event => event.type === 'result').length === 2);

    assert.equal(driver.busy, false);
    assert.equal(driver.queuedMessageCount, 0);
    const record = JSON.parse(readFileSync(marker, 'utf-8'));
    assert.equal(record.prompts.length, 2);
    assert.match(record.prompts[0].text, /first/);
    assert.match(record.prompts[1].text, /second/);
  } finally {
    driver.stop();
    await waitFor(() => !driver.pid).catch(() => {});
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});

test('codex acp runtime rejects control prompts that cannot be delivered immediately', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-control-reject-'));
  const marker = join(root, 'marker.json');
  const { driver } = makeDriver(root, marker);

  try {
    assert.equal(driver.sendUserMessage('/status', { control: true }), false);
    assert.equal(driver.queuedMessageCount, 0);
  } finally {
    driver.stop();
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});
