/**
 * MCP compatibility bridge.
 *
 * Message traffic intentionally does not flow through MCP. The real runtime
 * communication path is slock CLI -> local HTTP proxy -> Slock API.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createChatBridgeServer } from './chat-bridge.js';

export class MCPBridge {
  private server: McpServer | null = null;

  async start(): Promise<void> {
    this.server = createChatBridgeServer();
    await this.server.connect(new StdioServerTransport());
    console.error('[MCP] Compatibility bridge started on stdio');
  }

  async stop(): Promise<void> {
    await this.server?.close();
    this.server = null;
  }
}
