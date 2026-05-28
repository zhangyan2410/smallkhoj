/**
 * WebSocket connection manager for real-time Slock events.
 * Mirrors opencan-daemon's readLoop pattern: one background goroutine → one async readLoop.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { Credential } from './types.js';
import { parseLine } from './protocol/jsonrpc.js';
import type { JSONRPCMessage } from './protocol/jsonrpc.js';

export class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectInterval = 5000;
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
    if (!this.credential.wsUrl) {
      console.log('[WS] No wsUrl configured, skipping WebSocket');
      return;
    }

    console.log(`[WS] Connecting to ${this.credential.wsUrl}...`);

    this.ws = new WebSocket(this.credential.wsUrl, {
      headers: {
        'Authorization': `Bearer ${this.credential.token}`,
        'X-Agent-Id': this.credential.agentId,
      },
    });

    this.ws.on('open', () => {
      this._connected = true;
      console.log('[WS] Connected');
      this.emit('event', { type: 'connected' });
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const msg: JSONRPCMessage | null = parseLine(data.toString());
        if (msg) this.emit('event', { type: 'message', message: msg });
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    });

    this.ws.on('close', (code, reason) => {
      this._connected = false;
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

  private scheduleReconnect(): void {
    if (this.isShuttingDown) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    console.log(`[WS] Reconnecting in ${this.reconnectInterval}ms...`);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectInterval);
  }

  disconnect(): void {
    this.isShuttingDown = true;
    this._connected = false;
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
