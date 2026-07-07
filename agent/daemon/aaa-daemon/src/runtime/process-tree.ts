import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'child_process';

const DEFAULT_RUNTIME_KILL_GRACE_MS = 2_000;

export interface RuntimeCommandSpawnSpec {
  command: string;
  args: string[];
  shell: boolean;
}

export function runtimeProcessSpawnOptions(options: SpawnOptionsWithoutStdio): SpawnOptionsWithoutStdio {
  return {
    ...options,
    detached: process.platform !== 'win32',
    windowsHide: true,
  };
}

export function runtimeCommandNeedsWindowsShell(command: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

export function runtimeCommandSpawnSpec(command: string, args: string[] = []): RuntimeCommandSpawnSpec {
  if (process.platform === 'win32' && /\.(mjs|cjs|js)$/i.test(command)) {
    return {
      command: process.execPath,
      args: [command, ...args],
      shell: false,
    };
  }
  return {
    command,
    args,
    shell: runtimeCommandNeedsWindowsShell(command),
  };
}

export function signalRuntimeProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
): void {
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, signal);
      return;
    }
    child.kill(signal);
  } catch {
    // Process may already have exited.
  }
}

export function scheduleRuntimeProcessTreeKill(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = DEFAULT_RUNTIME_KILL_GRACE_MS,
): ReturnType<typeof setTimeout> | null {
  if (timeoutMs < 0) return null;
  return setTimeout(() => {
    signalRuntimeProcessTree(child, 'SIGKILL');
  }, timeoutMs);
}
