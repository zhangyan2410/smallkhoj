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

  constructor(private credential: Credential) {
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

    console.log(`[WS] Connecting to ${wsUrl}...`);

    this.ws = new WebSocket(wsUrl, {
      headers: {
        'Authorization': `Bearer ${this.credential.token}`,
        'X-Agent-Id': this.credential.agentId,
      },
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
  if (msg.method === 'message_received') {
    return [{ type: 'message', message: msg.params ?? msg }];
  }
  if (msg.method === 'daemon/message.received') {
    return [{ type: 'message', message: msg.params ?? msg }];
  }
  return [{ type: 'message', message: msg }];
}

function eventFromRawPayload(value: unknown): WebSocketManagerEvent[] {
  if (!isRecord(value)) return [];
  const type = typeof value.type === 'string' ? value.type : '';
  if (type === 'message_received') {
    return [{ type: 'message', message: value.message ?? value.event ?? value }];
  }
  if (type === 'message') {
    return [{ type: 'message', message: value.message ?? value }];
  }
  if (isRecord(value.message) || typeof value.content === 'string') {
    return [{ type: 'message', message: value }];
  }
  return [];
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
