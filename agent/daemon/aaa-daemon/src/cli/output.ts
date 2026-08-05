/**
 * Canonical output formatters.
 *
 * Each formatter converts a proxy JSON response into human-readable
 * canonical text. When `--format json` is used, the raw JSON is
 * passed through instead.
 */

export type OutputFormat = 'text' | 'json';

/** Parse --format option value. */
export function parseFormat(value: string | undefined): OutputFormat {
  if (value === 'json') return 'json';
  return 'text'; // default
}

// ─── Message formatting ──────────────────────────────────────────

interface MessageData {
  target?: string;
  msg?: string;
  messageId?: string;
  time?: string;
  type?: string;
  sender?: string;
  content?: string;
  threadId?: string;
  replyTarget?: string;
  task?: string;
  taskNumber?: number;
  taskStatus?: string;
  seq?: number;
}

function formatMessageLine(msg: MessageData): string {
  const target = msg.target ?? '';
  const id = msg.msg ?? msg.messageId ?? '';
  const time = msg.time ?? '';
  const type = msg.type ?? '';
  const sender = msg.sender ?? '';
  const content = msg.content ?? '';
  const parts = [`[target=${target} msg=${id} time=${time} type=${type}]`];
  if (sender) parts.push(`${sender}:`);
  parts.push(content);
  return parts.join(' ');
}

/** Format message check response. */
export function formatMessageCheck(json: unknown): string {
  const data = json as { messages?: MessageData[] };
  const messages = data.messages ?? [];
  if (messages.length === 0) {
    return 'No new messages.\n';
  }
  const lines = messages.map(formatMessageLine);
  lines.push('No more new messages.');
  return lines.join('\n') + '\n';
}

/** Format message read (history) response. */
export function formatMessageRead(json: unknown): string {
  let messages: MessageData[];
  if (Array.isArray(json)) {
    messages = json as MessageData[];
  } else {
    const data = json as { messages?: MessageData[] };
    messages = data.messages ?? [];
  }
  if (messages.length === 0) {
    return 'No messages.\n';
  }
  const lines = messages.map(formatMessageLine);
  return lines.join('\n') + '\n';
}

/** Format message send success response. */
export function formatMessageSend(json: unknown): string {
  const data = json as { state?: string; messageSeq?: number; message?: string };
  if (data.state === 'sent' || data.messageSeq !== undefined) {
    const seq = data.messageSeq !== undefined ? ` (seq=${data.messageSeq})` : '';
    return `Message sent.${seq}\n`;
  }
  return JSON.stringify(data) + '\n';
}

// ─── Memory formatting (smallkhoj extension) ─────────────────────

/** Format memory read response. */
export function formatMemoryRead(json: unknown): string {
  const data = json as { content?: string; contentText?: string; sha?: string; path?: string };
  const content = data.content ?? data.contentText ?? '';
  const sha = data.sha ? `  (sha: ${data.sha})` : '';
  const pathStr = data.path ? `Path: ${data.path}\n` : '';
  return `${pathStr}${content}${sha}\n`;
}

// ─── Server info formatting ──────────────────────────────────────

interface ChannelInfo {
  name?: string;
  joined?: boolean;
  private?: boolean;
  description?: string;
}

interface AgentInfo {
  name?: string;
  status?: string;
  role?: string;
  description?: string;
}

interface HumanInfo {
  name?: string;
  role?: string;
}

/** Format server info response. */
export function formatServerInfo(json: unknown): string {
  const data = json as {
    serverId?: string;
    serverName?: string;
    name?: string;
    id?: string;
    channels?: ChannelInfo[];
    agents?: AgentInfo[];
    humans?: HumanInfo[];
  };
  const lines: string[] = [];

  if (data.serverName ?? data.name) {
    lines.push(`Server: ${data.serverName ?? data.name}`);
  }

  if (data.channels && data.channels.length > 0) {
    lines.push('', 'Channels:');
    for (const ch of data.channels) {
      const flags = [
        ch.private ? 'private' : 'public',
        ch.joined ? 'joined' : 'not joined',
      ].join(', ');
      const desc = ch.description ? ` — ${ch.description}` : '';
      lines.push(`  #${ch.name} [${flags}]${desc}`);
    }
  }

  if (data.agents && data.agents.length > 0) {
    lines.push('', 'Agents:');
    for (const ag of data.agents) {
      const status = ag.status ? ` (${ag.status})` : '';
      const desc = ag.description ? ` — ${ag.description}` : '';
      lines.push(`  @${ag.name}${status}${desc}`);
    }
  }

  if (data.humans && data.humans.length > 0) {
    lines.push('', 'Humans:');
    for (const h of data.humans) {
      const role = h.role ? ` [${h.role}]` : '';
      lines.push(`  @${h.name}${role}`);
    }
  }

  return lines.join('\n') + '\n';
}

