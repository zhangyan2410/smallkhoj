/**
 * HTTP Agent Proxy — forwards requests to Slock API with token injection.
 * Mirrors opencan-daemon's proxy pattern + real Slock daemon's agentCredentialProxy.
 *
 * Responsibilities:
 * - Listen on a local TCP port (127.0.0.1:dynamic)
 * - Authenticate callers with bearer token (sap_*)
 * - Rewrite agent-scoped paths to internal API paths
 * - Inject Authorization + X-Agent-Id headers
 * - Freshness check: hold sends when pending messages exist
 * - Buffer send/events/history responses for inbox coordination
 */

import http from 'http';
import { URL } from 'url';
import { EventEmitter } from 'events';
import type { Credential } from '../types.js';
import { StateMachine, ProxyState } from './state.js';
import { EventBuffer } from './event-buffer.js';

// ── Path rewrite ─────────────────────────────────────────────

export function rewriteAgentPath(pathname: string, search: string, agentId: string): string {
  // Attachment download
  const attachMatch = /^\/api\/attachments\/([^/?]+)(.*)$/.exec(pathname);
  if (attachMatch) {
    return `/internal/agent-api/attachments/${attachMatch[1]}${attachMatch[2] ?? ''}${search}`;
  }

  const prefix = `/internal/agent/${encodeURIComponent(agentId)}`;
  if (!pathname.startsWith(prefix)) return `${pathname}${search}`;

  const suffix = pathname.slice(prefix.length);

  const rewrites: Record<string, string> = {
    '/server': '/internal/agent-api/server',
    '/send': '/internal/agent-api/send',
  };

  // Simple exact matches
  if (rewrites[suffix]) return `${rewrites[suffix]}${search}`;

  // Prefix-based rewrites
  if (suffix.startsWith('/history')) return `/internal/agent-api/history${suffix.slice('/history'.length)}${search}`;
  if (suffix.startsWith('/search')) return `/internal/agent-api/search${suffix.slice('/search'.length)}${search}`;
  if (suffix.startsWith('/channel-members')) return `/internal/agent-api/channel-members${suffix.slice('/channel-members'.length)}${search}`;
  if (suffix.startsWith('/profile')) return `/internal/agent-api${suffix}${search}`;
  if (suffix.startsWith('/integrations')) return `/internal/agent-api${suffix}${search}`;
  if (suffix.startsWith('/tasks')) return `/internal/agent-api${suffix}${search}`;
  if (suffix.startsWith('/reminders')) return `/internal/agent-api${suffix}${search}`;
  if (suffix.startsWith('/attachments')) return `/internal/agent-api${suffix}${search}`;
  if (suffix.startsWith('/knowledge')) return `/internal/agent-api${suffix}${search}`;
  if (suffix.startsWith('/messages/') && suffix.endsWith('/reactions')) {
    return `/internal/agent-api${suffix}${search}`;
  }
  if (suffix.startsWith('/channels/')) {
    const channelMatch = /^\/channels\/([^/]+)\/(join|leave)$/.exec(suffix);
    if (channelMatch) return `/internal/agent-api/channels/${channelMatch[1]}/${channelMatch[2]}${search}`;
  }

  if (suffix === '/upload') return `/internal/agent-api/upload${search}`;
  if (suffix === '/resolve-channel') return `/internal/agent-api/resolve-channel${search}`;
  if (suffix === '/threads/unfollow') return `/internal/agent-api/threads/unfollow${search}`;
  if (suffix === '/threads/follow') return `/internal/agent-api/threads/follow${search}`;
  if (suffix === '/prepare-action') return `/internal/agent-api/prepare-action${search}`;
  if (suffix === '/receive') {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    if (!params.has('since')) params.set('since', 'latest');
    const query = params.toString();
    return `/internal/agent-api/events${query ? `?${query}` : ''}`;
  }

  return `${pathname}${search}`;
}

// ── Response buffer targets ──────────────────────────────────

const BUFFER_PATHS = new Set([
  '/internal/agent-api/send',
  '/internal/agent-api/events',
  '/internal/agent-api/history',
]);

export interface ProxyRegistration {
  token: string;
  credential: Credential;
  activeCapabilities: string;
}

export type DaemonRpcHandler = (message: unknown) => Promise<unknown>;

export class AgentProxy extends EventEmitter {
  private server: http.Server | null = null;
  private port = 0;
  private host = '127.0.0.1';
  private registrations = new Map<string, ProxyRegistration>();
  private daemonRpcHandler: DaemonRpcHandler | null = null;
  readonly state: StateMachine;
  readonly eventBuffer: EventBuffer;

