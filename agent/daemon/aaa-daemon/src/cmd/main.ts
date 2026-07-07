#!/usr/bin/env node
/**
 * aaa-daemon CLI — Slock Agent Daemon
 * Architecture mirrors opencan-daemon/cmd/opencan-daemon/main.go.
 *
 * Commands:
 *   start        Start the daemon (optionally daemonize)
 *   attach       Connect stdin/stdout to a running daemon
 *   status       Check if daemon is running
 *   stop         Stop a running daemon
 *   version      Print version
 */

import { Command } from 'commander';
import { DaemonCore, defaultDaemonWorkspaceRoot } from '../daemon/daemon.js';
import { attach, isDaemonRunning, startDaemon } from '../attach/attach.js';
import type { DaemonConfig } from '../types.js';
import { readFileSync } from 'fs';
import { runReadOnlySmoke } from './smoke.js';
import { DAEMON_VERSION } from '../version.js';

const program = new Command();

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function deriveBackendWebSocketUrl(serverUrl: string): string {
  const url = new URL('/internal/agent-api/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function parseRuntimeOption(value: string): DaemonConfig['runtime'] | undefined {
  if (!value || value === 'none') return undefined;
  if (value === 'claude' || value === 'claude_code') return 'claude_code';
  if (value === 'codex' || value === 'codex_acp') return 'codex';
  if (value === 'opencode' || value === 'kimi_cli' || value === 'custom') return value;
  throw new Error(`Unsupported runtime: ${value}`);
}

type StartOptions = {
  foreground?: boolean;
  config?: string;
  proxyPort: string;
  server: string;
  ws: string;
  agentId?: string;
  importSlockRuntime?: string;
  pidFile: string;
  logFile?: string;
  workspace?: string;
  runtime: string;
  runtimeCommand?: string;
  runtimeCommandArg: string[];
  runtimeModel?: string;
  runtimeAgent?: string;
  runtimeProvider?: string;
  runtimeResumeSessionId?: string;
  runtimeRestartOnCrash?: boolean;
  runtimeStallTimeoutMs?: string;
  runtimeWarmupTimeoutMs?: string;
  registerDaemon?: boolean;
  mcp?: boolean;
  verbose?: boolean;
  machineToken?: string;
  connectToken?: string;
  allowWrites?: boolean;
  writeTargetAllowlist?: string;
};

type ProductConnectOptions = {
  serverUrl?: string;
  apiKey?: string;
};

async function runStart(options: StartOptions): Promise<void> {
  const foreground = options.foreground || Boolean(options.machineToken || options.connectToken);

  // Daemonization: if not foreground, re-spawn as a detached child.
  if (!foreground) {
    const { spawn } = await import('child_process');
    const filteredArgs = process.argv.slice(3).filter((arg) => arg !== '--foreground');
    const child = spawn(process.execPath, [process.argv[1], 'start', '--foreground', ...filteredArgs], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    console.log(`[Daemon] Started in background (PID: ${child.pid})`);
    process.exit(0);
  }

  if (options.mcp) {
    process.env.AAA_DAEMON_MCP = '1';
  }
  if (options.connectToken) {
    process.env.SLOCK_CONNECT_TOKEN = options.connectToken;
  }
  if (options.machineToken) {
    process.env.SLOCK_AGENT_TOKEN = options.machineToken;
  }

  const wsUrl = options.ws === 'auto'
    ? deriveBackendWebSocketUrl(options.server)
    : options.ws;

  const config: DaemonConfig = {
    agentId: options.agentId || process.env.SLOCK_AGENT_ID || '',
    serverUrl: options.server,
    wsUrl,
    credentialPath: options.config || process.env.SLOCK_AGENT_CREDENTIAL || './credential.json',
    proxyPort: parseInt(options.proxyPort, 10),
    logLevel: options.verbose ? 'debug' : 'info',
    pidFile: options.pidFile,
    importSlockRuntime: options.importSlockRuntime,
    logFile: options.logFile,
    workspacePath: options.workspace || defaultDaemonWorkspaceRoot(),
    runtime: parseRuntimeOption(options.runtime),
    runtimeCommand: options.runtimeCommand,
    runtimeCommandArgs: options.runtimeCommandArg.length > 0 ? options.runtimeCommandArg : undefined,
    runtimeModel: options.runtimeModel,
    runtimeAgent: options.runtimeAgent,
    runtimeProvider: options.runtimeProvider,
    runtimeResumeSessionId: options.runtimeResumeSessionId,
    runtimeRestartOnCrash: options.runtimeRestartOnCrash === true,
    runtimeStallTimeoutMs: options.runtimeStallTimeoutMs ? parseInt(options.runtimeStallTimeoutMs, 10) : undefined,
    runtimeWarmupTimeoutMs: options.runtimeWarmupTimeoutMs ? parseInt(options.runtimeWarmupTimeoutMs, 10) : undefined,
    daemonRegister: options.registerDaemon === true,
    allowWrites: options.allowWrites === true,
    writeTargetAllowlist: options.writeTargetAllowlist,
  };

  const daemon = new DaemonCore(config);

  try {
    await daemon.start();
    console.log('[Daemon] Running. Press Ctrl+C to stop.');
    await new Promise(() => {});
  } catch (err) {
    console.error('[Daemon] Failed to start:', (err as Error).message);
    process.exit(1);
  }
}

async function runProductConnect(options: ProductConnectOptions): Promise<void> {
  if (!options.serverUrl || !options.apiKey) {
    program.outputHelp();
    process.exit(2);
  }

  const apiKey = options.apiKey.trim();
  const tokenOptions = apiKey.startsWith('sk_machine_')
    ? { machineToken: apiKey }
    : { connectToken: apiKey };

  await runStart({
    server: options.serverUrl,
    ws: 'auto',
    proxyPort: '0',
    pidFile: './smallkhoj-daemon.pid',
    runtime: 'none',
    runtimeCommandArg: [],
    foreground: true,
    registerDaemon: true,
    ...tokenOptions,
  });
}

program
  .name('smallkhoj-daemon')
  .description('SmallKhoj Agent Daemon')
  .version(DAEMON_VERSION)
  .option('--server-url <url>', 'SmallKhoj server URL for one-line onboarding')
  .option('--api-key <key>', 'One-time sk_connect_ ticket or sk_machine_ token')
  .action(async (options: ProductConnectOptions) => runProductConnect(options));

// ── start ────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the daemon')
  .option('--foreground', 'Run in foreground (no daemonization)')
  .option('-c, --config <path>', 'Path to credential JSON')
  .option('-p, --proxy-port <port>', 'HTTP proxy port', '0')
  .option('-s, --server <url>', 'Slock server URL', 'https://api.slock.ai')
  .option('-w, --ws <url>', 'WebSocket URL (auto|none|ws://...)', 'auto')
  .option('--agent-id <id>', 'Agent ID')
  .option('--import-slock-runtime <path>', 'Import an existing Slock .slock runtime directory')
  .option('--pid-file <path>', 'PID file path', './aaa-daemon.pid')
  .option('--log-file <path>', 'Log file path')
  .option('--workspace <path>', 'Workspace root for managed runtime files (default: ~/.smallkhoj/daemon/workspaces)')
  .option('--runtime <runtime>', 'Runtime driver to start (none|claude|codex)', 'none')
  .option('--runtime-command <command>', 'Runtime executable command')
  .option('--runtime-command-arg <arg>', 'Runtime executable argument (repeatable)', collect, [])
  .option('--runtime-model <model>', 'Runtime model')
  .option('--runtime-agent <agent>', 'Runtime agent/persona name')
  .option('--runtime-provider <provider>', 'Local runtime provider/profile name resolved by the daemon')
  .option('--runtime-resume-session-id <id>', 'Resume an existing Claude Code session id')
  .option('--runtime-restart-on-crash', 'Restart supported runtimes once after an unexpected exit')
  .option('--runtime-stall-timeout-ms <ms>', 'Busy runtime inactivity timeout before stall recovery')
  .option('--runtime-warmup-timeout-ms <ms>', 'Startup warmup timeout before degrading runtime to ready')
  .option('--register-daemon', 'Register daemon computer/workspace lifecycle with the backend')
  .option('--machine-token <token>', 'Machine token returned by a previous daemon connect')
  .option('--allow-writes', 'Explicitly allow daemon-managed runtime write-capable Slock/Raft CLI commands')
  .option('--write-target-allowlist <targets>', 'Comma-separated write target allowlist for daemon-managed runtime Slock/Raft CLI commands')
  .option('--mcp', 'Enable MCP stdio bridge')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (options: StartOptions) => runStart(options));

program
  .command('connect')
  .description('Connect this computer to a SmallKhoj server with a one-time ticket')
  .requiredOption('--token <token>', 'One-time sk_connect_ ticket')
  .option('-s, --server <url>', 'SmallKhoj server URL', 'http://localhost:8000')
  .option('-w, --ws <url>', 'WebSocket URL (auto|none|ws://...)', 'auto')
  .option('-p, --proxy-port <port>', 'HTTP proxy port', '0')
  .option('--pid-file <path>', 'PID file path', './aaa-daemon.pid')
  .option('--log-file <path>', 'Log file path')
  .option('--workspace <path>', 'Workspace root for managed runtime files (default: ~/.smallkhoj/daemon/workspaces)')
  .option('--allow-writes', 'Explicitly allow daemon-managed runtime write-capable Slock/Raft CLI commands')
  .option('--write-target-allowlist <targets>', 'Comma-separated write target allowlist for daemon-managed runtime Slock/Raft CLI commands')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (options) => runStart({
    ...options,
    connectToken: options.token,
    foreground: true,
    runtime: 'none',
    runtimeCommandArg: [],
    registerDaemon: true,
  }));

