import assert from 'node:assert/strict';
import test from 'node:test';

import { translateAcpSessionUpdate } from '../dist/runtime/acp-event-translator.js';

const SID = 'sess-1';

function first(events) {
  assert.equal(events.length, 1, `expected exactly one event, got ${events.length}`);
  return events[0];
}

test('agent_message_chunk translates to an item_delta text', () => {
  const event = first(translateAcpSessionUpdate({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'hello' },
  }, SID));
  assert.equal(event.type, 'item_delta');
  assert.equal(event.sessionId, SID);
  assert.equal(event.delta.type, 'text');
  assert.equal(event.delta.text, 'hello');
});

test('agent_thought_chunk translates to an item_delta reasoning (kept, not dropped)', () => {
  const event = first(translateAcpSessionUpdate({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'thinking...' },
  }, SID));
  assert.equal(event.type, 'item_delta');
  assert.equal(event.delta.type, 'reasoning');
  assert.equal(event.delta.text, 'thinking...');
});

test('tool_call in_progress translates to an item_started tool_call', () => {
  const event = first(translateAcpSessionUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'tc1',
    title: 'Shell',
    kind: 'execute_command',
    status: 'in_progress',
    rawInput: { command: 'ls' },
  }, SID));
  assert.equal(event.type, 'item_started');
  assert.equal(event.item.kind, 'tool_call');
  assert.equal(event.item.status, 'in_progress');
  assert.equal(event.item.callId, 'tc1');
  assert.equal(event.item.toolName, 'execute_command');
});

test('tool_call terminal completed translates to an item_completed tool_result', () => {
  const event = first(translateAcpSessionUpdate({
    sessionUpdate: 'tool_call',
    toolCallId: 'tc1',
    title: 'Shell',
    status: 'completed',
    rawOutput: 'done',
  }, SID));
  assert.equal(event.type, 'item_completed');
  assert.equal(event.item.kind, 'tool_result');
  assert.equal(event.item.status, 'completed');
  assert.equal(event.item.callId, 'tc1');
});

test('tool_call_update failed produces a structured failed signal (no regex)', () => {
  const event = first(translateAcpSessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tc2',
    status: 'failed',
    rawOutput: 'boom',
  }, SID));
  assert.equal(event.type, 'item_completed');
  assert.equal(event.item.status, 'failed');
  const resultPart = event.item.content.find((part) => part.type === 'tool_result');
  assert.equal(resultPart.isError, true);
  assert.equal(resultPart.output, 'boom');
});

test('aura message send stdout JSON stays fully recoverable from tool output', () => {
  const messageId = '11111111-2222-3333-4444-555555555555';
  const event = first(translateAcpSessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tc3',
    status: 'completed',
    rawOutput: JSON.stringify({ ok: true, messageId }),
  }, SID));
  const resultPart = event.item.content.find((part) => part.type === 'tool_result');
  const parsed = JSON.parse(resultPart.output);
  assert.equal(parsed.messageId, messageId);
});

test('tool_call_update non-terminal progress is not streamed', () => {
  const events = translateAcpSessionUpdate({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'tc4',
    status: 'in_progress',
  }, SID);
  assert.equal(events.length, 0);
});

test('usage_update translates to a session_ended stats fragment', () => {
  const event = first(translateAcpSessionUpdate({
    sessionUpdate: 'usage_update',
    used: 1234,
    size: 200000,
  }, SID));
  assert.equal(event.type, 'session_ended');
  assert.equal(event.stats.contextTokens, 1234);
  assert.equal(event.stats.contextWindow, 200000);
});

test('plan and other updates are dropped', () => {
  assert.equal(translateAcpSessionUpdate({ sessionUpdate: 'plan' }, SID).length, 0);
  assert.equal(translateAcpSessionUpdate({ sessionUpdate: 'available_commands_update' }, SID).length, 0);
});
