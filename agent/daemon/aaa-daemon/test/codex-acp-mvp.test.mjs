import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CodexAcpBridge,
  buildCodexAcpCommand,
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

    await bridge.loadSession('persisted-session-1');
    assert.equal(bridge.sessionIds.has('persisted-session-1'), true);
  } finally {
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
    command: 'npx',
    args: ['-y', '@zed-industries/codex-acp@0.16.0'],
  });
});
