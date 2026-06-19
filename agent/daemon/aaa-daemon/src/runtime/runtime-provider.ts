import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import type { DaemonConfig, DetectedRuntime } from '../types.js';

export interface LocalRuntimeProvider {
  id: string;
  name: string;
  runtime: 'claude_code' | 'codex_cli';
  model?: string;
  command?: string;
  source: 'cc-switch' | 'codex-cli';
}

export interface RuntimeProviderInventory {
  ccsClaudeCommand?: string;
  codexCommand?: string;
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
    if (line.startsWith('Available') || line.startsWith('Usage:')) continue;
    if (line.startsWith('*')) line = line.slice(1).trim();
    const columns = line.split(/\t+|\s{2,}/).map((item) => item.trim().replace(/^- /, '')).filter(Boolean);
    if (columns.length < 1) continue;
    const name = columns[0];
    // macOS ccs-claude: "name  id  model" (3+ columns)
    // Windows cc-switch.ps1: "name\t- description" (1-2 columns, no model info)
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

export function detectRuntimeProviders(env: NodeJS.ProcessEnv = process.env): RuntimeProviderInventory {
  const homeDir = env.USERPROFILE || env.HOME || '';
  const codexCommand = detectCodexCommand(env);
  const candidates = [
    env.SLOCK_CCS_CLAUDE_COMMAND,
    env.CCS_CLAUDE_COMMAND,
    // macOS (ccs-claude binary)
    '/Users/lee/.local/bin/ccs-claude',
    'ccs-claude',
    // Windows (cc-switch.ps1 in .claude/, invoked via powershell)
    `${homeDir}/.local/bin/ccs-claude`,
  ].filter((item): item is string => Boolean(item));

  // Windows: detect cc-switch.ps1 and wrap it for spawnSync
  const ccSwitchPs1 = homeDir ? `${homeDir}/.claude/cc-switch.ps1` : '';
  if (ccSwitchPs1 && existsSync(ccSwitchPs1)) {
    // powershell.exe is always available on Windows
    candidates.push(`powershell.exe|-ExecutionPolicy|Bypass|${ccSwitchPs1}`);
  }

  for (const candidate of candidates) {
    // Handle powershell wrapper: "powershell.exe|-ExecutionPolicy|Bypass|script.ps1"
    const parts = candidate.split('|');
    const command = parts[0];
    const preArgs = parts.length > 1 ? parts.slice(1, -1) : [];
    const scriptOrBin = parts.length > 1 ? parts[parts.length - 1] : command;

    if (scriptOrBin.includes('/') && !existsSync(scriptOrBin)) continue;
    if (scriptOrBin.includes('\\') && !existsSync(scriptOrBin)) continue;

    // Build args: for pipe-delimited candidates, include the script/binary path
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
      return {
        ccsClaudeCommand: candidate,
        codexCommand,
        providers: [
          ...providers,
          ...(codexCommand ? [{
            id: 'codex-cli',
            name: 'Codex CLI',
            runtime: 'codex_cli' as const,
            command: codexCommand,
            source: 'codex-cli' as const,
          }] : []),
        ],
      };
  }

  return {
    codexCommand,
    providers: codexCommand ? [{
      id: 'codex-cli',
      name: 'Codex CLI',
      runtime: 'codex_cli',
      command: codexCommand,
      source: 'codex-cli',
    }] : [],
  };
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
      command: provider.command,
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

  if (provider.runtime === 'codex_cli') {
    return {
      runtimeProvider: provider.id,
      command: provider.command ?? inventory.codexCommand,
      model: provider.model,
    };
  }

  if (!inventory.ccsClaudeCommand) {
    return { runtimeProvider: selected, error: `Runtime provider ${selected} is not available locally` };
  }

  // Handle powershell wrapper: "powershell.exe|-ExecutionPolicy|Bypass|script.ps1"
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

function detectCodexCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const homeDir = env.USERPROFILE || env.HOME || '';
  const candidates = [
    env.SLOCK_CODEX_COMMAND,
    env.CODEX_COMMAND,
    'codex',
    `${homeDir}/.npm-global/bin/codex`,
    `${homeDir}/.local/bin/codex`,
  ].filter((item): item is string => Boolean(item));

  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) continue;
    if (candidate.includes('\\') && !existsSync(candidate)) continue;
    const result = spawnSync(candidate, ['--version'], {
      encoding: 'utf-8',
      env,
      windowsHide: true,
    });
    if (result.status === 0) return candidate;
  }

  return undefined;
}
