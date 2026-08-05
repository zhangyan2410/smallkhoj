export interface RuntimeChannelMember {
  memberId: string;
  kind: 'human' | 'agent' | string;
  handle?: string;
  reference: string;
  status?: string;
  description?: string;
}

export interface RuntimeChannelSnapshot {
  channelId: string;
  rosterRevision: number;
  members: RuntimeChannelMember[];
}

export interface RuntimeChannelReferenceUpdate {
  memberId: string;
  reference: string;
}

export interface RuntimeChannelMembershipChange {
  eventId?: string;
  eventType: 'channel.member_joined' | 'channel.member_left';
  channelId: string;
  rosterRevision: number;
  member: RuntimeChannelMember;
  referenceUpdates: RuntimeChannelReferenceUpdate[];
  removedAgentId?: string;
}

interface RuntimeChannelContextEntry {
  rosterRevision: number;
  members: Map<string, RuntimeChannelMember>;
  recentEvents: string[];
  recentEventSet: Set<string>;
}

export type RuntimeChannelChangeResult =
  | { kind: 'uninitialized' }
  | { kind: 'duplicate'; rosterRevision: number }
  | { kind: 'gap'; expectedRevision: number; receivedRevision: number }
  | { kind: 'applied'; rosterRevision: number }
  | { kind: 'removed'; rosterRevision: number };

const MAX_RECENT_EVENTS = 256;

function contextKey(agentId: string, generation: string, channelId: string): string {
  return `${agentId}::${generation}::${channelId}`;
}

function cloneMember(member: RuntimeChannelMember): RuntimeChannelMember {
  return { ...member };
}

function eventReplayKey(change: RuntimeChannelMembershipChange): string | undefined {
  return change.eventId
    ? `${change.eventId}:${change.rosterRevision}`
    : undefined;
}

export class RuntimeChannelContextRegistry {
  private readonly entries = new Map<string, RuntimeChannelContextEntry>();

  has(agentId: string, generation: string, channelId: string): boolean {
    return this.entries.has(contextKey(agentId, generation, channelId));
  }

  initialize(
    agentId: string,
    generation: string,
    snapshot: RuntimeChannelSnapshot,
  ): RuntimeChannelSnapshot {
    const entry: RuntimeChannelContextEntry = {
      rosterRevision: snapshot.rosterRevision,
      members: new Map(snapshot.members.map((member) => [member.memberId, cloneMember(member)])),
      recentEvents: [],
      recentEventSet: new Set(),
    };
    this.entries.set(contextKey(agentId, generation, snapshot.channelId), entry);
    return this.snapshot(agentId, generation, snapshot.channelId)!;
  }

  snapshot(
    agentId: string,
    generation: string,
    channelId: string,
  ): RuntimeChannelSnapshot | undefined {
    const entry = this.entries.get(contextKey(agentId, generation, channelId));
    if (!entry) return undefined;
    return {
      channelId,
      rosterRevision: entry.rosterRevision,
      members: Array.from(entry.members.values(), cloneMember),
    };
  }

  apply(
    agentId: string,
    generation: string,
    change: RuntimeChannelMembershipChange,
  ): RuntimeChannelChangeResult {
    const key = contextKey(agentId, generation, change.channelId);
    const entry = this.entries.get(key);
    if (!entry) return { kind: 'uninitialized' };

    const replayKey = eventReplayKey(change);
    if (replayKey && entry.recentEventSet.has(replayKey)) {
      return { kind: 'duplicate', rosterRevision: entry.rosterRevision };
    }
    this.rememberEvent(entry, replayKey);

    if (change.rosterRevision <= entry.rosterRevision) {
      return { kind: 'duplicate', rosterRevision: entry.rosterRevision };
    }
    const expectedRevision = entry.rosterRevision + 1;
    if (change.rosterRevision !== expectedRevision) {
      return {
        kind: 'gap',
        expectedRevision,
        receivedRevision: change.rosterRevision,
      };
    }

    for (const update of change.referenceUpdates) {
      const current = entry.members.get(update.memberId);
      if (current) entry.members.set(update.memberId, { ...current, reference: update.reference });
    }
    if (change.eventType === 'channel.member_joined') {
      entry.members.set(change.member.memberId, cloneMember(change.member));
    } else {
      entry.members.delete(change.member.memberId);
    }
    entry.rosterRevision = change.rosterRevision;

    if (change.removedAgentId === agentId) {
      this.entries.delete(key);
      return { kind: 'removed', rosterRevision: change.rosterRevision };
    }
    return { kind: 'applied', rosterRevision: entry.rosterRevision };
  }

