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
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { arch, hostname, platform, release } from 'os';
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

export class DaemonCore extends EventEmitter {
  private config: DaemonConfig;
  private credential: Credential | null = null;
  private proxy: AgentProxy;
  private wsManager: WebSocketManager | null = null;
  private mcpBridge: MCPBridge | null = null;
  private runtimeDriver: ClaudeRuntimeDriver | null = null;
  private clientHandler: ClientHandler;
  private sessionManager = new SessionManager();
  private logBuffer: LogEntry[] = [];
  private logCapacity = 2000;
  private isRunning = false;
  private proxyToken: string | null = null;
  private runtimeSessionId: string | null = null;
  private runtimeRestartAttempts = 0;
  private runtimeRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private runtimeStallTimer: ReturnType<typeof setInterval> | null = null;
  private daemonHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private runtimeLastProgressAt = 0;
  private wrapper: SlockWrapperResult | null = null;
  private stopping = false;
  private daemonRegistrationEnabled = false;

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
      // Only deliver task events and message events to runtime; skip heartbeats/member updates
      if (eventType === 'message_received') return; // already handled above
      if (!isTaskEventType(eventType)) return;
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
    const message = normalizeRuntimeIncomingMessage(input);
    if (!message) {
      this.log(`Runtime delivery skipped unrecognized ${source} message`, 'debug');
      return false;
    }

    if (!this.runtimeDriver) {
      this.log(`Runtime delivery skipped because Claude runtime is not running: source=${source}`, 'debug');
      return false;
    }

    const delivered = this.runtimeDriver.sendUserMessage(formatRuntimeIncomingMessage(message));
    this.log(
      `Runtime message ${delivered ? 'delivered' : 'queued'} from ${source}: target=${message.target ?? 'unknown'}`,
      delivered ? 'info' : 'debug',
    );
    this.emit('runtime_delivery', { source, delivered, message });
    return delivered;
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
    this.credential = this.loadCredential();
    if (!this.credential) {
      throw new Error('Failed to load credential');
    }
    this.log(`Credential loaded for agent ${this.credential.agentId}`, 'info');

    // 2. Write PID file
    this.writePidFile();

    // 3. Start HTTP proxy
    await this.proxy.start(this.config.proxyPort);
    this.log(`Proxy listening on ${this.proxy.getProxyUrl()}`, 'info');

    // 4. Register proxy token
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
    this.daemonRegistrationEnabled = this.shouldRegisterDaemonLifecycle();
    if (this.daemonRegistrationEnabled) {
      await this.registerDaemonLifecycle('register');
      this.startDaemonHeartbeat();
    }

    if (this.config.runtime === 'claude_code') {
      this.startClaudeRuntime();
    }

    // 5. Start WebSocket
    this.wsManager = new WebSocketManager(this.credential);
    this.wsManager.on('event', (event) => {
      this.emit('daemon_event', event);
      this.log(`WS event: ${event.type}`, 'debug');
      if (event.type === 'message') {
        if (isRecord(event.message)) {
          this.proxy.recordIncomingMessage(event.message, false);
        }
        this.deliverRuntimeMessage(event.message, 'websocket');
      }
      if (event.type === 'event') {
        if (isRecord(event.event)) {
          this.proxy.recordIncomingEvent(event.event);
        }
      }
    });
    this.wsManager.connect();

    // 5b. Inbox polling fallback when no WS
    if (this.config.wsUrl === 'none' || !this.config.wsUrl) {
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

    if (this.runtimeRestartTimer) {
      clearTimeout(this.runtimeRestartTimer);
      this.runtimeRestartTimer = null;
    }
    this.stopRuntimeStallWatchdog();
    this.stopDaemonHeartbeat();
    this.stopInboxPolling();
    this.wsManager?.disconnect();
    this.runtimeDriver?.stop();
    void this.mcpBridge?.stop();
    this.proxy.stop();
    this.removePidFile();

    console.log('[Daemon] Stopped');
    this.log('Stopped', 'info');

    process.exit(0);
  }

