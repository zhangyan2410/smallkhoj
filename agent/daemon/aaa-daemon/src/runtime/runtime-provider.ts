import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import type { DaemonConfig, DetectedRuntime } from '../types.js';

export interface LocalRuntimeProvider {
  id: string;
  name: string;
  runtime: 'claude_code';
  model?: string;
  source: 'cc-switch';
}

export interface RuntimeProviderInventory {
  ccsClaudeCommand?: string;
  providers: LocalRuntimeProvider[];
}

export interface RuntimeProviderLaunch {
  command?: string;
  commandArgs?: string[];
  model?: string;
  runtimeProvider?: string;
  error?: string;
}

export function parseCcsClaudeListOutput(output: string): LocalRuntimeProvider[] {
  const providers: LocalRuntimeProvider[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('current ') || line.startsWith('current\t')) continue;
    if (line.startsWith('*')) line = line.slice(1).trim();
    const columns = line.split(/\s{2,}/).map((item) => item.trim()).filter(Boolean);
    if (columns.length < 3) continue;
    const [name, id, model] = columns;
    if (!name || !id || !model) continue;
    providers.push({
      id: name,
      name,
      runtime: 'claude_code',
      model,
      source: 'cc-switch',
    });
  }
  return providers;
}

export function detectRuntimeProviders(env: NodeJS.ProcessEnv = process.env): RuntimeProviderInventory {
  const candidates = [
    env.SLOCK_CCS_CLAUDE_COMMAND,
    env.CCS_CLAUDE_COMMAND,
    '/Users/lee/.local/bin/ccs-claude',
    'ccs-claude',
  ].filter((item): item is string => Boolean(item));

  for (const command of candidates) {
    if (command.includes('/') && !existsSync(command)) continue;
    const result = spawnSync(command, ['list'], {
      encoding: 'utf-8',
      env,
      windowsHide: true,
    });
    if (result.status !== 0) continue;
    const providers = parseCcsClaudeListOutput(result.stdout || '');
    if (providers.length === 0) continue;
    return { ccsClaudeCommand: command, providers };
  }

  return { providers: [] };
}

export function detectedRuntimesForInventory(
  config: DaemonConfig,
  inventory: RuntimeProviderInventory,
): Array<DetectedRuntime & Record<string, unknown>> {
  const base: Array<DetectedRuntime & Record<string, unknown>> = [
    {
      type: config.runtime ?? 'claude_code',
      status: 'available',
    },
  ];

  for (const provider of inventory.providers) {
    base.push({
      type: provider.runtime,
      status: 'available',
      provider: provider.name,
      runtimeProvider: provider.id,
      model: provider.model,
      source: provider.source,
    });
  }

  return base;
}

export function resolveRuntimeProviderLaunch(
  runtimeProvider: string | undefined,
  inventory: RuntimeProviderInventory,
): RuntimeProviderLaunch {
  const selected = runtimeProvider?.trim();
  if (!selected) return {};
  const provider = inventory.providers.find((item) => (
    item.id.toLowerCase() === selected.toLowerCase()
    || item.name.toLowerCase() === selected.toLowerCase()
  ));
  if (!provider || !inventory.ccsClaudeCommand) {
    return { runtimeProvider: selected, error: `Runtime provider ${selected} is not available locally` };
  }
  return {
    runtimeProvider: provider.id,
    command: inventory.ccsClaudeCommand,
    commandArgs: [provider.name, provider.model].filter((item): item is string => Boolean(item)),
    model: provider.model,
  };
}