  private lastSeenSeq = 0;
  private readUpToSeq = 0;

  constructor() {
    super();
    this.state = new StateMachine(ProxyState.Starting);
    this.eventBuffer = new EventBuffer(100_000);
  }

  // ── Registration ───────────────────────────────────────────

  register(reg: ProxyRegistration): void {
    this.registrations.set(reg.token, reg);
  }

  unregister(token: string): boolean {
    return this.registrations.delete(token);
  }

  setDaemonRpcHandler(handler: DaemonRpcHandler | null): void {
    this.daemonRpcHandler = handler;
  }

  // ── Start / Stop ───────────────────────────────────────────

  async start(desiredPort = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on('error', (err) => {
        console.error('[Proxy] Server error:', err.message);
      });

      this.server.listen(desiredPort, this.host, () => {
        const addr = this.server!.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
        }
        this.state.transition(ProxyState.Idle);
        console.log(`[Proxy] Listening on http://${this.host}:${this.port}`);
        resolve(this.port);
      });
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
    this.state.force(ProxyState.Dead);
  }

  getProxyUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  getPort(): number {
    return this.port;
  }

  // ── Freshness tracking ─────────────────────────────────────

  updateSeq(seq: number): void {
    if (seq > this.lastSeenSeq) {
      this.lastSeenSeq = seq;
    }
  }

  getLastSeenSeq(): number {
    return this.lastSeenSeq;
  }

  getReadUpToSeq(): number {
    return this.readUpToSeq;
  }

  markReadUpTo(seq: number): void {
    if (seq > this.readUpToSeq) {
      this.readUpToSeq = seq;
    }
  }

  recordIncomingMessage(event: Record<string, unknown>, emitEvent = true): void {
    const rawType = typeof event.type === 'string' && event.type.trim()
      ? event.type.trim()
      : typeof event.eventType === 'string' && event.eventType.trim()
        ? event.eventType.trim()
        : undefined;
    const normalized = rawType && isMessageEventType(rawType)
      ? normalizeIncomingEvent(event)
      : { ...event, type: 'message_received' };
    this.recordIncomingEvent(normalized, emitEvent);
  }

  recordIncomingEvent(event: Record<string, unknown>, emitEvent = true): void {
    const normalized = normalizeIncomingEvent(event);
    const eventType = eventTypeOf(normalized);
    const seq = messageSeqOf(normalized);
    if (eventType === 'message_received' && seq && seq > 0) this.updateSeq(seq);
    this.eventBuffer.append(eventType, normalized);
    if (emitEvent) {
      this.emit('event_received', normalized);
      if (eventType === 'message_received') {
        this.emit('message_received', normalized);
      }
    }
  }

  // ── Request handler ────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const localTarget = new URL(req.url ?? '/', 'http://local.daemon');
    if (localTarget.pathname === '/internal/daemon/jsonrpc') {
      await this.handleDaemonRpc(req, res);
      return;
    }

    // Auth
    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

    const reg = this.registrations.get(token);
    if (!reg) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid local agent proxy token', code: 'invalid_agent_proxy_token' }));
      return;
    }

    const method = req.method ?? 'GET';
    const target = new URL(req.url ?? '/', reg.credential.serverUrl);

    // Rewrite path
    const rewritten = rewriteAgentPath(target.pathname, target.search, reg.credential.agentId);
    const upstreamUrl = new URL(rewritten, reg.credential.serverUrl);

    // Build upstream headers
    const upstreamHeaders: Record<string, string> = {
      'Authorization': `Bearer ${reg.credential.token}`,
      'X-Agent-Id': reg.credential.agentId,
      'X-Slock-Client': 'cli',
      'X-Slock-Agent-Active-Capabilities': reg.activeCapabilities,
    };

    // Forward non-sensitive client headers
    for (const [name, value] of Object.entries(req.headers)) {
      const lower = name.toLowerCase();
      if (lower === 'host' || lower === 'authorization' || lower === 'content-length') continue;
      if (lower === 'x-agent-id' || lower === 'x-slock-client' || lower === 'x-slock-agent-active-capabilities') continue;
      if (typeof value === 'string') {
        upstreamHeaders[name] = value;
      }
    }
    if (method !== 'GET' && method !== 'HEAD' && !hasHeader(upstreamHeaders, 'content-type')) {
      upstreamHeaders['Content-Type'] = 'application/json';
    }

    try {
      // Determine body
      let body: Uint8Array | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        body = await readBody(req);
      }

      const rewrittenPathname = new URL(rewritten, reg.credential.serverUrl).pathname;
      if (method === 'POST' && rewrittenPathname === '/internal/agent-api/send') {
        const hold = this.buildFreshnessHold(body);
        if (hold) {
          this.emit('freshness_hold', hold);
          res.writeHead(409, { 'content-type': 'application/json' });
          res.end(JSON.stringify(hold));
          return;
        }
      }

      // Make upstream request
      const upstreamRes = await fetch(upstreamUrl.toString(), {
        method,
        headers: upstreamHeaders,
        body: body as unknown as BodyInit,
      });

      // For buffered paths, read full response to consume into inbox
      const upstreamContentType = upstreamRes.headers.get('content-type') ?? '';
      if (BUFFER_PATHS.has(rewrittenPathname) && upstreamContentType.includes('json')) {
        const text = await upstreamRes.text();
        this.consumeResponse(rewrittenPathname, target, text, reg.credential.agentId);

        // Forward response headers (minus decoded ones)
        const resHeaders: Record<string, string> = {};
        for (const [name, value] of upstreamRes.headers.entries()) {
          const lower = name.toLowerCase();
          if (lower === 'content-encoding' || lower === 'content-length' || lower === 'transfer-encoding') continue;
          resHeaders[name] = value;
        }
        resHeaders['content-type'] = 'application/json';
        res.writeHead(upstreamRes.status, resHeaders);
        res.end(text);
      } else {
        // Stream through
        const resHeaders: Record<string, string> = {};
        for (const [name, value] of upstreamRes.headers.entries()) {
          const lower = name.toLowerCase();
          if (lower === 'content-encoding' || lower === 'transfer-encoding') continue;
          resHeaders[name] = value;
        }
        res.writeHead(upstreamRes.status, resHeaders);
        if (upstreamRes.body) {
          const reader = upstreamRes.body.getReader();
          const sseParser = rewrittenPathname === '/internal/agent-api/events' && upstreamContentType.includes('text/event-stream')
            ? new SseEventParser((event) => this.recordIncomingEvent(withAgentId(event, reg.credential.agentId)))
            : null;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (sseParser) {
                sseParser.push(Buffer.from(value).toString('utf-8'));
              }
              res.write(Buffer.from(value));
            }
            sseParser?.flush();
          } finally {
            reader.releaseLock();
          }
        }
        res.end();
      }
    } catch (err) {
      console.error(`[Proxy] Request failed: ${method} ${rewritten}:`, (err as Error).message);
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'failed to proxy local agent request',
        code: 'agent_proxy_failed',
        detail: (err as Error).message,
      }));
    }
  }

  /**
   * Parse buffered response to track inbox state.
   * Mirrors consumeVisibleResponse in the real daemon.
   */
  private consumeResponse(pathname: string, _targetUrl: URL, responseText: string, agentId?: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') return;

    const data = parsed as Record<string, unknown>;

    // send response
    if (pathname === '/internal/agent-api/send' && data.state === 'sent') {
      const seq = typeof data.messageSeq === 'number' ? Math.floor(data.messageSeq) : undefined;
      if (seq && seq > 0) {
        this.updateSeq(seq);
      }
    }

    // events response — buffer messages
    if (pathname === '/internal/agent-api/events' && Array.isArray(data.events)) {
      let maxSeq = this.readUpToSeq;
      for (const rawEvent of data.events as Record<string, unknown>[]) {
        const event = agentId ? withAgentId(rawEvent, agentId) : rawEvent;
        const normalized = normalizeIncomingEvent(event);
        const seq = eventTypeOf(normalized) === 'message_received' ? messageSeqOf(normalized) : undefined;
        if (seq && seq > maxSeq) maxSeq = seq;
        this.recordIncomingEvent(normalized);
      }
      this.markReadUpTo(Math.max(maxSeq, this.lastSeenSeq));
    }

    // history response — track seq
    if (pathname === '/internal/agent-api/history' && Array.isArray(data.messages)) {
      let maxSeq = this.readUpToSeq;
      for (const msg of data.messages as Record<string, unknown>[]) {
        const seq = typeof msg.seq === 'number' ? msg.seq : undefined;
        if (seq && seq > this.lastSeenSeq) this.updateSeq(seq);
        if (seq && seq > maxSeq) maxSeq = seq;
      }
      this.markReadUpTo(Math.max(maxSeq, this.lastSeenSeq));
    }
  }

  /** Public entry point for inbox polling fallback to feed responses through consumeResponse. */
  consumeResponseExternal(pathname: string, targetUrl: string | URL, responseText: string): void {
    this.consumeResponse(pathname, new URL(String(targetUrl)), responseText);
  }

  private buildFreshnessHold(body: Uint8Array | undefined): Record<string, unknown> | null {
    let seenUpToSeq = this.readUpToSeq;
    if (!body || body.byteLength === 0) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(body).toString('utf-8'));
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const seen = (parsed as Record<string, unknown>).seenUpToSeq;
    if (typeof seen === 'number' && Number.isFinite(seen)) {
      seenUpToSeq = Math.floor(seen);
    }

    const pending = this.pendingEventsSince(seenUpToSeq);
    if (pending.length === 0) return null;

    return {
      state: 'held',
      reason: 'pending_messages',
      seenUpToSeq,
      pendingCount: pending.length,
      pending,
    };
  }

  private pendingEventsSince(seenUpToSeq: number): ReturnType<EventBuffer['snapshot']> {
    return this.eventBuffer.snapshot().filter((event) => {
      if (event.method !== 'message_received') return false;
      const params = event.params;
      if (isRecord(params)) {
        const seq = messageSeqOf(params);
        if (seq) return seq > seenUpToSeq;
      }
      return false;
    });
  }

  private async handleDaemonRpc(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'method not allowed', code: 'method_not_allowed' }));
      return;
    }
    if (!this.daemonRpcHandler) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'daemon rpc unavailable', code: 'daemon_rpc_unavailable' }));
      return;
    }

    try {
      const rawBody = await readBody(req);
      const text = Buffer.from(rawBody).toString('utf-8').trim();
      const message = text ? JSON.parse(text) : null;
      const response = await this.daemonRpcHandler(message);
      if (response === null || response === undefined) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error',
          data: (err as Error).message,
        },
      }));
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventTypeOf(event: Record<string, unknown>): string {
  const type = typeof event.type === 'string' && event.type.trim()
    ? event.type.trim()
    : typeof event.eventType === 'string' && event.eventType.trim()
      ? event.eventType.trim()
      : undefined;
  if (!type || isMessageEventType(type)) return 'message_received';
  return type;
}

