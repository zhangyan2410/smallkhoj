import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';
import type { LocalRuntimeProvider } from './provider-types.js';

interface CcSwitchProviderRow {
  id?: unknown;
  app_type?: unknown;
  name?: unknown;
  settings_config?: unknown;
}

interface CcSwitchSettingsConfig {
  config?: unknown;
  env?: unknown;
  model?: unknown;
  provider?: unknown;
  models?: unknown;
  npm?: unknown;
  options?: unknown;
}

interface OpenCodeBridgeSpec {
  providerId: string;
  displayName: string;
  extraModels?: string[];
}

export interface CcsClaudeProviderDetection {
  command?: string;
  providers: LocalRuntimeProvider[];
}

export function detectCcsClaudeProviders(env: NodeJS.ProcessEnv = process.env): CcsClaudeProviderDetection {
  const candidates = [
    env.SLOCK_CCS_CLAUDE_COMMAND,
    env.CCS_CLAUDE_COMMAND,
  ].filter((item): item is string => Boolean(item?.trim()));

  for (const candidate of candidates) {
    const parts = candidate.split('|');
    const command = parts[0];
    const preArgs = parts.length > 1 ? parts.slice(1, -1) : [];
    const scriptOrBin = parts.length > 1 ? parts[parts.length - 1] : command;

    if (scriptOrBin.includes('/') && !existsSync(scriptOrBin)) continue;
    if (scriptOrBin.includes('\\') && !existsSync(scriptOrBin)) continue;

    const listArgs = parts.length > 1
      ? [...preArgs, scriptOrBin, 'list']
      : ['list'];

    const result = spawnSync(command, listArgs, {
      encoding: 'utf-8',
      env,
      windowsHide: true,
    });
    if (result.status !== 0) continue;
    const providers = parseCcsClaudeListOutput(result.stdout || '');
    if (providers.length === 0) continue;
    return { command: candidate, providers };
  }

  return { providers: [] };
}

