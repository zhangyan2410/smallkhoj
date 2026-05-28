#!/usr/bin/env node
/**
 * Compatibility MCP Chat Bridge.
 *
 * Real Slock communication goes through the slock CLI and local HTTP proxy.
 * This bridge only exposes the legacy runtime_profile_migration_done no-op tool.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { fileURLToPath } from 'url';
import { z } from 'zod';

export interface ChatBridgeOptions {
  agentId?: string;
  serverUrl?: string;
  authToken?: string;
  runtime?: string;
  runtimeActionsOnly?: boolean;
}

export function parseChatBridgeArgs(args: string[]): ChatBridgeOptions {
  const options: ChatBridgeOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--runtime-actions-only') {
      options.runtimeActionsOnly = true;
      continue;
    }
    const value = args[i + 1];
    if (value === undefined) continue;
    if (arg === '--agent-id') options.agentId = value;
    if (arg === '--server-url') options.serverUrl = value;
    if (arg === '--auth-token') options.authToken = value;
    if (arg === '--runtime') options.runtime = value;
    if (arg.startsWith('--')) i += 1;
  }
  return options;
}

export function createChatBridgeServer(_options: ChatBridgeOptions = {}): McpServer {
  const server = new McpServer({
    name: 'aaa-daemon-chat-bridge',
    version: '0.2.0',
  });

  server.registerTool(
    'runtime_profile_migration_done',
    {
      title: 'Runtime Profile Migration Done',
      description: 'Deprecated compatibility no-op. Runtime profile migration is no longer required.',
      inputSchema: {
        migration_key: z.string().optional(),
      },
    },
    async () => ({
      content: [{
        type: 'text',
        text: 'Runtime profile migration is no longer required.',
      }],
    }),
  );

  return server;
}

export async function startChatBridge(options: ChatBridgeOptions = {}): Promise<void> {
  const server = createChatBridgeServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startChatBridge(parseChatBridgeArgs(process.argv.slice(2))).catch((err) => {
    console.error('[ChatBridge] Failed:', (err as Error).message);
    process.exit(1);
  });
}
