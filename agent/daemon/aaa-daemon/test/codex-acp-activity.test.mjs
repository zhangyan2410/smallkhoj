import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeSlockWrapper } from '../dist/runtime/slock-wrapper.js';
import { CodexAcpRuntimeDriver } from '../dist/runtime/codex-acp-runtime.js';
import { translateRuntimeStreamActivity } from '../dist/runtime/runtime-activity.js';
import { countToolResults, extractTaskRunOutputMessageIdFromEvent } from '../dist/daemon/daemon.js';

// codex 迁移 AgentEvent schema 后的 activity/诊断链路回归：用一个假 ACP
// 进程发一整个真实形状的 turn，断言 stream_event 全部是 AgentEvent、
// runtime-activity 翻译、toolName 补全、messageId 恢复与 tool_result 计数
// —— 即 daemon 侧五个通用消费者在新 schema 上的行为等价。

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

function fakeAcpEval() {
  const auraStdoutJson = JSON.stringify({ ok: true, messageId: '11111111-2222-3333-4444-555555555555' });
  return `
const sessions = new Set();
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
      const sessionId = 'fake-codex-' + Date.now();
      sessions.add(sessionId);
      send({ jsonrpc: '2.0', id: msg.id, result: { sessionId } });
    } else if (msg.method === 'session/load') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
    } else if (msg.method === 'session/prompt') {
      const sessionId = msg.params.sessionId;
      notify(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'working on it' } });
      notify(sessionId, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'checking the inbox first' } });
      notify(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-aura',
        title: 'Shell',
        kind: 'execute',
        status: 'in_progress',
        rawInput: { command: 'printf hello | aura message send --target dm:@user' },
      });
      // 完成：不带 kind/title —— driver 必须从 item_started 记住的 toolName 补全
      notify(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-aura',
        status: 'completed',
        rawOutput: ${JSON.stringify(auraStdoutJson)},
      });
      notify(sessionId, {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-bad',
        title: 'Shell',
        status: 'in_progress',
        rawInput: { command: 'false' },
      });
      notify(sessionId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'tc-bad',
        status: 'failed',
        rawOutput: 'command failed with exit code 1',
      });
      notify(sessionId, { sessionUpdate: 'usage_update', used: 4321, size: 258400 });
      send({ jsonrpc: '2.0', id: msg.id, result: { stopReason: 'end_turn', usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } } });
    } else if (msg.method === 'session/cancel') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} });
    }
  }
});
function send(frame) { process.stdout.write(JSON.stringify(frame) + '\\n'); }
function notify(sessionId, update) { send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update } }); }
`;
}

test('codex AgentEvent schema drives activity signals, diagnostics and task-run consumers', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-codex-acp-activity-'));
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  const credential = {
    serverUrl: 'http://127.0.0.1:9',
    token: 'sk_machine_test',
    agentId: 'agent-acp-activity',
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
    commandArgs: ['--input-type=module', '--eval', fakeAcpEval()],
  });
  const events = [];
  driver.on('stream_event', event => events.push(event));

  try {
    driver.start();
    driver.sendUserMessage('run the turn');
    await waitFor(() => events.some(event => event.type === 'result'));

    // 1) 旧伪 Anthropic 信封必须消失，事件全部是 AgentEvent 类型。
    const legacy = events.filter(event => event.type === 'assistant' || event.type === 'user');
    assert.deepEqual(legacy.map(() => 'legacy envelope emitted'), []);
    const types = new Set(events.map(event => event.type));
    for (const expected of ['item_delta', 'item_started', 'item_completed', 'session_ended', 'result']) {
      assert.ok(types.has(expected), `missing AgentEvent type ${expected}`);
    }

    // 2) runtime-activity 翻译：text/reasoning delta → Thinking；tool_call → Output。
    const textDelta = events.find(e => e.type === 'item_delta' && e.delta?.type === 'text');
    const reasoningDelta = events.find(e => e.type === 'item_delta' && e.delta?.type === 'reasoning');
    const thinkingText = translateRuntimeStreamActivity('codex', textDelta);
    const thinkingReasoning = translateRuntimeStreamActivity('codex', reasoningDelta);
    assert.equal(thinkingText[0].type, 'thinking');
    assert.equal(thinkingText[0].text, 'working on it');
    assert.equal(thinkingReasoning[0].type, 'thinking');
    assert.equal(thinkingReasoning[0].text, 'checking the inbox first');

    const auraStart = events.find(e => e.type === 'item_started' && e.item.callId === 'tc-aura');
    const toolUse = translateRuntimeStreamActivity('codex', auraStart);
    assert.equal(toolUse.length, 1);
    assert.equal(toolUse[0].type, 'tool_use');
    assert.equal(toolUse[0].toolName, 'execute');
    assert.equal(toolUse[0].commandPreview, 'printf hello | aura message send --target dm:@user');

    // 3) toolName 补全：tool_call_update 不带 kind/title 时失败诊断仍能点名工具。
    const auraDone = events.find(e => e.type === 'item_completed' && e.item.callId === 'tc-aura');
    assert.equal(auraDone.item.toolName, 'execute');
    const badDone = events.find(e => e.type === 'item_completed' && e.item.callId === 'tc-bad');
    assert.equal(badDone.item.toolName, 'Shell');
    assert.equal(badDone.item.status, 'failed');
    const badPart = badDone.item.content.find(part => part.type === 'tool_result');
    assert.equal(badPart.isError, true);
    assert.equal(badPart.output, 'command failed with exit code 1');

    // 4) 硬约束：aura stdout JSON 可从 tool 输出恢复 messageId；item_completed 计 1 个 tool_result。
    assert.equal(extractTaskRunOutputMessageIdFromEvent(auraDone), '11111111-2222-3333-4444-555555555555');
    assert.equal(countToolResults(auraDone), 1);
    assert.equal(countToolResults(badDone), 1);

    // 5) result 事件把 usage_update 的 context window 折进 usage。
    const result = events.find(event => event.type === 'result');
    assert.equal(result.usage.total_tokens, 100);
    assert.equal(result.usage.context_window, 258400);
  } finally {
    driver.stop();
    await waitFor(() => !driver.busy, 3000).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
