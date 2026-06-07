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
import { DaemonCore } from '../daemon/daemon.js';
import { attach, isDaemonRunning, startDaemon } from '../attach/attach.js';
import type { DaemonConfig } from '../types.js';
import { readFileSync, existsSync } from 'fs';
import { runReadOnlySmoke } from './smoke.js';

const program = new Command();

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

program
  .name('aaa-daemon')
  .description('Minimal Slock Agent Daemon — based on opencan-daemon architecture')
  .version('0.2.0');

// ── start ────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the daemon')
  .option('--foreground', 'Run in foreground (no daemonization)')
  .option('-c, --config <path>', 'Path to credential JSON')
  .option('-p, --proxy-port <port>', 'HTTP proxy port', '0')
  .option('-s, --server <url>', 'Slock server URL', 'https://api.slock.ai')
  .option('-w, --ws <url>', 'WebSocket URL', 'wss://ws.slock.ai')
  .option('--agent-id <id>', 'Agent ID')
  .option('--import-slock-runtime <path>', 'Import an existing Slock .slock runtime directory')
  .option('--pid-file <path>', 'PID file path', './aaa-daemon.pid')
  .option('--log-file <path>', 'Log file path')
  .option('--workspace <path>', 'Workspace path for managed runtime files', process.cwd())
  .option('--runtime <runtime>', 'Runtime driver to start (none|claude)', 'none')
  .option('--runtime-command <command>', 'Runtime executable command')
  .option('--runtime-command-arg <arg>', 'Runtime executable argument (repeatable)', collect, [])
  .option('--runtime-model <model>', 'Claude runtime model')
  .option('--runtime-resume-session-id <id>', 'Resume an existing Claude Code session id')
  .option('--runtime-restart-on-crash', 'Restart Claude runtime once after an unexpected exit')
  .option('--runtime-stall-timeout-ms <ms>', 'Busy runtime inactivity timeout before stall recovery')
  .option('--register-daemon', 'Register daemon computer/workspace lifecycle with the backend')
  .option('--mcp', 'Enable MCP stdio bridge')
  .option('-v, --verbose', 'Verbose logging')
  .action(async (options) => {
    // Daemonization: if not --foreground, re-spawn as a detached child
    if (!options.foreground) {
      const { spawn } = await import('child_process');

      // Re-spawn with --foreground flag
      const args = [...process.argv.slice(2).filter((a) => a !== 'daemon' && !a.startsWith('start')), 'start', '--foreground'];
      // Replace non-foreground args
      const filteredArgs = process.argv.slice(3).filter((a) => a !== '--foreground');
      const child = spawn(process.execPath, [process.argv[1], 'start', '--foreground', ...filteredArgs], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      console.log(`[Daemon] Started in background (PID: ${child.pid})`);
      process.exit(0);
    }

    // Foreground mode
    if (options.mcp) {
      process.env.AAA_DAEMON_MCP = '1';
    }

    const config: DaemonConfig = {
      agentId: options.agentId || process.env.SLOCK_AGENT_ID || '',
      serverUrl: options.server,
      wsUrl: options.ws,
      credentialPath: options.config || process.env.SLOCK_AGENT_CREDENTIAL || './credential.json',
      proxyPort: parseInt(options.proxyPort, 10),
      logLevel: options.verbose ? 'debug' : 'info',
      pidFile: options.pidFile,
      importSlockRuntime: options.importSlockRuntime,
      logFile: options.logFile,
      workspacePath: options.workspace,
      runtime: options.runtime === 'claude' ? 'claude_code' : undefined,
      runtimeCommand: options.runtimeCommand,
      runtimeCommandArgs: options.runtimeCommandArg,
      runtimeModel: options.runtimeModel,
      runtimeResumeSessionId: options.runtimeResumeSessionId,
      runtimeRestartOnCrash: options.runtimeRestartOnCrash === true,
      runtimeStallTimeoutMs: options.runtimeStallTimeoutMs ? parseInt(options.runtimeStallTimeoutMs, 10) : undefined,
      daemonRegister: options.registerDaemon === true,
    };

    const daemon = new DaemonCore(config);

    try {
      await daemon.start();

      // Keep process alive
      console.log('[Daemon] Running. Press Ctrl+C to stop.');

      // Idle handling: wait forever (signals handle shutdown)
      await new Promise(() => {}); // never resolves
    } catch (err) {
      console.error('[Daemon] Failed to start:', (err as Error).message);
      process.exit(1);
    }
  });

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
