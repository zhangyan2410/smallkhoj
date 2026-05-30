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
  target?: string;
  messageId?: string;
  timestamp?: string;
  sender?: string;
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
  private runtimeLastProgressAt = 0;
  private wrapper: SlockWrapperResult | null = null;
  private stopping = false;

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
      'debug',
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

    if (this.config.runtime === 'claude') {
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
    });
    this.wsManager.connect();

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

  private markRuntimeProgress(): void {
    this.runtimeLastProgressAt = Date.now();
  }

  private scheduleRuntimeRestart(sessionId?: string): void {
    if (this.stopping || this.config.runtime !== 'claude' || !this.config.runtimeRestartOnCrash) return;
    if (this.runtimeRestartAttempts >= 1 || this.runtimeRestartTimer) return;

    this.runtimeRestartAttempts += 1;
    const resumeSessionId = sessionId ?? this.runtimeSessionId ?? this.config.runtimeResumeSessionId;
    this.log(`Scheduling Claude runtime restart: resumeSessionId=${resumeSessionId ?? 'none'}`, 'warn');
    this.emitRuntimeTrace({ type: 'restart_scheduled', resumeSessionId });
    this.runtimeRestartTimer = setTimeout(() => {
      this.runtimeRestartTimer = null;
      if (this.stopping || this.config.runtime !== 'claude') return;
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
  const value = unwrapMessagePayload(input);
  if (!isRecord(value)) return null;

  const content = firstString(
    value.content,
    value.text,
    value.body,
    value.message,
  );
  if (!content) return null;

  return {
    target: firstString(value.target, value.channel, value.channelName),
    messageId: firstString(value.msg, value.messageId, value.message_id, value.id, value.shortId),
    timestamp: firstString(value.time, value.timestamp, value.createdAt),
    sender: firstString(value.sender, value.author, value.user, value.username),
    senderType: firstString(value.senderType, value.sender_type, value.type),
    content,
  };
}

export function formatRuntimeIncomingMessage(message: RuntimeIncomingMessage): string {
  const header = [
    message.target ? `target=${message.target}` : undefined,
    message.messageId ? `msg=${message.messageId}` : undefined,
    message.timestamp ? `time=${message.timestamp}` : undefined,
    message.sender ? `sender=${message.sender}` : undefined,
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

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
