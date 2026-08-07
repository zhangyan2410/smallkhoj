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
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'fs';
import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { runReadOnlySmoke } from './smoke.js';
import { DAEMON_VERSION } from '../version.js';
import { daemonPaths, detectWindowsArchitecture } from '../platform/paths.js';
import { readSetup, runSetup } from '../platform/setup.js';
import { codexAcpReadiness } from '../runtime/codex-acp-runtime.js';
import {
  clearManagedDaemonState,
  readManagedDaemonState,
  redactManagedDaemonError,
  writeManagedDaemonState,
} from '../platform/daemon-state.js';
import {
  readReleasePointer,
  rollbackRelease,
} from '../platform/release-state.js';

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
  server?: string;
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

type SetupOptions = {
  name: string;
  serverUrl: string;
  mode?: string;
  reset?: boolean;
};

type ProductConnectOptions = {
  serverUrl?: string;
  apiKey?: string;
};

type RollbackOptions = {
  targetVersion: string;
};

function detectImplementationType(): 'aura-standalone' | 'node-npx' {
  if (process.env.AURA_STANDALONE === '1') return 'aura-standalone';
  const executable = `${process.execPath} ${process.argv[1] || ''}`.toLowerCase();
  if (process.platform === 'win32' && /[\\/]aura[\\/]versions[\\/]/.test(executable)) {
    return 'aura-standalone';
  }
  return 'node-npx';
}

type JsonRecord = Record<string, unknown>;

function readJsonRecord(path: string): JsonRecord | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8').replace(/^\uFEFF/, ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function activeReleaseInfo(env: NodeJS.ProcessEnv = process.env): {
  activePath?: string;
  version?: string;
  platform?: string;
  artifactSha256?: string;
  manifest?: JsonRecord | null;
} {
  const paths = daemonPaths(env);
  const active = readJsonRecord(join(paths.installRoot, 'active.json'));
  if (!active) return {};
  const activePath = stringValue(active.path);
  return {
    activePath,
    version: stringValue(active.version),
    platform: stringValue(active.platform),
    artifactSha256: stringValue(active.artifactSha256),
    manifest: activePath ? readJsonRecord(join(activePath, 'manifest.json')) : null,
  };
}

function readCredentialMetadata(path: string): {
  present: boolean;
  valid: boolean;
  token?: string;
  serverUrl?: string;
  serverId?: string;
  computerId?: string;
  machineId?: string;
  agentId?: string;
} {
  const value = readJsonRecord(path);
  if (!value) return { present: existsSync(path), valid: false };
  const token = stringValue(value.token) || stringValue(value.apiKey);
  return {
    present: true,
    valid: Boolean(token),
    token,
    serverUrl: stringValue(value.server_url) || stringValue(value.serverUrl),
    serverId: stringValue(value.server_id) || stringValue(value.serverId),
    computerId: stringValue(value.computer_id) || stringValue(value.computerId),
    machineId: stringValue(value.machine_id) || stringValue(value.machineId),
    agentId: stringValue(value.agent_id) || stringValue(value.agentId),
  };
}

