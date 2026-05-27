/**
 * WebSocket Connection Manager
 * Handles connection to Slock server via WebSocket
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type { Credential, DaemonEvent, SlockMessage } from './types.js';

export class WebSocketManager extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private readonly reconnectInterval = 5000;
  private isShuttingDown = false;

  constructor(private credential: Credential) {
    super();
  }

  connect(): void {
    if (this.isShuttingDown) return;

    console.log(`[WS] Connecting to ${this.credential.wsUrl}...`);

    this.ws = new WebSocket(this.credential.wsUrl, {
      headers: {
        'Authorization': `Bearer ${this.credential.token}`,
        'X-Agent-ID': this.credential.agentId,
      },
    });

    this.ws.on('open', () => {
      console.log('[WS] Connected');
      this.emit('event', { type: 'connected' } as DaemonEvent);
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const payload = JSON.parse(data.toString());
        this.handleMessage(payload);
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    });

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[WS] Closed: ${code} ${reason.toString()}`);
      this.emit('event', {
        type: 'disconnected',
        reason: `${code}: ${reason.toString()}`,
      } as DaemonEvent);
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error('[WS] Error:', err.message);
      this.emit('event', { type: 'error', error: err } as DaemonEvent);
    });
  }

  private handleMessage(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return;

    const msg = payload as Record<string, unknown>;

    if (msg.type === 'message' && msg.data) {
      const message = msg.data as SlockMessage;
      console.log(`[WS] Received message from ${message.sender}: ${message.content.slice(0, 50)}...`);
      this.emit('event', { type: 'message', message } as DaemonEvent);
    } else if (msg.type === 'task_update') {
      console.log(`[WS] Task update:`, msg.data);
    }
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
    console.log(`[WS] Reconnecting in ${this.reconnectInterval}ms...`);
    this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectInterval);
  }

  disconnect(): void {
    this.isShuttingDown = true;
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