// ─── Message search formatting ───────────────────────────────────

interface SearchResult {
  target?: string;
  msg?: string;
  messageId?: string;
  time?: string;
  type?: string;
  sender?: string;
  content?: string;
  score?: number;
}

/** Format message search response. */
export function formatMessageSearch(json: unknown): string {
  const data = json as { results?: SearchResult[] };
  const results = data.results ?? [];
  if (results.length === 0) {
    return 'No results found.\n';
  }
  const lines = results.map((r) => {
    const target = r.target ?? '';
    const id = r.msg ?? r.messageId ?? '';
    const time = r.time ?? '';
    const sender = r.sender ?? '';
    const content = r.content ?? '';
    return `[target=${target} msg=${id} time=${time}] ${sender}: ${content}`;
  });
  return lines.join('\n') + '\n';
}

/** Format message resolve response. */
export function formatMessageResolve(json: unknown): string {
  const data = json as { target?: string; channel?: string; channelId?: string; threadId?: string };
  const parts: string[] = [];
  if (data.target) parts.push(`Target: ${data.target}`);
  if (data.channel) parts.push(`Channel: ${data.channel}`);
  if (data.channelId) parts.push(`Channel ID: ${data.channelId}`);
  if (data.threadId) parts.push(`Thread ID: ${data.threadId}`);
  if (parts.length === 0) return JSON.stringify(json) + '\n';
  return parts.join('\n') + '\n';
}

/** Format message react response (generic write success). */
export function formatReact(_json: unknown): string {
  return 'Reaction added.\n';
}

// ─── Channel formatting ─────────────────────────────────────────

interface MemberInfo {
  memberId?: string;
  kind?: string;
  handle?: string;
  reference?: string;
  name?: string;
  role?: string;
  type?: string;
  status?: string;
  description?: string;
}

/** Format channel members response. */
export function formatChannelMembers(json: unknown): string {
  const data = json as { channelId?: string; rosterRevision?: number; members?: MemberInfo[] };
  const members = data.members ?? [];
  const heading = data.rosterRevision === undefined
    ? '## Channel Members'
    : `## Channel Members (revision ${data.rosterRevision})`;
  if (members.length === 0) {
    return `${heading}\n\nNo members.\n`;
  }
  const formatMember = (m: MemberInfo): string => {
    const role = m.role ? ` [${m.role}]` : '';
    const status = m.status ? ` (${m.status})` : '';
    const kind = m.kind ?? m.type;
    const desc = kind === 'agent' && m.description ? ` — ${m.description}` : '';
    const rawReference = m.reference ?? m.handle ?? m.name ?? '<unknown>';
    const reference = rawReference.startsWith('@') ? rawReference : `@${rawReference}`;
    const identity = m.memberId ? ` [${kind ?? 'member'} id=${m.memberId}]` : role;
    return `  ${reference}${identity}${status}${desc}`;
  };
  const memberKind = (member: MemberInfo): string | undefined => member.kind ?? member.type;
  const agents = members.filter((m) => memberKind(m) === 'agent');
  const humans = members.filter((m) => memberKind(m) === 'human' || !memberKind(m));
  const others = members.filter((m) => {
    const kind = memberKind(m);
    return Boolean(kind && kind !== 'agent' && kind !== 'human');
  });
  const lines = [heading];
  if (agents.length > 0) {
    lines.push('', 'Agents:', ...agents.map(formatMember));
  }
  if (humans.length > 0) {
    lines.push('', 'Humans:', ...humans.map(formatMember));
  }
  if (others.length > 0) {
    lines.push('', 'Members:', ...others.map(formatMember));
  }
  return lines.join('\n') + '\n';
}

/** Format generic join/leave response. */
export function formatChannelAction(json: unknown, action: string): string {
  const data = json as { joined?: boolean; left?: boolean; channel?: string };
  if (action === 'join') return `Joined channel.\n`;
  if (action === 'leave') return `Left channel.\n`;
  if (action === 'mute') return `Channel muted.\n`;
  if (action === 'unmute') return `Channel unmuted.\n`;
  return JSON.stringify(data) + '\n';
}

interface InboxRow {
  target?: string;
  pendingCount?: number;
  pending?: number;
  firstPendingMsgId?: string;
  latestMsgId?: string;
  latestSenderName?: string;
  latestSender?: string;
  flags?: string[];
}

