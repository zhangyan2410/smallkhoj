/**
 * DaemonCore — main orchestrator.
 * Mirrors opencan-daemon/internal/daemon/daemon.go.
 *
 * Responsibilities:
 * - Manage lifecycle of all subsystems (proxy, WS, MCP, sessions)
 * - PID file locking
 * - Signal handling
 * - Log ring buffer
 * - Idle timeout
 */

import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { arch, homedir, hostname, platform, release } from 'os';
import type { Credential, DaemonConfig } from '../types.js';
import { AgentProxy, generateProxyToken } from '../proxy/agent-proxy.js';
import { WebSocketManager } from '../websocket.js';
import { MCPBridge } from '../mcp-bridge.js';
import { ClientHandler } from './client-handler.js';
import { SessionManager } from './session-manager.js';
import { type SlockWrapperResult, writeSlockWrapper } from '../runtime/slock-wrapper.js';
import { ClaudeRuntimeDriver } from '../runtime/claude-runtime.js';
import { importSlockRuntime } from '../runtime/import-slock-runtime.js';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface RuntimeIncomingMessage {
  eventType?: string;
  eventSeq?: string;
  target?: string;
  channelId?: string;
  messageId?: string;
  taskId?: string;
  taskNumber?: string;
  status?: string;
  title?: string;
  timestamp?: string;
  sender?: string;
  actor?: string;
  senderType?: string;
  content: string;
}

export interface DaemonControlCommand {
  type: 'start_runtime' | 'stop_runtime' | 'restart_runtime';
  agentId: string;
  workspaceId?: string;
  config?: {
    runtime?: string;
    runtimeModel?: string;
    runtimeCommand?: string;
    runtimeCommandArgs?: string[];
    workspacePath?: string;
    workspaceId?: string;
    backend?: string;
  };
}

interface RuntimeRecord {
  agentId: string;
  workspaceId?: string;
  runtime: string;
  credential: Credential;
  proxyToken: string;
  wrapper: SlockWrapperResult;
  driver: ClaudeRuntimeDriver;
  workspacePath: string;
  status: 'running' | 'stopped' | 'exited';
  runtimeCommand?: string;
  runtimeCommandArgs?: string[];
  runtimeModel?: string;
  sessionId: string | null;
  restartAttempts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stallTimer: ReturnType<typeof setInterval> | null;
  lastProgressAt: number;
}

export class DaemonCore extends EventEmitter {
  private config: DaemonConfig;
  private credential: Credential | null = null;
  private proxy: AgentProxy;
  private wsManager: WebSocketManager | null = null;
  private mcpBridge: MCPBridge | null = null;
  private runtimes = new Map<string, RuntimeRecord>();
  private clientHandler: ClientHandler;
  private sessionManager = new SessionManager();
  private logBuffer: LogEntry[] = [];
  private logCapacity = 2000;
  private isRunning = false;
  private proxyToken: string | null = null;
  private runtimeSessionIds = new Map<string, string>();
  private daemonHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wrapper: SlockWrapperResult | null = null;
  private stopping = false;
  private daemonRegistrationEnabled = false;
  private daemonId: string = randomUUID();
  private machineId: string | null = null;

  constructor(config: DaemonConfig) {
    super();
    this.config = config;
    this.proxy = new AgentProxy();
    this.clientHandler = new ClientHandler(this);
    this.proxy.setDaemonRpcHandler((message) => this.clientHandler.handleMessage(message as never));

    // Forward proxy events
    this.proxy.on('freshness_hold', (data) => this.emit('freshness_hold', data));
    this.proxy.on('message_received', (data) => {
      this.deliverRuntimeMessage(data, 'proxy');
    });
    this.proxy.on('event_received', (data) => {
      if (!isRecord(data)) return;
      const eventType = firstString(data.type, data.eventType) ?? '';
      // Only deliver task/thread events and message events to runtime; skip heartbeats/member updates.
      if (eventType === 'message_received') return; // already handled above
      if (!isTaskEventType(eventType) && !isThreadEventType(eventType)) return;
      this.deliverRuntimeMessage(data, 'proxy');
    });
  }

  // ── Getters ─────────────────────────────────────────────────

  getConfig(): DaemonConfig { return this.config; }
  getCredential(): Credential | null { return this.credential; }
  getProxy(): AgentProxy { return this.proxy; }
  getProxyToken(): string | null { return this.proxyToken; }
  getSessionManager(): SessionManager { return this.sessionManager; }
  getLogBuffer(): LogEntry[] { return [...this.logBuffer]; }

  deliverRuntimeMessage(input: unknown, source = 'daemon'): boolean {
    const controlCommand = parseDaemonControlCommand(input);
    if (controlCommand) {
      void this.handleControlCommand(controlCommand);
      return true;
    }

    const message = normalizeRuntimeIncomingMessage(input);
    if (!message) {
      this.log(`Runtime delivery skipped unrecognized ${source} message`, 'debug');
      return false;
    }

    const agentId = this.resolveRuntimeAgentId(input, message);
    const runtime = agentId ? this.runtimes.get(agentId) : this.onlyRuntime();
    if (!runtime) {
      this.log(
        `Runtime delivery skipped because target runtime is not running: source=${source} agent=${agentId ?? 'unknown'}`,
        'debug',
      );
      return false;
    }

    const delivered = runtime.driver.sendUserMessage(formatRuntimeIncomingMessage(message));
    this.log(
      `Runtime message ${delivered ? 'delivered' : 'queued'} from ${source}: agent=${runtime.agentId} target=${message.target ?? 'unknown'}`,
      delivered ? 'info' : 'debug',
    );
    this.emit('runtime_delivery', { source, delivered, agentId: runtime.agentId, message });
    return delivered;
  }

