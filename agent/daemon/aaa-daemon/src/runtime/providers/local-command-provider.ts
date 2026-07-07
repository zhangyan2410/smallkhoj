import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import { delimiter, isAbsolute, join } from 'path';

type RuntimeCommandName = 'claude' | 'codex' | 'opencode';

interface RuntimeCommandDetectionOptions {
  env: NodeJS.ProcessEnv;
  envNames: string[];
  commandNames: string[];
  homeSubpaths: string[][];
  probeArgs?: string[];
}

export function detectClaudeCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return detectRuntimeCommand({
    env,
    envNames: ['SLOCK_CLAUDE_COMMAND', 'CLAUDE_COMMAND'],
    commandNames: commandNamesForRuntime('claude'),
    homeSubpaths: commonHomeSubpaths('claude', env),
  });
}

export function detectCodexCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return detectRuntimeCommand({
    env,
    envNames: ['SLOCK_CODEX_COMMAND', 'CODEX_COMMAND'],
    commandNames: commandNamesForRuntime('codex'),
    homeSubpaths: commonHomeSubpaths('codex', env),
  });
}

export function detectOpenCodeCommand(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return detectRuntimeCommand({
    env,
    envNames: ['SLOCK_OPENCODE_COMMAND', 'OPENCODE_COMMAND'],
    commandNames: commandNamesForRuntime('opencode'),
    homeSubpaths: commonHomeSubpaths('opencode', env),
  });
}

function detectRuntimeCommand(options: RuntimeCommandDetectionOptions): string | undefined {
  const candidates = runtimeCommandCandidates(options);
  for (const candidate of candidates) {
    if (!candidateMayExist(candidate, options.env)) continue;
    const result = spawnSync(candidate, options.probeArgs ?? ['--version'], {
      encoding: 'utf-8',
      env: options.env,
      windowsHide: true,
      shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(candidate),
    });
    if (result.status === 0) return candidate;
  }
  return undefined;
}

function runtimeCommandCandidates(options: RuntimeCommandDetectionOptions): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  const push = (value: string | undefined) => {
    const candidate = value?.trim();
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  for (const envName of options.envNames) push(options.env[envName]);
  for (const commandName of options.commandNames) push(commandName);

  const homeDir = options.env.USERPROFILE || options.env.HOME || '';
  if (homeDir) {
    for (const subpath of options.homeSubpaths) {
      push(join(homeDir, ...subpath));
    }
  }

  const appData = options.env.APPDATA;
  if (appData) {
    for (const commandName of options.commandNames) {
      push(join(appData, 'npm', commandName));
    }
  }

  return candidates;
}

function commandNamesForRuntime(name: RuntimeCommandName): string[] {
  return process.platform === 'win32' ? [name, `${name}.cmd`, `${name}.exe`] : [name];
}

function commonHomeSubpaths(name: RuntimeCommandName, _env: NodeJS.ProcessEnv): string[][] {
  const commandNames = commandNamesForRuntime(name);
  const dirs = [
    ['.npm-global', 'bin'],
    ['.local', 'bin'],
  ];
  const paths: string[][] = [];
  for (const dir of dirs) {
    for (const commandName of commandNames) {
      paths.push([...dir, commandName]);
    }
  }

  return paths;
}

function candidateMayExist(candidate: string, env: NodeJS.ProcessEnv): boolean {
  if (candidate.includes('/') || candidate.includes('\\') || isAbsolute(candidate)) {
    return existsSync(candidate);
  }
  return commandAppearsOnPath(candidate, env.PATH ?? '');
}

function commandAppearsOnPath(command: string, pathValue: string): boolean {
  if (!pathValue) return false;
  for (const pathDir of pathValue.split(delimiter)) {
    if (!pathDir) continue;
    if (existsSync(join(pathDir, command))) return true;
  }
  return false;
}
