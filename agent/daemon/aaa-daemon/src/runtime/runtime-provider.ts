import type { DaemonConfig, DetectedRuntime } from '../types.js';
import {
  detectCcsClaudeProviders,
  loadCcSwitchProviders,
  parseCcSwitchOpenCodeProviderRows,
  parseCcSwitchProviderRows,
  parseCcsClaudeListOutput,
} from './providers/cc-switch-provider.js';
import { detectClaudeCommand, detectCodexCommand, detectOpenCodeCommand } from './providers/local-command-provider.js';
import { loadManualRuntimeProviders, parseManualRuntimeProviders } from './providers/manual-provider.js';
import { loadOpenCodeConfigProviders, parseOpenCodeConfigProviders } from './providers/opencode-config-provider.js';
import type {
  LocalRuntimeProvider,
  RuntimeProviderInventory,
  RuntimeProviderLaunch,
} from './providers/provider-types.js';
import { resolveBundledPiLayout, type BundledPiLayout } from './pi-runtime.js';

export type {
  LocalRuntimeProvider,
  RuntimeProviderInventory,
  RuntimeProviderLaunch,
} from './providers/provider-types.js';

export {
  detectClaudeCommand,
  detectCodexCommand,
  detectOpenCodeCommand,
  loadCcSwitchProviders,
  parseCcSwitchOpenCodeProviderRows,
  parseCcSwitchProviderRows,
  parseCcsClaudeListOutput,
  parseManualRuntimeProviders,
  parseOpenCodeConfigProviders,
};

export function detectRuntimeProviders(env: NodeJS.ProcessEnv = process.env): RuntimeProviderInventory {
  const homeDir = env.USERPROFILE || env.HOME || '';
  const claudeCommand = detectClaudeCommand(env);
  const codexCommand = detectCodexCommand(env);
  const opencodeCommand = detectOpenCodeCommand(env);
  const manualProviders = loadManualRuntimeProviders(env);
  const opencodeConfigProviders = loadOpenCodeConfigProviders(env);
  const ccSwitchProviders = loadCcSwitchProviders(env, homeDir);
  const ccsClaude = detectCcsClaudeProviders(env);
  const providers = mergeRuntimeProviders([
    manualProviders,
    opencodeConfigProviders,
    ccSwitchProviders,
    ccsClaude.providers,
  ]);

  return {
    ccsClaudeCommand: ccsClaude.command,
    claudeCommand,
    codexCommand,
    opencodeCommand,
    providers,
  };
}

export function detectedRuntimesForInventory(
  config: DaemonConfig,
  inventory: RuntimeProviderInventory,
  bundledPi: BundledPiLayout | undefined = resolveBundledPiLayout(),
): Array<DetectedRuntime & Record<string, unknown>> {
  const base: Array<DetectedRuntime & Record<string, unknown>> = [
    {
      type: config.runtime ?? 'claude_code',
      status: 'available',
    },
  ];

  if (bundledPi) {
    base.push({
      type: 'pi',
      status: 'available',
      source: 'bundled',
      version: bundledPi.version,
    });
  }

  for (const provider of inventory.providers) {
    base.push({
      type: provider.runtime,
      status: 'available',
      provider: provider.name,
      runtimeProvider: provider.id,
      model: provider.model,
      ...(provider.agent ? { agent: provider.agent } : {}),
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
  if (!provider) {
    return { runtimeProvider: selected, error: `Runtime provider ${selected} is not available locally` };
  }

  if (provider.source === 'manual' && provider.command) {
    return {
      runtimeProvider: provider.id,
      command: provider.command,
      commandArgs: provider.commandArgs,
      model: provider.model,
      ...(provider.agent ? { agent: provider.agent } : {}),
    };
  }

  if (provider.runtime === 'codex' || provider.runtime === 'opencode') {
    return {
      runtimeProvider: provider.id,
      ...(provider.command ? { command: provider.command } : {}),
      ...(provider.commandArgs ? { commandArgs: provider.commandArgs } : {}),
      model: provider.model,
      ...(provider.agent ? { agent: provider.agent } : {}),
      ...(provider.opencodeConfig ? { opencodeConfig: provider.opencodeConfig } : {}),
    };
  }

  if (provider.runtime === 'claude_code' && provider.source === 'cc-switch') {
    if (!inventory.claudeCommand) {
      return { runtimeProvider: provider.id, error: `Runtime provider ${provider.name} requires a detected Claude Code command` };
    }
    return {
      runtimeProvider: provider.id,
      command: inventory.claudeCommand,
      model: provider.model,
    };
  }

  if (!inventory.ccsClaudeCommand) {
    return { runtimeProvider: selected, error: `Runtime provider ${selected} is not available locally` };
  }

  const ccsCommand = inventory.ccsClaudeCommand;
  if (ccsCommand.includes('|')) {
    const parts = ccsCommand.split('|');
    return {
      runtimeProvider: provider.id,
      command: parts[0],
      commandArgs: [...parts.slice(1), provider.name, ...(provider.model ? [provider.model] : [])],
      model: provider.model,
    };
  }

  return {
    runtimeProvider: provider.id,
    command: ccsCommand,
    commandArgs: [provider.name, provider.model].filter((item): item is string => Boolean(item)),
    model: provider.model,
  };
}

export function resolveDetectedRuntimeCommand(
  runtime: 'pi' | 'claude_code' | 'codex' | 'opencode',
  inventory: RuntimeProviderInventory,
): string | undefined {
  if (runtime === 'claude_code') return inventory.claudeCommand;
  if (runtime === 'opencode') return inventory.opencodeCommand;
  return undefined;
}

function mergeRuntimeProviders(providerGroups: Array<LocalRuntimeProvider[] | false | undefined>): LocalRuntimeProvider[] {
  const seen = new Set<string>();
  const providers: LocalRuntimeProvider[] = [];
  for (const group of providerGroups) {
    if (!group) continue;
    for (const provider of group) {
      const key = `${provider.runtime}:${provider.id}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      providers.push(provider);
    }
  }
  return providers;
}
