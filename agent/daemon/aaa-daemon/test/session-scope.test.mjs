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

// G1 (task 08-15): the scope→session mapping survives daemon restarts via a
// JSON file; a "restart" is save → new store → load → remember-each.

test('scoped provider session mapping round-trips through the persistence file', async () => {
  const { mkdtempSync, readFileSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadScopedSessionRecords, saveScopedSessionRecords } = await import('../dist/daemon/scoped-session-persistence.js');

  const root = mkdtempSync(join(tmpdir(), 'aaa-scoped-sessions-'));
  const file = join(root, 'scoped-sessions.json');
  const scope = normalizeRuntimeSessionScope({ type: 'dm', peerMemberId: 'user-9' });

  const before = new ScopedProviderSessionStore();
  before.remember({ agentId: 'agent-1', scope, providerSessionId: 'goose-agent-1-20260815_1' });
  before.remember({
    agentId: 'agent-2',
    scope: normalizeRuntimeSessionScope({ type: 'channel', channelId: 'ch-2' }),
    providerSessionId: 'codex-thread-7',
    runtimeWorkspaceId: 'workspace-2',
    summaryMemoryEntryId: 'memory-5',
  });
  saveScopedSessionRecords(before.snapshot(), file);

  const after = new ScopedProviderSessionStore();
  for (const record of loadScopedSessionRecords(file)) {
    after.remember(record);
  }

  assert.equal(after.lookup('agent-1', scope)?.providerSessionId, 'goose-agent-1-20260815_1');
  const restoredAgent2 = after.snapshot('agent-2')[0];
  assert.equal(restoredAgent2.providerSessionId, 'codex-thread-7');
  assert.equal(restoredAgent2.runtimeWorkspaceId, 'workspace-2');
  assert.equal(restoredAgent2.summaryMemoryEntryId, 'memory-5');
  assert.equal(restoredAgent2.scope.channelId, 'ch-2');
  rmSync(root, { recursive: true, force: true });
});

test('forgetting a channel persists away on the next save', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadScopedSessionRecords, saveScopedSessionRecords } = await import('../dist/daemon/scoped-session-persistence.js');

  const root = mkdtempSync(join(tmpdir(), 'aaa-scoped-sessions-forget-'));
  const file = join(root, 'scoped-sessions.json');
  const store = new ScopedProviderSessionStore();
  const dmScope = normalizeRuntimeSessionScope({ type: 'dm', peerMemberId: 'u1' });
  const channelScope = normalizeRuntimeSessionScope({ type: 'channel', channelId: 'ch-x' });
  store.remember({ agentId: 'agent-1', scope: dmScope, providerSessionId: 's-dm' });
  store.remember({ agentId: 'agent-1', scope: channelScope, providerSessionId: 's-channel' });
  saveScopedSessionRecords(store.snapshot(), file);

  store.forgetChannel('agent-1', 'ch-x');
  saveScopedSessionRecords(store.snapshot(), file);

  const reloaded = new ScopedProviderSessionStore();
  for (const record of loadScopedSessionRecords(file)) reloaded.remember(record);
  assert.equal(reloaded.lookup('agent-1', dmScope)?.providerSessionId, 's-dm');
  assert.equal(reloaded.lookup('agent-1', channelScope), undefined);
  rmSync(root, { recursive: true, force: true });
});

test('missing or corrupt persistence file degrades to an empty mapping', async () => {
  const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadScopedSessionRecords } = await import('../dist/daemon/scoped-session-persistence.js');

  const root = mkdtempSync(join(tmpdir(), 'aaa-scoped-sessions-corrupt-'));
  assert.deepEqual(loadScopedSessionRecords(join(root, 'absent.json')), []);
  const corrupt = join(root, 'corrupt.json');
  writeFileSync(corrupt, '{not json', 'utf-8');
  assert.deepEqual(loadScopedSessionRecords(corrupt), []);
  const wrongSchema = join(root, 'wrong.json');
  writeFileSync(wrongSchema, JSON.stringify({ schemaVersion: 99, records: [{ agentId: 'a' }] }), 'utf-8');
  assert.deepEqual(loadScopedSessionRecords(wrongSchema), []);
  rmSync(root, { recursive: true, force: true });
});
