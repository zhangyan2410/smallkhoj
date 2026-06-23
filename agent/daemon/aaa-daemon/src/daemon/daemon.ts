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
import { ClaudeRuntimeDriver, getContentBlocks } from '../runtime/claude-runtime.js';
import { CodexRuntimeDriver } from '../runtime/codex-runtime.js';
import { CodexAcpRuntimeDriver } from '../runtime/codex-acp-runtime.js';
import type { ManagedRuntimeDriver } from '../runtime/runtime-driver.js';
import { importSlockRuntime } from '../runtime/import-slock-runtime.js';
import {
  chooseRuntimeSessionScope,
  ScopedProviderSessionStore,
  type RuntimeSessionScope,
} from './session-scope.js';
import {
  detectedRuntimesForInventory,
  detectRuntimeProviders,
  resolveRuntimeProviderLaunch,
  type RuntimeProviderInventory,
} from '../runtime/runtime-provider.js';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface RuntimeIncomingMessage {
  traceId?: string;
  eventType?: string;
  eventSeq?: string;
  target?: string;
  channelType?: string;
  channelId?: string;
  rootMessageId?: string;
  peerMemberId?: string;
  messageId?: string;
  taskId?: string;
  taskNumber?: string;
  status?: string;
  title?: string;
  timestamp?: string;
  sender?: string;
  actor?: string;
  senderType?: string;
  assignee?: string;
  assigneeId?: string;
  content: string;
}

export interface RuntimeMemoryContextManifest {
  policy?: string;
  sessionScope?: {
    type?: string;
    id?: string;
    key?: string;
  };
  channelMemories?: RuntimeMemoryContextItem[];
  taskMemories?: RuntimeMemoryContextItem[];
  readMore?: string[] | Record<string, string>;
}

export interface RuntimeMemoryContextItem {
  path?: string;
  title?: string;
  snippet?: string;
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
    runtimeProvider?: string;
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
  driver: ManagedRuntimeDriver;
  workspacePath: string;
  status: 'starting' | 'running' | 'stopped' | 'exited';
  runtimeCommand?: string;
  runtimeCommandArgs?: string[];
  runtimeModel?: string;
  runtimeProvider?: string;
  sessionId: string | null;
  activeSessionScope?: RuntimeSessionScope;
  sessionScopesByKey: Map<string, RuntimeSessionScope>;
  activeTraceId?: string;
  activeTraceStartedAt?: number;
  activeTraceFirstOutputSeen?: boolean;
  restartAttempts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stallTimer: ReturnType<typeof setInterval> | null;
  lastProgressAt: number;
  /** Startup warmup gate: true once a slock tool call has completed successfully */
  ready: boolean;
  /** Timestamp the warmup probe was injected, for timeout / duration reporting */
  warmupStartedAt?: number;
  /** slock tool_use ids emitted during warmup, awaiting their tool_result */
  pendingWarmupResult: Set<string>;
  /** Timer that degrades the runtime to ready if warmup never completes */
  warmupTimer: ReturnType<typeof setTimeout> | null;
  /** Current activity state for the four-state timeline (Working/Thinking/Output/Idle) */
  activityTurnState: 'idle' | 'working' | 'thinking' | 'output';
  /** tool_use ids already reported as Output activity this turn (dedup) */
  recordedToolUseIds: Set<string>;
  /** Ground-truth token usage from the last completed turn (session-jsonl or provider) */
  lastTurnUsage?: {
    source: 'session-jsonl' | 'provider-stream-json';
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
  };
}