  getRuntimeForAgent(agentId: string): ClaudeRuntimeDriver | undefined {
    return this.runtimes.get(agentId)?.driver;
  }

  listActiveRuntimes(): Array<{ agentId: string; pid?: number; sessionId?: string; busy: boolean }> {
    return Array.from(this.runtimes.values()).map((runtime) => ({
      agentId: runtime.agentId,
      pid: runtime.driver.pid,
      sessionId: runtime.sessionId ?? undefined,
      busy: runtime.driver.busy,
    }));
  }

  private onlyRuntime(): RuntimeRecord | undefined {
    return this.runtimes.size === 1 ? Array.from(this.runtimes.values())[0] : undefined;
  }

  private resolveRuntimeAgentId(input: unknown, message?: RuntimeIncomingMessage): string | undefined {
    const raw = findAgentId(input);
    if (raw) return raw;
    if (message?.actor && this.runtimes.has(message.actor)) return message.actor;
    const credentialAgentId = this.credential?.agentId;
    if (credentialAgentId && this.runtimes.has(credentialAgentId)) return credentialAgentId;
    return this.onlyRuntime()?.agentId;
  }

  // ── Start ──────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[Daemon] Already running');
      return;
    }

    console.log('[Daemon] Starting aaa-daemon v0.2.0...');
    this.log('Starting aaa-daemon v0.2.0', 'info');
    this.stopping = false;

    // 1. Load credential
    this.credential = await this.loadCredential();
    if (!this.credential) {
      throw new Error('Failed to load credential');
    }
    this.log(`Credential loaded for agent ${this.credential.agentId}`, 'info');

    // 2. Write PID file
    this.writePidFile();

    // 3. Start HTTP proxy
    await this.proxy.start(this.config.proxyPort);
    this.log(`Proxy listening on ${this.proxy.getProxyUrl()}`, 'info');

    // 4. Register a default proxy token for legacy single-agent daemon starts.
    if (this.credential.agentId) {
      this.proxyToken = generateProxyToken();
      this.proxy.register({
        token: this.proxyToken,
        credential: this.credential,
        activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
      });
      this.log(`Proxy token registered: ${this.proxyToken.slice(0, 12)}...`, 'info');

      this.wrapper = writeSlockWrapper({
        workspacePath: this.config.workspacePath ?? process.cwd(),
        proxyUrl: this.proxy.getProxyUrl(),
        proxyToken: this.proxyToken,
        credential: this.credential,
        activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
      });
      this.log(`slock wrapper generated in ${this.wrapper.wrapperDir}`, 'info');
    }
    this.daemonRegistrationEnabled = this.shouldRegisterDaemonLifecycle();
    if (this.daemonRegistrationEnabled) {
      await this.registerDaemonLifecycle('register');
      this.startDaemonHeartbeat();
    }

    if (this.config.runtime === 'claude_code' && this.credential.agentId) {
      this.startRuntimeForAgent(this.credential.agentId, {
        runtime: 'claude_code',
        runtimeCommand: this.config.runtimeCommand,
        runtimeCommandArgs: this.config.runtimeCommandArgs,
        runtimeModel: this.config.runtimeModel,
        workspacePath: this.config.workspacePath,
      });
    }

    // 5. Start WebSocket
    this.wsManager = new WebSocketManager(this.credential);
    this.wsManager.on('event', (event) => {
      this.emit('daemon_event', event);
      this.log(`WS event: ${event.type}`, 'debug');
      if (event.type === 'connected') {
        this.stopInboxPolling();
      }
      if (event.type === 'disconnected' && this.credential?.agentId) {
        this.startInboxPolling();
      }
      if (event.type === 'message') {
        if (isRecord(event.message)) {
          this.proxy.recordIncomingMessage(event.message, false);
        }
        this.deliverRuntimeMessage(event.message, 'websocket');
      }
      if (event.type === 'control') {
        void this.handleControlCommand(event.command);
      }
      if (event.type === 'event') {
        if (isRecord(event.event)) {
          this.proxy.recordIncomingEvent(event.event);
        }
      }
    });
    this.wsManager.connect();

    // 5b. Inbox polling fallback when no WS
    if ((this.config.wsUrl === 'none' || !this.config.wsUrl) && this.credential.agentId) {
      this.startInboxPolling();
    }

    // 6. Start MCP bridge (if in foreground / CLI mode)
    // Only in --mcp mode
    if (process.env.AAA_DAEMON_MCP === '1') {
      this.mcpBridge = new MCPBridge();
      await this.mcpBridge.start();
      this.log('MCP bridge started', 'info');
    }

    this.isRunning = true;
    console.log(`[Daemon] All modules started. Proxy: ${this.proxy.getProxyUrl()}`);
    this.log('All modules started', 'info');

    // Setup signal handlers
    this.setupSignalHandlers();

    // Emit ready
    this.emit('ready', { proxyUrl: this.proxy.getProxyUrl(), proxyToken: this.proxyToken });
  }

  // ── Stop ───────────────────────────────────────────────────

  stop(): void {
    if (!this.isRunning) return;

    console.log('[Daemon] Shutting down...');
    this.log('Shutting down', 'info');
    this.stopping = true;
    this.isRunning = false;

    this.stopRuntimeStallWatchdog();
    this.stopDaemonHeartbeat();
    this.stopInboxPolling();
    this.wsManager?.disconnect();
    for (const agentId of Array.from(this.runtimes.keys())) {
      this.stopRuntimeForAgent(agentId);
    }
    void this.mcpBridge?.stop();
    this.proxy.stop();
    this.removePidFile();

    console.log('[Daemon] Stopped');
    this.log('Stopped', 'info');

    process.exit(0);
  }

  // ── Credential ─────────────────────────────────────────────

  private async loadCredential(): Promise<Credential | null> {
    if (this.config.importSlockRuntime) {
      const imported = importSlockRuntime(this.config.importSlockRuntime);
      this.log(`Imported Slock runtime credentials from ${imported.source}`, 'info');
      return imported.credential;
    }

    if (process.env.SLOCK_CONNECT_TOKEN) {
      return this.connectMachineCredential(process.env.SLOCK_CONNECT_TOKEN);
    }

    const credPath = this.config.credentialPath;

    if (existsSync(credPath)) {
      try {
        const raw = readFileSync(credPath, 'utf-8');
        const data = JSON.parse(raw);
        return {
          agentId: data.agent_id || data.agentId || this.config.agentId,
          serverId: data.server_id || data.serverId || 'unknown',
          token: data.token || data.apiKey || '',
          serverUrl: data.server_url || data.serverUrl || this.config.serverUrl,
          wsUrl: data.ws_url || data.wsUrl || this.config.wsUrl,
        };
      } catch (err) {
        console.error('[Daemon] Failed to load credential:', err);
      }
    }

    // Fallback: use env / config values for prototype
    return {
      agentId: this.config.agentId || process.env.SLOCK_AGENT_ID || 'prototype-agent',
      serverId: process.env.SLOCK_SERVER_ID || 'prototype',
      token: process.env.SLOCK_AGENT_TOKEN || process.env.ANTHROPIC_AUTH_TOKEN || 'prototype-token',
      serverUrl: this.config.serverUrl,
      wsUrl: this.config.wsUrl,
    };
  }

  private machineIdPath(): string {
    return process.env.AAA_DAEMON_MACHINE_ID_FILE
      || process.env.SLOCK_MACHINE_ID_FILE
      || join(homedir(), '.slock', 'aaa-daemon', 'machine-id');
  }

  private loadMachineId(): string {
    if (this.machineId) return this.machineId;
    const path = this.machineIdPath();
    if (existsSync(path)) {
      const existing = readFileSync(path, 'utf-8').trim();
      if (existing) {
        this.machineId = existing;
        return existing;
      }
    }
    const next = randomUUID();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${next}\n`, 'utf-8');
    this.machineId = next;
    return next;
  }

  private async connectMachineCredential(connectToken: string): Promise<Credential> {
    const serverUrl = this.config.serverUrl;
    const machineId = this.loadMachineId();
    const response = await fetch(new URL('/internal/agent-api/daemon/connect', serverUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${connectToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        daemonId: this.daemonId,
        machineId,
        name: hostname(),
        os: `${platform()} ${release()} ${arch()}`,
        daemonVersion: '0.2.0',
        status: 'online',
        detectedRuntimes: [
          {
            type: this.config.runtime ?? 'daemon',
            status: this.config.runtime === 'claude_code' ? 'available' : 'idle',
            command: this.config.runtimeCommand,
          },
        ],
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Daemon connect failed: ${response.status} ${text.slice(0, 200)}`);
    }
    const data = await response.json() as {
      daemonId?: string;
      machineToken?: string;
      computer?: { serverId?: string };
    };
    if (!data.machineToken) {
      throw new Error('Daemon connect did not return a machine token');
    }
    if (data.daemonId) this.daemonId = data.daemonId;
    return {
      agentId: this.config.agentId || process.env.SLOCK_AGENT_ID || '',
      serverId: data.computer?.serverId || process.env.SLOCK_SERVER_ID || 'unknown',
      token: data.machineToken,
      serverUrl,
      wsUrl: this.config.wsUrl,
    };
  }

  // ── PID file ───────────────────────────────────────────────

  private writePidFile(): void {
    const pidFile = this.config.pidFile || './aaa-daemon.pid';
    try {
      writeFileSync(pidFile, String(process.pid));
      this.log(`PID ${process.pid} written to ${pidFile}`, 'debug');
    } catch (err) {
      console.warn('[Daemon] Failed to write PID file:', (err as Error).message);
    }
  }

  private removePidFile(): void {
    const pidFile = this.config.pidFile || './aaa-daemon.pid';
    try {
      if (existsSync(pidFile)) unlinkSync(pidFile);
    } catch {
      // ignore
    }
  }

  // ── Claude runtime lifecycle ──────────────────────────────

  startRuntimeForAgent(agentId: string, runtimeConfig: DaemonControlCommand['config'] = {}): void {
    if (!this.credential) {
      throw new Error('Cannot start Claude runtime before credential is ready');
    }
    if (this.runtimes.has(agentId)) {
      this.log(`Runtime already running for agent ${agentId}`, 'debug');
      return;
    }
    if (runtimeConfig.runtime && runtimeConfig.runtime !== 'claude_code') {
      this.log(`Unsupported runtime ${runtimeConfig.runtime} for agent ${agentId}`, 'warn');
      return;
    }

    const workspacePath = runtimeConfig.workspacePath
      ?? this.defaultRuntimeWorkspacePath(agentId);
    const credential: Credential = {
      ...this.credential,
      agentId,
    };
    const proxyToken = generateProxyToken();
    this.proxy.register({
      token: proxyToken,
      credential,
      activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
    });
    const wrapper = writeSlockWrapper({
      workspacePath,
      proxyUrl: this.proxy.getProxyUrl(),
      proxyToken,
      credential,
      activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
    });
    const resumeSessionId = this.runtimeSessionIds.get(agentId) ?? this.config.runtimeResumeSessionId;
    const driver = new ClaudeRuntimeDriver({
      credential,
      workspacePath,
      wrapperDir: wrapper.wrapperDir,
      slockHome: wrapper.slockHome,
      launchId: wrapper.launchId,
      resumeSessionId: resumeSessionId ?? undefined,
      model: runtimeConfig.runtimeModel ?? this.config.runtimeModel,
      command: runtimeConfig.runtimeCommand ?? this.config.runtimeCommand,
      commandArgs: runtimeConfig.runtimeCommandArgs ?? this.config.runtimeCommandArgs,
    });
    const runtime: RuntimeRecord = {
      agentId,
      workspaceId: runtimeConfig.workspaceId,
      runtime: runtimeConfig.runtime ?? 'claude_code',
      credential,
      proxyToken,
      wrapper,
      driver,
      workspacePath,
      status: 'running',
      runtimeCommand: runtimeConfig.runtimeCommand ?? this.config.runtimeCommand,
      runtimeCommandArgs: runtimeConfig.runtimeCommandArgs ?? this.config.runtimeCommandArgs,
      runtimeModel: runtimeConfig.runtimeModel ?? this.config.runtimeModel,
      sessionId: resumeSessionId ?? null,
      restartAttempts: 0,
      restartTimer: null,
      stallTimer: null,
      lastProgressAt: Date.now(),
    };
    this.runtimes.set(agentId, runtime);
    this.startRuntimeStallWatchdog(runtime);

    driver.on('line', (event) => {
      this.markRuntimeProgress(runtime);
      this.log(`Claude runtime ${agentId} ${event.stream}: ${event.line}`, 'debug');
      if (event.stream === 'stderr') {
        console.error(`[Daemon] Claude runtime ${agentId} stderr: ${event.line}`);
      }
      this.emit('runtime_line', { ...event, agentId });
    });
    driver.on('stream_event', (event) => {
      this.markRuntimeProgress(runtime);
      this.emitRuntimeTrace({
        type: 'stream_event',
        agentId,
        eventType: typeof event.type === 'string' ? event.type : undefined,
        subtype: typeof event.subtype === 'string' ? event.subtype : undefined,
        sessionId: driver.sessionId,
      });
    });
    driver.on('session', ({ sessionId }: { sessionId: string }) => {
      this.markRuntimeProgress(runtime);
      runtime.sessionId = sessionId;
      this.runtimeSessionIds.set(agentId, sessionId);
      const now = Date.now();
      this.sessionManager.upsert({
        sessionId,
        agentId,
        status: 'active',
        cwd: workspacePath,
        command: runtime.runtimeCommand ?? 'claude',
        createdAt: now,
        updatedAt: now,
      });
      this.emitRuntimeTrace({ type: 'session', agentId, sessionId });
      this.emit('runtime_session', { agentId, sessionId });
      void this.registerDaemonLifecycle('heartbeat');
    });
    driver.on('message_sent', (payload) => {
      this.markRuntimeProgress(runtime);
      this.emitRuntimeTrace({
        type: 'message_sent',
        agentId,
        sessionId: driver.sessionId,
        hasSessionId: isRecord(payload) && typeof payload.session_id === 'string',
      });
    });
    driver.on('exit', (event) => {
      this.log(`Claude runtime ${agentId} exited: code=${event.code} signal=${event.signal}`, event.intentional ? 'info' : 'warn');
      console.error(`[Daemon] Claude runtime ${agentId} exited: code=${event.code} signal=${event.signal}`);
      if (event.sessionId) {
        this.sessionManager.update(event.sessionId, { status: 'dead' });
      }
      runtime.status = event.intentional ? 'stopped' : 'exited';
      this.emit('runtime_exit', { ...event, agentId });
      this.emitRuntimeTrace({ type: 'exit', agentId, ...event });
      void this.registerDaemonLifecycle('heartbeat');

      if (this.runtimes.get(agentId) === runtime) {
        this.runtimes.delete(agentId);
      }
      this.stopRuntimeStallWatchdog(runtime);
      this.proxy.unregister(proxyToken);
      if (!event.intentional) {
        this.scheduleRuntimeRestart(runtime, event.sessionId);
      }
    });
    driver.on('error', (err) => {
      this.markRuntimeProgress(runtime);
      this.log(`Claude runtime ${agentId} error: ${(err as Error).message}`, 'error');
      console.error(`[Daemon] Claude runtime ${agentId} error:`, (err as Error).message);
      this.emit('runtime_error', err);
      this.emitRuntimeTrace({ type: 'error', agentId, message: (err as Error).message });
    });

    driver.start();
    this.log(`Claude runtime started for agent ${agentId}: pid=${driver.pid ?? 'unknown'}`, 'info');
    console.error(`[Daemon] Claude runtime started for agent ${agentId}: pid=${driver.pid ?? 'unknown'}`);
    this.emitRuntimeTrace({
      type: 'start',
      agentId,
      pid: driver.pid,
      resumeSessionId: resumeSessionId ?? undefined,
    });
    void this.registerDaemonLifecycle('heartbeat');
  }

  stopRuntimeForAgent(agentId: string): void {
    const runtime = this.runtimes.get(agentId);
    if (!runtime) return;
    if (runtime.restartTimer) {
      clearTimeout(runtime.restartTimer);
      runtime.restartTimer = null;
    }
    runtime.status = 'stopped';
    this.stopRuntimeStallWatchdog(runtime);
    runtime.driver.stop();
    void this.registerDaemonLifecycle('heartbeat');
    this.runtimes.delete(agentId);
    this.proxy.unregister(runtime.proxyToken);
  }

  private defaultRuntimeWorkspacePath(agentId: string): string {
    const basePath = this.config.workspacePath ?? process.cwd();
    if (this.credential?.agentId === agentId && this.runtimes.size === 0) {
      return basePath;
    }
    return join(basePath, '.slock-runtimes', agentId);
  }

  async handleControlCommand(command: DaemonControlCommand): Promise<void> {
    if (!command.agentId) {
      this.log(`Ignoring control command without agentId: ${command.type}`, 'warn');
      return;
    }
    this.log(`Handling control command ${command.type} for agent ${command.agentId}`, 'info');
    if (command.type === 'start_runtime') {
      this.startRuntimeForAgent(command.agentId, command.config);
      return;
    }
    if (command.type === 'stop_runtime') {
      this.stopRuntimeForAgent(command.agentId);
      return;
    }
    if (command.type === 'restart_runtime') {
      this.stopRuntimeForAgent(command.agentId);
      this.startRuntimeForAgent(command.agentId, command.config);
    }
  }

  private startRuntimeStallWatchdog(runtime: RuntimeRecord): void {
    this.stopRuntimeStallWatchdog(runtime);
    const timeoutMs = this.config.runtimeStallTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return;

    const intervalMs = Math.max(250, Math.min(timeoutMs, 5_000));
    runtime.stallTimer = setInterval(() => {
      if (this.stopping || this.runtimes.get(runtime.agentId) !== runtime || !runtime.driver.busy) {
        return;
      }
      const idleForMs = Date.now() - runtime.lastProgressAt;
      if (idleForMs < timeoutMs) return;

      this.log(`Claude runtime ${runtime.agentId} stalled for ${idleForMs}ms; terminating`, 'warn');
      this.emitRuntimeTrace({
        type: 'stall',
        agentId: runtime.agentId,
        idleForMs,
        timeoutMs,
        sessionId: runtime.driver.sessionId,
      });
      runtime.driver.killUnresponsive();
    }, intervalMs);
  }

  private stopRuntimeStallWatchdog(runtime?: RuntimeRecord): void {
    if (!runtime) {
      for (const item of this.runtimes.values()) this.stopRuntimeStallWatchdog(item);
      return;
    }
    if (!runtime.stallTimer) return;
    clearInterval(runtime.stallTimer);
    runtime.stallTimer = null;
  }

  private startDaemonHeartbeat(): void {
    this.stopDaemonHeartbeat();
    this.daemonHeartbeatTimer = setInterval(() => {
      void this.registerDaemonLifecycle('heartbeat');
    }, 15_000);
  }

  private stopDaemonHeartbeat(): void {
    if (!this.daemonHeartbeatTimer) return;
    clearInterval(this.daemonHeartbeatTimer);
    this.daemonHeartbeatTimer = null;
  }

  // ── Inbox polling fallback (no WS) ─────────────────────────

  private inboxPollTimer: ReturnType<typeof setInterval> | null = null;

  private startInboxPolling(): void {
    this.stopInboxPolling();
    const intervalMs = 3000;
    this.log(`Inbox polling started (no WS, interval=${intervalMs}ms)`, 'info');
    this.inboxPollTimer = setInterval(() => {
      void this.pollInbox();
    }, intervalMs);
    setTimeout(() => void this.pollInbox(), 500);
  }

  private stopInboxPolling(): void {
    if (this.inboxPollTimer) {
      clearInterval(this.inboxPollTimer);
      this.inboxPollTimer = null;
    }
  }

  private async pollInbox(): Promise<void> {
    if (this.stopping) return;
    const credential = this.credential;
    if (!credential) return;
    try {
      const serverUrl = credential.serverUrl || this.config.serverUrl;
      // Use since=latest so backend manages the cursor via member.config
      const url = new URL('/internal/agent-api/events?since=latest', serverUrl);
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${credential.token}`,
          'X-Agent-Id': credential.agentId,
        },
      });
      if (!res.ok) return;
      const text = await res.text();
      const data = JSON.parse(text) as { count?: number; eventLogCursor?: string; events?: unknown[] };
      if (data.count && data.count > 0) {
        this.log(`Inbox poll got ${data.count} events`, 'debug');
      }
      for (const event of data.events ?? []) {
        if (parseDaemonControlCommand(event)) {
          this.deliverRuntimeMessage(event, 'polling-control');
        }
      }
      // Feed through proxy's consumeResponse to trigger event buffering + emit
      this.proxy.consumeResponseExternal('/internal/agent-api/events', serverUrl, text);
    } catch (err) {
      this.log(`Inbox poll error: ${err}`, 'warn');
    }
  }

  private shouldRegisterDaemonLifecycle(): boolean {
    if (this.config.daemonRegister) return true;
    const override = process.env.AAA_DAEMON_REGISTER ?? process.env.SLOCK_DAEMON_REGISTER;
    if (override === '1' || override === 'true') return true;
    if (override === '0' || override === 'false') return false;
    return false;
  }

  private async registerDaemonLifecycle(kind: 'register' | 'heartbeat'): Promise<void> {
    if (!this.credential || !this.daemonRegistrationEnabled) return;
    const serverUrl = this.credential.serverUrl || this.config.serverUrl;
    const endpoint = kind === 'register' ? '/internal/agent-api/daemon/register' : '/internal/agent-api/daemon/heartbeat';
    const runtimeCommand = this.config.runtimeCommand ?? (this.config.runtime === 'claude_code' ? 'claude' : undefined);
    const workspaces = Array.from(this.runtimes.values()).map((runtime) => ({
      agentId: runtime.agentId,
      workspaceId: runtime.workspaceId,
      runtime: runtime.runtime,
      runtimeCommand: runtime.runtimeCommand ?? runtimeCommand,
      runtimeModel: runtime.runtimeModel ?? this.config.runtimeModel,
      status: runtime.status,
      sessionId: runtime.sessionId,
      cwd: runtime.workspacePath,
      pid: runtime.driver.pid,
      backend: this.config.runtime === 'claude_code' ? 'Claude' : undefined,
    }));
    const body = {
      daemonId: this.daemonId,
      name: process.env.SLOCK_CONNECT_TOKEN ? undefined : hostname(),
      os: `${platform()} ${release()} ${arch()}`,
      daemonVersion: '0.2.0',
      status: 'online',
      detectedRuntimes: [
        {
          type: this.config.runtime ?? 'daemon',
          status: this.config.runtime === 'claude_code' ? 'available' : 'idle',
          command: runtimeCommand,
        },
      ],
      workspaces,
    };

    try {
      const response = await fetch(new URL(endpoint, serverUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.log(`Daemon ${kind} failed: ${response.status} ${text.slice(0, 200)}`, 'warn');
        return;
      }
      const payload = await response.json().catch(() => null) as { controlCommands?: unknown[] } | null;
      for (const command of payload?.controlCommands ?? []) {
        this.deliverRuntimeMessage(command, `daemon-${kind}`);
      }
      this.log(`Daemon ${kind} synced to ${serverUrl}`, 'debug');
    } catch (err) {
      this.log(`Daemon ${kind} failed: ${(err as Error).message}`, 'warn');
    }
  }

  private markRuntimeProgress(runtime: RuntimeRecord): void {
    runtime.lastProgressAt = Date.now();
  }

  private scheduleRuntimeRestart(runtime: RuntimeRecord, sessionId?: string): void {
    if (this.stopping || this.config.runtime !== 'claude_code' || !this.config.runtimeRestartOnCrash) return;
    if (runtime.restartAttempts >= 1 || runtime.restartTimer) return;

    runtime.restartAttempts += 1;
    const resumeSessionId = sessionId ?? runtime.sessionId ?? this.runtimeSessionIds.get(runtime.agentId) ?? this.config.runtimeResumeSessionId;
    if (resumeSessionId) this.runtimeSessionIds.set(runtime.agentId, resumeSessionId);
    this.log(`Scheduling Claude runtime restart for agent ${runtime.agentId}: resumeSessionId=${resumeSessionId ?? 'none'}`, 'warn');
    this.emitRuntimeTrace({ type: 'restart_scheduled', agentId: runtime.agentId, resumeSessionId });
    runtime.restartTimer = setTimeout(() => {
      runtime.restartTimer = null;
      if (this.stopping || this.config.runtime !== 'claude_code') return;
      try {
        this.startRuntimeForAgent(runtime.agentId, {
          runtime: 'claude_code',
          runtimeCommand: runtime.runtimeCommand,
          runtimeCommandArgs: runtime.runtimeCommandArgs,
          runtimeModel: runtime.runtimeModel,
          workspacePath: runtime.workspacePath,
          workspaceId: runtime.workspaceId,
        });
      } catch (err) {
        this.log(`Claude runtime restart failed for agent ${runtime.agentId}: ${(err as Error).message}`, 'error');
        this.emit('runtime_error', err);
      }
    }, 250);
  }

  private emitRuntimeTrace(event: Record<string, unknown>): void {
    const payload = {
      at: new Date().toISOString(),
      ...event,
    };
    this.log(`Runtime trace: ${JSON.stringify(payload)}`, 'debug');
    this.emit('runtime_trace', payload);
  }

  // ── Signal handling ────────────────────────────────────────

  private setupSignalHandlers(): void {
    process.on('SIGINT', () => {
      console.log('[Daemon] Received SIGINT');
      this.stop();
    });
    process.on('SIGTERM', () => {
      console.log('[Daemon] Received SIGTERM');
      this.stop();
    });
  }

  // ── Log buffer (ring buffer, mirrors opencan's LogRingBuffer) ─

  log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (this.logBuffer.length >= this.logCapacity) {
      this.logBuffer.shift(); // evict oldest
    }
    this.logBuffer.push(entry);
  }
}

export function normalizeRuntimeIncomingMessage(input: unknown): RuntimeIncomingMessage | null {
  const value = normalizeRuntimeEventPayload(unwrapMessagePayload(input));
  if (!isRecord(value)) return null;

  const eventType = firstString(value.type, value.eventType);
  const content = firstString(
    value.content,
    value.text,
    value.body,
    value.message,
  ) ?? summarizeRuntimeEvent(value, eventType);
  if (!content) return null;

  const message: RuntimeIncomingMessage = { content };
  assignIfPresent(message, 'target', firstString(value.target, value.channel, value.channelName));
  assignIfPresent(message, 'messageId', firstString(value.msg, value.messageId, value.message_id, value.id, value.shortId));
  assignIfPresent(message, 'eventSeq', firstString(value.eventSeq, value.eventLogCursor, value.eventCursor));
  assignIfPresent(message, 'channelId', firstString(value.channelId, value.channel_id));
  assignIfPresent(message, 'taskId', firstString(value.taskId, value.task_id));
  assignIfPresent(message, 'taskNumber', firstString(value.taskNumber, value.task_number, value.number));
  assignIfPresent(message, 'status', firstString(value.status, value.taskStatus));
  assignIfPresent(message, 'title', firstString(value.title, value.taskTitle));
  assignIfPresent(message, 'timestamp', firstString(value.time, value.timestamp, value.createdAt));
  assignIfPresent(message, 'sender', firstString(value.sender, value.author, value.user, value.username));
  assignIfPresent(message, 'actor', firstString(value.actor, value.actorId, value.actor_id, value.memberId, value.agentId));
  assignIfPresent(message, 'senderType', firstString(value.senderType, value.sender_type, value.type));
  if (eventType && eventType !== 'message_received') {
    message.eventType = eventType;
  }
  return message;
}

export function formatRuntimeIncomingMessage(message: RuntimeIncomingMessage): string {
  const header = [
    message.eventType ? `event=${message.eventType}` : undefined,
    message.eventSeq ? `eventSeq=${message.eventSeq}` : undefined,
    message.target ? `target=${message.target}` : undefined,
    message.channelId ? `channel=${message.channelId}` : undefined,
    message.messageId ? `msg=${message.messageId}` : undefined,
    message.taskNumber ? `task=#${message.taskNumber}` : undefined,
    !message.taskNumber && message.taskId ? `task=${message.taskId}` : undefined,
    message.status ? `status=${message.status}` : undefined,
    message.timestamp ? `time=${message.timestamp}` : undefined,
    message.sender ? `sender=${message.sender}` : undefined,
    message.actor ? `actor=${message.actor}` : undefined,
    message.senderType ? `type=${message.senderType}` : undefined,
  ].filter(Boolean).join(' ');

  return header ? `${header}\n\n${message.content}` : message.content;
}

