export type RuntimeSessionScopeType = 'dm' | 'channel' | 'thread' | 'task';

export interface RuntimeSessionScopeInput {
  type?: RuntimeSessionScopeType;
  peerMemberId?: string;
  channelId?: string;
  rootMessageId?: string;
  taskId?: string;
}

export type RuntimeSessionScope =
  | { type: 'dm'; peerMemberId: string; key: string }
  | { type: 'channel'; channelId: string; key: string }
  | { type: 'thread'; channelId: string; rootMessageId: string; key: string }
  | { type: 'task'; taskId: string; key: string };

export interface RuntimeSessionScopeChoice {
  channelType?: string;
  peerMemberId?: string;
  channelId?: string;
  rootMessageId?: string;
  taskId?: string;
}

export interface ScopedProviderSessionRecord {
  agentId: string;
  runtimeWorkspaceId?: string;
  scope: RuntimeSessionScope;
  scopeKey: string;
  providerSessionId: string;
  status: 'active' | 'dead';
  lastUsedAt: number;
  summaryMemoryEntryId?: string;
}

export interface RememberScopedProviderSessionInput {
  agentId: string;
  runtimeWorkspaceId?: string;
  scope: RuntimeSessionScope;
  providerSessionId: string;
  status?: 'active' | 'dead';
  summaryMemoryEntryId?: string;
  now?: number;
}

export function normalizeRuntimeSessionScope(input: RuntimeSessionScopeInput): RuntimeSessionScope {
  if (input.type === 'task') {
    const taskId = requireScopePart(input.taskId, 'taskId');
    return { type: 'task', taskId, key: `task:${taskId}` };
  }

  if (input.type === 'thread') {
    const channelId = requireScopePart(input.channelId, 'channelId');
    const rootMessageId = requireScopePart(input.rootMessageId, 'rootMessageId');
    return { type: 'thread', channelId, rootMessageId, key: `thread:${channelId}:${rootMessageId}` };
  }

  if (input.type === 'dm') {
    const peerMemberId = requireScopePart(input.peerMemberId, 'peerMemberId');
    return { type: 'dm', peerMemberId, key: `dm:${peerMemberId}` };
  }

  if (input.type === 'channel') {
    const channelId = requireScopePart(input.channelId, 'channelId');
    return { type: 'channel', channelId, key: `channel:${channelId}` };
  }

  throw new Error('Missing runtime session scope type');
}

export function chooseRuntimeSessionScope(input: RuntimeSessionScopeChoice): RuntimeSessionScope {
  if (input.taskId) {
    return normalizeRuntimeSessionScope({ type: 'task', taskId: input.taskId });
  }

  if (input.rootMessageId && input.channelId) {
    return normalizeRuntimeSessionScope({
      type: 'thread',
      channelId: input.channelId,
      rootMessageId: input.rootMessageId,
    });
  }

  if (input.channelType === 'dm' && input.peerMemberId) {
    return normalizeRuntimeSessionScope({ type: 'dm', peerMemberId: input.peerMemberId });
  }

  return normalizeRuntimeSessionScope({ type: 'channel', channelId: input.channelId });
}

export function scopedSessionKey(agentId: string, scope: RuntimeSessionScope): string {
  return `${requireScopePart(agentId, 'agentId')}::${scope.key}`;
}

export class ScopedProviderSessionStore {
  private readonly records = new Map<string, ScopedProviderSessionRecord>();

  remember(input: RememberScopedProviderSessionInput): ScopedProviderSessionRecord {
    const agentId = requireScopePart(input.agentId, 'agentId');
    const providerSessionId = requireScopePart(input.providerSessionId, 'providerSessionId');
    const key = scopedSessionKey(agentId, input.scope);
    const existing = this.records.get(key);
    const record: ScopedProviderSessionRecord = {
      agentId,
      runtimeWorkspaceId: input.runtimeWorkspaceId ?? existing?.runtimeWorkspaceId,
      scope: input.scope,
      scopeKey: input.scope.key,
      providerSessionId,
      status: input.status ?? existing?.status ?? 'active',
      lastUsedAt: input.now ?? Date.now(),
      summaryMemoryEntryId: input.summaryMemoryEntryId ?? existing?.summaryMemoryEntryId,
    };
    this.records.set(key, record);
    return record;
  }

  lookup(agentId: string, scope: RuntimeSessionScope): ScopedProviderSessionRecord | undefined {
    const key = scopedSessionKey(agentId, scope);
    const record = this.records.get(key);
    if (!record || record.status !== 'active') return undefined;
    record.lastUsedAt = Date.now();
    return record;
  }

  snapshot(agentId?: string): ScopedProviderSessionRecord[] {
    const items = Array.from(this.records.values())
      .filter((record) => !agentId || record.agentId === agentId)
      .sort((a, b) => a.agentId.localeCompare(b.agentId) || a.scopeKey.localeCompare(b.scopeKey));
    return items.map((record) => ({ ...record, scope: { ...record.scope } } as ScopedProviderSessionRecord));
  }
}

function requireScopePart(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`Missing ${name}`);
  return trimmed;
}
