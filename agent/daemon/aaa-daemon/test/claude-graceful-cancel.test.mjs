import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeSlockWrapper } from '../dist/runtime/slock-wrapper.js';
import { ClaudeRuntimeDriver } from '../dist/runtime/claude-runtime.js';

// Claude Code 优雅取消：busy 回合中 requestGracefulCancel 向常驻进程 stdin
// 写 interrupt 控制帧（claude 2.x stream-json 控制协议），fake claude 以
// result 事件结算；control_response 帧不进 stream_event；空闲时返回 false。

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

function writeFakeClaude(path, marker) {
  writeFileSync(path, `
import { appendFileSync, writeFileSync } from 'node:fs';

let busy = false;
let buffer = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.type === 'user' && !busy) {
      busy = true;
      send({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'starting long turn' }] } });
      // 挂起：只有 interrupt 控制帧才结算（120s 兜底防测试卡死）
      setTimeout(() => {
        if (busy) {
          busy = false;
          send({ type: 'result', subtype: 'success', is_error: false });
        }
      }, 120000);
    } else if (msg.type === 'control_request') {
      appendFileSync(${JSON.stringify(marker)}, JSON.stringify(msg) + '\\n');
      send({ type: 'control_response', request_id: msg.request_id, response: { subtype: 'success' } });
      if (busy && msg.request?.subtype === 'interrupt') {
        busy = false;
        send({ type: 'result', subtype: 'success', is_error: false, user_interrupted: true });
      }
    }
  }
});
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\\n'); }
`);
}

function makeDriver(root, marker) {
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  const credential = {
    serverUrl: 'http://127.0.0.1:9',
    token: 'sk_machine_test',
    agentId: 'agent-claude-cancel',
  };
  const wrapper = writeSlockWrapper({
    workspacePath,
    proxyUrl: 'http://127.0.0.1:9',
    proxyToken: 'proxy-token',
    credential,
    activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
  });
  const fakeClaude = join(root, 'fake-claude.mjs');
  writeFakeClaude(fakeClaude, marker);
  const driver = new ClaudeRuntimeDriver({
    credential,
    workspacePath,
    wrapperDir: wrapper.wrapperDir,
    slockHome: wrapper.slockHome,
    launchId: wrapper.launchId,
    command: process.execPath,
    commandArgs: [fakeClaude],
    baseEnv: { ...process.env, HOME: root },
  });
  return { driver, root };
}

test('claude driver cancels a busy turn via the stdin interrupt control request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-claude-cancel-'));
  const marker = join(root, 'interrupt-marker.jsonl');
  const { driver } = makeDriver(root, marker);
  const events = [];
  driver.on('stream_event', event => events.push(event));

  try {
    driver.start();
    // 空闲（回合未开始）时取消必须返回 false。
    assert.equal(driver.requestGracefulCancel(), false);

    driver.sendUserMessage('long running turn');
    await waitFor(() => events.some(event => event.type === 'assistant'));

    assert.equal(driver.busy, true);
    assert.equal(driver.requestGracefulCancel(), true);

    await waitFor(() => events.some(event => event.type === 'result'));
    await waitFor(() => !driver.busy);

    // 中断帧形状：control_request + subtype interrupt（驱动到 fake 的 stdin）。
    assert.equal(existsSync(marker), true);
    const frames = readFileSync(marker, 'utf-8').trim().split('\n').map(line => JSON.parse(line));
    assert.equal(frames.length, 1);
    assert.equal(frames[0].type, 'control_request');
    assert.equal(frames[0].request.subtype, 'interrupt');
    assert.equal(typeof frames[0].request_id, 'string');

    // control_response 是协议管道帧，绝不能作为 stream_event 污染活动流。
    assert.equal(events.some(event => event.type === 'control_response'), false);
    assert.equal(events.some(event => event.type === 'control_request'), false);

    // 回合结束后再次取消返回 false（看门狗据此直接走 kill 兜底）。
    assert.equal(driver.requestGracefulCancel(), false);
  } finally {
    driver.stop();
    await waitFor(() => !driver.pid).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