// ── attach ───────────────────────────────────────────────────

program
  .command('attach')
  .description('Connect stdin/stdout to a running daemon')
  .option('-t, --target <url>', 'Daemon proxy URL', 'http://localhost:3456')
  .option('--pid-file <path>', 'PID file path', './aaa-daemon.pid')
  .option('--no-auto-start', 'Do not auto-start daemon if not running')
  .action(async (options) => {
    await attach({
      target: options.target,
      pidFile: options.pidFile,
      autoStart: options.autoStart,
    });
  });

// ── status ───────────────────────────────────────────────────

program
  .command('smoke')
  .description('Run a read-only Slock smoke test through the local proxy')
  .requiredOption('--import-slock-runtime <path>', 'Path to an existing Slock .slock runtime directory')
  .option('--workspace <path>', 'Workspace path for temporary wrapper files')
  .action(async (options) => {
    const code = await runReadOnlySmoke({
      importSlockRuntime: options.importSlockRuntime,
      workspace: options.workspace,
    });
    process.exit(code);
  });

program
  .command('status')
  .description('Check if the daemon is running')
  .option('--pid-file <path>', 'PID file path', './aaa-daemon.pid')
  .action((options) => {
    const running = isDaemonRunning(options.pidFile);
    if (running) {
      try {
        const pid = parseInt(readFileSync(options.pidFile, 'utf-8').trim(), 10);
        console.log(`Daemon is running (PID: ${pid})`);
      } catch {
        console.log('Daemon is running');
      }
      process.exit(0);
    } else {
      console.log('Daemon is not running');
      process.exit(1);
    }
  });

// ── stop ─────────────────────────────────────────────────────

program
  .command('stop')
  .description('Stop a running daemon')
  .option('--pid-file <path>', 'PID file path', './aaa-daemon.pid')
  .action((options) => {
    if (!isDaemonRunning(options.pidFile)) {
      console.log('Daemon is not running');
      process.exit(0);
    }

    try {
      const pid = parseInt(readFileSync(options.pidFile, 'utf-8').trim(), 10);
      console.log(`Stopping daemon (PID: ${pid})...`);
      process.kill(pid, 'SIGTERM');
      console.log('Signal sent.');
    } catch (err) {
      console.error('Failed to stop daemon:', (err as Error).message);
      process.exit(1);
    }
  });

// ── version is handled by commander ──────────────────────────

program.parse();