export function parseDaemonControlCommand(input: unknown): DaemonControlCommand | null {
  const value = unwrapControlPayload(input);
  if (!isRecord(value)) return null;

  const type = firstString(value.type, value.controlType, value.commandType);
  if (type !== 'start_runtime' && type !== 'stop_runtime' && type !== 'restart_runtime') {
    return null;
  }

  const agentId = firstString(value.agentId, value.agent_id, value.memberId, value.member_id);
  if (!agentId) return null;

  const config = isRecord(value.config) ? value.config : {};
  const command: DaemonControlCommand = { type, agentId };
  assignDefined(command, 'workspaceId', firstString(value.workspaceId, value.workspace_id, config.workspaceId, config.workspace_id));
  const runtimeConfig: NonNullable<DaemonControlCommand['config']> = {};
  assignDefined(runtimeConfig, 'runtime', firstString(config.runtime, value.runtime));
  assignDefined(runtimeConfig, 'runtimeModel', firstString(config.runtimeModel, config.runtime_model, value.runtimeModel, value.runtime_model));
  assignDefined(runtimeConfig, 'runtimeCommand', firstString(config.runtimeCommand, config.runtime_command, value.runtimeCommand, value.runtime_command));
  assignDefined(runtimeConfig, 'workspacePath', firstString(config.workspacePath, config.workspace_path, value.workspacePath, value.cwd));
  assignDefined(runtimeConfig, 'workspaceId', command.workspaceId);
  assignDefined(runtimeConfig, 'backend', firstString(config.backend, value.backend));
  const runtimeCommandArgs = arrayOfStrings(config.runtimeCommandArgs ?? config.runtime_command_args ?? value.runtimeCommandArgs);
  if (runtimeCommandArgs.length > 0) {
    runtimeConfig.runtimeCommandArgs = runtimeCommandArgs;
  }
  if (Object.keys(runtimeConfig).length > 0) {
    command.config = runtimeConfig;
  }
  return command;
}

