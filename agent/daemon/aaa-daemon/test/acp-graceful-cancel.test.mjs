import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeSlockWrapper } from '../dist/runtime/slock-wrapper.js';
import { CodexAcpRuntimeDriver } from '../dist/runtime/codex-acp-runtime.js';
import { GooseRuntimeDriver } from '../dist/runtime/goose-runtime.js';

// 优雅取消（ACP session/cancel）生命周期：prompt 挂起 → requestGracefulCancel
// → agent 收到取消通知 → 以 stopReason 'cancelled' 结算 → result 事件 subtype
// 'cancelled'、busy 清空、无活跃 prompt 时再取消返回 false。

function waitFor(predicate, timeoutMs = 8_000) {
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

function fakeAcpEval() {
  return `
import { writeFileSync } from 'node:fs';
const sessions = new Set();
let cancelled = false;
let pending = null;
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
      const sessionId = 'fake-cancel-' + Date.now();
      sessions.add(sessionId);
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId } });
    } else if (msg.method === 'session/prompt') {
      cancelled = false;
      const sessionId = msg.params.sessionId;
      notify(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'starting long turn' } });
      // 挂起：只有收到取消通知才结算（10s 兜底按 end_turn，防测试卡死）
      pending = { id: msg.id, sessionId };
      setTimeout(() => {
        if (pending) {
          const p = pending;
          pending = null;
          send({ jsonrpc: '2.0', id: p.id, result: { stopReason: 'end_turn' } });
        }
      }, 10000);
    } else if (msg.method === '$/cancel_request') {
      // 传输层取消（JSON-RPC 通知）：记录收到即证明 driver 的 AbortController
      // 走到了 SDK 的 cancellationSignal 路径。
      try { writeFileSync(process.env.CANCEL_PROBE_FILE, '1'); } catch {}
    } else if (msg.method === 'session/cancel') {
      cancelled = true;
      if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result: {} });
      if (pending) {
        const p = pending;
        pending = null;
        notify(p.sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'winding down' } });
        send({ jsonrpc: '2.0', id: p.id, result: { stopReason: 'cancelled' } });
      }
    }
  }
});
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\\n'); }
function notify(sessionId, update) { send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } }); }
`;
}

function makeOptions(root) {
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  const credential = {
    serverUrl: 'http://127.0.0.1:9',
    token: 'sk_machine_test',
    agentId: 'agent-cancel-test',
  };
  const wrapper = writeSlockWrapper({
    workspacePath,
    proxyUrl: 'http://127.0.0.1:9',
    proxyToken: 'proxy-token',
    credential,
    activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
  });
  const base = {
    credential,
    workspacePath,
    wrapperDir: wrapper.wrapperDir,
    slockHome: wrapper.slockHome,
    launchId: wrapper.launchId,
    command: process.execPath,
    commandArgs: ['--input-type=module', '--eval', fakeAcpEval()],
  };
  return { base, workspacePath };
}

async function exerciseCancel(makeDriver, label) {
  const root = mkdtempSync(join(tmpdir(), `aaa-${label}-cancel-`));
  const transportCancelProbe = join(root, 'transport-cancel.txt');
  process.env.CANCEL_PROBE_FILE = transportCancelProbe;
  const driver = makeDriver(root);
  const events = [];
  driver.on('stream_event', event => events.push(event));
  try {
    driver.start();
    driver.sendUserMessage('long running turn');
    await waitFor(() => events.some(e => e.type === 'item_delta'));

    assert.equal(driver.requestGracefulCancel(), true);

    await waitFor(() => events.some(e => e.type === 'result' && e.subtype === 'cancelled'));
    await waitFor(() => !driver.busy);
    const result = events.find(e => e.type === 'result');
    assert.equal(result.subtype, 'cancelled');
    assert.equal(result.stopReason, 'cancelled');
    // 无活跃 prompt 时再次取消必须返回 false（看门狗据此直接走 kill 兜底）
    assert.equal(driver.requestGracefulCancel(), false);
    // 双通道取消：session/cancel 之外，$/cancel_request 也必须到达 agent。
    assert.equal(existsSync(transportCancelProbe), true, '$/cancel_request not received by the fake agent');
  } finally {
    delete process.env.CANCEL_PROBE_FILE;
    driver.stop();
    await waitFor(() => !driver.busy, 3000).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
}

test('codex driver: graceful cancel settles the prompt with stopReason cancelled', async () => {
  const { base } = makeOptions(await (async () => {
    const { mkdtempSync: mk } = await import('node:fs');
    const { tmpdir: td } = await import('node:os');
    const { join: j } = await import('node:path');
    return mk(j(td(), 'aaa-codex-cancel-root-'));
  })());
  await exerciseCancel(root => new CodexAcpRuntimeDriver(base), 'codex');
});

test('goose driver: graceful cancel settles the prompt with stopReason cancelled', async () => {
  const { base } = makeOptions(await (async () => {
    const { mkdtempSync: mk } = await import('node:fs');
    const { tmpdir: td } = await import('node:os');
    const { join: j } = await import('node:path');
    return mk(j(td(), 'aaa-goose-cancel-root-'));
  })());
  await exerciseCancel(root => new GooseRuntimeDriver(base), 'goose');
});
