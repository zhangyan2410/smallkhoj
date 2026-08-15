import assert from 'node:assert/strict';
import test from 'node:test';

import { translateRuntimeStreamActivity } from '../dist/runtime/runtime-activity.js';

function assistantBlock(block, extra = {}) {
  return {
    type: 'assistant',
    message: { content: [block] },
    ...extra,
  };
}

function toolResult(id, isError = false, extra = {}) {
  return {
    type: 'user',
    message: {
      content: [{
        type: 'tool_result',
        tool_use_id: id,
        content: JSON.stringify({ status: isError ? 'failed' : 'completed' }),
        is_error: isError,
      }],
    },
    ...extra,
  };
}

test('Codex ACP narration and thought chunks both use the Claude-compatible Thinking state', () => {
  assert.deepEqual(
    translateRuntimeStreamActivity('codex', assistantBlock(
      { type: 'thinking', thinking: 'checking the repository' },
      { runtime: 'codex_acp', acpUpdate: 'agent_thought_chunk' },
    )),
    [{
      type: 'thinking',
      protocol: 'codex-acp',
      sourceEvent: 'agent_thought_chunk',
      text: 'checking the repository',
    }],
  );

  assert.deepEqual(
    translateRuntimeStreamActivity('codex', assistantBlock(
      { type: 'text', text: 'I found the relevant implementation.' },
      { runtime: 'codex_acp', acpUpdate: 'agent_message_chunk' },
    )),
    [{
      type: 'thinking',
      protocol: 'codex-acp',
      sourceEvent: 'agent_message_chunk',
      text: 'I found the relevant implementation.',
    }],
  );
});

test('OpenCode SSE requires explicit reasoning for Thinking and only real tool execution is Output', () => {
  assert.deepEqual(
    translateRuntimeStreamActivity('opencode', assistantBlock(
      { type: 'text', text: 'hello from opencode' },
      { runtime: 'opencode', opencodeEvent: 'message.part.delta' },
    )),
    [],
    'final assistant transcript text must not masquerade as provider reasoning',
  );

  assert.deepEqual(
    translateRuntimeStreamActivity('opencode', assistantBlock(
      { type: 'thinking', thinking: 'checking the repository' },
      { runtime: 'opencode', opencodeEvent: 'message.part.updated' },
    )),
    [{
      type: 'thinking',
      protocol: 'opencode-sse',
      sourceEvent: 'message.part.updated',
      text: 'checking the repository',
    }],
  );

  assert.deepEqual(
    translateRuntimeStreamActivity('opencode', assistantBlock(
      {
        type: 'tool_use',
        id: 'tool-1',
        name: 'bash',
        input: { status: 'pending', command: 'pwd' },
      },
      { runtime: 'opencode', opencodeEvent: 'message.part.updated' },
    )),
    [{
      type: 'tool_use',
      protocol: 'opencode-sse',
      sourceEvent: 'message.part.updated',
      toolUseId: 'tool-1',
      toolName: 'bash',
      commandPreview: 'pwd',
    }],
  );

  assert.deepEqual(
    translateRuntimeStreamActivity('opencode', toolResult(
      'tool-1',
      false,
      { runtime: 'opencode', opencodeEvent: 'message.part.updated' },
    )),
    [],
  );
});

test('Codex ACP reports tool start once and does not invent a terminal Activity row', () => {
  assert.deepEqual(
    translateRuntimeStreamActivity('codex', assistantBlock(
      { type: 'tool_use', id: 'call-1', name: 'terminal', input: { status: 'pending', command: 'pwd' } },
      { runtime: 'codex_acp', acpUpdate: 'tool_call' },
    )),
    [{
      type: 'tool_use',
      protocol: 'codex-acp',
      sourceEvent: 'tool_call',
      toolUseId: 'call-1',
      toolName: 'terminal',
      commandPreview: 'pwd',
    }],
  );

  assert.deepEqual(
    translateRuntimeStreamActivity('codex', toolResult(
      'call-1',
      true,
      { runtime: 'codex_acp', acpUpdate: 'tool_call_update' },
    )),
    [],
  );
});

test('Claude stream-json keeps its existing plain-text thinking fallback', () => {
  assert.deepEqual(
    translateRuntimeStreamActivity('claude_code', assistantBlock(
      { type: 'text', text: 'legacy stream-json progress' },
      { runtime: 'claude_code' },
    )),
    [{
      type: 'thinking',
      protocol: 'claude-stream-json',
      sourceEvent: 'assistant_text',
      text: 'legacy stream-json progress',
    }],
  );
});

test('OpenCode generic connection and session events do not masquerade as activity', () => {
  assert.deepEqual(translateRuntimeStreamActivity('opencode', {
    type: 'opencode_event',
    runtime: 'opencode',
    opencodeEvent: 'server.connected',
  }), []);
  assert.deepEqual(translateRuntimeStreamActivity('opencode', {
    type: 'status',
    runtime: 'opencode',
    opencodeEvent: 'session.status',
  }), []);
});

test('user transcript parts are never Thinking or Output', () => {
  assert.deepEqual(translateRuntimeStreamActivity('opencode', {
    type: 'user',
    runtime: 'opencode',
    message: { content: [{ type: 'text', text: '[event=message.created] hello' }] },
    opencodeEvent: 'message.part.updated',
  }), []);
});

// ── AgentEvent path (goose / codex-on-new-schema) ──

test('item_delta text and reasoning both translate to Thinking on the AgentEvent path', () => {
  assert.deepEqual(
    translateRuntimeStreamActivity('goose', {
      type: 'item_delta',
      sessionId: 's1',
      delta: { type: 'text', text: 'narration' },
    }),
    [{ type: 'thinking', protocol: 'codex-acp', sourceEvent: 'item_delta', text: 'narration' }],
  );
  assert.deepEqual(
    translateRuntimeStreamActivity('goose', {
      type: 'item_delta',
      sessionId: 's1',
      delta: { type: 'reasoning', text: 'hmm' },
    }),
    [{ type: 'thinking', protocol: 'codex-acp', sourceEvent: 'item_delta', text: 'hmm' }],
  );
});

test('item_started tool_call translates to a tool_use signal with command preview', () => {
  const signals = translateRuntimeStreamActivity('goose', {
    type: 'item_started',
    sessionId: 's1',
    item: {
      kind: 'tool_call',
      role: 'assistant',
      status: 'in_progress',
      callId: 'tc-9',
      toolName: 'shell',
      content: [{ type: 'tool_call', toolName: 'shell', rawInput: { command: 'ls -la' } }],
    },
  });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].type, 'tool_use');
  assert.equal(signals[0].toolUseId, 'tc-9');
  assert.equal(signals[0].toolName, 'shell');
  assert.equal(signals[0].commandPreview, 'ls -la');
});

test('item_completed tool_result produces no activity signal (terminal state only)', () => {
  assert.deepEqual(
    translateRuntimeStreamActivity('goose', {
      type: 'item_completed',
      sessionId: 's1',
      item: {
        kind: 'tool_result',
        role: 'user',
        status: 'failed',
        callId: 'tc-9',
        content: [{ type: 'tool_result', output: 'boom', isError: true }],
      },
    }),
    [],
  );
});
