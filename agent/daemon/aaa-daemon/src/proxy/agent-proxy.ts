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

export class AgentProxy extends EventEmitter {
  private server: http.Server | null = null;
  private port = 0;
  private host = '127.0.0.1';
  private registrations = new Map<string, ProxyRegistration>();
  readonly state: StateMachine;
  readonly eventBuffer: EventBuffer;

  private lastSeenSeq = 0;

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

  // ── Request handler ────────────────────────────────────────

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
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
      'Content-Type': 'application/json',
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

    try {
      // Determine body
      let body: string | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        body = await readBody(req);
      }

      // Make upstream request
      const upstreamRes = await fetch(upstreamUrl.toString(), {
        method,
        headers: upstreamHeaders,
        body,
      });

      // For buffered paths, read full response to consume into inbox
      const rewrittenPathname = new URL(rewritten, reg.credential.serverUrl).pathname;
      if (BUFFER_PATHS.has(rewrittenPathname) && upstreamRes.headers.get('content-type')?.includes('json')) {
        const text = await upstreamRes.text();
        this.consumeResponse(rewrittenPathname, target, text);

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
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
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
  private consumeResponse(pathname: string, _targetUrl: URL, responseText: string): void {
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
      for (const event of data.events as Record<string, unknown>[]) {
        const seq = typeof event.seq === 'number' ? event.seq : undefined;
        if (seq && seq > 0) this.updateSeq(seq);
        this.eventBuffer.append('message_received', event);
      }
    }

    // history response — track seq
    if (pathname === '/internal/agent-api/history' && Array.isArray(data.messages)) {
      for (const msg of data.messages as Record<string, unknown>[]) {
        const seq = typeof msg.seq === 'number' ? msg.seq : undefined;
        if (seq && seq > this.lastSeenSeq) this.updateSeq(seq);
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
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
