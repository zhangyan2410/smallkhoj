import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chooseRuntimeSessionScope,
  normalizeRuntimeSessionScope,
  ScopedProviderSessionStore,
  scopedSessionKey,
} from '../dist/daemon/session-scope.js';

test('runtime session scope normalizes stable keys', () => {
  assert.deepEqual(normalizeRuntimeSessionScope({ type: 'dm', peerMemberId: 'user-1' }), {
    type: 'dm',
    peerMemberId: 'user-1',
    key: 'dm:user-1',
  });
  assert.deepEqual(normalizeRuntimeSessionScope({ type: 'channel', channelId: 'ch-1' }), {
    type: 'channel',
    channelId: 'ch-1',
    key: 'channel:ch-1',
  });
  assert.deepEqual(normalizeRuntimeSessionScope({ type: 'thread', channelId: 'ch-1', rootMessageId: 'msg-1' }), {
    type: 'thread',
    channelId: 'ch-1',
    rootMessageId: 'msg-1',
    key: 'thread:ch-1:msg-1',
  });
  assert.deepEqual(normalizeRuntimeSessionScope({ type: 'task', taskId: 'task-1' }), {
    type: 'task',
    taskId: 'task-1',
    key: 'task:task-1',
  });
});

test('task scope wins over thread and channel scope when task id is present', () => {
  const scope = chooseRuntimeSessionScope({
    channelId: 'ch-1',
    rootMessageId: 'msg-1',
    taskId: 'task-1',
    channelType: 'public',
  });

  assert.equal(scope.key, 'task:task-1');
  assert.equal(scopedSessionKey('agent-1', scope), 'agent-1::task:task-1');
});

test('thread replies prefer thread scope over broad channel scope', () => {
  const scope = chooseRuntimeSessionScope({
    channelId: 'ch-1',
    rootMessageId: 'msg-1',
    channelType: 'public',
  });

  assert.equal(scope.key, 'thread:ch-1:msg-1');
});

test('top level dm and channel messages do not share scope', () => {
  const dmScope = chooseRuntimeSessionScope({
    channelType: 'dm',
    peerMemberId: 'human-1',
    channelId: 'dm-channel',
  });
  const channelScope = chooseRuntimeSessionScope({
    channelType: 'public',
    channelId: 'ch-1',
  });

  assert.equal(dmScope.key, 'dm:human-1');
  assert.equal(channelScope.key, 'channel:ch-1');
  assert.notEqual(scopedSessionKey('agent-1', dmScope), scopedSessionKey('agent-1', channelScope));
});

test('scoped provider session store keeps provider ids isolated by logical scope', () => {
  const store = new ScopedProviderSessionStore();
  const dmScope = chooseRuntimeSessionScope({
    channelType: 'dm',
    peerMemberId: 'human-1',
    channelId: 'dm-channel',
  });
  const channelScope = chooseRuntimeSessionScope({
    channelType: 'public',
    channelId: 'ch-1',
  });
  const taskScope = chooseRuntimeSessionScope({
    channelId: 'ch-1',
    rootMessageId: 'msg-1',
    taskId: 'task-1',
  });

  store.remember({
    agentId: 'agent-1',
    runtimeWorkspaceId: 'workspace-1',
    scope: dmScope,
    providerSessionId: 'provider-dm-1',
  });
  store.remember({
    agentId: 'agent-1',
    runtimeWorkspaceId: 'workspace-1',
    scope: channelScope,
    providerSessionId: 'provider-channel-1',
  });
  store.remember({
    agentId: 'agent-1',
    runtimeWorkspaceId: 'workspace-1',
    scope: taskScope,
    providerSessionId: 'provider-task-1',
  });

  assert.equal(store.lookup('agent-1', dmScope)?.providerSessionId, 'provider-dm-1');
  assert.equal(store.lookup('agent-1', channelScope)?.providerSessionId, 'provider-channel-1');
  assert.equal(store.lookup('agent-1', taskScope)?.providerSessionId, 'provider-task-1');
  assert.equal(store.lookup('agent-2', dmScope), undefined);

  const snapshot = store.snapshot('agent-1');
  assert.deepEqual(snapshot.map((item) => item.scopeKey).sort(), [
    'channel:ch-1',
    'dm:human-1',
    'task:task-1',
  ]);
  assert.ok(snapshot.every((item) => item.lastUsedAt > 0));
});
