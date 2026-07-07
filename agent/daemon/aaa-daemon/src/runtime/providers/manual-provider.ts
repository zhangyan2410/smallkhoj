import type { LocalRuntimeProvider, LocalRuntimeProviderRuntime } from './provider-types.js';

interface ManualRuntimeProviderInput {
  id?: unknown;
  name?: unknown;
  runtime?: unknown;
  model?: unknown;
  agent?: unknown;
  command?: unknown;
  commandArgs?: unknown;
}

const SUPPORTED_MANUAL_RUNTIMES = new Set<LocalRuntimeProviderRuntime>([
  'claude_code',
  'codex',
  'codex_acp',
  'opencode',
]);

export function loadManualRuntimeProviders(env: NodeJS.ProcessEnv): LocalRuntimeProvider[] {
  return parseManualRuntimeProviders(
    env.SLOCK_RUNTIME_PROVIDERS_JSON
      ?? env.AAA_DAEMON_RUNTIME_PROVIDERS_JSON
      ?? env.RUNTIME_PROVIDERS_JSON,
  );
}

export function parseManualRuntimeProviders(raw: unknown): LocalRuntimeProvider[] {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(parseManualRuntimeProvider)
    .filter((provider): provider is LocalRuntimeProvider => Boolean(provider));
}

function parseManualRuntimeProvider(input: unknown): LocalRuntimeProvider | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const item = input as ManualRuntimeProviderInput;
  if (typeof item.id !== 'string' || typeof item.name !== 'string') return undefined;
  if (typeof item.runtime !== 'string' || !SUPPORTED_MANUAL_RUNTIMES.has(item.runtime as LocalRuntimeProviderRuntime)) return undefined;
  const id = item.id.trim();
  const name = item.name.trim();
  const runtime = item.runtime as LocalRuntimeProviderRuntime;
  if (!id || !name) return undefined;
  const commandArgs = Array.isArray(item.commandArgs)
    ? item.commandArgs.filter((arg): arg is string => typeof arg === 'string')
    : undefined;
  return {
    id,
    name,
    runtime,
    model: typeof item.model === 'string' && item.model.trim() ? item.model.trim() : undefined,
    ...(typeof item.agent === 'string' && item.agent.trim() ? { agent: item.agent.trim() } : {}),
    command: typeof item.command === 'string' && item.command.trim() ? item.command.trim() : undefined,
    commandArgs,
    source: 'manual',
  };
}
