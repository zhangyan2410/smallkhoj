import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import type { LocalRuntimeProvider } from './provider-types.js';

interface CcSwitchProviderRow {
  id?: unknown;
  app_type?: unknown;
  name?: unknown;
  settings_config?: unknown;
}

export interface CcsClaudeProviderDetection {
  command?: string;
  providers: LocalRuntimeProvider[];
}

export function detectCcsClaudeProviders(env: NodeJS.ProcessEnv = process.env): CcsClaudeProviderDetection {
  const homeDir = env.USERPROFILE || env.HOME || '';
  const candidates = [
    env.SLOCK_CCS_CLAUDE_COMMAND,
    env.CCS_CLAUDE_COMMAND,
    '/Users/lee/.local/bin/ccs-claude',
    'ccs-claude',
    `${homeDir}/.local/bin/ccs-claude`,
  ].filter((item): item is string => Boolean(item));

  const ccSwitchPs1 = homeDir ? `${homeDir}/.claude/cc-switch.ps1` : '';
  if (ccSwitchPs1 && existsSync(ccSwitchPs1)) {
    candidates.push(`powershell.exe|-ExecutionPolicy|Bypass|${ccSwitchPs1}`);
  }

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

export function loadCcSwitchCodexProviders(env: NodeJS.ProcessEnv, homeDir = env.USERPROFILE || env.HOME || ''): LocalRuntimeProvider[] {
  const dbPath = env.SLOCK_CC_SWITCH_DB || env.CC_SWITCH_DB || (homeDir ? `${homeDir}/.cc-switch/cc-switch.db` : '');
  if (!dbPath || !existsSync(dbPath)) return [];
  const sqliteCommand = env.SLOCK_SQLITE_COMMAND || env.SQLITE_COMMAND || 'sqlite3';
  const result = spawnSync(sqliteCommand, [
    '-json',
    dbPath,
    [
      'select id, app_type, name, settings_config',
      'from providers',
      "where app_type = 'codex'",
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
    return Array.isArray(rows) ? parseCcSwitchProviderRows(rows, 'codex') : [];
  } catch {
    return [];
  }
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

export function parseCcSwitchProviderRows(rows: unknown[], appType: 'codex' | 'claude'): LocalRuntimeProvider[] {
  const providers: LocalRuntimeProvider[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const provider = row as CcSwitchProviderRow;
    if (provider.app_type !== appType) continue;
    if (typeof provider.id !== 'string' || typeof provider.name !== 'string') continue;
    const id = provider.id.trim();
    const name = provider.name.trim();
    if (!id || !name) continue;
    providers.push({
      id,
      name,
      runtime: appType === 'codex' ? 'codex' : 'claude_code',
      model: readProviderModel(provider.settings_config),
      source: 'cc-switch',
    });
  }
  return providers;
}

function readProviderModel(settingsConfig: unknown): string | undefined {
  if (typeof settingsConfig !== 'string' || !settingsConfig.trim()) return undefined;
  try {
    const parsed = JSON.parse(settingsConfig);
    if (!parsed || typeof parsed !== 'object') return undefined;
    const config = (parsed as { config?: unknown }).config;
    if (!config || typeof config !== 'object') return undefined;
    const model = (config as { model?: unknown; default_model?: unknown }).model
      ?? (config as { model?: unknown; default_model?: unknown }).default_model;
    return typeof model === 'string' && model.trim() ? model.trim() : undefined;
  } catch {
    return undefined;
  }
}
