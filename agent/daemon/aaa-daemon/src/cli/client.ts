/**
 * HTTP client for communicating with the local daemon proxy.
 *
 * Handles proxy URL resolution, bearer token injection, and X-Agent-Id header.
 */

import { readFileSync } from 'fs';
import { CliError, ErrorCodes, redact } from './errors.js';

export interface ProxyConfig {
  proxyUrl: string;
  token: string;
  agentId: string;
}

export interface RequestOptions {
  method: string;
  path: string;
  body?: unknown;
  rawOutputFile?: string;
}

export interface ProxyResponse {
  ok: boolean;
  status: number;
  text: string;
}

/** Resolve proxy configuration from environment variables. */
export function resolveProxyConfig(env: NodeJS.ProcessEnv): ProxyConfig {
  const proxyUrl = env.SLOCK_AGENT_PROXY_URL;
  if (!proxyUrl) {
    throw new CliError(
      'Missing SLOCK_AGENT_PROXY_URL',
      ErrorCodes.MISSING_PROXY_URL.code,
      ErrorCodes.MISSING_PROXY_URL.nextAction,
    );
  }

  const agentId = env.SLOCK_AGENT_ID;
  if (!agentId) {
    throw new CliError(
      'Missing SLOCK_AGENT_ID',
      ErrorCodes.MISSING_AGENT_ID.code,
      ErrorCodes.MISSING_AGENT_ID.nextAction,
    );
  }

  const tokenFile = env.SLOCK_AGENT_PROXY_TOKEN_FILE;
  if (!tokenFile) {
    throw new CliError(
      'Missing SLOCK_AGENT_PROXY_TOKEN_FILE',
      ErrorCodes.MISSING_TOKEN_FILE.code,
      ErrorCodes.MISSING_TOKEN_FILE.nextAction,
    );
  }

  let token: string;
  try {
    token = readFileSync(tokenFile, 'utf-8').trim();
  } catch {
    throw new CliError(
      'Failed to read proxy token file',
      ErrorCodes.TOKEN_READ_FAILED.code,
      ErrorCodes.TOKEN_READ_FAILED.nextAction,
    );
  }

  return { proxyUrl, token, agentId };
}

/** The agent-prefixed API path: /internal/agent/{agentId} */
export function agentPrefix(agentId: string): string {
  return `/internal/agent/${encodeURIComponent(agentId)}`;
}

/** Execute a request against the local proxy. */
export async function proxyRequest(
  config: ProxyConfig,
  options: RequestOptions,
): Promise<ProxyResponse> {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.token}`,
    'X-Agent-Id': config.agentId,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(new URL(options.path, config.proxyUrl), {
    method: options.method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

/**
 * Enrich a proxy failure response with better error messaging.
 * Redacts any credential-shaped strings.
 */
export function enrichProxyFailure(text: string, status: number): string {
  // Try to parse as JSON for structured error extraction
  try {
    const parsed = JSON.parse(text) as { detail?: unknown; code?: unknown; instruction?: unknown; message?: unknown };
    const detail = parsed.detail && typeof parsed.detail === 'object'
      ? parsed.detail as Record<string, unknown>
      : parsed;
    if (detail.code === 'MEMORY_CONFLICT') {
      return JSON.stringify({
        ok: false,
        code: 'MEMORY_CONFLICT',
        instruction: typeof detail.instruction === 'string'
          ? detail.instruction
          : 'Memory changed since you read it. Re-read the memory, merge your update, then retry or create a proposal.',
      }) + '\n';
    }
    // Return the message from the proxy if available, redacted
    const message = typeof parsed.message === 'string'
      ? parsed.message
      : typeof parsed.detail === 'string'
        ? parsed.detail
        : text;
    return redact(message);
  } catch {
    // Not JSON — return redacted raw text
  }
  if (!text) return redact(`HTTP ${status}`);
  return redact(text);
}