  clearChannel(agentId: string, generation: string, channelId: string): void {
    this.entries.delete(contextKey(agentId, generation, channelId));
  }

  clearRuntime(agentId: string, generation: string): void {
    const prefix = `${agentId}::${generation}::`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  private rememberEvent(entry: RuntimeChannelContextEntry, replayKey?: string): void {
    if (!replayKey) return;
    entry.recentEvents.push(replayKey);
    entry.recentEventSet.add(replayKey);
    while (entry.recentEvents.length > MAX_RECENT_EVENTS) {
      const removed = entry.recentEvents.shift();
      if (removed) entry.recentEventSet.delete(removed);
    }
  }
}

export function channelMembershipPromptRules(): string[] {
  return [
    '## Channel Member Context',
    '',
    '- The daemon injects one current Channel member snapshot when you first enter a Channel runtime context, then compact join/leave and reference updates.',
    '- Channel membership may change frequently. Keep only the latest snapshot plus updates as your current working member list, and replace superseded @references.',
    '- A member update is context, not a task. Do not send a chat reply merely to acknowledge it and do not infer durable roles, permissions, identity, or assignments from temporary membership.',
    '- When an injected member snapshot or update is complete and revision-contiguous, process it without reading long-lived memory, checking messages, or calling tools. Only query the current roster when the member state or reference is actually uncertain.',
    '- Use only the canonical @reference supplied for the current Channel. Human display names are not part of Agent-visible identity.',
    '- If the member state or a reference is uncertain, run `aura channel members --channel <target>` before addressing someone.',
  ];
}

export function formatChannelRosterSnapshot(snapshot: RuntimeChannelSnapshot): string {
  const lines = [
    `[event=channel.members.snapshot channelId=${snapshot.channelId} revision=${snapshot.rosterRevision}]`,
    'Current Channel members (authoritative entry snapshot):',
  ];
  if (snapshot.members.length === 0) {
    lines.push('- none');
  } else {
    for (const member of snapshot.members) {
      const description = member.kind === 'agent' && member.description
        ? ` — ${member.description}`
        : '';
      lines.push(`- ${member.reference} [${member.kind} memberId=${member.memberId}]${description}`);
    }
  }
  lines.push('Keep this as volatile working context. Do not read long-lived memory, check messages, call tools, or send an acknowledgment for this complete snapshot.');
  return lines.join('\n');
}

export function formatChannelRosterReconciliation(snapshot: RuntimeChannelSnapshot): string {
  const lines = [
    `[event=channel.members.reconciled channelId=${snapshot.channelId} revision=${snapshot.rosterRevision}]`,
    'A membership revision gap was reconciled. Replace the previous working member list with these current references:',
  ];
  if (snapshot.members.length === 0) {
    lines.push('- none');
  } else {
    for (const member of snapshot.members) {
      lines.push(`- ${member.reference} [${member.kind} memberId=${member.memberId}]`);
    }
  }
  lines.push('Descriptions are intentionally not repeated. Do not read long-lived memory, check messages, call tools, or send an acknowledgment for this reconciled snapshot.');
  return lines.join('\n');
}

export function formatChannelMembershipChange(change: RuntimeChannelMembershipChange): string {
  const action = change.eventType === 'channel.member_joined' ? 'joined' : 'left';
  const lines = [
    `[event=${change.eventType} channelId=${change.channelId} revision=${change.rosterRevision}]`,
    `${change.member.reference} [${change.member.kind} memberId=${change.member.memberId}] ${action} this Channel.`,
  ];
  if (change.referenceUpdates.length > 0) {
    lines.push('Updated canonical references:');
    for (const update of change.referenceUpdates) {
      lines.push(`- memberId=${update.memberId} reference=${update.reference}`);
    }
  }
  if (change.removedAgentId) {
    lines.push(`removedAgentId=${change.removedAgentId}`);
  }
  lines.push('Keep only the latest member state and references. Do not read long-lived memory, check messages, call tools, or send an acknowledgment for this complete update.');
  return lines.join('\n');
}

export function formatRemovedFromChannel(change: RuntimeChannelMembershipChange): string {
  return [
    `[event=channel.member_left channelId=${change.channelId} revision=${change.rosterRevision}]`,
    'You have been removed from this Channel and must stop reading, replying to, or acting on its messages.',
    'This is a complete membership boundary update. Do not read long-lived memory, check messages, call tools, or send a confirmation reply.',
  ].join('\n');
}
