/**
 * Daemon Core
 * Main orchestrator: manages agent process lifecycle, inbox, and coordinates modules
 */

import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { WebSocketManager } from './websocket.js';
import { MCPBridge } from './mcp-bridge.js';
import { AgentProxy } from './proxy.js';
import type { Credential, DaemonConfig, DaemonEvent, InboxEntry, SlockMessage } from './types.js';

export class DaemonCore extends EventEmitter {
  private wsManager: WebSocketManager | null = null;
  private mcpBridge: MCPBridge | null = null;
  private proxy: AgentProxy | null = null;
  private inbox = new Map<string, InboxEntry>();
  private credential: Credential | null = null;
  private isRunning = false;

  constructor(private config: DaemonConfig) {
    super();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[Daemon] Already running');
      return;
    }

    console.log('[Daemon] Starting aaa-daemon v0.1.0...');

    // Load credential
    this.credential = this.loadCredential();
    if (!this.credential) {
      throw new Error('Failed to load credential');
    }

    // Start HTTP proxy (token injection + freshness check)
    this.proxy = new AgentProxy(this.credential, this.config.proxyPort);
    this.proxy.on('freshness_hold', (data) => {
      console.log('[Daemon] Freshness hold:', data);
    });
    this.proxy.start();

    // Start WebSocket connection
    this.wsManager = new WebSocketManager(this.credential);
    this.wsManager.on('event', (event: DaemonEvent) => {
      this.handleDaemonEvent(event);
    });
    this.wsManager.connect();

    // Start MCP bridge (stdio)
    this.mcpBridge = new MCPBridge();
    this.mcpBridge.on('tool_call', (call) => {
      this.handleToolCall(call);
    });
    this.mcpBridge.start();

    this.isRunning = true;
    console.log('[Daemon] All modules started');

    // Graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  private loadCredential(): Credential | null {
    try {
      if (!existsSync(this.config.credentialPath)) {
        console.warn(`[Daemon] Credential not found at ${this.config.credentialPath}`);
        // Use config-based credential for prototype
        return {
          agentId: this.config.agentId,
          serverId: 'prototype',
          token: 'prototype-token',
          serverUrl: this.config.serverUrl,
          wsUrl: this.config.wsUrl,
        };
      }
      const data = JSON.parse(readFileSync(this.config.credentialPath, 'utf-8'));
      return {
        agentId: data.agent_id || this.config.agentId,
        serverId: data.server_id || 'unknown',
        token: data.token || 'unknown',
        serverUrl: data.server_url || this.config.serverUrl,
        wsUrl: data.ws_url || this.config.wsUrl,
      };
    } catch (err) {
      console.error('[Daemon] Failed to load credential:', err);
      return null;
    }
  }

  private handleDaemonEvent(event: DaemonEvent): void {
    switch (event.type) {
      case 'message':
        this.handleIncomingMessage(event.message);
        break;
      case 'connected':
        console.log('[Daemon] WebSocket connected');
        break;
      case 'disconnected':
        console.log('[Daemon] WebSocket disconnected:', event.reason);
        break;
      case 'error':
        console.error('[Daemon] Error:', event.error);
        break;
    }
  }

  private handleIncomingMessage(message: SlockMessage): void {
    // Deduplication
    if (this.inbox.has(message.id)) {
      console.log(`[Daemon] Duplicate message ignored: ${message.shortId}`);
      return;
    }

    const entry: InboxEntry = {
      seq: Date.now(),
      message,
      read: false,
    };
    this.inbox.set(message.id, entry);

    console.log(`[Inbox] New message #${this.inbox.size} from ${message.sender}`);

    // Notify MCP bridge
    this.mcpBridge?.sendNotification('message_received', {
      id: message.id,
      sender: message.sender,
      content: message.content,
      target: message.target,
    });
  }

  private handleToolCall(call: { id: number; method: string; params: Record<string, unknown> }): void {
    console.log(`[MCP] Tool call: ${call.method}`, call.params);

    switch (call.method) {
      case 'send_message': {
        const { target, content } = call.params;
        const success = this.wsManager?.send({
          type: 'send_message',
          target,
          content,
        });
        this.mcpBridge?.sendResponse(call.id, { success, sent: !!success });
        break;
      }

      case 'check_messages': {
        const unread = Array.from(this.inbox.values())
          .filter((e) => !e.read)
          .map((e) => e.message);
        this.mcpBridge?.sendResponse(call.id, { count: unread.length, messages: unread });
        break;
      }

      case 'read_history': {
        const messages = Array.from(this.inbox.values())
          .sort((a, b) => a.seq - b.seq)
          .map((e) => e.message);
        this.mcpBridge?.sendResponse(call.id, { messages });
        break;
      }

      default:
        this.mcpBridge?.sendError(call.id, -32601, `Method not found: ${call.method}`);
    }
  }

  stop(): void {
    if (!this.isRunning) return;

    console.log('[Daemon] Shutting down...');
    this.isRunning = false;

    this.wsManager?.disconnect();
    this.mcpBridge?.stop();
    this.proxy?.stop();

    console.log('[Daemon] Stopped');
    process.exit(0);
  }
}
