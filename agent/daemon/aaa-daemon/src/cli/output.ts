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
  name?: string;
  role?: string;
  type?: string;
  status?: string;
  description?: string;
}

/** Format channel members response. */
export function formatChannelMembers(json: unknown): string {
  const data = json as { members?: MemberInfo[] };
  const members = data.members ?? [];
  if (members.length === 0) {
    return 'No members.\n';
  }
  const lines = members.map((m) => {
    const role = m.role ? ` [${m.role}]` : '';
    const status = m.status ? ` (${m.status})` : '';
    const desc = m.description ? ` — ${m.description}` : '';
    return `  @${m.name}${role}${status}${desc}`;
  });
  return lines.join('\n') + '\n';
}

/** Format generic join/leave response. */
export function formatChannelAction(json: unknown, action: string): string {
  const data = json as { joined?: boolean; left?: boolean; channel?: string };
  if (action === 'join') return `Joined channel.\n`;
  if (action === 'leave') return `Left channel.\n`;
  return JSON.stringify(data) + '\n';
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

/** For commands not yet migrated to canonical formatting, pass through raw JSON. */
export function formatPassthrough(text: string): string {
  return text.endsWith('\n') ? text : text + '\n';
}
