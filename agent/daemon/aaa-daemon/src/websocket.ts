/**
 * WebSocket connection manager for real-time Slock events.
 * Mirrors opencan-daemon's readLoop pattern: one background goroutine → one async readLoop.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { Credential } from './types.js';
import { parseLine } from './protocol/jsonrpc.js';
import type { JSONRPCMessage } from './protocol/jsonrpc.js';

export type WebSocketManagerEvent =
  | { type: 'connected' }
  | { type: 'message'; message: unknown }
  | { type: 'event'; event: unknown }
  | { type: 'control'; command: unknown }
  | { type: 'disconnected'; reason: string }
  | { type: 'error'; error: string };

export interface WebSocketActivityPayload {
  type: 'activity';
  status: string;
  at: string;
}

export class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private activityTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectInterval = 5000;
  private activityInterval = 30_000;
  private isShuttingDown = false;
  private _connected = false;
  private lastEventCursor = 0;

  constructor(private credential: Credential, private options: { daemonId?: string } = {}) {
    super();
  }

  get connected(): boolean {
    return this._connected;
  }

  connect(): void {
    if (this.isShuttingDown) return;
    const wsUrl = this.credential.wsUrl?.trim();
    if (!wsUrl || ['none', 'off', 'disabled'].includes(wsUrl.toLowerCase())) {
      console.log('[WS] No wsUrl configured, skipping WebSocket');
      return;
    }

    const connectUrl = appendDaemonConnectionParams(wsUrl, this.lastEventCursor, this.options.daemonId);
    console.log(`[WS] Connecting to ${connectUrl}...`);

    this.ws = new WebSocket(connectUrl, {
      headers: buildWebSocketHeaders(this.credential),
    });

    this.ws.on('open', () => {
      this._connected = true;
      console.log('[WS] Connected');
      this.emit('event', { type: 'connected' });
      this.sendActivity('online');
      this.startActivityHeartbeat();
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        for (const event of parseWebSocketPayload(data.toString())) {
          this.lastEventCursor = Math.max(this.lastEventCursor, eventCursorOf(event));
          this.emit('event', event);
          if (event.type === 'message') {
            this.sendAck(event.message);
          }
        }
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      this._connected = false;
      this.stopActivityHeartbeat();
      console.log(`[WS] Closed: ${code} ${reason.toString()}`);
      this.emit('event', { type: 'disconnected', reason: `${code}: ${reason.toString()}` });
      this.scheduleReconnect();
    });

    this.ws.on('unexpected-response', (_request, response) => {
      const reason = `HTTP ${response.statusCode ?? 'unknown'} ${response.statusMessage ?? ''}`.trim();
      this._connected = false;
      this.stopActivityHeartbeat();
      console.error(`[WS] Unexpected response: ${reason}`);
      response.resume();
      this.emit('event', { type: 'error', error: `Unexpected response: ${reason}` });
      this.emit('event', { type: 'disconnected', reason: `unexpected-response ${reason}` });
      this.scheduleReconnect();
    });

    this.ws.on('error', (err) => {
      console.error('[WS] Error:', err.message);
      this.emit('event', { type: 'error', error: err.message });
    });
  }

  send(data: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Not connected, cannot send');
      return false;
    }
    this.ws.send(JSON.stringify(data));
    return true;
  }

  sendAck(message: unknown): boolean {
    const ack = buildAckPayload(message);
    if (!ack) return false;
    return this.send(ack);
  }

  sendActivity(status = 'active'): boolean {
    return this.send(buildActivityPayload(status));
  }

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    console.log(`[WS] Reconnecting in ${this.reconnectInterval}ms...`);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectInterval);
  }

  private startActivityHeartbeat(): void {
    this.stopActivityHeartbeat();
    this.activityTimer = setInterval(() => {
      this.sendActivity('active');
    }, this.activityInterval);
    this.activityTimer.unref?.();
  }

  private stopActivityHeartbeat(): void {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
      this.activityTimer = null;
    }
  }

  disconnect(): void {
    this.isShuttingDown = true;
    this._connected = false;
    this.stopActivityHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export function parseWebSocketPayload(text: string): WebSocketManagerEvent[] {
  const rpc = parseLine(text);
  if (rpc) return eventsFromJsonRpc(rpc);

  const parsed = JSON.parse(text) as unknown;
  const values = Array.isArray(parsed) ? parsed : [parsed];
  return values.flatMap(eventFromRawPayload);
}

export function buildActivityPayload(status: string): WebSocketActivityPayload {
  return { type: 'activity', status, at: new Date().toISOString() };
}

export function buildWebSocketHeaders(credential: Credential): Record<string, string> {
  // Computer-connect credentials carry no daemon-level agent id; the backend
  // WS endpoint authenticates machine tokens via X-Computer-Id. Sending an
  // undefined/empty X-Agent-Id crashes the Headers constructor at startup.
  return {
    'Authorization': `Bearer ${credential.token}`,
    ...(credential.agentId ? { 'X-Agent-Id': credential.agentId } : {}),
    ...(credential.computerId ? { 'X-Computer-Id': credential.computerId } : {}),
  };
}

export function buildAckPayload(message: unknown): Record<string, unknown> | null {
  const value = unwrapMessage(message);
  if (!isRecord(value)) return null;

  const messageId = firstString(value.id, value.messageId, value.message_id, value.shortId, value.msg);
  const seq = typeof value.seq === 'number' && Number.isFinite(value.seq) ? value.seq : undefined;
  if (!messageId && seq === undefined) return null;

  return {
    type: 'ack',
    ...(messageId ? { message_id: messageId } : {}),
    ...(seq !== undefined ? { seq } : {}),
    at: new Date().toISOString(),
  };
}

function eventsFromJsonRpc(msg: JSONRPCMessage): WebSocketManagerEvent[] {
  const method = typeof msg.method === 'string' ? msg.method : '';
  if (method.startsWith('daemon.command.') || method.startsWith('control.')) {
    const commandType = method.slice(method.lastIndexOf('.') + 1);
    const command = isRecord(msg.params)
      ? { type: commandType, ...msg.params }
      : { type: commandType, params: msg.params };
    return [{ type: 'control', command }];
  }
  if (method === 'message_received') {
    return [{ type: 'message', message: msg.params ?? msg }];
  }
  if (method === 'daemon/message.received') {
    return [{ type: 'message', message: msg.params ?? msg }];
  }
  if (method.startsWith('message.')) {
    return [{ type: 'message', message: msg.params ?? msg }];
  }
  if (isTaskEventType(method) || isThreadEventType(method) || isChannelMembershipEventType(method)) {
    return [{ type: 'event', event: { ...(isRecord(msg.params) ? msg.params : {}), type: method } }];
  }
  return [{ type: 'message', message: msg }];
}

function eventFromRawPayload(value: unknown): WebSocketManagerEvent[] {
  if (!isRecord(value)) return [];
  const type = typeof value.type === 'string' ? value.type : '';
  if (type === 'control' || type === 'daemon_control' || type === 'daemon.command') {
    return [{ type: 'control', command: value.command ?? value.event ?? value }];
  }
  if (type === 'start_runtime' || type === 'stop_runtime' || type === 'restart_runtime') {
    return [{ type: 'control', command: value }];
  }
  if (isMessageEventType(type)) {
    return [{ type: 'message', message: value.message ?? value.event ?? value }];
  }
  if (isTaskEventType(type) || isThreadEventType(type) || isChannelMembershipEventType(type)) {
    return [{ type: 'event', event: value.event ?? value }];
  }
  if (isRecord(value.message) || typeof value.content === 'string') {
    return [{ type: 'message', message: value }];
  }
  return [];
}

export function appendDaemonConnectionParams(wsUrl: string, cursor: number, daemonId?: string): string {
  if ((!cursor || cursor <= 0) && !daemonId) return wsUrl;
  try {
    const url = new URL(wsUrl);
    if (cursor && cursor > 0) url.searchParams.set('eventLogCursor', String(cursor));
    if (daemonId) url.searchParams.set('daemonId', daemonId);
    return url.toString();
  } catch {
    return wsUrl;
  }
}

function eventCursorOf(event: WebSocketManagerEvent): number {
  if (event.type === 'message') return cursorFromPayload(event.message);
  if (event.type === 'event') return cursorFromPayload(event.event);
  return 0;
}

function cursorFromPayload(payload: unknown): number {
  const value = unwrapMessage(payload);
  if (!isRecord(value)) return 0;
  for (const raw of [value.eventSeq, value.eventLogCursor, value.eventCursor, value.seq]) {
    const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return 0;
}

function unwrapMessage(input: unknown): unknown {
  if (!isRecord(input)) return input;
  if (isRecord(input.params)) return unwrapMessage(input.params);
  if (isRecord(input.message)) return unwrapMessage(input.message);
  if (isRecord(input.event)) return unwrapMessage(input.event);
  return input;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
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

function isThreadEventType(type: string): boolean {
  return type.startsWith('thread_') || type.startsWith('thread.');
}

function isChannelMembershipEventType(type: string): boolean {
  return type === 'channel.member_joined'
    || type === 'channel.member_left'
    || type === 'channel_member_joined'
    || type === 'channel_member_left';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