export function loadCcSwitchProviders(env: NodeJS.ProcessEnv, homeDir = env.USERPROFILE || env.HOME || ''): LocalRuntimeProvider[] {
  const dbPath = env.SLOCK_CC_SWITCH_DB || env.CC_SWITCH_DB || (homeDir ? join(homeDir, '.cc-switch', 'cc-switch.db') : '');
  if (!dbPath || !existsSync(dbPath)) return [];
  const sqliteCommand = env.SLOCK_SQLITE_COMMAND || env.SQLITE_COMMAND || 'sqlite3';
  const result = spawnSync(sqliteCommand, [
    '-json',
    dbPath,
    [
      'select id, app_type, name, settings_config',
      'from providers',
      "where app_type in ('claude', 'codex', 'opencode')",
      'order by coalesce(sort_index, 999999), name',
    ].join(' '),
  ], {
    encoding: 'utf-8',
    env,
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  try {
    const rows = JSON.parse(result.stdout || '[]');
    return Array.isArray(rows)
      ? [
          ...parseCcSwitchProviderRows(rows, ['claude', 'codex']),
          ...parseCcSwitchOpenCodeProviderRows(rows),
        ]
      : [];
  } catch {
    return [];
  }
}

export function loadCcSwitchCodexProviders(env: NodeJS.ProcessEnv, homeDir = env.USERPROFILE || env.HOME || ''): LocalRuntimeProvider[] {
  return loadCcSwitchProviders(env, homeDir).filter((provider) => provider.runtime === 'codex');
}

export function parseCcsClaudeListOutput(output: string): LocalRuntimeProvider[] {
  const providers: LocalRuntimeProvider[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('current ') || line.startsWith('current\t')) continue;
    if (line.startsWith('Available') || line.startsWith('Usage:')) continue;
    if (line.startsWith('*')) line = line.slice(1).trim();
    const columns = line.split(/\t+|\s{2,}/).map((item) => item.trim().replace(/^- /, '')).filter(Boolean);
    if (columns.length < 1) continue;
    const name = columns[0];
    const id = name;
    const model = columns.length >= 3 ? columns[2] : columns[1] || name;
    if (!name) continue;
    providers.push({
      id,
      name,
      runtime: 'claude_code',
      model,
      source: 'cc-switch',
    });
  }
  return providers;
}

export function parseCcSwitchProviderRows(rows: unknown[], appType: 'codex' | 'claude' | Array<'codex' | 'claude'>): LocalRuntimeProvider[] {
  const allowedAppTypes = new Set(Array.isArray(appType) ? appType : [appType]);
  const providers: LocalRuntimeProvider[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const provider = row as CcSwitchProviderRow;
    if (provider.app_type !== 'codex' && provider.app_type !== 'claude') continue;
    if (!allowedAppTypes.has(provider.app_type)) continue;
    if (typeof provider.id !== 'string' || typeof provider.name !== 'string') continue;
    const id = provider.id.trim();
    const name = provider.name.trim();
    if (!id || !name) continue;
    providers.push({
      id,
      name,
      runtime: provider.app_type === 'codex' ? 'codex' : 'claude_code',
      model: readProviderModel(provider.settings_config),
      source: 'cc-switch',
    });
  }
  return providers;
}

export function parseCcSwitchOpenCodeProviderRows(rows: unknown[]): LocalRuntimeProvider[] {
  const providers: LocalRuntimeProvider[] = [];
  const seen = new Set<string>();
  const push = (provider: LocalRuntimeProvider) => {
    const key = `${provider.runtime}:${provider.id}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    providers.push(provider);
  };

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const provider = row as CcSwitchProviderRow;
    if (typeof provider.id !== 'string' || typeof provider.name !== 'string') continue;
    const id = provider.id.trim();
    const name = provider.name.trim();
    if (!id || !name) continue;

    const settings = parseSettingsConfig(provider.settings_config);
    if (!settings) continue;

    if (provider.app_type === 'opencode') {
      for (const item of opencodeProvidersFromOpenCodeSettings(id, name, settings)) {
        push(item);
      }
      continue;
    }

    if (provider.app_type === 'claude') {
      const item = opencodeProviderFromClaudeSettings(id, name, settings);
      if (item) push(item);
    }
  }

  return providers;
}

function readProviderModel(settingsConfig: unknown): string | undefined {
  const parsed = parseSettingsConfig(settingsConfig);
  if (!parsed || !isRecord(parsed.config)) return undefined;
  const model = (parsed.config as { model?: unknown; default_model?: unknown }).model
    ?? (parsed.config as { model?: unknown; default_model?: unknown }).default_model;
  return typeof model === 'string' && model.trim() ? model.trim() : undefined;
}

function opencodeProvidersFromOpenCodeSettings(rowId: string, name: string, settings: CcSwitchSettingsConfig): LocalRuntimeProvider[] {
  const fullConfig: Record<string, unknown> | undefined = isRecord(settings.provider)
    ? settings as Record<string, unknown>
    : buildOpenCodeConfig(rowId, stringField(settings, 'model'), settings);
  if (!fullConfig || !isRecord(fullConfig.provider)) return [];

  const providers: LocalRuntimeProvider[] = [];
  for (const [providerId, providerConfig] of Object.entries(fullConfig.provider)) {
    if (!isRecord(providerConfig) || !isRecord(providerConfig.models)) continue;
    for (const modelId of Object.keys(providerConfig.models)) {
      const model = `${providerId}/${modelId}`;
      providers.push(withOpenCodeConfig({
        id: `opencode-cc-switch-${safeId(providerId)}-${safeId(modelId)}`,
        name: `${name} (OpenCode ${model})`,
        runtime: 'opencode',
        model,
        source: 'cc-switch',
      }, fullConfig));
    }
  }
  return providers;
}

function opencodeProviderFromClaudeSettings(rowId: string, name: string, settings: CcSwitchSettingsConfig): LocalRuntimeProvider | undefined {
  if (!isRecord(settings.env)) return undefined;
  const token = stringField(settings.env, 'ANTHROPIC_AUTH_TOKEN');
  const baseUrl = stringField(settings.env, 'ANTHROPIC_BASE_URL');
  if (!token || !baseUrl) return undefined;

  const spec = opencodeBridgeSpec(rowId, name);
  if (!spec) return undefined;

  const models = uniqueStrings([
    ...spec.extraModels ?? [],
    stringField(settings.env, 'ANTHROPIC_MODEL'),
    stringField(settings.env, 'ANTHROPIC_DEFAULT_HAIKU_MODEL'),
    stringField(settings.env, 'ANTHROPIC_DEFAULT_SONNET_MODEL'),
    stringField(settings.env, 'ANTHROPIC_DEFAULT_OPUS_MODEL'),
  ]);
  if (models.length === 0) return undefined;

  const selectedModel = models[0];
  const providerConfig = {
    npm: '@ai-sdk/anthropic',
    options: {
      apiKey: token,
      baseURL: normalizeAnthropicBaseUrl(baseUrl),
    },
    models: Object.fromEntries(models.map((model) => [model, { name: model }])),
  };
  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: `${spec.providerId}/${selectedModel}`,
    provider: {
      [spec.providerId]: providerConfig,
    },
  };

  return withOpenCodeConfig({
    id: `opencode-cc-switch-${safeId(spec.providerId)}-${safeId(selectedModel)}`,
    name: `${spec.displayName} (OpenCode)`,
    runtime: 'opencode',
    model: `${spec.providerId}/${selectedModel}`,
    source: 'cc-switch',
  }, config);
}

function opencodeBridgeSpec(rowId: string, name: string): OpenCodeBridgeSpec | undefined {
  const normalized = `${rowId} ${name}`.toLowerCase();
  if (normalized.includes('kimi')) {
    return {
      providerId: 'kimi-for-coding',
      displayName: 'Kimi',
      extraModels: ['k2p5'],
    };
  }
  if (normalized.includes('minimax') || normalized.includes('mini max')) {
    return {
      providerId: 'minimax-cn-coding-plan',
      displayName: 'MiniMax',
      extraModels: ['MiniMax-M2.7'],
    };
  }
  if (normalized.includes('zhipu') || normalized.includes('glm')) {
    return {
      providerId: 'zai-coding-plan',
      displayName: 'Zhipu GLM',
    };
  }
  return undefined;
}

function buildOpenCodeConfig(providerId: string, model: string | undefined, settings: CcSwitchSettingsConfig): Record<string, unknown> | undefined {
  if (!isRecord(settings.models)) return undefined;
  const configProvider = {
    npm: typeof settings.npm === 'string' ? settings.npm : undefined,
    options: isRecord(settings.options) ? settings.options : undefined,
    models: settings.models,
  };
  return {
    $schema: 'https://opencode.ai/config.json',
    ...(model ? { model: `${providerId}/${model}` } : {}),
    provider: {
      [providerId]: configProvider,
    },
  };
}

function parseSettingsConfig(settingsConfig: unknown): CcSwitchSettingsConfig | undefined {
  if (typeof settingsConfig !== 'string' || !settingsConfig.trim()) return undefined;
  try {
    const parsed = JSON.parse(settingsConfig);
    return isRecord(parsed) ? parsed as CcSwitchSettingsConfig : undefined;
  } catch {
    return undefined;
  }
}

function stringField(source: unknown, key: string): string | undefined {
  if (!isRecord(source)) return undefined;
  const value = source[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeAnthropicBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const item = value?.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
}

function safeId(value: string): string {
  const id = value.trim().replace(/[^A-Za-z0-9_.-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return id || 'local';
}

function withOpenCodeConfig(provider: LocalRuntimeProvider, config: Record<string, unknown>): LocalRuntimeProvider {
  Object.defineProperty(provider, 'opencodeConfig', {
    value: config,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return provider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
