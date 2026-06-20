import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import type { LocalRuntimeProvider } from './provider-types.js';

export function detectCodexCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
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

export function codexCliFallbackProvider(codexCommand: string): LocalRuntimeProvider {
  return {
    id: 'codex-cli',
    name: 'Codex',
    runtime: 'codex_cli',
    command: codexCommand,
    source: 'codex-cli',
  };
}
