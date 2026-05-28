/**
 * MCP stdio Bridge — connects Claude Code (via stdio JSON-RPC) to the daemon.
 * Mirrors opencan-daemon's client handler pattern: one instance per connection.
 *
 * Protocol: \n-delimited JSON-RPC 2.0 over stdin/stdout.
 */

import { EventEmitter } from 'events';
import * as readline from 'readline';
import {
  parseLine,
  serialize,
  isRequest,
  isNotification,
  isResponse,
  ErrorCode,
  buildError,
  buildResponse,
  buildNotification,
} from './protocol/jsonrpc.js';
import type { JSONRPCMessage } from './protocol/jsonrpc.js';

export interface MCPToolCall {
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}

export class MCPBridge extends EventEmitter {
  private rl: readline.Interface | null = null;
  private pendingRequests = new Map<number | string, (response: JSONRPCMessage) => void>();

  start(): void {
    console.log('[MCP] Bridge started on stdio');

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line: string) => {
      const msg = parseLine(line);
      if (!msg) return;

      if (isRequest(msg)) {
        this.emit('tool_call', {
          id: msg.id!,
          method: msg.method!,
          params: (msg.params as Record<string, unknown>) ?? {},
        } as MCPToolCall);
      } else if (isResponse(msg) || msg.error) {
        const resolver = this.pendingRequests.get(msg.id!);
        if (resolver) {
          resolver(msg);
          this.pendingRequests.delete(msg.id!);
        }
      } else if (isNotification(msg)) {
        this.emit('notification', { method: msg.method!, params: msg.params });
      }
    });

    // Init notification
    process.stdout.write(serialize(buildNotification('initialized', {})));
  }

  // ── Outgoing ────────────────────────────────────────────────

  sendResponse(id: number | string, result: unknown): void {
    process.stdout.write(serialize(buildResponse(id, result)));
  }

  sendError(id: number | string | null, code: number, message: string): void {
    process.stdout.write(serialize(buildError(id, code, message)));
  }

  sendNotification(method: string, params: unknown): void {
    process.stdout.write(serialize(buildNotification(method, params)));
  }

  // ── Request / Response cycle ────────────────────────────────

  sendRequest(method: string, params?: unknown): Promise<JSONRPCMessage> {
    const id = Date.now();
    const msg = { jsonrpc: '2.0' as const, id, method, params };
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, resolve);
      process.stdout.write(serialize(msg));
      // Timeout after 60s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 60_000);
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────

  stop(): void {
    this.rl?.close();
    this.rl = null;
    this.pendingRequests.clear();
  }
}