function shortId(id: string | undefined): string {
  return id ? id.slice(0, 8) : '';
}

/** Format inbox target summary response without draining message bodies. */
export function formatInboxCheck(json: unknown): string {
  const data = json as { rows?: InboxRow[]; pending_targets?: number; pending_messages?: number };
  const rows = data.rows ?? [];
  if (rows.length === 0) return 'No pending inbox targets.\n';
  const totalMessages = data.pending_messages ?? rows.reduce((sum, row) => sum + (row.pendingCount ?? row.pending ?? 0), 0);
  const lines = [`Inbox update: ${totalMessages} unread message${totalMessages === 1 ? '' : 's'} total; ${rows.length} changed target${rows.length === 1 ? '' : 's'}`];
  for (const row of rows) {
    const pending = row.pendingCount ?? row.pending ?? 0;
    const sender = row.latestSenderName ?? row.latestSender;
    const first = shortId(row.firstPendingMsgId);
    const latest = shortId(row.latestMsgId);
    const flags = row.flags && row.flags.length > 0 ? ` · ${row.flags.join(' · ')}` : '';
    const senderPart = sender ? ` · latest sender @${sender.replace(/^@/, '')}` : '';
    lines.push(`${row.target ?? '(unknown target)'}  pending: ${pending} message${pending === 1 ? '' : 's'}${first ? ` · first msg=${first}` : ''}${senderPart}${latest ? ` · latest msg=${latest}` : ''}${flags}`);
  }
  return lines.join('\n') + '\n';
}

/** Format local auth whoami diagnostic output. */
export function formatAuthWhoami(json: unknown): string {
  const data = json as {
    ok?: boolean;
    data?: {
      agentId?: string;
      serverUrl?: string;
      serverId?: string | null;
      clientMode?: string;
      secretSource?: string;
      profileSlug?: string;
      profileCredentialPath?: string;
    };
  };
  const ctx = data.data ?? {};
  const lines = [
    `Agent ID: ${ctx.agentId ?? '(unknown)'}`,
    `Server URL: ${ctx.serverUrl ?? '(unknown)'}`,
    `Server ID: ${ctx.serverId ?? '(none)'}`,
    `Client mode: ${ctx.clientMode ?? '(unknown)'}`,
    `Secret source: ${ctx.secretSource ?? '(unknown)'}`,
  ];
  if (ctx.profileSlug) lines.push(`Profile: ${ctx.profileSlug}`);
  if (ctx.profileCredentialPath) lines.push(`Profile credential: ${ctx.profileCredentialPath}`);
  return lines.join('\n') + '\n';
}

/** Format manual search response. */
export function formatManualSearch(json: unknown): string {
  const data = json as {
    results?: Array<{ topic?: string; title?: string; summary?: string; description?: string; snippet?: string; content?: string }>;
    topics?: Array<{ topic?: string; title?: string; summary?: string; description?: string; snippet?: string; content?: string }>;
  };
  const results = data.results ?? data.topics ?? [];
  if (results.length === 0) return 'No manual topics found.\n';
  const lines = ['Manual search results:'];
  for (const [idx, result] of results.entries()) {
    const topic = result.topic ?? result.title ?? '(unknown topic)';
    const summary = result.summary ?? result.description;
    const snippet = result.snippet ?? result.content;
    lines.push(`${idx + 1}. ${summary ? `${topic} — ${summary}` : topic}`);
    if (snippet) lines.push(`   ${snippet}`);
  }
  return lines.join('\n') + '\n';
}

// ─── Thread formatting ──────────────────────────────────────────

interface ThreadMessage {
  target?: string;
  msg?: string;
  messageId?: string;
  time?: string;
  type?: string;
  sender?: string;
  content?: string;
}

/** Format thread read response. */
export function formatThreadRead(json: unknown): string {
  let messages: ThreadMessage[];
  if (Array.isArray(json)) {
    messages = json as ThreadMessage[];
  } else {
    const data = json as { messages?: ThreadMessage[] };
    messages = data.messages ?? [];
  }
  if (messages.length === 0) {
    return 'No messages in thread.\n';
  }
  const lines = messages.map((m) => {
    const target = m.target ?? '';
    const id = m.msg ?? m.messageId ?? '';
    const time = m.time ?? '';
    const sender = m.sender ?? '';
    return `[target=${target} msg=${id} time=${time}] ${sender}: ${m.content ?? ''}`;
  });
  return lines.join('\n') + '\n';
}

/** Format thread unfollow response. */
export function formatThreadUnfollow(_json: unknown): string {
  return 'Thread unfollowed.\n';
}

