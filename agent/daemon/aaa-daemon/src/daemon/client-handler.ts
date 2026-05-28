/**
 * Client handler — manages one client connection to the daemon.
 * Mirrors opencan-daemon/internal/daemon/client_handler.go.
 *
 * Per-connection state:
 * - read loop: parse JSON-RPC lines, route to daemon methods or forward to proxy
 * - write: serialized write with optional mutex (single-threaded JS, so implicit)
 * - request ID tracking for forwarding
 */

import { EventEmitter } from 'events';
import {
  parseLine,
  serialize,
  isRequest,
  isResponse,
  isDaemonMethod,
  ErrorCode,
  buildError,
  buildResponse,
} from '../protocol/jsonrpc.js';
import type { JSONRPCMessage } from '../protocol/jsonrpc.js';
import { DaemonMethods } from '../protocol/methods.js';
import type { AgentProxy } from '../proxy/agent-proxy.js';
import type { DaemonCore } from './daemon.js';

export class ClientHandler extends EventEmitter {
  private daemon: DaemonCore;

  constructor(daemon: DaemonCore) {
    super();
    this.daemon = daemon;
  }

  /**
   * Process one incoming JSON-RPC message from a client.
   * Returns the response to send back (or null for notifications).
   */
  async handleMessage(msg: JSONRPCMessage): Promise<JSONRPCMessage | null> {
    // ── Request ───────────────────────────────────────
    if (isRequest(msg)) {
      if (isDaemonMethod(msg.method!)) {
        return this.routeDaemonMethod(msg.id!, msg.method!, msg.params);
      }
      // Forward to appropriate ACP proxy
      return this.forwardToProxy(msg.id!, msg.method!, msg.params);
    }

    // ── Response ──────────────────────────────────────
    if (isResponse(msg)) {
      this.emit('response', msg);
      return null;
    }

    // ── Notification ──────────────────────────────────
    if (msg.method) {
      this.emit('notification', msg);
      return null;
    }

    // ── Malformed ─────────────────────────────────────
    return buildError(msg.id ?? null, ErrorCode.InvalidRequest, 'Invalid request');
  }

  // ── Daemon method routing ──────────────────────────────────

  private async routeDaemonMethod(
    id: string | number,
    method: string,
    params: unknown
  ): Promise<JSONRPCMessage> {
    switch (method) {
      case DaemonMethods.Hello:
        return buildResponse(id, {
          name: 'aaa-daemon',
          version: '0.2.0',
          agentId: this.daemon.getConfig().agentId,
          proxyPort: this.daemon.getProxy().getPort(),
        });

      case DaemonMethods.ServerInfo:
        return this.handleServerInfo(id);

      case DaemonMethods.MessageCheck:
        return this.handleMessageCheck(id);

      case DaemonMethods.MessageSend:
        return this.handleMessageSend(id, params);

      case DaemonMethods.MessageRead:
        return this.handleMessageRead(id, params);

      case DaemonMethods.SessionList:
        return buildResponse(id, {
          sessions: this.daemon.getSessionManager().list(),
        });

      case DaemonMethods.Logs:
        return buildResponse(id, {
          entries: this.daemon.getLogBuffer(),
        });

      case DaemonMethods.ConversationCreate:
        return this.handleConversationCreate(id, params);

      case DaemonMethods.ConversationList:
        return buildResponse(id, {
          conversations: this.daemon.getSessionManager().list(),
        });

      default:
        return buildError(id, ErrorCode.MethodNotFound, `Unknown daemon method: ${method}`);
    }
  }

  // ── Forward to proxy (for Slock API calls) ─────────────────

