/**
 * MCP stdio Bridge
 * Bridges between Claude Code (via stdio) and HTTP API
 * Implements a minimal MCP server over stdin/stdout
 */

import { EventEmitter } from 'events';
import * as readline from 'readline';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export class MCPBridge extends EventEmitter {
  private rl: readline.Interface | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, (response: MCPResponse) => void>();

  start(): void {
    console.log('[MCP] Bridge started on stdio');

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line: string) => {
      try {
        const msg = JSON.parse(line);
        this.handleMessage(msg);
      } catch {
        // Ignore non-JSON lines (e.g., logs from Claude Code)
      }
    });

    // Send initialization notification
    this.sendNotification('initialized', {});
  }

  private handleMessage(msg: unknown): void {
    if (typeof msg !== 'object' || msg === null) return;

    const mcpMsg = msg as Record<string, unknown>;

    if ('method' in mcpMsg) {
      // Request or notification from client
      this.handleRequest(mcpMsg as MCPRequest);
    } else if ('id' in mcpMsg && ('result' in mcpMsg || 'error' in mcpMsg)) {
      // Response from client
      const response = mcpMsg as MCPResponse;
      const resolver = this.pendingRequests.get(response.id);
      if (resolver) {
        resolver(response);
        this.pendingRequests.delete(response.id);
      }
    }
  }

  private handleRequest(req: MCPRequest): void {
    // Emit for external handling (e.g., by DaemonCore)
    this.emit('tool_call', {
      id: req.id,
      method: req.method,
      params: req.params || {},
    });
  }

  sendResponse(id: number, result: unknown): void {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.write(response);
  }

  sendError(id: number, code: number, message: string): void {
    const response: MCPResponse = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    this.write(response);
  }

  sendNotification(method: string, params: Record<string, unknown>): void {
    this.write({
      jsonrpc: '2.0',
      method,
      params,
    });
  }

  private write(msg: unknown): void {
    process.stdout.write(JSON.stringify(msg) + '\n');
  }

  stop(): void {
    this.rl?.close();
    this.rl = null;
  }
}