function messageSeqOf(event: Record<string, unknown>): number | undefined {
  const payload = isRecord(event.payload) ? event.payload : undefined;
  const payloadMessage = payload && isRecord(payload.message) ? payload.message : undefined;
  for (const value of [event.seq, event.messageSeq, payloadMessage?.seq]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return undefined;
}

function normalizeIncomingEvent(event: Record<string, unknown>): Record<string, unknown> {
  const rawType = typeof event.type === 'string' && event.type.trim()
    ? event.type.trim()
    : typeof event.eventType === 'string' && event.eventType.trim()
      ? event.eventType.trim()
      : undefined;

  if (!rawType || isMessageEventType(rawType)) {
    return normalizeMessageEvent(event, rawType);
  }

  if (isTaskEventType(rawType)) {
    return normalizeTaskEvent(event, rawType);
  }

  return event;
}

function withAgentId(event: Record<string, unknown>, agentId: string): Record<string, unknown> {
  if (event.agentId !== undefined || event.agent_id !== undefined) return event;
  return { ...event, agentId };
}

function normalizeMessageEvent(event: Record<string, unknown>, rawType?: string): Record<string, unknown> {
  if (rawType === 'message_received') return event;

  const payload = isRecord(event.payload) ? event.payload : undefined;
  const nestedMessage = payload && isRecord(payload.message)
    ? payload.message
    : isRecord(event.message)
      ? event.message
      : undefined;

  if (!nestedMessage) return event;

  const normalized: Record<string, unknown> = {
    ...nestedMessage,
    type: 'message_received',
  };

  copyIfPresent(normalized, event, 'eventSeq', 'eventSeq');
  copyIfPresent(normalized, event, 'eventLogCursor', 'eventLogCursor');
  copyIfPresent(normalized, event, 'eventCursor', 'eventCursor');
  if (normalized.eventSeq === undefined && typeof event.seq === 'number' && typeof nestedMessage.seq === 'number' && event.seq !== nestedMessage.seq) {
    normalized.eventSeq = event.seq;
  }
  if (normalized.channelId === undefined) {
    const channelId = payload?.channelId ?? event.channelId ?? event.channel_id;
    if (channelId !== undefined) normalized.channelId = channelId;
  }
  if (normalized.timestamp === undefined && event.timestamp !== undefined) normalized.timestamp = event.timestamp;
  if (normalized.createdAt === undefined && event.createdAt !== undefined) normalized.createdAt = event.createdAt;
  if (normalized.target === undefined) {
    const target = payload?.target ?? payload?.channel ?? event.target ?? event.channel ?? event.channelName;
    if (target !== undefined) normalized.target = target;
  }
  copyIfPresent(normalized, event, 'agentId', 'agentId');
  copyIfPresent(normalized, event, 'agent_id', 'agent_id');

  return normalized;
}

function normalizeTaskEvent(event: Record<string, unknown>, rawType: string): Record<string, unknown> {
  const payload = isRecord(event.payload) ? event.payload : undefined;
  if (!payload) return event;

  const normalized: Record<string, unknown> = {
    ...payload,
    type: rawType,
  };

  copyIfPresent(normalized, event, 'eventSeq', 'eventSeq');
  copyIfPresent(normalized, event, 'eventLogCursor', 'eventLogCursor');
  copyIfPresent(normalized, event, 'eventCursor', 'eventCursor');
  copyIfPresent(normalized, event, 'agentId', 'agentId');
  copyIfPresent(normalized, event, 'agent_id', 'agent_id');
  if (normalized.eventSeq === undefined && event.seq !== undefined) normalized.eventSeq = event.seq;
  if (normalized.timestamp === undefined && event.timestamp !== undefined) normalized.timestamp = event.timestamp;
  if (normalized.target === undefined) {
    const target = payload.channel ?? payload.target ?? event.channel ?? event.target;
    if (target !== undefined) normalized.target = target;
  }
  if (normalized.actor === undefined) {
    const actor = payload.changedBy ?? payload.actor ?? payload.actorId ?? payload.assigneeId;
    if (actor !== undefined) normalized.actor = actor;
  }

  return normalized;
}

function copyIfPresent(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  targetKey: string,
  sourceKey: string,
): void {
  if (target[targetKey] === undefined && source[sourceKey] !== undefined) {
    target[targetKey] = source[sourceKey];
  }
}

function isMessageEventType(type: string): boolean {
  return type === 'message'
    || type === 'message_received'
    || type === 'message_created'
    || type.startsWith('message.');
}

function isTaskEventType(type: string): boolean {
  return type.startsWith('task_') || type.startsWith('task.');
}

class SseEventParser {
  private buffer = '';

  constructor(private readonly onEvent: (event: Record<string, unknown>) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    this.drainCompleteFrames();
  }

  flush(): void {
    if (!this.buffer.trim()) return;
    this.consumeFrame(this.buffer);
    this.buffer = '';
  }

  private drainCompleteFrames(): void {
    let boundary = findSseBoundary(this.buffer);
    while (boundary) {
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.end);
      this.consumeFrame(frame);
      boundary = findSseBoundary(this.buffer);
    }
  }

  private consumeFrame(frame: string): void {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trimStart());

    if (dataLines.length === 0) return;
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }

    for (const event of extractEventRecords(parsed)) {
      this.onEvent(event);
    }
  }
}

function findSseBoundary(text: string): { index: number; end: number } | null {
  const lf = text.indexOf('\n\n');
  const crlf = text.indexOf('\r\n\r\n');
  if (lf < 0 && crlf < 0) return null;
  if (lf >= 0 && (crlf < 0 || lf < crlf)) return { index: lf, end: lf + 2 };
  return { index: crlf, end: crlf + 4 };
}

function extractEventRecords(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) {
    return parsed.filter(isRecord);
  }
  if (!isRecord(parsed)) return [];
  if (Array.isArray(parsed.events)) {
    return parsed.events.filter(isRecord);
  }
  if (isRecord(parsed.message)) {
    return [parsed.message];
  }
  if (isRecord(parsed.event)) {
    return [parsed.event];
  }
  return [parsed];
}

// ── Helpers ──────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

function hasHeader(headers: Record<string, string>, lowerName: string): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === lowerName);
}

/** Generate a random proxy token (matching sap_ prefix convention) */
export function generateProxyToken(): string {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  const base64 = Buffer.from(bytes).toString('base64url');
  return `sap_${base64}`;
}