// ─── Task formatting ────────────────────────────────────────────

interface TaskInfo {
  number?: number;
  title?: string;
  status?: string;
  assignee?: string;
  channel?: string;
}

/** Format task list response. */
export function formatTaskList(json: unknown): string {
  let tasks: TaskInfo[];
  if (Array.isArray(json)) {
    tasks = json as TaskInfo[];
  } else {
    const data = json as { tasks?: TaskInfo[] };
    tasks = data.tasks ?? [];
  }
  if (tasks.length === 0) {
    return 'No tasks.\n';
  }
  const lines = tasks.map((t) => {
    const num = t.number ?? '?';
    const status = t.status ? ` [${t.status}]` : '';
    const assigneeRaw = t.assignee ?? '';
    const assignee = assigneeRaw ? ` ${assigneeRaw.startsWith('@') ? assigneeRaw : '@' + assigneeRaw}` : '';
    return `  #${num}${status}${assignee} — ${t.title ?? ''}`;
  });
  return lines.join('\n') + '\n';
}

/** Format generic task action response. */
export function formatTaskAction(_json: unknown, action: string): string {
  const messages: Record<string, string> = {
    claim: 'Task claimed.\n',
    unclaim: 'Task unclaimed.\n',
    update: 'Task updated.\n',
    create: 'Task created.\n',
    summary: 'Task summary written.\n',
    promote: 'Task memory promoted.\n',
  };
  return messages[action] ?? 'Done.\n';
}

// ─── Profile formatting ─────────────────────────────────────────

interface ProfileData {
  name?: string;
  displayName?: string;
  description?: string;
  status?: string;
  avatarUrl?: string;
  handle?: string;
  role?: string;
}

/** Format profile show response. */
export function formatProfileShow(json: unknown): string {
  // Backend wraps profile data in { profile: {...} }
  const raw = json as { profile?: ProfileData } & ProfileData;
  const data = raw.profile ?? raw;
  const lines: string[] = [];
  const name = data.displayName ?? data.name ?? data.handle ?? '';
  if (name) lines.push(`Name: ${name}`);
  if (data.handle) lines.push(`Handle: ${data.handle}`);
  if (data.role) lines.push(`Role: ${data.role}`);
  if (data.description) lines.push(`Description: ${data.description}`);
  if (data.status) lines.push(`Status: ${data.status}`);
  if (data.avatarUrl) lines.push(`Avatar: ${data.avatarUrl}`);
  if (lines.length === 0) return JSON.stringify(json) + '\n';
  return lines.join('\n') + '\n';
}

/** Format profile update response. */
export function formatProfileUpdate(_json: unknown): string {
  return 'Profile updated.\n';
}

// ─── Reminder formatting ────────────────────────────────────────

interface ReminderInfo {
  id?: string;
  title?: string;
  fireAt?: string;
  repeat?: string | { cadence?: string };
  channel?: string;
  status?: string;
  done?: boolean;
}

/** Format reminder list response. */
export function formatReminderList(json: unknown): string {
  let reminders: ReminderInfo[];
  if (Array.isArray(json)) {
    reminders = json as ReminderInfo[];
  } else {
    const data = json as { reminders?: ReminderInfo[] };
    reminders = data.reminders ?? [];
  }
  if (reminders.length === 0) {
    return 'No reminders.\n';
  }
  const lines = reminders.map((r) => {
    const title = r.title ?? '(no title)';
    const fire = r.fireAt ? ` @ ${r.fireAt}` : '';
    // repeat can be string or { cadence: "daily" }
    const repeatRaw = r.repeat;
    const repeatStr = typeof repeatRaw === 'string' ? repeatRaw : repeatRaw?.cadence;
    const repeat = repeatStr ? ` (${repeatStr})` : '';
    // channel already includes # from backend
    const channel = r.channel ? ` ${r.channel}` : '';
    // status takes priority over done boolean
    const status = r.status ? ` [${r.status}]` : r.done ? ' [done]' : '';
    return `  ${title}${fire}${repeat}${channel}${status}`;
  });
  return lines.join('\n') + '\n';
}

/** Format reminder schedule/create response. */
export function formatReminderSchedule(_json: unknown): string {
  return 'Reminder scheduled.\n';
}

/** Format reminder update/snooze response. */
export function formatReminderUpdate(_json: unknown): string {
  return 'Reminder updated.\n';
}

/** Format reminder cancel response. */
export function formatReminderCancel(_json: unknown): string {
  return 'Reminder canceled.\n';
}

// ─── Integration formatting ─────────────────────────────────────

