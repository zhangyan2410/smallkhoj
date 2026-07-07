import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { LocalRuntimeProvider } from './provider-types.js';

interface OpenCodeConfigInput {
  provider?: unknown;
}

interface OpenCodeProviderInput {
  models?: unknown;
}

const DEFAULT_OPENCODE_CONFIG = ['opencode', 'opencode.json'];

export function loadOpenCodeConfigProviders(env: NodeJS.ProcessEnv = process.env): LocalRuntimeProvider[] {
  const configPath = resolveOpenCodeConfigPath(env);
  if (!configPath || !existsSync(configPath)) return [];
  try {
    return parseOpenCodeConfigProviders(readFileSync(configPath, 'utf-8'));
  } catch {
    return [];
  }
}

export function parseOpenCodeConfigProviders(raw: unknown): LocalRuntimeProvider[] {
  let parsed: unknown;
  if (typeof raw === 'string') {
    if (!raw.trim()) return [];
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  } else {
    parsed = raw;
  }
  if (!isRecord(parsed)) return [];

  const config = parsed as OpenCodeConfigInput;
  if (!isRecord(config.provider)) return [];

  const providers: LocalRuntimeProvider[] = [];
  const seen = new Set<string>();
  for (const [providerIdRaw, providerConfigRaw] of Object.entries(config.provider)) {
    const providerId = providerIdRaw.trim();
    if (!providerId || !isRecord(providerConfigRaw)) continue;
    const providerConfig = providerConfigRaw as OpenCodeProviderInput;
    if (!isRecord(providerConfig.models)) continue;
    for (const modelIdRaw of Object.keys(providerConfig.models)) {
      const modelId = modelIdRaw.trim();
      if (!modelId) continue;
      const model = `${providerId}/${modelId}`;
      const id = `opencode-${safeId(providerId)}-${safeId(modelId)}`;
      const dedupeKey = id.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      providers.push({
        id,
        name: `OpenCode ${model}`,
        runtime: 'opencode',
        model,
        source: 'opencode-config',
      });
    }
  }
  return providers;
}

function resolveOpenCodeConfigPath(env: NodeJS.ProcessEnv): string | undefined {
  const explicit = env.SLOCK_OPENCODE_CONFIG || env.OPENCODE_CONFIG;
  if (explicit?.trim()) return explicit.trim();
  const configHome = env.XDG_CONFIG_HOME?.trim()
    || (env.HOME || env.USERPROFILE ? join(env.HOME || env.USERPROFILE || '', '.config') : undefined);
  return configHome ? join(configHome, ...DEFAULT_OPENCODE_CONFIG) : undefined;
}

function safeId(value: string): string {
  const id = value.trim().replace(/[^A-Za-z0-9_.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return id || 'local';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