  // ── Credential ─────────────────────────────────────────────

  private loadCredential(): Credential | null {
    if (this.config.importSlockRuntime) {
      const imported = importSlockRuntime(this.config.importSlockRuntime);
      this.log(`Imported Slock runtime credentials from ${imported.source}`, 'info');
      return imported.credential;
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

  private startClaudeRuntime(resumeSessionId = this.runtimeSessionId ?? this.config.runtimeResumeSessionId): void {
    if (!this.credential || !this.wrapper) {
      throw new Error('Cannot start Claude runtime before credential and wrapper are ready');
    }

    const driver = new ClaudeRuntimeDriver({
      credential: this.credential,
      workspacePath: this.config.workspacePath ?? process.cwd(),
      wrapperDir: this.wrapper.wrapperDir,
      slockHome: this.wrapper.slockHome,
      launchId: this.wrapper.launchId,
      resumeSessionId: resumeSessionId ?? undefined,
      model: this.config.runtimeModel,
      command: this.config.runtimeCommand,
      commandArgs: this.config.runtimeCommandArgs,
    });

    this.runtimeDriver = driver;
    this.runtimeLastProgressAt = Date.now();
    this.startRuntimeStallWatchdog(driver);

    driver.on('line', (event) => {
      this.markRuntimeProgress();
      this.log(`Claude runtime ${event.stream}: ${event.line}`, 'debug');
      if (event.stream === 'stderr') {
        console.error(`[Daemon] Claude runtime stderr: ${event.line}`);
      }
      this.emit('runtime_line', event);
    });
    driver.on('stream_event', (event) => {
      this.markRuntimeProgress();
      this.emitRuntimeTrace({
        type: 'stream_event',
        eventType: typeof event.type === 'string' ? event.type : undefined,
        subtype: typeof event.subtype === 'string' ? event.subtype : undefined,
        sessionId: driver.sessionId,
      });
    });
    driver.on('session', ({ sessionId }: { sessionId: string }) => {
      this.markRuntimeProgress();
      this.runtimeSessionId = sessionId;
      const now = Date.now();
      this.sessionManager.upsert({
        sessionId,
        agentId: this.credential?.agentId ?? '',
        status: 'active',
        cwd: this.config.workspacePath ?? process.cwd(),
        command: this.config.runtimeCommand ?? 'claude',
        createdAt: now,
        updatedAt: now,
      });
      this.emitRuntimeTrace({ type: 'session', sessionId });
      this.emit('runtime_session', { sessionId });
      void this.registerDaemonLifecycle('heartbeat');
    });
    driver.on('message_sent', (payload) => {
      this.markRuntimeProgress();
      this.emitRuntimeTrace({
        type: 'message_sent',
        sessionId: driver.sessionId,
        hasSessionId: isRecord(payload) && typeof payload.session_id === 'string',
      });
    });
    driver.on('exit', (event) => {
      this.log(`Claude runtime exited: code=${event.code} signal=${event.signal}`, event.intentional ? 'info' : 'warn');
      console.error(`[Daemon] Claude runtime exited: code=${event.code} signal=${event.signal}`);
      if (event.sessionId) {
        this.sessionManager.update(event.sessionId, { status: 'dead' });
      }
      this.emit('runtime_exit', event);
      this.emitRuntimeTrace({ type: 'exit', ...event });
      void this.registerDaemonLifecycle('heartbeat');

      if (this.runtimeDriver === driver) {
        this.runtimeDriver = null;
      }
      this.stopRuntimeStallWatchdog();
      if (!event.intentional) {
        this.scheduleRuntimeRestart(event.sessionId);
      }
    });
    driver.on('error', (err) => {
      this.markRuntimeProgress();
      this.log(`Claude runtime error: ${(err as Error).message}`, 'error');
      console.error('[Daemon] Claude runtime error:', (err as Error).message);
      this.emit('runtime_error', err);
      this.emitRuntimeTrace({ type: 'error', message: (err as Error).message });
    });

    driver.start();
    this.log(`Claude runtime started: pid=${driver.pid ?? 'unknown'}`, 'info');
    console.error(`[Daemon] Claude runtime started: pid=${driver.pid ?? 'unknown'}`);
    this.emitRuntimeTrace({
      type: 'start',
      pid: driver.pid,
      resumeSessionId: resumeSessionId ?? undefined,
    });
  }

  private startRuntimeStallWatchdog(driver: ClaudeRuntimeDriver): void {
    this.stopRuntimeStallWatchdog();
    const timeoutMs = this.config.runtimeStallTimeoutMs;
    if (!timeoutMs || timeoutMs <= 0) return;

    const intervalMs = Math.max(250, Math.min(timeoutMs, 5_000));
    this.runtimeStallTimer = setInterval(() => {
      if (this.stopping || this.runtimeDriver !== driver || !driver.busy) {
        return;
      }
      const idleForMs = Date.now() - this.runtimeLastProgressAt;
      if (idleForMs < timeoutMs) return;

      this.log(`Claude runtime stalled for ${idleForMs}ms; terminating`, 'warn');
      this.emitRuntimeTrace({
        type: 'stall',
        idleForMs,
        timeoutMs,
        sessionId: driver.sessionId,
      });
      driver.killUnresponsive();
    }, intervalMs);
  }

  private stopRuntimeStallWatchdog(): void {
    if (!this.runtimeStallTimer) return;
    clearInterval(this.runtimeStallTimer);
    this.runtimeStallTimer = null;
  }

  private startDaemonHeartbeat(): void {
    this.stopDaemonHeartbeat();
    this.daemonHeartbeatTimer = setInterval(() => {
      void this.registerDaemonLifecycle('heartbeat');
    }, 30_000);
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
      const data = JSON.parse(text) as { count?: number; eventLogCursor?: string };
      if (data.count && data.count > 0) {
        this.log(`Inbox poll got ${data.count} events`, 'debug');
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
    const workspacePath = this.config.workspacePath ?? process.cwd();
    const runtimeStatus = this.runtimeDriver ? (this.runtimeDriver.busy ? 'running' : 'idle') : 'idle';
    const runtimeCommand = this.config.runtimeCommand ?? (this.config.runtime === 'claude_code' ? 'claude' : undefined);
    const body = {
      name: hostname(),
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
      workspaces: [
        {
          agentId: this.credential.agentId,
          runtime: this.config.runtime ?? 'daemon',
          runtimeCommand,
          runtimeModel: this.config.runtimeModel,
          status: runtimeStatus,
          sessionId: this.runtimeSessionId,
          cwd: workspacePath,
          pid: this.runtimeDriver?.pid,
          backend: this.config.runtime === 'claude_code' ? 'Claude' : undefined,
        },
      ],
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
      this.log(`Daemon ${kind} synced to ${serverUrl}`, 'debug');
    } catch (err) {
      this.log(`Daemon ${kind} failed: ${(err as Error).message}`, 'warn');
    }
  }

  private markRuntimeProgress(): void {
    this.runtimeLastProgressAt = Date.now();
  }

  private scheduleRuntimeRestart(sessionId?: string): void {
    if (this.stopping || this.config.runtime !== 'claude_code' || !this.config.runtimeRestartOnCrash) return;
    if (this.runtimeRestartAttempts >= 1 || this.runtimeRestartTimer) return;

    this.runtimeRestartAttempts += 1;
    const resumeSessionId = sessionId ?? this.runtimeSessionId ?? this.config.runtimeResumeSessionId;
    this.log(`Scheduling Claude runtime restart: resumeSessionId=${resumeSessionId ?? 'none'}`, 'warn');
    this.emitRuntimeTrace({ type: 'restart_scheduled', resumeSessionId });
    this.runtimeRestartTimer = setTimeout(() => {
      this.runtimeRestartTimer = null;
      if (this.stopping || this.config.runtime !== 'claude_code') return;
      try {
        this.startClaudeRuntime(resumeSessionId ?? undefined);
      } catch (err) {
        this.log(`Claude runtime restart failed: ${(err as Error).message}`, 'error');
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