interface IntegrationInfo {
  service?: string;
  status?: string;
  loggedIn?: boolean;
}

/** Format integration list response. */
export function formatIntegrationList(json: unknown): string {
  let integrations: IntegrationInfo[];
  if (Array.isArray(json)) {
    integrations = json as IntegrationInfo[];
  } else {
    const data = json as { integrations?: IntegrationInfo[] };
    integrations = data.integrations ?? [];
  }
  if (integrations.length === 0) {
    return 'No integrations.\n';
  }
  const lines = integrations.map((i) => {
    const service = i.service ?? '?';
    const status = i.status ? ` (${i.status})` : i.loggedIn ? ' (logged in)' : '';
    return `  ${service}${status}`;
  });
  return lines.join('\n') + '\n';
}

/** Format integration login response. */
export function formatIntegrationLogin(_json: unknown): string {
  return 'Login ready.\n';
}

// ─── Memory formatting (smallkhoj extension) ────────────────────

/** Format memory search response. */
export function formatMemorySearch(json: unknown): string {
  // Backend returns { entries: [{ path, contentText, ... }] } or { results: [...] }
  const data = json as {
    entries?: Array<{ path?: string; contentText?: string; content?: string }>;
    results?: Array<{ path?: string; contentText?: string; content?: string }>;
  };
  const items = data.entries ?? data.results ?? [];
  if (items.length === 0) {
    return 'No results found.\n';
  }
  const lines = items.map((r) => {
    const content = r.contentText ?? r.content ?? '';
    return `  ${r.path ?? '?'}: ${content.slice(0, 100)}`;
  });
  return lines.join('\n') + '\n';
}

/** Format memory write response. */
export function formatMemoryWrite(_json: unknown): string {
  return 'Memory written.\n';
}

/** Format memory propose response. */
export function formatMemoryPropose(_json: unknown): string {
  return 'Proposal created.\n';
}

/** Format memory proposals list response. */
export function formatMemoryProposals(json: unknown): string {
  const data = json as { proposals?: Array<{ id?: string; path?: string; status?: string; reason?: string }> };
  const proposals = data.proposals ?? [];
  if (proposals.length === 0) {
    return 'No proposals.\n';
  }
  const lines = proposals.map((p) => {
    const status = p.status ? ` [${p.status}]` : '';
    const reason = p.reason ? ` — ${p.reason}` : '';
    return `  ${p.id ?? '?'} ${p.path ?? '?'}${status}${reason}`;
  });
  return lines.join('\n') + '\n';
}

/** Format memory accept/reject proposal response. */
export function formatProposalAction(_json: unknown, action: string): string {
  return action === 'accept' ? 'Proposal accepted.\n' : 'Proposal rejected.\n';
}

/** Format memory delete response. */
export function formatMemoryDelete(_json: unknown): string {
  return 'Memory deleted.\n';
}

/** Format thread summary response. */
export function formatThreadSummary(_json: unknown): string {
  return 'Thread summary written.\n';
}

/** Passthrough formatter that accepts unknown and outputs as string. */
export function formatPassthroughText(json: unknown): string {
  const data = json as { content?: unknown };
  if (typeof data?.content === 'string') return data.content.endsWith('\n') ? data.content : data.content + '\n';
  if (typeof json === 'string') return json.endsWith('\n') ? json : json + '\n';
  return JSON.stringify(json) + '\n';
}

// ─── Attachment formatting ──────────────────────────────────────

/** Format attachment view response. */
export function formatAttachmentView(json: unknown): string {
  const data = json as { id?: string; filename?: string; mimeType?: string; size?: number; url?: string };
  const lines: string[] = [];
  if (data.id) lines.push(`ID: ${data.id}`);
  if (data.filename) lines.push(`Filename: ${data.filename}`);
  if (data.mimeType) lines.push(`Type: ${data.mimeType}`);
  if (data.size !== undefined) lines.push(`Size: ${data.size}`);
  if (data.url) lines.push(`URL: ${data.url}`);
  if (lines.length === 0) return JSON.stringify(json) + '\n';
  return lines.join('\n') + '\n';
}

/** Format attachment upload response. */
export function formatAttachmentUpload(json: unknown): string {
  const data = json as { attachment?: { id?: string }; id?: string };
  const id = data.attachment?.id ?? data.id;
  if (id) return `Attachment uploaded (id: ${id}).\n`;
  return 'Attachment uploaded.\n';
}

/** For commands not yet migrated to canonical formatting, pass through raw JSON. */
export function formatPassthrough(text: string): string {
  return text.endsWith('\n') ? text : text + '\n';
}
