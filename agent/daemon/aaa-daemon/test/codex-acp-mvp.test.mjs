import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CodexAcpBridge,
  buildCodexAcpCommand,
  resolveNpxCommand,
  translateAcpUpdate,
} from '../dist/runtime/codex-acp-bridge.js';

function fakeAcpEval() {
  return `
let nextId = 1;
const sessions = new Set();
let cancelled = false;
let buffer = '';
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
      const sessionId = 'fake-session-' + nextId++;
      sessions.add(sessionId);
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId } });
    } else if (msg.method === 'session/load') {
      sessions.add(msg.params.sessionId);
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
    } else if (msg.method === 'session/prompt') {
      const sessionId = msg.params.sessionId;
      notify({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello from fake acp' }
        }
      });
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: cancelled ? 'cancelled' : 'end_turn' } });
    } else if (msg.method === 'session/cancel') {
      cancelled = true;
    }
  }
});
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\\n'); }
function notify(params) { send({ jsonrpc: '2.0', method: 'session/update', params }); }
`;
}

test('codex acp bridge drives initialize, session, prompt and update lifecycle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-'));
  const updates = [];
  const bridge = new CodexAcpBridge({
    command: process.execPath,
    args: ['--input-type=module', '--eval', fakeAcpEval()],
    cwd: root,
    onUpdate: update => updates.push(update),
  });

  try {
    await bridge.start();
    assert.equal(bridge.pid > 0, true);

    const sessionId = await bridge.createSession();
    assert.match(sessionId, /^fake-session-/);

    const result = await bridge.prompt(sessionId, 'say hello');
    assert.equal(result.stopReason, 'end_turn');
    assert.equal(updates.length, 1);
    const translated = translateAcpUpdate(updates[0]);
    assert.equal(translated.type, 'message_delta');
    assert.equal(translated.text, 'hello from fake acp');
    assert.equal(translated.raw.sessionUpdate, 'agent_message_chunk');

    const thought = translateAcpUpdate({
      sessionUpdate: 'agent_thought_chunk',
      content: { type: 'text', text: 'checking the runtime state' },
    });
    assert.equal(thought.type, 'thought_delta');
    assert.equal(thought.text, 'checking the runtime state');

    await bridge.loadSession('persisted-session-1');
    assert.equal(bridge.sessionIds.has('persisted-session-1'), true);
  } finally {
    await bridge.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('codex acp bridge does not refill keys omitted from an explicit child environment', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-env-boundary-'));
  const marker = join(root, 'child-env.json');
  const childEnv = { ...process.env };
  delete childEnv.npm_config_package;
  delete childEnv.NPM_CONFIG_PACKAGE;
  const originalPackage = process.env.npm_config_package;
  const originalUpperPackage = process.env.NPM_CONFIG_PACKAGE;
  const bridge = new CodexAcpBridge({
    command: process.execPath,
    args: ['--input-type=module', '--eval', `
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
  package: process.env.npm_config_package ?? null,
  upperPackage: process.env.NPM_CONFIG_PACKAGE ?? null
}));
${fakeAcpEval()}
`],
    cwd: root,
    env: childEnv,
  });

  process.env.npm_config_package = '/tmp/outer-smallkhoj-daemon.tgz';
  process.env.NPM_CONFIG_PACKAGE = '/tmp/OUTER-SMALLKHOJ-DAEMON-UPPER.tgz';
  try {
    await bridge.start();
    await bridge.createSession();
    assert.deepEqual(JSON.parse(readFileSync(marker, 'utf-8')), {
      package: null,
      upperPackage: null,
    });
  } finally {
    if (originalPackage === undefined) delete process.env.npm_config_package;
    else process.env.npm_config_package = originalPackage;
    if (originalUpperPackage === undefined) delete process.env.NPM_CONFIG_PACKAGE;
    else process.env.NPM_CONFIG_PACKAGE = originalUpperPackage;
    await bridge.stop();
    rmSync(root, { recursive: true, force: true });
  }
});

test('codex acp command builder supports direct binary and npx package modes', () => {
  assert.deepEqual(buildCodexAcpCommand({ command: 'codex-acp' }), {
    command: 'codex-acp',
    args: [],
  });
  assert.deepEqual(buildCodexAcpCommand({ npmPackage: '@zed-industries/codex-acp@0.16.0' }), {
    command: resolveNpxCommand(),
    args: ['-y', '@zed-industries/codex-acp@0.16.0'],
  });
});

test('codex acp command builder resolves npx.cmd on Windows PATH', () => {
  const pathDir = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-npx-path-'));
  try {
    const npxCmd = join(pathDir, 'npx.cmd');
    writeFileSync(npxCmd, '@echo off\r\n');
    assert.equal(resolveNpxCommand({ PATH: pathDir }, 'win32'), 'npx.cmd');
  } finally {
    rmSync(pathDir, { recursive: true, force: true });
  }
});

test('resolveNpxCommand restores npx.cmd on Windows when the inherited PATH is empty', () => {
  // Regression: the daemon is launched via `npx`/connect ticket and its process may
  // inherit an empty PATH. Without the registry fallback, resolveNpxCommand returns
  // bare `npx` (no extension), which Windows cannot CreateProcess without a shell
  // (spawn ENOENT). It must fall back to the persisted registry PATH and resolve
  // npx.cmd.
  if (process.platform !== 'win32') {
    assert.equal(resolveNpxCommand({ PATH: '' }, 'win32'), 'npx');
    return;
  }
  const resolved = resolveNpxCommand({ PATH: '' }, 'win32');
  assert.equal(resolved, 'npx.cmd', 'empty daemon PATH should still resolve npx.cmd via the registry fallback');
});