type DaemonRuntimeImplementation = 'claude_code' | 'codex' | 'codex_cli';

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
  private scopedProviderSessions = new ScopedProviderSessionStore();
  private daemonHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private wrapper: SlockWrapperResult | null = null;
  private stopping = false;
  private daemonRegistrationEnabled = false;
  private daemonId: string = randomUUID();
  private machineId: string | null = null;
  private runtimeProviderInventory: RuntimeProviderInventory;

  constructor(config: DaemonConfig) {
    super();
    this.config = config;
    this.runtimeProviderInventory = detectRuntimeProviders();
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
      // Only deliver explicitly actionable non-message events to runtime; skip
      // telemetry, status updates, and generic event feed noise.
      if (eventType === 'message_received') return; // already handled above
      if (!isRuntimeActionableEventType(eventType)) return;
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

    // Skip self-echo: if the message actor is the runtime's own agent, the
    // agent sent this message and should not receive it back as a new event.
    // This prevents unnecessary token consumption from self-message echoes.
    if (message.actor && message.actor === runtime.agentId) {
      this.log(
        `Runtime delivery skipped self-echo: agent=${runtime.agentId} msg=${message.messageId ?? 'unknown'}`,
        'debug',
      );
      return false;
    }

    const sessionScope = selectRuntimeSessionScope(message);
    const scopedSession = sessionScope ? this.scopedProviderSessions.lookup(runtime.agentId, sessionScope) : undefined;
    if (sessionScope) {
      runtime.sessionScopesByKey.set(sessionScope.key, sessionScope);
      runtime.activeSessionScope = sessionScope;
    }

    if (message.traceId) {
      runtime.activeTraceId = message.traceId;
      runtime.activeTraceStartedAt = Date.now();
      runtime.activeTraceFirstOutputSeen = false;
      this.proxy.setActiveTrace(runtime.agentId, message.traceId);
      this.emitLatencyTrace(message.traceId, 'daemon.runtime_delivery.attempt', {
        flow: 'message_to_agent_reply',
        source,
        agentId: runtime.agentId,
        target: message.target,
        messageId: message.messageId,
        eventSeq: message.eventSeq,
        sessionScope: sessionScope?.key,
        providerSessionId: scopedSession?.providerSessionId,
      });
    }
    void this.deliverRuntimeMessageToDriver(runtime, message, source, sessionScope, scopedSession?.providerSessionId);
    return true;
  }

  private async deliverRuntimeMessageToDriver(
    runtime: RuntimeRecord,
    message: RuntimeIncomingMessage,
    source: string,
    sessionScope: RuntimeSessionScope | undefined,
    scopedProviderSessionId: string | undefined,
  ): Promise<void> {
    const sendOptions = sessionScope
      ? {
        sessionId: scopedProviderSessionId ?? null,
        sessionScopeKey: sessionScope.key,
      }
      : undefined;
    const deliveryStarted = Date.now();
    const basePrompt = formatRuntimeIncomingMessage(message);
    const manifest = await this.loadRuntimeMemoryContextManifest(runtime, sessionScope, basePrompt);
    const prompt = formatRuntimeIncomingMessageWithMemoryContext(message, manifest);
    const delivered = runtime.driver.sendUserMessage(prompt, sendOptions);
    if (message.traceId) {
      this.emitLatencyTrace(message.traceId, 'daemon.runtime_delivery.sent_or_queued', {
        flow: 'message_to_agent_reply',
        source,
        agentId: runtime.agentId,
        delivered,
        queued: !delivered,
        durationMs: Date.now() - deliveryStarted,
        sessionScope: sessionScope?.key,
      });
    }
    // Working state: a message reached the runtime, reset per-turn dedup sets
    // and report the start of a new turn to the Activity timeline.
    if (delivered) {
      runtime.activityTurnState = 'working';
      runtime.recordedToolUseIds.clear();
      void this.reportRuntimeActivity(runtime, 'runtime_working', 'Working on message', {
        messageId: message.messageId ?? undefined,
        sourceChannel: message.channelId ?? undefined,
        target: message.target ?? undefined,
      });
    }
    this.log(
      `Runtime message ${delivered ? 'delivered' : 'queued'} from ${source}: agent=${runtime.agentId} target=${message.target ?? 'unknown'} scope=${sessionScope?.key ?? 'default'}`,
      delivered ? 'info' : 'debug',
    );
    this.emit('runtime_delivery', { source, delivered, agentId: runtime.agentId, message, sessionScope: sessionScope?.key });
  }

  private async loadRuntimeMemoryContextManifest(
    runtime: RuntimeRecord,
    sessionScope: RuntimeSessionScope | undefined,
    prompt: string,
  ): Promise<RuntimeMemoryContextManifest | null> {
    const request = buildRuntimeMemoryContextRequest(sessionScope, prompt);
    if (!request) return null;

    try {
      const response = await fetch(new URL(
        `/internal/agent/${encodeURIComponent(runtime.agentId)}/memory/context-manifest`,
        this.proxy.getProxyUrl(),
      ), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${runtime.proxyToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.log(
          `Runtime memory context skipped: agent=${runtime.agentId} scope=${sessionScope?.key ?? 'default'} status=${response.status} ${text.slice(0, 160)}`,
          'debug',
        );
        return null;
      }
      const manifest = await response.json().catch(() => null);
      return isRecord(manifest) ? manifest as RuntimeMemoryContextManifest : null;
    } catch (err) {
      this.log(
        `Runtime memory context skipped: agent=${runtime.agentId} scope=${sessionScope?.key ?? 'default'} error=${(err as Error).message}`,
        'debug',
      );
      return null;
    }
  }

  getRuntimeForAgent(agentId: string): ManagedRuntimeDriver | undefined {
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

    if ((this.config.runtime === 'claude_code' || this.config.runtime === 'codex' || this.config.runtime === 'codex_cli' || this.config.runtime === 'codex_acp') && this.credential.agentId) {
      this.startRuntimeForAgent(this.credential.agentId, {
        runtime: this.config.runtime,
        runtimeCommand: this.config.runtimeCommand,
        runtimeCommandArgs: this.config.runtimeCommandArgs,
        runtimeModel: this.config.runtimeModel,
        runtimeProvider: this.config.runtimeProvider,
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
        const traceId = traceIdOf(event.message);
        if (traceId) {
          this.emitLatencyTrace(traceId, 'daemon.websocket.message_received', {
            flow: 'message_to_agent_reply',
            agentId: findAgentId(event.message),
            eventSeq: eventSeqOf(event.message),
          });
        }
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

  async stop(): Promise<void> {
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
    await this.shutdownDaemonLifecycle();
    await this.mcpBridge?.stop();
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
        detectedRuntimes: detectedRuntimesForInventory(this.config, this.runtimeProviderInventory),
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

  // ── Managed runtime lifecycle ─────────────────────────────

  startRuntimeForAgent(agentId: string, runtimeConfig: DaemonControlCommand['config'] = {}): void {
    if (!this.credential) {
      throw new Error('Cannot start runtime before credential is ready');
    }
    if (this.runtimes.has(agentId)) {
      this.log(`Runtime already running for agent ${agentId}`, 'debug');
      return;
    }
    const runtimeType = normalizeDaemonRuntimeType(runtimeConfig.runtime ?? this.config.runtime ?? 'claude_code');
    if (!runtimeType) {
      this.log(`Unsupported runtime ${runtimeConfig.runtime} for agent ${agentId}`, 'warn');
      return;
    }
    const runtimeProvider = runtimeConfig.runtimeProvider ?? this.config.runtimeProvider;
    const providerLaunch = runtimeConfig.runtimeCommand || !runtimeProvider
      ? {}
      : resolveRuntimeProviderLaunch(runtimeProvider, this.runtimeProviderInventory);
    if (providerLaunch.error) {
      this.log(providerLaunch.error, 'warn');
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
    const model = runtimeConfig.runtimeModel ?? providerLaunch.model ?? this.config.runtimeModel;
    const command = runtimeConfig.runtimeCommand ?? providerLaunch.command ?? this.config.runtimeCommand;
    const commandArgs = runtimeConfig.runtimeCommandArgs ?? providerLaunch.commandArgs ?? this.config.runtimeCommandArgs;
    const driver: ManagedRuntimeDriver = runtimeType === 'codex_cli'
      ? new CodexRuntimeDriver({
        credential,
        workspacePath,
        wrapperDir: wrapper.wrapperDir,
        slockHome: wrapper.slockHome,
        launchId: wrapper.launchId,
        model,
        command,
        commandArgs,
        resumeSessionId: resumeSessionId ?? undefined,
      })
      : runtimeType === 'codex'
        ? new CodexAcpRuntimeDriver({
          credential,
          workspacePath,
          wrapperDir: wrapper.wrapperDir,
          slockHome: wrapper.slockHome,
          launchId: wrapper.launchId,
          command,
          commandArgs,
          resumeSessionId: resumeSessionId ?? undefined,
        })
        : new ClaudeRuntimeDriver({
        credential,
        workspacePath,
        wrapperDir: wrapper.wrapperDir,
        slockHome: wrapper.slockHome,
        launchId: wrapper.launchId,
        resumeSessionId: resumeSessionId ?? undefined,
        model,
        command,
        commandArgs,
      });
    const runtime: RuntimeRecord = {
      agentId,
      workspaceId: runtimeConfig.workspaceId,
      runtime: runtimeType,
      credential,
      proxyToken,
      wrapper,
      driver,
      workspacePath,
      status: 'starting',
      runtimeCommand: command,
      runtimeCommandArgs: commandArgs,
      runtimeModel: model,
      runtimeProvider: providerLaunch.runtimeProvider ?? runtimeProvider,
      sessionId: resumeSessionId ?? null,
      sessionScopesByKey: new Map(),
      activeTraceId: undefined,
      activeTraceStartedAt: undefined,
      activeTraceFirstOutputSeen: false,
      restartAttempts: 0,
      restartTimer: null,
      stallTimer: null,
      lastProgressAt: Date.now(),
      ready: false,
      warmupStartedAt: undefined,
      pendingWarmupResult: new Set(),
      warmupTimer: null,
      activityTurnState: 'idle',
      recordedToolUseIds: new Set(),
    };
    this.runtimes.set(agentId, runtime);
    this.startRuntimeStallWatchdog(runtime);

    driver.on('line', (event) => {
      this.markRuntimeProgress(runtime);
      this.log(`${runtimeType} runtime ${agentId} ${event.stream}: ${event.line}`, 'debug');
      if (event.stream === 'stderr') {
        console.error(`[Daemon] ${runtimeType} runtime ${agentId} stderr: ${event.line}`);
      }
      this.emit('runtime_line', { ...event, agentId });
    });
    driver.on('stream_event', (event) => {
      this.markRuntimeProgress(runtime);
      const eventType = typeof event.type === 'string' ? event.type : undefined;

      // ── Warmup gate: detect a successful slock tool call ──
      // The runtime is seeded with a warmup probe at startup. It must call a
      // `slock` tool (via Bash with a `slock` command, or an MCP tool whose
      // name mentions slock) and the tool_result must not be an error. Until
      // that happens the runtime stays in 'starting' status and is not
      // advertised as ready/online.
      if (!runtime.ready) {
        if ((runtime.runtime === 'codex_cli' || runtime.runtime === 'codex') && eventType === 'result') {
          const exitCode = isRecord(event) && typeof event.exitCode === 'number' ? event.exitCode : undefined;
          if (exitCode === undefined || exitCode === 0) {
            this.markRuntimeReady(runtime, runtime.runtime === 'codex' ? 'codex_acp_warmup_complete' : 'codex_warmup_complete');
          }
        }
        if (eventType === 'assistant') {
          for (const block of getContentBlocks(event)) {
            if (block.type !== 'tool_use' || typeof block.id !== 'string') continue;
            const name = typeof block.name === 'string' ? block.name : '';
            const input = isRecord(block.input) ? block.input : {};
            const cmd = typeof input.command === 'string' ? input.command : '';
            if ((name === 'Bash' && /\bslock\b/.test(cmd)) || /slock/i.test(name)) {
              runtime.pendingWarmupResult.add(block.id);
            }
          }
        }
        if (eventType === 'user') {
          for (const block of getContentBlocks(event)) {
            if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
            if (!runtime.pendingWarmupResult.has(block.tool_use_id)) continue;
            runtime.pendingWarmupResult.delete(block.tool_use_id);
            const content = typeof block.content === 'string' ? block.content : '';
            const isError = block.is_error === true
              || /"ok"\s*:\s*false/i.test(content)
              || /\berror\b/i.test(content) && !/"ok"\s*:\s*true/i.test(content);
            if (!isError) {
              this.markRuntimeReady(runtime, 'warmup_slock_ok');
            }
          }
        }
      }

      if (runtime.activeTraceId) {
        if (!runtime.activeTraceFirstOutputSeen) {
          runtime.activeTraceFirstOutputSeen = true;
          this.emitLatencyTrace(runtime.activeTraceId, 'daemon.runtime.first_output', {
            flow: 'message_to_agent_reply',
            agentId,
            runtimeEventType: eventType,
            elapsedMs: runtime.activeTraceStartedAt ? Date.now() - runtime.activeTraceStartedAt : undefined,
          });
        }
        if (eventType === 'result') {
          const resultData = isRecord(event) ? event : undefined;
          const resultUsage = isRecord(resultData?.usage) ? resultData.usage : undefined;
          const modelUsage = isRecord(resultData?.modelUsage) ? resultData.modelUsage : undefined;
          const modelName = modelUsage ? Object.keys(modelUsage).find((k) => k !== 'total') : undefined;
          const modelUsageEntry = modelName && modelUsage && isRecord(modelUsage[modelName]) ? modelUsage[modelName] : undefined;
          const providerCacheRead = typeof resultUsage?.cache_read_input_tokens === 'number' ? resultUsage.cache_read_input_tokens : undefined;
          const modelCacheRead = typeof modelUsageEntry?.cacheReadInputTokens === 'number' ? modelUsageEntry.cacheReadInputTokens : undefined;

          // Ground truth: read the real (billed) usage from the Claude Code
          // session jsonl. Provider-reported numbers via stream-json can be
          // inflated by Anthropic-compat adapters (MiniMax ~2-8x).
          const sessionUsage = runtime.runtime === 'claude_code'
            ? readSessionUsage(runtime.workspacePath, driver.sessionId)
            : undefined;
          const realCacheRead = sessionUsage?.cacheReadInputTokens;
          const realInputTokens = sessionUsage?.inputTokens;
          const realOutputTokens = sessionUsage?.outputTokens;

          // Prefer session-grounded numbers; fall back to provider-reported.
          const cacheRead = realCacheRead ?? providerCacheRead;
          const providerReportedInflated = providerCacheRead !== undefined && realCacheRead !== undefined
            ? providerCacheRead > realCacheRead * 2
            : false;

          // Store on the runtime record so the Idle activity can use real values.
          runtime.lastTurnUsage = sessionUsage
            ? { source: 'session-jsonl', ...sessionUsage }
            : { source: 'provider-stream-json', inputTokens: realInputTokens, outputTokens: realOutputTokens, cacheReadInputTokens: providerCacheRead };

          this.emitLatencyTrace(runtime.activeTraceId, 'daemon.runtime.result', {
            flow: 'message_to_agent_reply',
            agentId,
            elapsedMs: runtime.activeTraceStartedAt ? Date.now() - runtime.activeTraceStartedAt : undefined,
            durationApiMs: typeof resultData?.duration_api_ms === 'number' ? resultData.duration_api_ms : undefined,
            inputTokens: realInputTokens ?? (typeof resultUsage?.input_tokens === 'number' ? resultUsage.input_tokens : undefined),
            outputTokens: realOutputTokens ?? (typeof resultUsage?.output_tokens === 'number' ? resultUsage.output_tokens : undefined),
            cacheReadInputTokens: cacheRead,
            model: typeof modelName === 'string' ? modelName : undefined,
            wallClockMs: runtime.activeTraceStartedAt ? Date.now() - runtime.activeTraceStartedAt : undefined,
            modelUsageCacheReadInputTokens: modelCacheRead,
            usageSource: sessionUsage ? 'session-jsonl' : 'provider-stream-json',
            providerReportedInflated,
          });
        }
      }

      // ── Four-state activity translation (Working/Thinking/Output/Idle) ──
      // Only report after the runtime has finished warming up; warmup itself
      // would otherwise flood the timeline with Thinking/Output entries.
      if (runtime.ready) {
        if (eventType === 'assistant' && runtime.activityTurnState !== 'thinking') {
          runtime.activityTurnState = 'thinking';
          // Extract a short prefix of the model's thinking/reasoning text so
          // the Activity timeline shows what the runtime is reasoning about,
          // not just a bare "thinking" label.
          let thoughtPreview: string | undefined;
          for (const block of getContentBlocks(event)) {
            if (block.type === 'thinking' && typeof block.thinking === 'string') {
              thoughtPreview = block.thinking.slice(0, 200);
              break;
            }
            // Some providers expose reasoning as a text block before tool_use.
            if (block.type === 'text' && typeof block.text === 'string' && !thoughtPreview) {
              thoughtPreview = block.text.slice(0, 200);
            }
          }
          void this.reportRuntimeActivity(runtime, 'runtime_thinking', 'Thinking', {
            sessionId: driver.sessionId ?? undefined,
            thought: thoughtPreview,
          });
        }
        if (eventType === 'assistant') {
          for (const block of getContentBlocks(event)) {
            if (block.type !== 'tool_use' || typeof block.id !== 'string') continue;
            if (runtime.recordedToolUseIds.has(block.id)) continue;
            runtime.recordedToolUseIds.add(block.id);
            runtime.activityTurnState = 'output';
            const name = typeof block.name === 'string' ? block.name : 'tool';
            const input = isRecord(block.input) ? block.input : {};
            const cmd = typeof input.command === 'string' ? input.command : '';
            void this.reportRuntimeActivity(runtime, 'runtime_output', `Ran ${name}`, {
              toolName: name,
              commandPreview: cmd,
            });
          }
        }
        if (eventType === 'result') {
          const resultData = isRecord(event) ? event : undefined;
          runtime.activityTurnState = 'idle';
          runtime.recordedToolUseIds.clear();
          // Use the ground-truth usage (set above in the result trace block).
          const u = runtime.lastTurnUsage;
          void this.reportRuntimeActivity(runtime, 'runtime_idle', 'Idle', {
            durationMs: typeof resultData?.duration_ms === 'number' ? resultData.duration_ms : undefined,
            wallClockMs: runtime.activeTraceStartedAt ? Date.now() - runtime.activeTraceStartedAt : undefined,
            tokens: {
              input: u?.inputTokens,
              output: u?.outputTokens,
              cacheRead: u?.cacheReadInputTokens,
            },
            usageSource: u?.source ?? 'provider-stream-json',
          });
        }
      }

      this.emitRuntimeTrace({
        type: 'stream_event',
        agentId,
        eventType,
        subtype: typeof event.subtype === 'string' ? event.subtype : undefined,
        sessionId: driver.sessionId,
      });
    });
    driver.on('session', ({ sessionId }: { sessionId: string }) => {
      this.markRuntimeProgress(runtime);
      runtime.sessionId = sessionId;
      this.runtimeSessionIds.set(agentId, sessionId);
      const activeSessionScope = runtime.activeSessionScope;
      if (activeSessionScope) {
        this.scopedProviderSessions.remember({
          agentId,
          runtimeWorkspaceId: runtime.workspaceId,
          scope: activeSessionScope,
          providerSessionId: sessionId,
        });
      }
      const now = Date.now();
      this.sessionManager.upsert({
        sessionId,
        agentId,
        status: 'active',
        cwd: workspacePath,
        command: runtime.runtimeCommand ?? (runtime.runtime === 'codex_cli' ? 'codex' : runtime.runtime === 'codex' ? 'npx @zed-industries/codex-acp@0.16.0' : 'claude'),
        createdAt: now,
        updatedAt: now,
      });
      this.emitRuntimeTrace({ type: 'session', agentId, sessionId, sessionScope: activeSessionScope?.key });
      this.emit('runtime_session', { agentId, sessionId, sessionScope: activeSessionScope?.key });
      if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');
    });
    driver.on('message_sent', (payload) => {
      this.markRuntimeProgress(runtime);
      const sessionScopeKey = isRecord(payload) && typeof payload.sessionScopeKey === 'string'
        ? payload.sessionScopeKey
        : undefined;
      if (sessionScopeKey) {
        runtime.activeSessionScope = runtime.sessionScopesByKey.get(sessionScopeKey) ?? runtime.activeSessionScope;
      }
      if (runtime.activeTraceId) {
        this.emitLatencyTrace(runtime.activeTraceId, 'daemon.runtime.stdin_write', {
          flow: 'message_to_agent_reply',
          agentId,
          hasSessionId: isRecord(payload) && typeof payload.session_id === 'string',
          sessionScope: sessionScopeKey,
          elapsedMs: runtime.activeTraceStartedAt ? Date.now() - runtime.activeTraceStartedAt : undefined,
        });
      }
      this.emitRuntimeTrace({
        type: 'message_sent',
        agentId,
        sessionId: driver.sessionId,
        sessionScope: sessionScopeKey,
        hasSessionId: isRecord(payload) && typeof payload.session_id === 'string',
      });
    });
    driver.on('exit', (event) => {
      this.log(`${runtime.runtime} runtime ${agentId} exited: code=${event.code} signal=${event.signal}`, event.intentional ? 'info' : 'warn');
      console.error(`[Daemon] ${runtime.runtime} runtime ${agentId} exited: code=${event.code} signal=${event.signal}`);
      if (event.sessionId) {
        this.sessionManager.update(event.sessionId, { status: 'dead' });
      }
      runtime.status = event.intentional ? 'stopped' : 'exited';
      this.stopWarmupTimer(runtime);
      this.emit('runtime_exit', { ...event, agentId });
      this.emitRuntimeTrace({ type: 'exit', agentId, ...event });
      if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');

      if (this.runtimes.get(agentId) === runtime) {
        this.runtimes.delete(agentId);
      }
      this.stopRuntimeStallWatchdog(runtime);
      this.proxy.unregister(proxyToken);
      if (!event.intentional && runtime.runtime === 'claude_code') {
        this.scheduleRuntimeRestart(runtime, event.sessionId);
      }
    });
    driver.on('error', (err) => {
      this.markRuntimeProgress(runtime);
      this.log(`${runtime.runtime} runtime ${agentId} error: ${(err as Error).message}`, 'error');
      console.error(`[Daemon] ${runtime.runtime} runtime ${agentId} error:`, (err as Error).message);
      this.emit('runtime_error', err);
      this.emitRuntimeTrace({ type: 'error', agentId, message: (err as Error).message });
    });

    driver.start();
    this.log(`${runtime.runtime} runtime started for agent ${agentId}: pid=${driver.pid ?? 'unknown'} (status=starting, awaiting warmup)`, 'info');
    console.error(`[Daemon] ${runtime.runtime} runtime started for agent ${agentId}: pid=${driver.pid ?? 'unknown'}`);
    this.emitRuntimeTrace({
      type: 'start',
      agentId,
      pid: driver.pid,
      resumeSessionId: resumeSessionId ?? undefined,
      status: 'starting',
    });

    // Inject a startup warmup probe. The message is queued inside the driver
    // (pendingUserMessages) and self-drains once the child is writable.
    // The runtime must call a `slock` tool successfully for the daemon to flip
    // the status to 'running'; otherwise the warmup timer degrades it to ready.
    const warmupText = [
      '[event=system.warmup type=system]',
      'This is a startup readiness check, not a user message.',
      'Run `slock server info` once to confirm Slock connectivity and your agent identity,',
      'then stop and wait for real messages. Do not send any chat message during this check.',
    ].join('\n');
    runtime.driver.sendUserMessage(warmupText);
    runtime.warmupStartedAt = Date.now();
    this.startWarmupTimer(runtime);

    if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');
  }

  stopRuntimeForAgent(agentId: string): void {
    const runtime = this.runtimes.get(agentId);
    if (!runtime) return;
    if (runtime.restartTimer) {
      clearTimeout(runtime.restartTimer);
      runtime.restartTimer = null;
    }
    this.stopWarmupTimer(runtime);
    runtime.status = 'stopped';
    this.stopRuntimeStallWatchdog(runtime);
    runtime.driver.stop();
    if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');
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

      this.log(`${runtime.runtime} runtime ${runtime.agentId} stalled for ${idleForMs}ms; terminating`, 'warn');
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
    const configRuntime = normalizeDaemonRuntimeType(this.config.runtime);
    const runtimeCommand = this.config.runtimeCommand
      ?? (configRuntime === 'claude_code'
        ? 'claude'
        : configRuntime === 'codex_cli'
          ? 'codex'
          : configRuntime === 'codex'
            ? 'npx @zed-industries/codex-acp@0.16.0'
            : undefined);
    const workspaces = Array.from(this.runtimes.values()).map((runtime) => ({
      agentId: runtime.agentId,
      workspaceId: runtime.workspaceId,
      runtime: runtime.runtime,
      runtimeCommand: runtime.runtimeProvider ? undefined : runtime.runtimeCommand ?? runtimeCommand,
      runtimeModel: runtime.runtimeProvider ? undefined : runtime.runtimeModel ?? this.config.runtimeModel,
      runtimeProvider: runtime.runtimeProvider,
      status: runtime.status,
      sessionId: runtime.sessionId,
      scopedSessions: this.scopedProviderSessions.snapshot(runtime.agentId).map((item) => ({
        scope: item.scope.key,
        scopeType: item.scope.type,
        providerSessionId: item.providerSessionId,
        status: item.status,
        lastUsedAt: new Date(item.lastUsedAt).toISOString(),
      })),
      cwd: runtime.workspacePath,
      pid: runtime.driver.pid,
    }));
    const body = {
      daemonId: this.daemonId,
      name: process.env.SLOCK_CONNECT_TOKEN ? undefined : hostname(),
      os: `${platform()} ${release()} ${arch()}`,
      daemonVersion: '0.2.0',
      status: 'online',
      detectedRuntimes: detectedRuntimesForInventory(this.config, this.runtimeProviderInventory),
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

  private async shutdownDaemonLifecycle(): Promise<void> {
    if (!this.credential || !this.daemonRegistrationEnabled) return;
    const serverUrl = this.credential.serverUrl || this.config.serverUrl;
    try {
      const response = await fetch(new URL('/internal/agent-api/daemon/shutdown', serverUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credential.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          daemonId: this.daemonId,
          status: 'offline',
        }),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.log(`Daemon shutdown failed: ${response.status} ${text.slice(0, 200)}`, 'warn');
        return;
      }
      this.log(`Daemon shutdown synced to ${serverUrl}`, 'debug');
    } catch (err) {
      this.log(`Daemon shutdown failed: ${(err as Error).message}`, 'warn');
    }
  }

  private markRuntimeProgress(runtime: RuntimeRecord): void {
    runtime.lastProgressAt = Date.now();
  }

  /**
   * Flip a runtime from 'starting' to 'running' once the warmup slock tool call
   * has completed (or the warmup timer degraded it). Idempotent.
   */
  private markRuntimeReady(runtime: RuntimeRecord, reason: string): void {
    if (runtime.ready) return;
    runtime.ready = true;
    runtime.status = 'running';
    runtime.pendingWarmupResult.clear();
    this.stopWarmupTimer(runtime);
    this.emitRuntimeTrace({
      type: 'ready',
      agentId: runtime.agentId,
      reason,
      warmupDurationMs: runtime.warmupStartedAt ? Date.now() - runtime.warmupStartedAt : undefined,
      sessionId: runtime.driver.sessionId,
    });
    this.log(
      `Runtime ${runtime.agentId} ready (reason=${reason}, warmupMs=${runtime.warmupStartedAt ? Date.now() - runtime.warmupStartedAt : 'unknown'})`,
      reason === 'warmup_timeout' ? 'warn' : 'info',
    );
    if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');
  }

  private startWarmupTimer(runtime: RuntimeRecord): void {
    this.stopWarmupTimer(runtime);
    const timeoutMs = this.config.runtimeWarmupTimeoutMs ?? 120_000;
    if (timeoutMs <= 0) return;
    runtime.warmupTimer = setTimeout(() => {
      runtime.warmupTimer = null;
      if (this.runtimes.get(runtime.agentId) !== runtime || runtime.ready) return;
      this.log(
        `Runtime ${runtime.agentId} warmup timed out after ${timeoutMs}ms; degrading to ready`,
        'warn',
      );
      this.emitRuntimeTrace({
        type: 'warmup_timeout',
        agentId: runtime.agentId,
        timeoutMs,
        sessionId: runtime.driver.sessionId,
      });
      this.markRuntimeReady(runtime, 'warmup_timeout');
    }, timeoutMs);
  }

  private stopWarmupTimer(runtime?: RuntimeRecord): void {
    if (!runtime) return;
    if (!runtime.warmupTimer) return;
    clearTimeout(runtime.warmupTimer);
    runtime.warmupTimer = null;
  }

  /**
   * Report a runtime-state activity (Working/Thinking/Output/Idle) to the
   * backend so it shows up in the Activity tab timeline. Truncates all string
   * values to keep network payload small. Fire-and-forget with a short timeout;
   * failures are logged at debug level and never block the stream loop.
   */
  private async reportRuntimeActivity(
    runtime: RuntimeRecord,
    kind: string,
    description: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    if (!this.credential || this.stopping) return;
    const truncated = truncateDetails(details, 200);
    const serverUrl = this.credential.serverUrl || this.config.serverUrl;
    try {
      await fetch(new URL('/internal/agent-api/activity', serverUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credential.token}`,
          'X-Agent-Id': runtime.agentId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: kind, description, details: truncated }),
        signal: AbortSignal.timeout(3000),
      });
    } catch (err) {
      this.log(`Activity report failed (${kind}): ${(err as Error).message}`, 'debug');
    }
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
          runtimeProvider: runtime.runtimeProvider,
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

  private emitLatencyTrace(traceId: string, span: string, event: Record<string, unknown> = {}): void {
    const durationMs = typeof event.durationMs === 'number' ? event.durationMs : undefined;
    const elapsedMs = typeof event.elapsedMs === 'number' ? event.elapsedMs : undefined;
    const attrs = { ...event };
    delete attrs.flow;
    delete attrs.durationMs;
    delete attrs.elapsedMs;
    const payload = {
      at: new Date().toISOString(),
      traceId,
      flow: typeof event.flow === 'string' ? event.flow : 'message_to_agent_reply',
      span,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(elapsedMs !== undefined ? { elapsedMs } : {}),
      status: 'ok',
      attrs,
    };
    this.log(`Latency trace: ${JSON.stringify(payload)}`, 'debug');
    this.emit('latency_trace', payload);
  }

  // ── Signal handling ────────────────────────────────────────

  private setupSignalHandlers(): void {
    process.on('SIGINT', () => {
      console.log('[Daemon] Received SIGINT');
      void this.stop();
    });
    process.on('SIGTERM', () => {
      console.log('[Daemon] Received SIGTERM');
      void this.stop();
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
  assignIfPresent(message, 'traceId', firstString(value.traceId, value.trace_id, isRecord(value.details) ? value.details.traceId : undefined));
  const channelType = firstString(value.channelType, value.channel_type);
  assignIfPresent(message, 'channelType', channelType);
  assignIfPresent(message, 'channelId', firstString(value.channelId, value.channel_id));
  if (channelType === 'thread') {
    assignIfPresent(message, 'rootMessageId', firstString(value.rootMessageId, value.root_message_id, value.threadRootId, value.thread_root_id, value.threadId, value.thread_id));
  }
  if ((channelType === 'dm' || message.target?.startsWith('dm:')) && !eventType?.startsWith('task')) {
    assignIfPresent(message, 'peerMemberId', firstString(value.peerMemberId, value.peer_member_id, value.senderId, value.sender_id, value.actor, value.actorId, value.actor_id, value.memberId, value.member_id));
  }
  assignIfPresent(message, 'taskId', firstString(value.taskId, value.task_id));
  assignIfPresent(message, 'taskNumber', firstString(value.taskNumber, value.task_number, value.number));
  assignIfPresent(message, 'status', firstString(value.status, value.taskStatus));
  assignIfPresent(message, 'title', firstString(value.title, value.taskTitle));
  assignIfPresent(message, 'timestamp', firstString(value.time, value.timestamp, value.createdAt));
  assignIfPresent(message, 'sender', firstString(value.sender, value.author, value.user, value.username));
  assignIfPresent(message, 'actor', firstString(value.actor, value.actorId, value.actor_id, value.memberId, value.agentId));
  assignIfPresent(message, 'senderType', firstString(value.senderType, value.sender_type, value.type));
  const details = isRecord(value.details) ? value.details : undefined;
  assignIfPresent(message, 'assignee', firstString(value.assignee, value.assigneeHandle, value.assigneeName, details?.assignee));
  assignIfPresent(message, 'assigneeId', firstString(value.assigneeId, value.assignee_id, details?.assigneeId));
  if (eventType && eventType !== 'message_received') {
    message.eventType = eventType;
  }
  return message;
}

export function selectRuntimeSessionScope(message: RuntimeIncomingMessage): RuntimeSessionScope | undefined {
  try {
    const isThread = message.channelType === 'thread';
    const targetDmPeer = message.target?.startsWith('dm:')
      ? message.target.slice(3).split(':')[0]
      : undefined;
    const channelType = message.channelType ?? (targetDmPeer ? 'dm' : undefined);
    return chooseRuntimeSessionScope({
      channelType,
      peerMemberId: message.peerMemberId ?? targetDmPeer,
      channelId: message.channelId,
      rootMessageId: isThread ? message.rootMessageId : undefined,
      taskId: message.taskId,
    });
  } catch {
    return undefined;
  }
}

export function buildRuntimeMemoryContextRequest(
  sessionScope: RuntimeSessionScope | undefined,
  prompt: string,
): { scopeType: string; scopeId: string; prompt: string; topK: number } | null {
  if (!sessionScope || sessionScope.type === 'dm') return null;
  if (sessionScope.type === 'channel') {
    return {
      scopeType: 'channel',
      scopeId: sessionScope.channelId,
      prompt,
      topK: 3,
    };
  }
  if (sessionScope.type === 'task') {
    return {
      scopeType: 'task',
      scopeId: sessionScope.taskId,
      prompt,
      topK: 3,
    };
  }
  return {
    scopeType: 'thread',
    scopeId: sessionScope.rootMessageId,
    prompt,
    topK: 3,
  };
}

export function formatRuntimeIncomingMessage(message: RuntimeIncomingMessage): string {
  const content = formatRuntimeIncomingContent(message);
  const header = [
    message.eventType ? `event=${message.eventType}` : undefined,
    message.eventSeq ? `eventSeq=${message.eventSeq}` : undefined,
    message.traceId ? `trace=${message.traceId}` : undefined,
    message.target ? `target=${message.target}` : undefined,
    message.channelId ? `channel=${message.channelId}` : undefined,
    message.messageId ? `msg=${message.messageId}` : undefined,
    message.taskNumber ? `task=#${message.taskNumber}` : undefined,
    !message.taskNumber && message.taskId ? `task=${message.taskId}` : undefined,
    message.status ? `status=${message.status}` : undefined,
    message.timestamp ? `time=${message.timestamp}` : undefined,
    message.sender ? `sender=${message.sender}` : undefined,
    message.actor ? `actor=${message.actor}` : undefined,
    message.assignee ? `assignee=${message.assignee}` : undefined,
    message.senderType ? `type=${message.senderType}` : undefined,
  ].filter(Boolean).join(' ');

  if (!header) return content;
  const senderPrefix = message.sender ? `${message.sender}: ` : '';
  return `[${header}] ${senderPrefix}${content}`;
}

export function formatRuntimeIncomingMessageWithMemoryContext(
  message: RuntimeIncomingMessage,
  manifest?: RuntimeMemoryContextManifest | null,
): string {
  const base = formatRuntimeIncomingMessage(message);
  const block = formatMemoryContextBlock(manifest);
  return block ? `${block}\n\n${base}` : base;
}

function formatMemoryContextBlock(manifest?: RuntimeMemoryContextManifest | null): string {
  if (!manifest || !isRecord(manifest)) return '';

  const taskMemories = formatMemoryContextItems(manifest.taskMemories);
  const channelMemories = formatMemoryContextItems(manifest.channelMemories);
  const readMore = formatReadMoreCommands(manifest.readMore);
  if (taskMemories.length === 0 && channelMemories.length === 0 && readMore.length === 0) return '';

  const sessionScope = isRecord(manifest.sessionScope) ? manifest.sessionScope : undefined;
  const scopeKey = formatManifestScopeKey(sessionScope);
  const lines = [
    '## Slock Memory Context',
    `policy=${manifest.policy === 'selective' ? 'selective' : 'selective'} scope=${scopeKey}`,
    'Use these snippets as orientation only. For full details, call `slock memory read` or `slock memory search`.',
  ];

  if (taskMemories.length > 0) {
    lines.push('', 'Task memory:');
    for (const item of taskMemories) lines.push(`- ${item}`);
  }
  if (channelMemories.length > 0) {
    lines.push('', 'Channel memory:');
    for (const item of channelMemories) lines.push(`- ${item}`);
  }
  if (readMore.length > 0) {
    lines.push('', 'Read more:');
    for (const command of readMore) lines.push(`- ${truncateMemoryContextText(command, 240)}`);
  }
  return lines.join('\n');
}

function formatMemoryContextItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter(isRecord)
    .map((item) => {
      const path = firstString(item.path) ?? 'memory';
      const title = firstString(item.title);
      const snippet = firstString(item.snippet);
      if (!snippet) return undefined;
      const label = title ? `${path} - ${title}` : path;
      return `${label}: ${truncateMemoryContextText(snippet, 500)}`;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 6);
}

function formatReadMoreCommands(readMore: unknown): string[] {
  if (Array.isArray(readMore)) {
    return readMore
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .slice(0, 5);
  }
  if (!isRecord(readMore)) return [];
  return Object.values(readMore)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .slice(0, 5);
}

function formatManifestScopeKey(scope: Record<string, unknown> | undefined): string {
  const explicit = firstString(scope?.key);
  if (explicit) return explicit;
  const type = firstString(scope?.type);
  const id = firstString(scope?.id);
  if (type && id) return `${type}:${id}`;
  return firstString(type, id, 'unknown') ?? 'unknown';
}

function truncateMemoryContextText(value: string, maxLength: number): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatRuntimeIncomingContent(message: RuntimeIncomingMessage): string {
  if (isTaskMemoryRequestEvent(message.eventType)) {
    return message.content;
  }
  if (!isTaskCreatedEvent(message.eventType)) {
    return message.content;
  }

  const lines = [
    'You have been assigned this Slock task. Treat this event as an actionable work request, not as a passive system notification.',
    'Use `slock task claim` for this task if it is still todo, do the requested work, then use `slock task update --status in_review` when ready for human review.',
  ];

  if (message.target) {
    lines.push(`Post progress and the final result back to ${message.target} with \`slock message send --target "${message.target}"\`.`);
  } else {
    lines.push('Post progress and the final result back to the source task thread or visible source conversation.');
  }

  lines.push('', message.content);
  return lines.join('\n');
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
  assignDefined(runtimeConfig, 'runtimeProvider', firstString(config.runtimeProvider, config.runtime_provider, config.provider, value.runtimeProvider, value.runtime_provider, value.provider));
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

function normalizeDaemonRuntimeType(runtime: string | undefined): DaemonRuntimeImplementation | undefined {
  if (!runtime || runtime === 'claude' || runtime === 'claude_code') return 'claude_code';
  if (runtime === 'codex' || runtime === 'codex_acp') return 'codex';
  if (runtime === 'codex_cli') return 'codex_cli';
  return undefined;
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

function traceIdOf(input: unknown): string | undefined {
  const value = unwrapMessagePayload(input);
  if (!isRecord(value)) return undefined;
  const details = isRecord(value.details) ? value.details : undefined;
  return firstString(value.traceId, value.trace_id, details?.traceId, details?.trace_id);
}

function eventSeqOf(input: unknown): string | undefined {
  const value = unwrapMessagePayload(input);
  if (!isRecord(value)) return undefined;
  return firstString(value.eventSeq, value.eventLogCursor, value.eventCursor, value.seq);
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

/**
 * Recursively truncate all string values in an object to `maxLen` characters,
 * appending an ellipsis when truncated. Keeps the payload small for activity
 * reporting (network-bandwidth friendly; NoSQL-ready flat structure).
 */
function truncateDetails(obj: Record<string, unknown>, maxLen: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      out[k] = v.length > maxLen ? v.slice(0, maxLen) + '…' : v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = truncateDetails(v as Record<string, unknown>, maxLen);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Read the real (billed) token usage from the Claude Code session jsonl file.
 * Claude Code persists the authoritative usage on each assistant line under
 * `message.usage`. Provider-reported numbers in the stream-json `result` event
 * can be inflated by Anthropic-compat adapters, so this is the ground truth.
 *
 * Returns undefined if the session file can't be found or parsed.
 */
function readSessionUsage(
  workspacePath: string,
  sessionId: string | null | undefined,
): { inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number } | undefined {
  if (!sessionId) return undefined;
  try {
    const projectDir = workspacePath.replace(/\/+/g, '-');
    const sessionFile = join(
      process.env.HOME || process.env.USERPROFILE || '/root',
      '.claude',
      'projects',
      projectDir,
      `${sessionId}.jsonl`,
    );
    if (!existsSync(sessionFile)) return undefined;
    // Read the file and scan backwards for the last assistant line with usage.
    const raw = readFileSync(sessionFile, 'utf-8');
    const lines = raw.trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (!line) continue;
      const obj = JSON.parse(line);
      if (obj.type !== 'assistant') continue;
      const usage = obj.message?.usage;
      if (!usage || typeof usage !== 'object') continue;
      return {
        inputTokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
        outputTokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
        cacheReadInputTokens: typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : undefined,
      };
    }
    return undefined;
  } catch {
    return undefined;
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

function isTaskCreatedEvent(type?: string): boolean {
  return type === 'task_created' || type === 'task.created';
}

function isTaskMemoryRequestEvent(type?: string): boolean {
  return type === 'task_memory_requested' || type === 'task.memory_requested';
}

export function isRuntimeActionableEventType(type?: string): boolean {
  return type === 'task_created'
    || type === 'task.created'
    || type === 'task_memory_requested'
    || type === 'task.memory_requested'
    || type === 'thread_summary_requested'
    || type === 'thread.summary_requested';
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