  private async forwardToProxy(
    id: string | number,
    method: string,
    params: unknown
  ): Promise<JSONRPCMessage> {
    const proxy = this.daemon.getProxy();
    const proxyUrl = proxy.getProxyUrl();
    const credential = this.daemon.getCredential();

    if (!credential) {
      return buildError(id, ErrorCode.InternalError, 'No credential available');
    }

    try {
      const agentPath = `/internal/agent/${encodeURIComponent(credential.agentId)}`;
      let apiPath: string;

      switch (method) {
        case 'message.send': apiPath = `${agentPath}/send`; break;
        case 'message.check': apiPath = `${agentPath}/receive`; break;
        case 'message.read': apiPath = `${agentPath}/history`; break;
        case 'message.search': apiPath = `${agentPath}/search`; break;
        case 'task.list': apiPath = `${agentPath}/tasks`; break;
        case 'task.claim': apiPath = `${agentPath}/tasks/claim`; break;
        case 'task.update': apiPath = `${agentPath}/tasks/update-status`; break;
        case 'server.info': apiPath = `${agentPath}/server`; break;
        case 'channel.members': apiPath = `${agentPath}/channel-members`; break;
        case 'channel.join': apiPath = `${agentPath}/channels/${(params as any)?.channelId}/join`; break;
        case 'channel.leave': apiPath = `${agentPath}/channels/${(params as any)?.channelId}/leave`; break;
        default:
          return buildError(id, ErrorCode.MethodNotFound, `Unknown method for proxy: ${method}`);
      }

      const res = await fetch(`${proxyUrl}${apiPath}`, {
        method: method === 'message.send' || method === 'task.claim' || method === 'task.update' ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${proxy.getProxyUrl()}`,
        },
        body: params ? JSON.stringify(params) : undefined,
      });

      const data = await res.json();
      if (!res.ok) {
        return buildError(id, ErrorCode.ServerError, data.error ?? `HTTP ${res.status}`);
      }
      return buildResponse(id, data);
    } catch (err) {
      return buildError(id, ErrorCode.InternalError, (err as Error).message);
    }
  }

  // ── Method handlers ────────────────────────────────────────

  private async handleServerInfo(id: string | number): Promise<JSONRPCMessage> {
    try {
      const proxy = this.daemon.getProxy();
      const credential = this.daemon.getCredential();
      if (!credential) throw new Error('No credential');

      const res = await fetch(`${proxy.getProxyUrl()}/internal/agent/${encodeURIComponent(credential.agentId)}/server`);
      const data = await res.json();
      return buildResponse(id, data);
    } catch (err) {
      return buildError(id, ErrorCode.InternalError, (err as Error).message);
    }
  }

  private async handleMessageCheck(id: string | number): Promise<JSONRPCMessage> {
    const events = this.daemon.getProxy().eventBuffer.since(
      this.daemon.getProxy().getLastSeenSeq()
    );
    return buildResponse(id, { events, count: events.length });
  }

  private async handleMessageSend(
    id: string | number,
    params: unknown
  ): Promise<JSONRPCMessage> {
    try {
      const proxy = this.daemon.getProxy();
      const credential = this.daemon.getCredential();
      if (!credential) throw new Error('No credential');

      const p = params as Record<string, unknown> | undefined;
      const body = {
        target: p?.target ?? '',
        content: p?.content ?? '',
        seenUpToSeq: proxy.getLastSeenSeq(),
      };

      const res = await fetch(
        `${proxy.getProxyUrl()}/internal/agent/${encodeURIComponent(credential.agentId)}/send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );

      const data = await res.json();

      // If held, include pending messages
      if (data.state === 'held') {
        return buildResponse(id, data);
      }

      return buildResponse(id, data);
    } catch (err) {
      return buildError(id, ErrorCode.InternalError, (err as Error).message);
    }
  }

  private async handleMessageRead(
    id: string | number,
    params: unknown
  ): Promise<JSONRPCMessage> {
    try {
      const proxy = this.daemon.getProxy();
      const credential = this.daemon.getCredential();
      if (!credential) throw new Error('No credential');

      const p = params as Record<string, unknown> | undefined;
      const query = new URLSearchParams();
      if (p?.channel) query.set('channel', String(p.channel));
      if (p?.limit) query.set('limit', String(p.limit));
      if (p?.before) query.set('before', String(p.before));
      if (p?.after) query.set('after', String(p.after));

      const res = await fetch(
        `${proxy.getProxyUrl()}/internal/agent/${encodeURIComponent(credential.agentId)}/history?${query}`
      );
      const data = await res.json();
      return buildResponse(id, data);
    } catch (err) {
      return buildError(id, ErrorCode.InternalError, (err as Error).message);
    }
  }

  private handleConversationCreate(
    id: string | number,
    params: unknown
  ): JSONRPCMessage {
    const p = params as Record<string, unknown> | undefined;
    const command = typeof p?.command === 'string' ? p.command : '';
    const sessionId = this.daemon.getSessionManager().create(command);
    return buildResponse(id, { sessionId, command });
  }
}
