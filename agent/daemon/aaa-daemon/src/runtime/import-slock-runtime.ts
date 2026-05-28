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

const ENV_NAMES = [
  'SLOCK_AGENT_PROXY_URL',
  'SLOCK_AGENT_PROXY_TOKEN_FILE',
  'SLOCK_AGENT_ACTIVE_CAPABILITIES',
] as const;

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

function parseSingleQuotedBashAssignments(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of ENV_NAMES) {
    const match = new RegExp(`${name}='((?:'\\\\''|[^'])*)'`).exec(text);
    if (!match) continue;
    values[name] = match[1].replace(/'\\''/g, "'");
  }
  return values;
}

function readBashWrapperEnv(runtimeDir: string): Record<string, string> {
  const wrapperPath = join(runtimeDir, 'slock');
  if (!existsSync(wrapperPath)) return {};
  return parseSingleQuotedBashAssignments(readFileSync(wrapperPath, 'utf-8'));
}

function readWrapperEnv(runtimeDir: string): Record<string, string> {
  return {
    ...readBashWrapperEnv(runtimeDir),
    ...readCmdWrapperEnv(runtimeDir),
  };
}

function inferAgentId(runtimeDir: string, proxyTokenFile?: string): string | undefined {
  const fromToken = proxyTokenFile?.match(/[\\/]agent-proxy-tokens[\\/]([^\\/]+)[\\/][^\\/]+$/)?.[1];
  if (fromToken) return fromToken;

  const fromRuntime = runtimeDir.match(/[\\/]agents[\\/]([^\\/]+)[\\/]\.slock$/)?.[1];
  return fromRuntime;
}

export function importSlockRuntime(runtimeDir: string): ImportedSlockRuntime {
  const configPath = join(runtimeDir, 'claude-mcp-config.json');
  const wrapperEnv = readWrapperEnv(runtimeDir);
  const proxyUrl = wrapperEnv.SLOCK_AGENT_PROXY_URL;
  const proxyTokenFile = wrapperEnv.SLOCK_AGENT_PROXY_TOKEN_FILE;

  if (!existsSync(configPath)) {
    if (proxyUrl && proxyTokenFile) {
      const agentId = inferAgentId(runtimeDir, proxyTokenFile);
      if (!agentId) throw new Error(`Cannot infer agent id from imported Slock runtime: ${runtimeDir}`);
      const proxyToken = readFileSync(proxyTokenFile, 'utf-8').trim();
      if (!proxyToken) throw new Error(`Imported Slock proxy token file is empty: ${proxyTokenFile}`);
      const credential = {
        agentId,
        serverId: 'imported',
        token: proxyToken,
        serverUrl: proxyUrl,
      };
      return {
        chatBridgeArgs: [],
        credential,
        mcpCredential: credential,
        source: 'managed-proxy',
        proxyTokenFile,
      };
    }
    throw new Error(`No claude-mcp-config.json or managed slock wrapper found in ${runtimeDir}`);
  }

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
