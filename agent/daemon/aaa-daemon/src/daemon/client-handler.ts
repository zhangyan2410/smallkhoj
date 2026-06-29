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
  isRequest,
  isResponse,
  isDaemonMethod,
  ErrorCode,
  buildError,
  buildResponse,
} from '../protocol/jsonrpc.js';
import type { JSONRPCMessage } from '../protocol/jsonrpc.js';
import { DaemonMethods } from '../protocol/methods.js';
import type { DaemonCore } from './daemon.js';
import { DAEMON_VERSION } from '../version.js';

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
          version: DAEMON_VERSION,
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

      case DaemonMethods.MessageSearch:
        return this.forwardToProxy(id, 'message.search', params);

      case DaemonMethods.MessageResolve:
        return this.forwardToProxy(id, 'message.resolve', params);

      case DaemonMethods.MessageReact:
        return this.forwardToProxy(id, 'message.react', params);

      case DaemonMethods.TaskList:
        return this.forwardToProxy(id, 'task.list', params);

      case DaemonMethods.TaskCreate:
        return this.forwardToProxy(id, 'task.create', params);

      case DaemonMethods.TaskClaim:
        return this.forwardToProxy(id, 'task.claim', params);

      case DaemonMethods.TaskUnclaim:
        return this.forwardToProxy(id, 'task.unclaim', params);

      case DaemonMethods.TaskUpdate:
        return this.forwardToProxy(id, 'task.update', params);

      case DaemonMethods.TaskMemorySummary:
        return this.forwardToProxy(id, 'task.memory.summary', params);

      case DaemonMethods.TaskMemoryPromote:
        return this.forwardToProxy(id, 'task.memory.promote', params);

      case DaemonMethods.ChannelMembers:
        return this.forwardToProxy(id, 'channel.members', params);

      case DaemonMethods.ChannelJoin:
        return this.forwardToProxy(id, 'channel.join', params);

      case DaemonMethods.ChannelLeave:
        return this.forwardToProxy(id, 'channel.leave', params);

      case DaemonMethods.ThreadFollow:
        return this.forwardToProxy(id, 'thread.follow', params);

      case DaemonMethods.ThreadUnfollow:
        return this.forwardToProxy(id, 'thread.unfollow', params);

      case DaemonMethods.ThreadRead:
        return this.forwardToProxy(id, 'thread.read', params);

      case DaemonMethods.ThreadSummary:
        return this.forwardToProxy(id, 'thread.summary', params);

      case DaemonMethods.ProfileGet:
        return this.forwardToProxy(id, 'profile.get', params);

      case DaemonMethods.ProfileUpdate:
        return this.forwardToProxy(id, 'profile.update', params);

      case DaemonMethods.IntegrationList:
        return this.forwardToProxy(id, 'integration.list', params);

      case DaemonMethods.IntegrationLogin:
        return this.forwardToProxy(id, 'integration.login', params);

      case DaemonMethods.ReminderList:
        return this.forwardToProxy(id, 'reminder.list', params);

      case DaemonMethods.ReminderCreate:
        return this.forwardToProxy(id, 'reminder.create', params);

      case DaemonMethods.ReminderSchedule:
        return this.forwardToProxy(id, 'reminder.schedule', params);

      case DaemonMethods.ReminderSnooze:
        return this.forwardToProxy(id, 'reminder.snooze', params);

      case DaemonMethods.ReminderUpdate:
        return this.forwardToProxy(id, 'reminder.update', params);

      case DaemonMethods.ReminderCancel:
        return this.forwardToProxy(id, 'reminder.cancel', params);

      case DaemonMethods.ReminderDelete:
        return this.forwardToProxy(id, 'reminder.delete', params);

      case DaemonMethods.ReminderLog:
        return this.forwardToProxy(id, 'reminder.log', params);

      case DaemonMethods.AttachmentView:
        return this.forwardToProxy(id, 'attachment.view', params);

      case DaemonMethods.AttachmentDownload:
        return this.forwardToProxy(id, 'attachment.download', params);

      case DaemonMethods.AttachmentUpload:
        return this.forwardToProxy(id, 'attachment.upload', params);

      case DaemonMethods.KnowledgeList:
        return this.forwardToProxy(id, 'knowledge.list', params);

      case DaemonMethods.KnowledgeGet:
        return this.forwardToProxy(id, 'knowledge.get', params);

      case DaemonMethods.KnowledgeSearch:
        return this.forwardToProxy(id, 'knowledge.search', params);

      case DaemonMethods.MemoryRead:
        return this.forwardToProxy(id, 'memory.read', params);

      case DaemonMethods.MemorySearch:
        return this.forwardToProxy(id, 'memory.search', params);

      case DaemonMethods.MemoryContext:
        return this.forwardToProxy(id, 'memory.context', params);

      case DaemonMethods.MemoryWrite:
        return this.forwardToProxy(id, 'memory.write', params);

      case DaemonMethods.MemoryPropose:
        return this.forwardToProxy(id, 'memory.propose', params);

      case DaemonMethods.MemoryProposals:
        return this.forwardToProxy(id, 'memory.proposals', params);

      case DaemonMethods.MemoryProposalAccept:
        return this.forwardToProxy(id, 'memory.proposal.accept', params);

      case DaemonMethods.MemoryProposalReject:
        return this.forwardToProxy(id, 'memory.proposal.reject', params);

      case DaemonMethods.MemoryDelete:
        return this.forwardToProxy(id, 'memory.delete', params);

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
    const credential = this.daemon.getCredential();

    if (!credential) {
      return buildError(id, ErrorCode.InternalError, 'No credential available');
    }

    try {
      const p = isRecord(params) ? params : {};
      const agentPath = `/internal/agent/${encodeURIComponent(credential.agentId)}`;
      let apiPath: string;
      let httpMethod = 'GET';
      let body: unknown = undefined;

      switch (method) {
        case 'message.send':
          apiPath = `${agentPath}/send`;
          httpMethod = 'POST';
          body = params;
          break;
        case 'message.check':
          apiPath = `${agentPath}/receive${queryString(p, ['limit', 'since'])}`;
          break;
        case 'message.read':
          apiPath = `${agentPath}/history${queryString(p, ['channel', 'limit', 'before', 'after'])}`;
          break;
        case 'message.search':
          apiPath = `${agentPath}/search${queryString(p, ['q', 'query', 'channel', 'target', 'limit'])}`;
          break;
        case 'message.resolve':
          apiPath = `${agentPath}/messages/${encodeURIComponent(String(p.messageId ?? p.message_id ?? p.id ?? ''))}/resolve`;
          break;
        case 'message.react':
          apiPath = `${agentPath}/messages/${encodeURIComponent(String(p.messageId ?? p.message_id ?? p.id ?? ''))}/reactions`;
          httpMethod = p.remove === true ? 'DELETE' : 'POST';
          body = { reaction: p.reaction };
          break;
        case 'task.list':
          apiPath = `${agentPath}/tasks${queryString(p, ['channel', 'status'])}`;
          break;
        case 'task.create':
          apiPath = `${agentPath}/tasks`;
          httpMethod = 'POST';
          body = params;
          break;
        case 'task.claim':
          if (p.taskId || p.id) {
            apiPath = `${agentPath}/tasks/${encodeURIComponent(String(p.taskId ?? p.id))}/claim`;
            body = compactBody({ assignee: p.assignee });
          } else {
            apiPath = `${agentPath}/tasks/claim`;
            body = params;
          }
          httpMethod = 'POST';
          break;
        case 'task.unclaim':
          if (p.channel && (p.task_number || p.taskNumber || p.number) && !p.taskId && !p.id) {
            apiPath = `${agentPath}/tasks/update-status`;
            body = {
              channel: p.channel,
              task_number: p.task_number ?? p.taskNumber ?? p.number,
              status: 'todo',
            };
          } else {
            apiPath = `${agentPath}/tasks/${encodeURIComponent(String(p.taskId ?? p.id ?? ''))}/unclaim`;
          }
          httpMethod = 'POST';
          break;
        case 'task.update':
          if (p.channel && p.task_number && p.status && !p.taskId && !p.id) {
            apiPath = `${agentPath}/tasks/update-status`;
            httpMethod = 'POST';
            body = params;
          } else {
            apiPath = `${agentPath}/tasks/${encodeURIComponent(String(p.taskId ?? p.id ?? ''))}`;
            httpMethod = 'PATCH';
            body = withoutKeys(p, ['taskId', 'id']);
          }
          break;
        case 'server.info':
          apiPath = `${agentPath}/server`;
          break;
        case 'channel.members':
          apiPath = `${agentPath}/channel-members${queryString(p, ['channel', 'target'])}`;
          break;
        case 'channel.join':
          apiPath = `${agentPath}/channels/${encodeURIComponent(String(p.channelId ?? p.channel ?? p.target ?? ''))}/join`;
          httpMethod = 'POST';
          break;
        case 'channel.leave':
          apiPath = `${agentPath}/channels/${encodeURIComponent(String(p.channelId ?? p.channel ?? p.target ?? ''))}/leave`;
          httpMethod = 'POST';
          break;
        case 'thread.unfollow':
          apiPath = `${agentPath}/threads/unfollow`;
          httpMethod = 'POST';
          body = params;
          break;
        case 'thread.follow':
          apiPath = `${agentPath}/threads/follow`;
          httpMethod = 'POST';
          body = params;
          break;
        case 'thread.read':
          apiPath = `${agentPath}/threads/${encodeURIComponent(String(p.threadId ?? p.thread_id ?? p.id ?? ''))}`;
          break;
        case 'thread.summary':
          apiPath = `${agentPath}/threads/${encodeURIComponent(String(p.threadId ?? p.thread_id ?? p.id ?? ''))}/summary`;
          httpMethod = 'POST';
          body = compactBody({ summary: p.summary ?? p.text });
          break;
        case 'profile.get':
          apiPath = `${agentPath}/profile${p.handle ? `/${encodeURIComponent(String(p.handle))}` : ''}`;
          break;
        case 'profile.update':
          apiPath = `${agentPath}/profile`;
          httpMethod = 'POST';
          body = params;
          break;
        case 'integration.list':
          apiPath = `${agentPath}/integrations`;
          break;
        case 'integration.login':
          apiPath = `${agentPath}/integrations/login`;
          httpMethod = 'POST';
          body = params;
          break;
        case 'reminder.list':
          apiPath = `${agentPath}/reminders`;
          break;
        case 'reminder.create':
        case 'reminder.schedule':
          apiPath = `${agentPath}/reminders`;
          httpMethod = 'POST';
          body = params;
          break;
        case 'reminder.snooze':
          apiPath = `${agentPath}/reminders/${encodeURIComponent(String(p.reminderId ?? p.id ?? ''))}`;
          httpMethod = 'PATCH';
          body = compactBody({
            fireAt: p.fireAt ?? p.fire_at,
            delaySeconds: p.delaySeconds ?? p.delay_seconds ?? p.in,
          });
          break;
        case 'reminder.update':
          apiPath = `${agentPath}/reminders/${encodeURIComponent(String(p.reminderId ?? p.id ?? ''))}`;
          httpMethod = 'PATCH';
          body = withoutKeys(p, ['reminderId', 'id']);
          break;
        case 'reminder.cancel':
        case 'reminder.delete':
          apiPath = `${agentPath}/reminders/${encodeURIComponent(String(p.reminderId ?? p.id ?? ''))}`;
          httpMethod = 'DELETE';
          break;
        case 'reminder.log':
          apiPath = `${agentPath}/reminders/${encodeURIComponent(String(p.reminderId ?? p.id ?? ''))}/log`;
          break;
        case 'attachment.view':
          apiPath = `/api/attachments/${encodeURIComponent(String(p.attachmentId ?? p.id ?? ''))}`;
          break;
        case 'attachment.download':
          apiPath = `/api/attachments/${encodeURIComponent(String(p.attachmentId ?? p.id ?? ''))}/download`;
          break;
        case 'attachment.upload':
          apiPath = `${agentPath}/upload`;
          httpMethod = 'POST';
          body = params;
          break;
        case 'knowledge.list':
          apiPath = `${agentPath}/knowledge${queryString(p, ['channel', 'target', 'limit'])}`;
          break;
        case 'knowledge.get':
          apiPath = `${agentPath}/knowledge/${encodeURIComponent(String(p.knowledgeId ?? p.id ?? ''))}`;
          break;
        case 'knowledge.search':
          apiPath = `${agentPath}/knowledge/search${queryString(p, ['q', 'query', 'channel', 'target', 'limit'])}`;
          break;
        case 'memory.read': {
          const scope = memoryScopePath(p);
          apiPath = `${agentPath}/memory/scopes/${scope}/path/${memoryPath(p)}`;
          break;
        }
        case 'memory.search': {
          const scope = memoryScopePath(p);
          apiPath = `${agentPath}/memory/scopes/${scope}/search${queryString(p, ['q', 'query', 'limit'])}`;
          break;
        }
        case 'memory.context': {
          const scope = memoryScopeParts(p);
          if (!scope.type || !scope.id) {
            return buildError(id, ErrorCode.InvalidParams, `Missing required identifier for ${method}`);
          }
          apiPath = `${agentPath}/memory/context-manifest`;
          httpMethod = 'POST';
          body = compactBody({
            scopeType: scope.type,
            scopeId: scope.id,
            prompt: p.prompt ?? p.query ?? p.q,
            topK: p.topK ?? p.limit,
          });
          break;
        }
        case 'memory.write': {
          const scope = memoryScopePath(p);
          apiPath = `${agentPath}/memory/scopes/${scope}/path/${memoryPath(p)}`;
          httpMethod = 'PUT';
          body = compactBody({ contentText: p.contentText ?? p.content ?? p.text, baseSha: p.baseSha ?? p.base_sha });
          break;
        }
        case 'memory.propose': {
          const scope = memoryScopePath(p);
          apiPath = `${agentPath}/memory/scopes/${scope}/proposals`;
          httpMethod = 'POST';
          body = compactBody({
            path: p.path,
            contentText: p.contentText ?? p.content ?? p.text,
            reason: p.reason,
            baseSha: p.baseSha ?? p.base_sha,
          });
          break;
        }
        case 'memory.proposals': {
          const scope = memoryScopePath(p);
          apiPath = `${agentPath}/memory/scopes/${scope}/proposals${queryString(p, ['status'])}`;
          break;
        }
        case 'memory.proposal.accept':
        case 'memory.proposal.reject': {
          const proposalId = String(p.proposalId ?? p.proposal_id ?? p.id ?? '');
          if (!proposalId) {
            return buildError(id, ErrorCode.InvalidParams, `Missing required identifier for ${method}`);
          }
          const action = method === 'memory.proposal.accept' ? 'accept' : 'reject';
          apiPath = `${agentPath}/memory/proposals/${encodeURIComponent(proposalId)}/${action}`;
          httpMethod = 'POST';
          body = compactBody({
            reviewNote: p.reviewNote ?? p.review_note ?? p.note,
          });
          break;
        }
        case 'memory.delete': {
          const scope = memoryScopePath(p);
          apiPath = `${agentPath}/memory/scopes/${scope}/path/${memoryPath(p)}`;
          httpMethod = 'DELETE';
          break;
        }
        case 'task.memory.summary': {
          apiPath = `${agentPath}/tasks/${encodeURIComponent(String(p.taskId ?? p.task_id ?? p.id ?? ''))}/memory/summary`;
          httpMethod = 'POST';
          body = compactBody({
            finalSummary: p.finalSummary ?? p.summary ?? p.contentText ?? p.content ?? p.text,
            progress: p.progress,
            evidence: p.evidence,
            artifacts: p.artifacts,
            nextSteps: p.nextSteps ?? p.next_steps,
          });
          break;
        }
        case 'task.memory.promote': {
          apiPath = `${agentPath}/tasks/${encodeURIComponent(String(p.taskId ?? p.task_id ?? p.id ?? ''))}/memory/promote`;
          httpMethod = 'POST';
          body = compactBody({
            sourcePath: p.sourcePath ?? p.source_path,
            channelPath: p.channelPath ?? p.channel_path,
            reason: p.reason,
            proposal: p.proposal,
          });
          break;
        }
        default:
          return buildError(id, ErrorCode.MethodNotFound, `Unknown method for proxy: ${method}`);
      }

      if (apiPath.endsWith('//resolve') || apiPath.endsWith('//reactions') || apiPath.endsWith('/tasks/') || apiPath.includes('/tasks//') || apiPath.endsWith('/tasks//unclaim') || apiPath.endsWith('/channels//join') || apiPath.endsWith('/channels//leave') || apiPath.endsWith('/threads/') || apiPath.endsWith('/threads//summary') || apiPath.endsWith('/reminders/') || apiPath.endsWith('/reminders//log') || apiPath.endsWith('/attachments/') || apiPath.endsWith('/knowledge/')) {
        return buildError(id, ErrorCode.InvalidParams, `Missing required identifier for ${method}`);
      }

      const res = await this.callLocalProxy(apiPath, {
        method: httpMethod,
        body,
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
      const credential = this.daemon.getCredential();
      if (!credential) throw new Error('No credential');

      const res = await this.callLocalProxy(`/internal/agent/${encodeURIComponent(credential.agentId)}/server`);
      const data = await res.json();
      return buildResponse(id, data);
    } catch (err) {
      return buildError(id, ErrorCode.InternalError, (err as Error).message);
    }
  }

  private async handleMessageCheck(id: string | number): Promise<JSONRPCMessage> {
    const events = this.daemon.getProxy().eventBuffer.snapshot();
    let maxSeq = this.daemon.getProxy().getReadUpToSeq();
    for (const event of events) {
      if (event.method !== 'message_received') continue;
      const params = event.params;
      if (isRecord(params)) {
        const seq = messageSeqOf(params);
        if (seq && seq > maxSeq) maxSeq = seq;
      }
    }
    this.daemon.getProxy().markReadUpTo(maxSeq);
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
        seenUpToSeq: proxy.getReadUpToSeq(),
      };

      const res = await this.callLocalProxy(
        `/internal/agent/${encodeURIComponent(credential.agentId)}/send`,
        { method: 'POST', body },
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

      const res = await this.callLocalProxy(
        `/internal/agent/${encodeURIComponent(credential.agentId)}/history?${query}`,
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

  private async callLocalProxy(path: string, options: { method?: string; body?: unknown } = {}): Promise<Response> {
    const token = this.daemon.getProxyToken();
    if (!token) throw new Error('No proxy token available');

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
    };
    let body: string | undefined;
    if (options.body !== undefined && options.body !== null) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    return fetch(`${this.daemon.getProxy().getProxyUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function messageSeqOf(event: Record<string, unknown>): number | undefined {
  for (const value of [event.seq, event.messageSeq]) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }
  return undefined;
}

function compactBody(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function withoutKeys(values: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(values).filter(([key, value]) => !blocked.has(key) && value !== undefined));
}

function queryString(values: Record<string, unknown>, keys: string[]): string {
  const query = new URLSearchParams();
  for (const key of keys) {
    const value = values[key];
    if (value === undefined || value === null || value === '') continue;
    if (key === 'query') {
      query.set('q', String(value));
      continue;
    }
    if (key === 'target') {
      query.set('channel', String(value));
      continue;
    }
    query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

function memoryScopePath(values: Record<string, unknown>): string {
  const scope = memoryScopeParts(values);
  if (!scope.type || !scope.id) return '/';
  return `${scope.type}/${encodeURIComponent(scope.id)}`;
}

function memoryScopeParts(values: Record<string, unknown>): { type: string; id: string } {
  const type = String(values.scope ?? values.scopeType ?? values.scope_type ?? '');
  const id = String(values.id ?? values.scopeId ?? values.scope_id ?? '');
  if (!['agent', 'channel', 'thread', 'task'].includes(type) || !id) return { type: '', id: '' };
  return { type, id };
}

function memoryPath(values: Record<string, unknown>): string {
  const raw = String(values.path ?? '');
  if (!raw) return '';
  return raw.replace(/^\/+/, '').split('/').map((part) => encodeURIComponent(part)).join('/');
}