function unwrapControlPayload(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const type = firstString(input.type, input.eventType);
  if ((type === 'control' || type === 'daemon_control' || type === 'daemon.command') && isRecord(input.command)) {
    return unwrapControlPayload(input.command);
  }
  if (isRecord(input.params)) return unwrapControlPayload(input.params);
  if (isRecord(input.event)) return unwrapControlPayload(input.event);
  return input;
}

function findAgentId(input: unknown): string | undefined {
  const value = unwrapMessagePayload(input);
  if (!isRecord(value)) return undefined;
  return firstString(
    value.agentId,
    value.agent_id,
    value.targetAgentId,
    value.target_agent_id,
    value.memberId,
    value.member_id,
    value.recipientId,
    value.recipient_id,
    isRecord(value.payload) ? value.payload.agentId : undefined,
    isRecord(value.payload) ? value.payload.agent_id : undefined,
  );
}

function arrayOfStrings(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function assignDefined<T extends object, K extends keyof T>(
  target: T,
  key: K,
  value: T[K] | undefined,
): void {
  if (value !== undefined) {
    target[key] = value;
  }
}

function unwrapMessagePayload(input: unknown): unknown {
  if (!isRecord(input)) return input;

  if (isRecord(input.params)) {
    return unwrapMessagePayload(input.params);
  }

  if (isRecord(input.message)) {
    return unwrapMessagePayload(input.message);
  }

  if (isRecord(input.event)) {
    return unwrapMessagePayload(input.event);
  }

  return input;
}

function normalizeRuntimeEventPayload(input: unknown): unknown {
  if (!isRecord(input)) return input;

  const rawType = firstString(input.type, input.eventType);
  if (!rawType) return input;

  if (isMessageEventType(rawType)) {
    if (rawType === 'message_received') return input;
    const payload = isRecord(input.payload) ? input.payload : undefined;
    const nestedMessage = payload && isRecord(payload.message) ? payload.message : undefined;
    if (!nestedMessage) return input;

    const normalized: Record<string, unknown> = {
      ...nestedMessage,
      type: 'message_received',
    };
    assignRawIfMissing(normalized, 'channelId', payload?.channelId ?? input.channelId ?? input.channel_id);
    assignRawIfMissing(normalized, 'target', payload?.target ?? payload?.channel ?? input.target ?? input.channel ?? input.channelName);
    assignRawIfMissing(normalized, 'timestamp', input.timestamp);
    assignRawIfMissing(normalized, 'createdAt', input.createdAt);
    assignRawIfMissing(normalized, 'eventSeq', input.eventSeq ?? input.eventLogCursor ?? input.eventCursor);
    if (normalized.eventSeq === undefined && typeof input.seq === 'number' && typeof nestedMessage.seq === 'number' && input.seq !== nestedMessage.seq) {
      normalized.eventSeq = input.seq;
    }
    return normalized;
  }

  if (isTaskEventType(rawType) && isRecord(input.payload)) {
    const normalized: Record<string, unknown> = {
      ...input.payload,
      type: rawType,
    };
    assignRawIfMissing(normalized, 'eventSeq', input.eventSeq ?? input.eventLogCursor ?? input.eventCursor ?? input.seq);
    assignRawIfMissing(normalized, 'timestamp', input.timestamp);
    assignRawIfMissing(normalized, 'target', input.payload.channel ?? input.payload.target ?? input.channel ?? input.target);
    assignRawIfMissing(normalized, 'actor', input.payload.changedBy ?? input.payload.actor ?? input.payload.actorId ?? input.payload.assigneeId);
    return normalized;
  }

  if (isThreadEventType(rawType) && isRecord(input.payload)) {
    const normalized: Record<string, unknown> = {
      ...input.payload,
      type: rawType,
    };
    assignRawIfMissing(normalized, 'eventSeq', input.eventSeq ?? input.eventLogCursor ?? input.eventCursor ?? input.seq);
    assignRawIfMissing(normalized, 'timestamp', input.timestamp);
    assignRawIfMissing(normalized, 'target', input.payload.target ?? input.target ?? input.channel ?? input.channelName);
    assignRawIfMissing(normalized, 'actor', input.payload.actor ?? input.payload.actorId ?? input.payload.agentId ?? input.payload.targetAgentId);
    return normalized;
  }

  return input;
}

function assignRawIfMissing(target: Record<string, unknown>, key: string, value: unknown): void {
  if (target[key] === undefined && value !== undefined) {
    target[key] = value;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function assignIfPresent<K extends keyof RuntimeIncomingMessage>(
  message: RuntimeIncomingMessage,
  key: K,
  value: RuntimeIncomingMessage[K] | undefined,
): void {
  if (value !== undefined) {
    message[key] = value;
  }
}

function summarizeRuntimeEvent(value: Record<string, unknown>, eventType?: string): string | undefined {
  if (!eventType || eventType === 'message_received') return undefined;

  const title = firstString(value.title, value.taskTitle);
  const status = firstString(value.status, value.taskStatus);
  const reaction = firstString(value.reaction, value.emoji);
  const description = firstString(value.description, value.summary, value.name);
  const fields = [
    title ? `title=${title}` : undefined,
    status ? `status=${status}` : undefined,
    reaction ? `reaction=${reaction}` : undefined,
    description ? `description=${description}` : undefined,
  ].filter(Boolean);

  const details = isRecord(value.details) ? value.details : isRecord(value.payload) ? value.payload : null;
  if (details) {
    for (const [key, raw] of Object.entries(details)) {
      if (fields.length >= 8) break;
      if (raw === null || raw === undefined || typeof raw === 'object') continue;
      fields.push(`${key}=${String(raw)}`);
    }
  }

  return fields.length ? fields.join('\n') : `Received Slock event: ${eventType}`;
}

function isMessageEventType(type: string): boolean {
  return type === 'message'
    || type === 'message_received'
    || type === 'message_created'
    || type.startsWith('message.');
}

function isTaskEventType(type: string): boolean {
  return type.startsWith('task_') || type.startsWith('task.');
}

function isThreadEventType(type: string): boolean {
  return type.startsWith('thread_') || type.startsWith('thread.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
