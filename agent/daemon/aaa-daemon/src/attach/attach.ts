/**
 * Attach — client bridge to connect stdin/stdout to the daemon proxy.
 * Mirrors opencan-daemon/internal/attach/attach.go.
 *
 * Usage:
 *   aaa-daemon attach [--target http://localhost:PORT]
 *
 * Connects to the running daemon's HTTP proxy and bridges stdin/stdout.
 * Auto-starts the daemon if not running.
 */

import { spawn, execSync } from 'child_process';
import * as readline from 'readline';
import { existsSync, readFileSync } from 'fs';

export interface AttachOptions {
  target?: string;
  pidFile?: string;
  autoStart?: boolean;
}

const DEFAULT_PID_FILE = './aaa-daemon.pid';
const DEFAULT_PROXY_PORT = 3456;

/** Check if the daemon is running by reading PID file and checking the process */
export function isDaemonRunning(pidFile = DEFAULT_PID_FILE): boolean {
  if (!existsSync(pidFile)) return false;

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
    if (isNaN(pid)) return false;

    // On Windows, we can't send signal 0. Try process.kill with 0.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Auto-start the daemon in background */
export async function startDaemon(args: string[] = []): Promise<void> {
  console.log('[Attach] Daemon not running, auto-starting...');

  const child = spawn(process.execPath, [
    ...process.execArgv,
    process.argv[1],
    'start',
    '--foreground',
    ...args,
  ], {
    detached: true,
    stdio: 'ignore',
  });

  child.unref();

  // Wait briefly for it to start
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

/** Connect to the daemon proxy and bridge stdin/stdout */
export async function attach(options: AttachOptions = {}): Promise<void> {
  const pidFile = options.pidFile || DEFAULT_PID_FILE;
  const target = options.target || `http://localhost:${DEFAULT_PROXY_PORT}`;
  const autoStart = options.autoStart !== false;

  // Check if daemon is running
  if (!isDaemonRunning(pidFile)) {
    if (autoStart) {
      await startDaemon();
    } else {
      console.error('[Attach] Daemon is not running. Start it with: aaa-daemon start');
      process.exit(1);
    }
  }

  console.log(`[Attach] Connected to ${target}`);
  console.log(`[Attach] Bridging stdin/stdout...`);

  // Read from stdin, send to daemon proxy
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line: string) => {
    try {
      const msg = JSON.parse(line);
      const res = await fetch(target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      const data = await res.json();
      process.stdout.write(JSON.stringify(data) + '\n');
    } catch (err) {
      // Forward non-JSON as-is (like opencan's passthrough)
      console.error('[Attach] Error:', (err as Error).message);
    }
  });

  // Emit attached notification
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'daemon/attached',
    params: {},
  }) + '\n');
}
