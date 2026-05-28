import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Credential } from '../types.js';

export interface ImportedSlockRuntime {
  credential: Credential;
  mcpCredential: Credential;
  chatBridgeArgs: string[];
  source: 'managed-proxy' | 'mcp-config';
  proxyTokenFile?: string;
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function readCmdWrapperEnv(runtimeDir: string): Record<string, string> {
  const wrapperPath = join(runtimeDir, 'slock.cmd');
  if (!existsSync(wrapperPath)) return {};

  const values: Record<string, string> = {};
  const text = readFileSync(wrapperPath, 'utf-8');
  for (const line of text.split(/\r?\n/)) {
    const match = /^set\s+"([^=]+)=(.*)"\s*$/i.exec(line.trim());
    if (!match) continue;
    values[match[1]] = match[2];
  }
  return values;
}

export function importSlockRuntime(runtimeDir: string): ImportedSlockRuntime {
  const configPath = join(runtimeDir, 'claude-mcp-config.json');
  const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
    mcpServers?: Record<string, { args?: string[] }>;
  };

  const chat = raw.mcpServers?.chat;
  if (!chat?.args?.length) {
    throw new Error(`No chat MCP server args found in ${configPath}`);
  }

  const args = chat.args;
  const agentId = readArg(args, '--agent-id');
  const serverUrl = readArg(args, '--server-url');
  const authToken = readArg(args, '--auth-token');

  if (!agentId) throw new Error('Missing --agent-id in imported Slock runtime config');
  if (!serverUrl) throw new Error('Missing --server-url in imported Slock runtime config');
  if (!authToken) throw new Error('Missing --auth-token in imported Slock runtime config');

  const mcpCredential: Credential = {
    agentId,
    serverId: 'imported',
    token: authToken,
    serverUrl,
  };

  const wrapperEnv = readCmdWrapperEnv(runtimeDir);
  const proxyUrl = wrapperEnv.SLOCK_AGENT_PROXY_URL;
  const proxyTokenFile = wrapperEnv.SLOCK_AGENT_PROXY_TOKEN_FILE;
  if (proxyUrl && proxyTokenFile) {
    const proxyToken = readFileSync(proxyTokenFile, 'utf-8').trim();
    if (!proxyToken) throw new Error(`Imported Slock proxy token file is empty: ${proxyTokenFile}`);
    return {
      chatBridgeArgs: [...args],
      credential: {
        agentId,
        serverId: 'imported',
        token: proxyToken,
        serverUrl: proxyUrl,
      },
      mcpCredential,
      source: 'managed-proxy',
      proxyTokenFile,
    };
  }

  return {
    chatBridgeArgs: [...args],
    credential: mcpCredential,
    mcpCredential,
    source: 'mcp-config',
  };
}