function pathIsExecutable(path: string | undefined): boolean {
  if (!path) return false;
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function activePrivateNodePath(activePath?: string): string | undefined {
  if (!activePath) return undefined;
  const candidate = join(activePath, process.platform === 'win32' ? 'node.exe' : 'node');
  return pathIsExecutable(candidate) ? candidate : undefined;
}

function activeAcpPath(activePath?: string): string | undefined {
  const readiness = codexAcpReadiness({
    ...process.env,
    AURA_RELEASE_ROOT: activePath || process.env.AURA_RELEASE_ROOT,
  }, activePath || process.env.AURA_RELEASE_ROOT);
  return readiness.path;
}

function setupSummary(paths = daemonPaths()): {
  setup: ReturnType<typeof readSetup>;
  credential: ReturnType<typeof readCredentialMetadata>;
  machineIdPresent: boolean;
} {
  const setup = readSetup(paths);
  const credential = readCredentialMetadata(paths.credentialPath);
  let machineIdPresent = false;
  try {
    machineIdPresent = existsSync(paths.machineIdPath) && Boolean(readFileSync(paths.machineIdPath, 'utf-8').trim());
  } catch {
    // A permission or transient filesystem error is reported as an incomplete
    // Setup state rather than crashing `status`/`doctor`.
    machineIdPresent = false;
  }
  return { setup, credential, machineIdPresent };
}

async function waitForProcessExit(pid: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

type ManagedLaunchOptions = {
  serverUrl: string;
  connectToken?: string;
  machineToken?: string;
};

async function launchManagedDaemon(options: ManagedLaunchOptions): Promise<number> {
  const paths = daemonPaths();
  if (isDaemonRunning(paths.pidPath)) {
    throw new Error(`Aura daemon is already running (PID ${readFileSync(paths.pidPath, 'utf-8').trim()}); use aura status or stop before connecting again.`);
  }

  clearManagedDaemonState(paths.statePath);
  mkdirSync(dirname(paths.logPath), { recursive: true });
  const logFd = openSync(paths.logPath, 'a', 0o600);
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    AURA_STANDALONE: '1',
    AURA_SERVER_URL: options.serverUrl,
    SLOCK_AGENT_CREDENTIAL: paths.credentialPath,
  };
  delete childEnv.SLOCK_CONNECT_TOKEN;
  delete childEnv.SLOCK_AGENT_TOKEN;
  if (options.connectToken) childEnv.SLOCK_CONNECT_TOKEN = options.connectToken;
  if (options.machineToken) childEnv.SLOCK_AGENT_TOKEN = options.machineToken;

  const child = spawn(process.execPath, [
    process.argv[1],
    'start',
    '--foreground',
    '--server', options.serverUrl,
    '--ws', 'auto',
    '--proxy-port', '0',
    '--pid-file', paths.pidPath,
    '--log-file', paths.logPath,
    '--workspace', paths.workspaceRoot,
    '--register-daemon',
  ], {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: childEnv,
  });
  closeSync(logFd);
  child.unref();

  const childPid = child.pid;
  if (!childPid) throw new Error('Aura daemon process could not be started');
  // Keep the exit event in a mutable object so TypeScript does not narrow the
  // captured variable to `never` across the asynchronous listener/loop.
  const childExit: { value: { code: number | null; signal: NodeJS.Signals | null } | null } = { value: null };
  child.once('exit', (code, signal) => {
    childExit.value = { code, signal };
  });
  const timeoutMs = Number(process.env.AURA_CONNECT_TIMEOUT_MS || 20_000);
  const deadline = Date.now() + (Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 20_000);
  while (Date.now() < deadline) {
    const state = readManagedDaemonState(paths.statePath);
    if (state?.status === 'online' && state.pid === childPid) {
      console.log(`[Aura] Connected and running in background (PID ${childPid}). You can close this terminal.`);
      return childPid;
    }
    if (state?.status === 'error') {
      throw new Error(state.lastError || 'Aura daemon registration failed; see aura doctor and the Aura log.');
    }
    if (childExit.value) {
      const detail = childExit.value.signal ? `signal ${childExit.value.signal}` : `exit ${childExit.value.code}`;
      throw new Error(`Aura daemon exited before it became online (${detail}); see ${paths.logPath}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  try { process.kill(childPid, 'SIGTERM'); } catch { /* already exited */ }
  const message = `Timed out waiting for Aura to register with the server; see ${paths.logPath}.`;
  try {
    writeManagedDaemonState({
      status: 'error',
      pid: childPid,
      daemonVersion: DAEMON_VERSION,
      lastError: message,
    }, paths.statePath);
  } catch {
    // Preserve the actionable timeout even if the state directory is no
    // longer writable while the child is shutting down.
  }
  throw new Error(message);
}

async function runRestart(): Promise<void> {
  const paths = daemonPaths();
  const { setup, credential } = setupSummary(paths);
  if (!credential.valid) {
    console.error('[Aura] Installed/setup state is present, but this computer is not connected. Run the Connect command from the web page first.');
    process.exitCode = 1;
    return;
  }

  if (isDaemonRunning(paths.pidPath)) {
    try {
      const pid = Number.parseInt(readFileSync(paths.pidPath, 'utf-8').trim(), 10);
      if (Number.isFinite(pid)) process.kill(pid, 'SIGTERM');
      if (!(await waitForProcessExit(pid))) {
        console.error(`[Aura] Existing daemon (PID ${pid}) did not stop gracefully; refusing to force-kill it.`);
        process.exitCode = 1;
        return;
      }
    } catch (error) {
      console.error('[Aura] Could not stop the existing daemon:', (error as Error).message);
      process.exitCode = 1;
      return;
    }
  }

  const serverUrl = credential.serverUrl || setup?.serverUrl || process.env.AURA_SERVER_URL || 'http://localhost:8000';
  await launchManagedDaemon({ serverUrl, machineToken: credential.token });
}

function runRollback(options: RollbackOptions): void {
  const paths = daemonPaths();
  if (isDaemonRunning(paths.pidPath)) {
    throw new Error('Aura daemon is running; stop it gracefully with `aura stop` before rolling back.');
  }
  const previous = readReleasePointer(paths.installRoot);
  const result = rollbackRelease({
    installRoot: paths.installRoot,
    version: options.targetVersion,
  });
  if (result.previous.version === result.active.version && result.previous.path === result.active.path) {
    console.log(`[Aura] Release ${result.active.version} is already active.`);
    return;
  }
  const hadPrevious = previous && previous.version !== result.active.version;
  console.log(`[Aura] Rolled back Aura from ${result.previous.version} to ${result.active.version}.`);
  if (hadPrevious) {
    console.log('[Aura] Setup, machine identity, and credentials were preserved. Run `aura doctor` before reconnecting.');
  }
}

function buildStatusPayload(): JsonRecord {
  const paths = daemonPaths();
  const running = isDaemonRunning(paths.pidPath);
  const active = activeReleaseInfo();
  const summary = setupSummary(paths);
  const daemonState = readManagedDaemonState(paths.statePath);
  const implementationType = detectImplementationType();
  const online = Boolean(
    summary.credential.valid
      && running
      && daemonState?.status === 'online'
      && daemonState.pid === Number.parseInt(readFileSync(paths.pidPath, 'utf-8').trim(), 10),
  );
  return {
    running,
    implementation: implementationType,
    implementationType,
    platform: process.platform,
    architecture: process.platform === 'win32' ? detectWindowsArchitecture() : process.arch,
    daemonVersion: DAEMON_VERSION,
    installed: Boolean(active.activePath && active.version),
    activeVersion: active.version ?? null,
    activePlatform: active.platform ?? null,
    artifactSha256: active.artifactSha256 ?? null,
    setup: Boolean(summary.setup && summary.machineIdPresent),
    credentialPresent: summary.credential.present,
    credentialValid: summary.credential.valid,
    connected: online,
    online,
    serverId: summary.credential.serverId ?? daemonState?.serverId ?? null,
    computerId: summary.credential.computerId ?? daemonState?.computerId ?? null,
    daemonId: daemonState?.daemonId ?? null,
    daemonState: daemonState ?? null,
    paths,
    runtimeInventory: {
      privateNode: activePrivateNodePath(active.activePath) ?? null,
      codexAcp: activeAcpPath(active.activePath) ?? null,
    },
    lastError: daemonState?.lastError ?? null,
  };
}

function printDoctor(json: boolean): number {
  const payload = buildStatusPayload();
  const paths = payload.paths as JsonRecord;
  const activePath = stringValue((activeReleaseInfo()).activePath);
  const acp = codexAcpReadiness({
    ...process.env,
    AURA_RELEASE_ROOT: activePath || process.env.AURA_RELEASE_ROOT,
  }, activePath || process.env.AURA_RELEASE_ROOT);
  const checks = {
    platformSupported: payload.architecture !== 'unknown',
    activePointer: Boolean(payload.installed && activePath),
    launcherExecutable: pathIsExecutable(process.env.AURA_RELEASE_ROOT ? join(dirname(process.argv[1]), 'aura') : undefined)
      || Boolean(process.env.AURA_STANDALONE),
    privateNode: Boolean(payload.runtimeInventory && (payload.runtimeInventory as JsonRecord).privateNode) || payload.implementation !== 'aura-standalone',
    codexAcp: acp.available,
    pathDiscovery: Boolean(process.env.PATH?.split(process.platform === 'win32' ? ';' : ':').some((entry) => entry && pathIsExecutable(join(entry, process.platform === 'win32' ? 'aura.exe' : 'aura')))),
    setup: Boolean(payload.setup),
    credential: Boolean(payload.credentialPresent && payload.credentialValid),
    online: payload.online === true,
  };
  const result = { ...payload, checks, codexAcpReason: acp.reason ?? null };
  if (json) {
    console.log(JSON.stringify(result));
  } else {
    console.log(`[Aura] ${payload.installed ? `installed ${payload.activeVersion}` : 'not installed'} (${payload.implementation})`);
    console.log(`[Aura] Setup: ${payload.setup ? 'ready' : 'not initialized'}; credential: ${payload.credentialValid ? 'saved' : 'missing'}; online: ${payload.online ? 'yes' : 'no'}; daemon: ${payload.running ? 'running' : 'stopped'}`);
    console.log(`[Aura] Private Node: ${checks.privateNode ? 'ready' : 'missing'}`);
    console.log(`[Aura] Codex ACP: ${acp.available ? acp.path : acp.reason}`);
    if (!checks.pathDiscovery) console.log('[Aura] Launcher is not discoverable in the current PATH. Re-run the installer from a shell with a writable user bin directory already on PATH.');
  }
  // ACP is optional; only core installation/setup/credential failures fail the
  // doctor command.  This lets Claude-only installations remain healthy while
  // still explaining the exact Codex child-process problem.
  return checks.platformSupported && checks.activePointer && checks.privateNode ? 0 : 1;
}

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

  const paths = daemonPaths();
  const setup = readSetup(paths);
  const serverUrl = options.server || setup?.serverUrl || process.env.AURA_SERVER_URL || 'http://localhost:8000';
  const wsUrl = options.ws === 'auto'
    ? deriveBackendWebSocketUrl(serverUrl)
    : options.ws;
  const config: DaemonConfig = {
    agentId: options.agentId || process.env.SLOCK_AGENT_ID || '',
    computerName: setup?.name || process.env.AURA_COMPUTER_NAME,
    serverUrl,
    wsUrl,
    credentialPath: options.config || process.env.SLOCK_AGENT_CREDENTIAL || paths.credentialPath,
    proxyPort: parseInt(options.proxyPort, 10),
    logLevel: options.verbose ? 'debug' : 'info',
    pidFile: options.pidFile || paths.pidPath,
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
    if (process.env.AURA_STANDALONE === '1') {
      try {
        writeManagedDaemonState({
          status: 'error',
          pid: process.pid,
          daemonId: undefined,
          daemonVersion: DAEMON_VERSION,
          lastError: redactManagedDaemonError(err),
        }, daemonPaths().statePath);
      } catch {
        // Preserve the original startup error if the diagnostic state itself
        // cannot be written.
      }
    }
    console.error('[Daemon] Failed to start:', (err as Error).message);
    process.exit(1);
  }
}

async function runProductConnect(options: ProductConnectOptions): Promise<void> {
  if (!options.apiKey) {
    program.outputHelp();
    process.exit(2);
  }

  const apiKey = options.apiKey.trim();
  const tokenOptions = apiKey.startsWith('sk_machine_')
    ? { machineToken: apiKey }
    : { connectToken: apiKey };

  const paths = daemonPaths();
  const setup = readSetup(paths);
  if (process.env.AURA_STANDALONE === '1' && !setup) {
    throw new Error('Aura is installed but Setup is missing. Run `aura setup --name <computer-name> --server-url <url>` first.');
  }
  if (process.env.AURA_STANDALONE === '1') {
    await launchManagedDaemon({
      serverUrl: options.serverUrl || setup?.serverUrl || process.env.AURA_SERVER_URL || 'http://localhost:8000',
      ...tokenOptions,
    });
    return;
  }
  await runStart({
    server: options.serverUrl || setup?.serverUrl || 'http://localhost:8000',
    ws: 'auto',
    proxyPort: '0',
    pidFile: paths.pidPath,
    config: paths.credentialPath,
    logFile: paths.logPath,
    workspace: paths.workspaceRoot,
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

program
  .command('setup')
  .description('Initialize Aura locally (name, machine identity, and configuration)')
  .requiredOption('--name <name>', 'Computer name')
  .option('--server-url <url>', 'SmallKhoj server URL', process.env.AURA_SERVER_URL || 'http://localhost:8000')
  .option('--mode <mode>', 'Compatibility mode (managed|legacy)', 'managed')
  .option('--reset', 'Generate a new machine identity (for VM clones or an explicit reset)')
  .action((options: SetupOptions) => {
    try {
      const result = runSetup(options);
      console.log(`[Aura] Setup complete for ${result.config.name}`);
      console.log(`Machine ID: ${result.config.machineId}`);
      console.log(`Config: ${result.paths.configPath}`);
      console.log(`Mode: ${result.config.mode}`);
      if (result.reset) console.log('Identity regenerated by explicit reset.');
    } catch (error) {
      console.error('[Aura] Setup failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('restart')
  .description('Gracefully restart the installed Aura daemon using its saved machine credential')
  .action(async () => {
    try {
      await runRestart();
    } catch (error) {
      console.error('[Aura] Restart failed:', (error as Error).message);
      process.exitCode = 1;
    }
  });

// ── start ────────────────────────────────────────────────────

program
  .command('start')
  .description('Start the daemon')
  .option('--foreground', 'Run in foreground (no daemonization)')
  .option('-c, --config <path>', 'Path to credential JSON')
  .option('-p, --proxy-port <port>', 'HTTP proxy port', '0')
  .option('-s, --server <url>', 'Slock server URL', process.env.AURA_SERVER_URL)
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
  .option('-s, --server <url>', 'SmallKhoj server URL', process.env.AURA_SERVER_URL || 'http://localhost:8000')
  .option('-w, --ws <url>', 'WebSocket URL (auto|none|ws://...)', 'auto')
  .option('-p, --proxy-port <port>', 'HTTP proxy port', '0')
  .option('--pid-file <path>', 'PID file path', daemonPaths().pidPath)
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
  .option('--pid-file <path>', 'PID file path', daemonPaths().pidPath)
  .option('--json', 'Print machine-readable implementation and path metadata')
  .action((options) => {
    const running = isDaemonRunning(options.pidFile);
    const payload = buildStatusPayload();
    // Respect an explicitly injected PID file in tests and legacy scripts.
    payload.running = running;
    if (options.json) {
      console.log(JSON.stringify(payload));

      // ``--json`` is a machine-readable contract.  Do not append the
      // human-oriented status line below to stdout, otherwise consumers cannot
      // parse the command output as one JSON document.  Preserve the existing
      // exit-code semantics so shell scripts can still distinguish a stopped
      // daemon (1) from a running one (0).
      process.exitCode = running ? 0 : 1;
      return;
    }
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

program
  .command('doctor')
  .description('Run read-only Aura installation, runtime, and connection diagnostics')
  .option('--json', 'Print machine-readable diagnostics')
  .action((options) => {
    process.exitCode = printDoctor(Boolean(options.json));
  });

program
  .command('rollback')
  .description('Switch to an already-installed Aura release without changing Setup or credentials')
  .requiredOption('--target-version <version>', 'Installed Aura release version to activate')
  .action((options: RollbackOptions) => runRollback(options));

// ── stop ─────────────────────────────────────────────────────

program
  .command('stop')
  .description('Stop a running daemon')
  .option('--pid-file <path>', 'PID file path', daemonPaths().pidPath)
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
