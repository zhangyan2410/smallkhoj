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
    channels?: ChannelInfo[];
    agents?: AgentInfo[];
    humans?: HumanInfo[];
  };
  const lines: string[] = [];

  if (data.serverName) {
    lines.push(`Server: ${data.serverName}`);
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

// ─── Generic passthrough ─────────────────────────────────────────

/** For commands not yet migrated to canonical formatting, pass through raw JSON. */
export function formatPassthrough(text: string): string {
  return text.endsWith('\n') ? text : text + '\n';
}
