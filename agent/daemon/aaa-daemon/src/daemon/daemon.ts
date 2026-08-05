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
import { CodexAcpRuntimeDriver } from '../runtime/codex-acp-runtime.js';
import { OpenCodeServerRuntimeDriver } from '../runtime/opencode-server-runtime.js';
import { PiRuntimeDriver, resolveBundledPiLayout } from '../runtime/pi-runtime.js';
import type { ManagedRuntimeDriver } from '../runtime/runtime-driver.js';
import { translateRuntimeStreamActivity } from '../runtime/runtime-activity.js';
import {
  RuntimeChannelContextRegistry,
  formatChannelMembershipChange,
  formatChannelRosterReconciliation,
  formatChannelRosterSnapshot,
  formatRemovedFromChannel,
  type RuntimeChannelMember,
  type RuntimeChannelMembershipChange,
  type RuntimeChannelReferenceUpdate,
  type RuntimeChannelSnapshot,
} from '../runtime/channel-context.js';
import { importSlockRuntime } from '../runtime/import-slock-runtime.js';
import {
  chooseRuntimeSessionScope,
  ScopedProviderSessionStore,
  type RuntimeSessionScope,
} from './session-scope.js';
import {
  detectedRuntimesForInventory,
  detectRuntimeProviders,
  resolveDetectedRuntimeCommand,
  resolveRuntimeProviderLaunch,
  type RuntimeProviderInventory,
} from '../runtime/runtime-provider.js';
import { DAEMON_VERSION } from '../version.js';

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

export interface RuntimeIncomingMessage {
  traceId?: string;
  eventType?: string;
  eventId?: string;
  eventSeq?: string;
  target?: string;
  channelType?: string;
  channelId?: string;
  rootMessageId?: string;
  peerMemberId?: string;
  messageId?: string;
  taskId?: string;
  taskRunId?: string;
  taskNumber?: string;
  status?: string;
  title?: string;
  promptProfile?: string;
  contextSessionId?: string;
  taskRunTemplate?: Record<string, unknown>;
  taskRunRole?: Record<string, unknown>;
  completionPolicy?: string;
  timestamp?: string;
  sender?: string;
  actor?: string;
  senderType?: string;
  assignee?: string;
  assigneeId?: string;
  rosterRevision?: number;
  member?: RuntimeChannelMember;
  referenceUpdates?: RuntimeChannelReferenceUpdate[];
  removedAgentId?: string;
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

export interface TaskRunLifecycleReport {
  agentId: string;
  taskRunId: string;
  status: 'dispatched' | 'running' | 'completed' | 'failed' | 'cancelled';
  workspaceId?: string;
  runtimeSessionId?: string;
  workspaceSessionId?: string;
  contextSessionId?: string;
  contextUsage?: Record<string, unknown>;
  tokenUsage?: Record<string, unknown>;
  toolUsageSummary?: Record<string, unknown>;
  outputMessageId?: string;
  failureCode?: string;
  failureReason?: string;
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
    runtimeAgent?: string;
    workspacePath?: string;
    workspaceId?: string;
    backend?: string;
    allowWrites?: boolean;
    writeTargetAllowlist?: string;
  };
}

export interface DaemonRuntimeControlCommand {
  action: 'inspect_context' | 'compact' | 'usage_status';
  agentId: string;
  workspaceId?: string;
  waitForResult?: boolean;
  timeoutMs?: number;
}

export interface DaemonRuntimeControlResult {
  accepted: boolean;
  delivered: boolean;
  action: DaemonRuntimeControlCommand['action'];
  agentId: string;
  runtime?: string;
  slashCommand?: string;
  reason?: string;
  output?: string;
  outputTruncated?: boolean;
  error?: string;
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
  runtimeAgent?: string;
  sessionId: string | null;
  activeSessionScope?: RuntimeSessionScope;
  sessionScopesByKey: Map<string, RuntimeSessionScope>;
  activeTraceId?: string;
  activeTraceStartedAt?: number;
  activeTraceFirstOutputSeen?: boolean;
  activeTaskRunId?: string;
  activeTaskRunContextSessionId?: string;
  activeTaskRunOutputMessageId?: string;
  activeTaskRunToolUseCount: number;
  activeTaskRunToolResultCount: number;
  restartAttempts: number;
  restartTimer: ReturnType<typeof setTimeout> | null;
  stallTimer: ReturnType<typeof setInterval> | null;
  lastProgressAt: number;
  /** Startup warmup gate: true once an aura tool call has completed successfully */
  ready: boolean;
  /** Timestamp the warmup probe was injected, for timeout / duration reporting */
  warmupStartedAt?: number;
  /** aura tool_use ids emitted during warmup, awaiting their tool_result */
  pendingWarmupResult: Set<string>;
  /** Timer that degrades the runtime to ready if warmup never completes */
  warmupTimer: ReturnType<typeof setTimeout> | null;
  /** Current activity state for the four-state timeline (Working/Thinking/Output/Idle) */
  activityTurnState: 'idle' | 'working' | 'thinking' | 'output';
  /** Last runtime stderr line, retained so an unexpected exit can explain itself in Activity. */
  lastStderrLine?: string;
  /** Last runtime driver error, paired with stderr and exit metadata in Activity. */
  lastErrorMessage?: string;
  /** tool_use ids already reported as Output activity this turn (dedup) */
  recordedToolUseIds: Set<string>;
  /** Serializes Activity POSTs for this runtime without blocking stream handling. */
  activityReportChain: Promise<void>;
  /** Inbound turns accepted into a busy driver, awaiting its message_sent boundary. */
  pendingActivityTurns: RuntimeIncomingMessage[];
  /** Serializes snapshot/event preparation and provider queue insertion per runtime. */
  channelContextDeliveryChain: Promise<void>;
  /** Ground-truth token usage from the last completed turn (session-jsonl or provider) */
  lastTurnUsage?: {
    source: 'session-jsonl' | 'provider-stream-json';
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
  };
  lastTurnContextUsage?: {
    source: 'runtime_usage_event' | 'provider-stream-json';
    knownTokens?: number;
    contextWindow?: number;
    occupancyRatio?: number;
  };
}

type DaemonRuntimeImplementation = 'pi' | 'claude_code' | 'codex' | 'opencode';

export function workspacePathSegment(value: string | undefined, fallback: string): string {
  const segment = (value || fallback).trim().replace(/[^A-Za-z0-9_.-]/g, '_');
  return segment || fallback;
}

function writeOpenCodeRuntimeConfig(workspacePath: string, config: Record<string, unknown>): string {
  const configHome = join(workspacePath, '.slock', 'opencode-config-home');
  const configDir = join(configHome, 'opencode');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'opencode.json'), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  return configHome;
}

export function defaultDaemonWorkspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
  const explicitRoot = env.SMALLKHOJ_DAEMON_WORKSPACE_ROOT?.trim();
  if (explicitRoot) return explicitRoot;
  const daemonHome = env.SMALLKHOJ_DAEMON_HOME?.trim() || join(homedir(), '.smallkhoj', 'daemon');
  return join(daemonHome, 'workspaces');
}

export function daemonRuntimeWorkspacePath(
  basePath: string,
  options: {
    serverId?: string;
    computerId?: string;
    machineId?: string;
    workspaceId?: string;
    agentId?: string;
  },
): string {
  const serverSegment = workspacePathSegment(options.serverId, 'unknown-server');
  const computerSegment = workspacePathSegment(options.computerId || options.machineId, 'unknown-computer');
  const workspaceSegment = workspacePathSegment(options.workspaceId || options.agentId, 'unknown-workspace');
  return join(basePath, '.slock-runtimes', serverSegment, computerSegment, workspaceSegment);
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
  private scopedProviderSessions = new ScopedProviderSessionStore();
  private channelContexts = new RuntimeChannelContextRegistry();
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
      // telemetry, status updates, and generic event feed noise. Membership
      // events are a separate non-work context stream.
      if (eventType === 'message_received') return; // already handled above
      if (!isRuntimeActionableEventType(eventType) && !isChannelMembershipEventType(eventType)) return;
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
    const runtimeControlCommand = parseDaemonRuntimeControlCommand(input);
    if (runtimeControlCommand) {
      void this.executeRuntimeControlCommand(runtimeControlCommand);
      return true;
    }

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
    if (
      !isChannelMembershipEventType(message.eventType)
      && message.actor
      && message.actor === runtime.agentId
    ) {
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
    runtime.channelContextDeliveryChain = (runtime.channelContextDeliveryChain ?? Promise.resolve())
      .then(() => this.deliverRuntimeMessageToDriver(
        runtime,
        message,
        source,
        sessionScope,
        scopedSession?.providerSessionId,
      ))
      .catch((error) => {
        this.log(
          `Runtime Channel context delivery failed: agent=${runtime.agentId} error=${(error as Error).message}`,
          'warn',
        );
      });
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
    const membershipChange = runtimeChannelMembershipChange(message);
    let prompt: string;
    let contextOnly = false;
    if (membershipChange) {
      const contextPrompt = await this.prepareRuntimeMembershipChange(runtime, membershipChange);
      if (!contextPrompt) return;
      prompt = contextPrompt;
      contextOnly = true;
    } else {
      const basePrompt = formatRuntimeIncomingMessage(message);
      const manifest = await this.loadRuntimeMemoryContextManifest(runtime, sessionScope, basePrompt);
      const messagePrompt = formatRuntimeIncomingMessageWithMemoryContext(message, manifest);
      const snapshot = message.channelId
        ? await this.ensureRuntimeChannelSnapshot(runtime, message.channelId)
        : null;
      prompt = snapshot ? `${formatChannelRosterSnapshot(snapshot)}\n\n${messagePrompt}` : messagePrompt;
    }
    const delivered = runtime.driver.sendUserMessage(prompt, sendOptions);
    if (message.taskRunId) {
      void this.reportTaskRunLifecycle({
        agentId: runtime.agentId,
        taskRunId: message.taskRunId,
        status: 'dispatched',
        workspaceId: runtime.workspaceId,
        runtimeSessionId: runtime.driver.sessionId ?? runtime.sessionId ?? undefined,
        contextSessionId: message.contextSessionId,
      });
    }
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
    if (delivered && !contextOnly) {
      this.beginRuntimeActivityTurn(runtime, message);
    } else if (!delivered && !contextOnly) {
      runtime.pendingActivityTurns.push(message);
    }
    this.log(
      `Runtime message ${delivered ? 'delivered' : 'queued'} from ${source}: agent=${runtime.agentId} target=${message.target ?? 'unknown'} scope=${sessionScope?.key ?? 'default'}`,
      delivered ? 'info' : 'debug',
    );
    this.emit('runtime_delivery', { source, delivered, agentId: runtime.agentId, message, sessionScope: sessionScope?.key });
  }

  private async ensureRuntimeChannelSnapshot(
    runtime: RuntimeRecord,
    channelId: string,
  ): Promise<RuntimeChannelSnapshot | null> {
    const generation = runtime.wrapper.launchId;
    if (this.channelContexts.has(runtime.agentId, generation, channelId)) return null;
    const snapshot = await this.loadRuntimeChannelSnapshot(runtime, channelId);
    if (!snapshot) return null;
    this.channelContexts.initialize(runtime.agentId, generation, snapshot);
    return snapshot;
  }

  private async prepareRuntimeMembershipChange(
    runtime: RuntimeRecord,
    change: RuntimeChannelMembershipChange,
  ): Promise<string | null> {
    const generation = runtime.wrapper.launchId;
    if (change.removedAgentId === runtime.agentId) {
      this.channelContexts.clearChannel(runtime.agentId, generation, change.channelId);
      const pendingBefore = runtime.pendingActivityTurns.length;
      for (let index = runtime.pendingActivityTurns.length - 1; index >= 0; index -= 1) {
        if (runtime.pendingActivityTurns[index].channelId === change.channelId) {
          runtime.pendingActivityTurns.splice(index, 1);
        }
      }
      const driverDiscarded = runtime.driver.discardQueuedChannel(change.channelId);
      this.scopedProviderSessions.forgetChannel(runtime.agentId, change.channelId);
      this.log(
        `Removed Agent Channel cutoff: agent=${runtime.agentId} channel=${change.channelId} `
          + `daemonQueued=${pendingBefore - runtime.pendingActivityTurns.length} driverQueued=${driverDiscarded}`,
        'info',
      );
      return formatRemovedFromChannel(change);
    }

    if (!this.channelContexts.has(runtime.agentId, generation, change.channelId)) {
      const snapshot = await this.loadRuntimeChannelSnapshot(runtime, change.channelId);
      if (!snapshot) return formatChannelMembershipChange(change);
      this.channelContexts.initialize(runtime.agentId, generation, snapshot);
      this.channelContexts.apply(runtime.agentId, generation, change);
      return formatChannelRosterSnapshot(snapshot);
    }

    const result = this.channelContexts.apply(runtime.agentId, generation, change);
    if (result.kind === 'duplicate') return null;
    if (result.kind === 'gap') {
      const snapshot = await this.loadRuntimeChannelSnapshot(runtime, change.channelId);
      if (!snapshot) {
        return [
          formatChannelMembershipChange(change),
          `A roster revision gap was detected (expected ${result.expectedRevision}, received ${result.receivedRevision}).`,
          'Run `aura channel members --channel <target>` before relying on the member list.',
        ].join('\n');
      }
      this.channelContexts.initialize(runtime.agentId, generation, snapshot);
      return formatChannelRosterReconciliation(snapshot);
    }
    return formatChannelMembershipChange(change);
  }

  private async loadRuntimeChannelSnapshot(
    runtime: RuntimeRecord,
    channelId: string,
  ): Promise<RuntimeChannelSnapshot | null> {
    try {
      const path = `/internal/agent/${encodeURIComponent(runtime.agentId)}`
        + `/channel-members?channel=${encodeURIComponent(channelId)}`;
      const response = await fetch(new URL(path, this.proxy.getProxyUrl()), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${runtime.proxyToken}`,
          'X-Agent-Id': runtime.agentId,
        },
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        this.log(
          `Channel snapshot fetch failed: agent=${runtime.agentId} channel=${channelId} `
            + `status=${response.status} detail=${detail.slice(0, 160)}`,
          'warn',
        );
        return null;
      }
      const snapshot = parseRuntimeChannelSnapshot(await response.json(), channelId);
      if (!snapshot) {
        this.log(
          `Channel snapshot response was invalid: agent=${runtime.agentId} channel=${channelId}`,
          'warn',
        );
      }
      return snapshot;
    } catch (error) {
      this.log(
        `Channel snapshot fetch failed: agent=${runtime.agentId} channel=${channelId} `
          + `error=${(error as Error).message}`,
        'warn',
      );
      return null;
    }
  }

  private beginRuntimeActivityTurn(runtime: RuntimeRecord, message: RuntimeIncomingMessage): void {
    if (message.taskRunId) {
      runtime.activeTaskRunId = message.taskRunId;
      runtime.activeTaskRunContextSessionId = message.contextSessionId;
      runtime.activeTaskRunOutputMessageId = undefined;
      runtime.activeTaskRunToolUseCount = 0;
      runtime.activeTaskRunToolResultCount = 0;
      runtime.lastTurnContextUsage = undefined;
      void this.reportTaskRunLifecycle({
        agentId: runtime.agentId,
        taskRunId: message.taskRunId,
        status: 'running',
        workspaceId: runtime.workspaceId,
        runtimeSessionId: runtime.driver.sessionId ?? runtime.sessionId ?? undefined,
        contextSessionId: message.contextSessionId,
      });
    }
    runtime.activityTurnState = 'working';
    runtime.recordedToolUseIds.clear();
    void this.reportRuntimeActivity(runtime, 'runtime_working', 'Working on message', {
      messageId: message.messageId ?? undefined,
      taskRunId: message.taskRunId ?? undefined,
      sourceChannel: message.channelId ?? undefined,
      target: message.target ?? undefined,
    });
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

    console.log(`[Daemon] Starting aaa-daemon v${DAEMON_VERSION}...`);
    this.log(`Starting aaa-daemon v${DAEMON_VERSION}`, 'info');
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
        allowWrites: this.config.allowWrites,
        writeTargetAllowlist: this.config.writeTargetAllowlist,
      });
      this.log(`slock wrapper generated in ${this.wrapper.wrapperDir}`, 'info');
    }
    this.daemonRegistrationEnabled = this.shouldRegisterDaemonLifecycle();
    if (this.daemonRegistrationEnabled) {
      await this.registerDaemonLifecycle('register');
      this.startDaemonHeartbeat();
    }

    if ((this.config.runtime === 'claude_code' || this.config.runtime === 'codex' || this.config.runtime === 'codex_acp' || this.config.runtime === 'opencode' || this.config.runtime === 'pi') && this.credential.agentId) {
      this.startRuntimeForAgent(this.credential.agentId, {
        runtime: this.config.runtime,
        runtimeCommand: this.config.runtimeCommand,
        runtimeCommandArgs: this.config.runtimeCommandArgs,
        runtimeModel: this.config.runtimeModel,
        runtimeAgent: this.config.runtimeAgent,
        runtimeProvider: this.config.runtimeProvider,
        workspacePath: this.config.workspacePath,
        allowWrites: this.config.allowWrites,
        writeTargetAllowlist: this.config.writeTargetAllowlist,
      });
    }

    // 5. Start WebSocket
    this.wsManager = new WebSocketManager(this.credential, { daemonId: this.daemonId });
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
        const delivered = this.deliverRuntimeMessage(event.message, 'websocket');
        if (delivered) {
          this.proxy.markReadUpTo(this.proxy.getLastSeenSeq());
        }
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
          computerId: data.computer_id || data.computerId,
          machineId: data.machine_id || data.machineId,
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
      computerId: process.env.SLOCK_COMPUTER_ID,
      machineId: process.env.SLOCK_MACHINE_ID,
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
        daemonVersion: DAEMON_VERSION,
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
      computer?: { id?: string; serverId?: string; machineId?: string };
    };
    if (!data.machineToken) {
      throw new Error('Daemon connect did not return a machine token');
    }
    if (data.daemonId) this.daemonId = data.daemonId;
    return {
      agentId: this.config.agentId || process.env.SLOCK_AGENT_ID || '',
      serverId: data.computer?.serverId || process.env.SLOCK_SERVER_ID || 'unknown',
      computerId: data.computer?.id,
      machineId: data.computer?.machineId || machineId,
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
    const runtimeConfigCommand = runtimeType === 'codex'
      ? codexAcpRuntimeCommand(runtimeConfig.runtimeCommand, runtimeConfig.runtimeCommandArgs, 'control')
      : runtimeConfig.runtimeCommand;
    const configRuntimeCommand = runtimeType === 'codex'
      ? codexAcpRuntimeCommand(this.config.runtimeCommand, this.config.runtimeCommandArgs, 'daemon')
      : this.config.runtimeCommand;
    const providerLaunch = runtimeConfigCommand || !runtimeProvider
      ? {}
      : resolveRuntimeProviderLaunch(runtimeProvider, this.runtimeProviderInventory);
    if (providerLaunch.error) {
      this.log(providerLaunch.error, 'warn');
      return;
    }

    const workspacePath = runtimeConfig.workspacePath
      ?? this.defaultRuntimeWorkspacePath(agentId, runtimeConfig.workspaceId);
    const resumeSessionId = this.runtimeSessionIds.get(agentId) ?? this.config.runtimeResumeSessionId;
    const model = runtimeConfig.runtimeModel ?? providerLaunch.model ?? this.config.runtimeModel;
    const agent = runtimeConfig.runtimeAgent ?? providerLaunch.agent ?? this.config.runtimeAgent;
    let command: string | undefined;
    let commandArgs: string[] | undefined;
    if (runtimeConfigCommand) {
      command = runtimeConfigCommand;
      commandArgs = runtimeConfig.runtimeCommandArgs;
    } else if (providerLaunch.command) {
      command = providerLaunch.command;
      commandArgs = providerLaunch.commandArgs;
    } else if (configRuntimeCommand) {
      command = configRuntimeCommand;
      commandArgs = this.config.runtimeCommandArgs;
    } else {
      command = resolveDetectedRuntimeCommand(runtimeType, this.runtimeProviderInventory);
    }
    if (requiresDetectedRuntimeCommand(runtimeType) && !command) {
      this.log(runtimeCommandDetectionError(runtimeType), 'warn');
      return;
    }
    const credential: Credential = {
      ...this.credential,
      agentId,
    };
    const runtimeAllowWrites = runtimeConfig.allowWrites === true || this.config.allowWrites === true;
    const baseEnv = { ...process.env };
    if (runtimeAllowWrites) {
      baseEnv.SLOCK_ALLOW_WRITES = '1';
    }
    const writeTargetAllowlist = runtimeConfig.writeTargetAllowlist ?? this.config.writeTargetAllowlist;
    if (writeTargetAllowlist) {
      baseEnv.SLOCK_WRITE_TARGET_ALLOWLIST = writeTargetAllowlist;
    }
    if (runtimeType === 'opencode' && providerLaunch.opencodeConfig) {
      baseEnv.XDG_CONFIG_HOME = writeOpenCodeRuntimeConfig(workspacePath, providerLaunch.opencodeConfig);
    }
    const bundledPi = runtimeType === 'pi' ? resolveBundledPiLayout() : undefined;
    if (runtimeType === 'pi' && !bundledPi) {
      this.log('Cannot start pi runtime: bundled Pi layout is unavailable or incomplete', 'warn');
      return;
    }
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
      allowWrites: runtimeAllowWrites,
      writeTargetAllowlist,
    });
    const driver: ManagedRuntimeDriver = runtimeType === 'pi'
      ? new PiRuntimeDriver({
          credential,
          workspacePath,
          nodePath: bundledPi!.nodePath,
          piEntry: bundledPi!.piEntry,
          proxyUrl: this.proxy.getProxyUrl(),
          proxyToken,
          wrapperDir: wrapper.wrapperDir,
          slockHome: wrapper.slockHome,
          launchId: wrapper.launchId,
          manageCapacity: true,
          model,
          apiFormat: process.env.SMALLKHOJ_PI_LLM_API_FORMAT === 'openai' ? 'openai' : 'anthropic',
          baseEnv,
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
          baseEnv,
        })
      : runtimeType === 'opencode'
        ? new OpenCodeServerRuntimeDriver({
          credential,
          workspacePath,
          wrapperDir: wrapper.wrapperDir,
          slockHome: wrapper.slockHome,
          launchId: wrapper.launchId,
          command,
          commandArgs,
          resumeSessionId: resumeSessionId ?? undefined,
          model,
          agent,
          baseEnv,
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
        baseEnv,
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
      runtimeAgent: agent,
      sessionId: resumeSessionId ?? null,
      sessionScopesByKey: new Map(),
      activeTraceId: undefined,
      activeTraceStartedAt: undefined,
      activeTraceFirstOutputSeen: false,
      activeTaskRunId: undefined,
      activeTaskRunContextSessionId: undefined,
      activeTaskRunOutputMessageId: undefined,
      activeTaskRunToolUseCount: 0,
      activeTaskRunToolResultCount: 0,
      lastTurnContextUsage: undefined,
      restartAttempts: 0,
      restartTimer: null,
      stallTimer: null,
      lastProgressAt: Date.now(),
      ready: false,
      warmupStartedAt: undefined,
      pendingWarmupResult: new Set(),
      warmupTimer: null,
      activityTurnState: 'idle',
      lastStderrLine: undefined,
      lastErrorMessage: undefined,
      recordedToolUseIds: new Set(),
      activityReportChain: Promise.resolve(),
      pendingActivityTurns: [],
      channelContextDeliveryChain: Promise.resolve(),
    };
    this.runtimes.set(agentId, runtime);
    this.startRuntimeStallWatchdog(runtime);

    driver.on('line', (event) => {
      this.markRuntimeProgress(runtime);
      this.log(`${runtimeType} runtime ${agentId} ${event.stream}: ${event.line}`, 'debug');
      if (event.stream === 'stderr') {
        runtime.lastStderrLine = event.line;
        console.error(`[Daemon] ${runtimeType} runtime ${agentId} stderr: ${event.line}`);
        const severity = classifyRuntimeDiagnostic(event.line);
        if (severity) {
          void this.reportRuntimeActivity(
            runtime,
            severity === 'error' ? 'runtime_error' : 'runtime_warning',
            runtimeDiagnosticDescription(severity, event.line),
            {
              runtime: runtime.runtime,
              severity,
              source: 'stderr',
              message: event.line,
              sessionId: driver.sessionId,
            },
          );
        }
      }
      this.emit('runtime_line', { ...event, agentId });
    });
    driver.on('stream_event', (event) => {
      this.markRuntimeProgress(runtime);
      const eventType = typeof event.type === 'string' ? event.type : undefined;

      // ── Warmup gate: detect a successful aura tool call ──
      // The runtime is seeded with a warmup probe at startup. It must call a
      // `aura` tool (via Bash with an `aura` command, or an MCP tool whose
      // name mentions aura) and the tool_result must not be an error. Until
      // that happens the runtime stays in 'starting' status and is not
      // advertised as ready/online.
      if (!runtime.ready) {
        if (runtime.runtime === 'codex' && eventType === 'result') {
          const subtype = isRecord(event) && typeof event.subtype === 'string' ? event.subtype : undefined;
          if (subtype === 'success') {
            this.markRuntimeReady(runtime, 'codex_acp_warmup_complete');
          }
        }
        if (eventType === 'assistant') {
          for (const block of getContentBlocks(event)) {
            if (block.type !== 'tool_use' || typeof block.id !== 'string') continue;
            const name = typeof block.name === 'string' ? block.name : '';
            const input = isRecord(block.input) ? block.input : {};
            const cmd = typeof input.command === 'string' ? input.command : '';
            if ((name === 'Bash' && /\baura\b/.test(cmd)) || /aura/i.test(name)) {
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
              this.markRuntimeReady(runtime, 'warmup_aura_ok');
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

      if (eventType === 'usage') {
        const usageEvent = isRecord(event) ? event : {};
        const knownTokens = numberFrom(usageEvent.used) ?? numberFrom(usageEvent.totalTokens) ?? numberFrom(usageEvent.total_tokens);
        const contextWindow = numberFrom(usageEvent.contextWindow) ?? numberFrom(usageEvent.context_window) ?? numberFrom(usageEvent.size);
        runtime.lastTurnContextUsage = {
          source: 'runtime_usage_event',
          knownTokens,
          contextWindow,
          occupancyRatio: knownTokens !== undefined && contextWindow !== undefined && contextWindow > 0
            ? knownTokens / contextWindow
            : undefined,
        };
      }

      // ── Four-state activity translation (Working/Thinking/Output/Idle) ──
      // Only report after the runtime has finished warming up; warmup itself
      // would otherwise flood the timeline with Thinking/Output entries.
      if (runtime.ready) {
        if (runtime.activeTaskRunId && eventType === 'user') {
          const toolResultCount = countToolResults(event);
          runtime.activeTaskRunToolResultCount += toolResultCount;
          const outputMessageId = extractTaskRunOutputMessageIdFromEvent(event);
          if (outputMessageId) {
            runtime.activeTaskRunOutputMessageId = outputMessageId;
          }
          if (toolResultCount > 0 || outputMessageId) {
            void this.reportTaskRunLifecycle({
              agentId,
              taskRunId: runtime.activeTaskRunId,
              status: 'running',
              workspaceId: runtime.workspaceId,
              runtimeSessionId: driver.sessionId ?? runtime.sessionId ?? undefined,
              contextSessionId: runtime.activeTaskRunContextSessionId,
              contextUsage: runtime.lastTurnContextUsage,
              toolUsageSummary: {
                toolUseCount: runtime.activeTaskRunToolUseCount,
                toolResultCount: runtime.activeTaskRunToolResultCount,
              },
              outputMessageId: runtime.activeTaskRunOutputMessageId,
            });
          }
        }
        const activitySignals = translateRuntimeStreamActivity(runtimeType, event);
        for (const signal of activitySignals) {
          if (signal.type !== 'thinking') continue;
          const severity = classifyRuntimeDiagnostic(signal.text);
          if (severity) {
            void this.reportRuntimeActivity(
              runtime,
              severity === 'error' ? 'runtime_error' : 'runtime_warning',
              runtimeDiagnosticDescription(severity, signal.text),
              {
                runtime: runtime.runtime,
                protocol: signal.protocol,
                sourceEvent: signal.sourceEvent,
                severity,
                source: 'assistant',
                message: signal.text,
                sessionId: driver.sessionId,
              },
            );
            continue;
          }
          // Startup warmup/session traffic can arrive after the runtime has
          // technically become ready. Only user-delivery turns enter Working,
          // so do not surface provider warmup narration as product Activity.
          if (runtime.activityTurnState === 'idle') continue;
          if (runtime.activityTurnState !== 'thinking') {
            runtime.activityTurnState = 'thinking';
            void this.reportRuntimeActivity(runtime, 'runtime_thinking', 'Thinking', {
              protocol: signal.protocol,
              sourceEvent: signal.sourceEvent,
              sessionId: driver.sessionId ?? undefined,
              thought: signal.text.slice(0, 200),
            });
          }
        }
        if (eventType === 'assistant' && runtime.activityTurnState !== 'idle') {
          let toolUseRecorded = false;
          for (const signal of activitySignals) {
            if (signal.type !== 'tool_use') continue;
            if (runtime.recordedToolUseIds.has(signal.toolUseId)) continue;
            runtime.recordedToolUseIds.add(signal.toolUseId);
            if (runtime.activeTaskRunId) {
              runtime.activeTaskRunToolUseCount += 1;
              toolUseRecorded = true;
            }
            runtime.activityTurnState = 'output';
            void this.reportRuntimeActivity(runtime, 'runtime_output', `Ran ${signal.toolName}`, {
              protocol: signal.protocol,
              sourceEvent: signal.sourceEvent,
              toolName: signal.toolName,
              commandPreview: sanitizeRuntimeCommandPreview(signal.commandPreview),
            });
          }
          if (toolUseRecorded && runtime.activeTaskRunId) {
            void this.reportTaskRunLifecycle({
              agentId,
              taskRunId: runtime.activeTaskRunId,
              status: 'running',
              workspaceId: runtime.workspaceId,
              runtimeSessionId: driver.sessionId ?? runtime.sessionId ?? undefined,
              contextSessionId: runtime.activeTaskRunContextSessionId,
              contextUsage: runtime.lastTurnContextUsage,
              toolUsageSummary: {
                toolUseCount: runtime.activeTaskRunToolUseCount,
                toolResultCount: runtime.activeTaskRunToolResultCount,
              },
              outputMessageId: runtime.activeTaskRunOutputMessageId,
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
          if (runtime.activeTaskRunId) {
            const completionSummary = buildTaskRunCompletionSummary(event, u, {
              toolUseCount: runtime.activeTaskRunToolUseCount,
              toolResultCount: runtime.activeTaskRunToolResultCount,
              outputMessageId: runtime.activeTaskRunOutputMessageId,
            }, runtime.lastTurnContextUsage);
            void this.reportTaskRunLifecycle({
              agentId,
              taskRunId: runtime.activeTaskRunId,
              status: 'completed',
              workspaceId: runtime.workspaceId,
              runtimeSessionId: driver.sessionId ?? runtime.sessionId ?? undefined,
              contextSessionId: runtime.activeTaskRunContextSessionId,
              contextUsage: completionSummary.contextUsage,
              tokenUsage: completionSummary.tokenUsage,
              toolUsageSummary: completionSummary.toolUsageSummary,
              outputMessageId: completionSummary.outputMessageId,
            });
            runtime.activeTaskRunId = undefined;
            runtime.activeTaskRunContextSessionId = undefined;
            runtime.activeTaskRunOutputMessageId = undefined;
            runtime.activeTaskRunToolUseCount = 0;
            runtime.activeTaskRunToolResultCount = 0;
            runtime.lastTurnContextUsage = undefined;
          }
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
        command: runtime.runtimeCommand ?? (runtime.runtime === 'codex' ? 'npx @zed-industries/codex-acp@0.16.0' : runtime.runtime === 'opencode' ? 'opencode serve' : 'claude'),
        createdAt: now,
        updatedAt: now,
      });
      if (runtime.runtime === 'codex' || runtime.runtime === 'opencode') {
        this.markRuntimeReady(runtime, runtime.runtime === 'codex' ? 'codex_acp_session_ready' : 'opencode_session_ready');
      }
      this.emitRuntimeTrace({ type: 'session', agentId, sessionId, sessionScope: activeSessionScope?.key });
      this.emit('runtime_session', { agentId, sessionId, sessionScope: activeSessionScope?.key });
      if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');
    });
    driver.on('message_sent', (payload) => {
      this.markRuntimeProgress(runtime);
      const control = isRecord(payload) && payload.control === true;
      if (!control) {
        const queuedActivityTurn = runtime.pendingActivityTurns.shift();
        if (queuedActivityTurn) this.beginRuntimeActivityTurn(runtime, queuedActivityTurn);
      }
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
      if (!event.intentional) {
        const fallbackReason = `exit code=${event.code ?? 'unknown'} signal=${event.signal ?? 'unknown'}`;
        const visibleReason = runtime.lastStderrLine || runtime.lastErrorMessage || fallbackReason;
        void this.reportRuntimeActivity(
          runtime,
          'runtime_error',
          `${runtime.runtime === 'codex' ? 'Codex' : runtime.runtime} runtime failed: ${visibleReason}`,
          {
            runtime: runtime.runtime,
            status: 'exited',
            phase: runtime.ready ? 'running' : 'starting',
            error: runtime.lastErrorMessage,
            stderr: runtime.lastStderrLine,
            exitCode: event.code,
            signal: event.signal,
          },
        );
      }
      if (!event.intentional && runtime.activeTaskRunId) {
        void this.reportTaskRunLifecycle({
          agentId,
          taskRunId: runtime.activeTaskRunId,
          status: 'failed',
          workspaceId: runtime.workspaceId,
          runtimeSessionId: event.sessionId ?? driver.sessionId ?? runtime.sessionId ?? undefined,
          contextSessionId: runtime.activeTaskRunContextSessionId,
          failureCode: 'RUNTIME_EXITED',
          failureReason: `Runtime exited unexpectedly: code=${event.code ?? 'unknown'} signal=${event.signal ?? 'unknown'}`,
        });
        runtime.activeTaskRunId = undefined;
        runtime.activeTaskRunContextSessionId = undefined;
        runtime.activeTaskRunOutputMessageId = undefined;
        runtime.activeTaskRunToolUseCount = 0;
        runtime.activeTaskRunToolResultCount = 0;
        runtime.lastTurnContextUsage = undefined;
      }
      this.stopWarmupTimer(runtime);
      this.emit('runtime_exit', { ...event, agentId });
      this.emitRuntimeTrace({ type: 'exit', agentId, ...event });
      if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');

      if (this.runtimes.get(agentId) === runtime) {
        this.runtimes.delete(agentId);
      }
      this.channelContexts.clearRuntime(agentId, runtime.wrapper.launchId);
      this.stopRuntimeStallWatchdog(runtime);
      this.proxy.unregister(proxyToken);
      if (!event.intentional && runtime.runtime === 'claude_code') {
        this.scheduleRuntimeRestart(runtime, event.sessionId);
      }
    });
    driver.on('error', (err) => {
      this.markRuntimeProgress(runtime);
      runtime.lastErrorMessage = (err as Error).message;
      this.log(`${runtime.runtime} runtime ${agentId} error: ${runtime.lastErrorMessage}`, 'error');
      console.error(`[Daemon] ${runtime.runtime} runtime ${agentId} error:`, runtime.lastErrorMessage);
      void this.reportRuntimeActivity(
        runtime,
        'runtime_error',
        runtimeDiagnosticDescription('error', runtime.lastErrorMessage),
        {
          runtime: runtime.runtime,
          severity: 'error',
          source: 'driver',
          error: runtime.lastErrorMessage,
          stderr: runtime.lastStderrLine,
          phase: runtime.ready ? 'running' : 'starting',
          sessionId: driver.sessionId,
        },
      );
      this.emit('runtime_error', err);
      this.emitRuntimeTrace({ type: 'error', agentId, message: (err as Error).message });
      if (runtime.activeTaskRunId) {
        void this.reportTaskRunLifecycle({
          agentId,
          taskRunId: runtime.activeTaskRunId,
          status: 'failed',
          workspaceId: runtime.workspaceId,
          runtimeSessionId: driver.sessionId ?? runtime.sessionId ?? undefined,
          contextSessionId: runtime.activeTaskRunContextSessionId,
          failureCode: 'RUNTIME_ERROR',
          failureReason: (err as Error).message,
        });
        runtime.activeTaskRunId = undefined;
        runtime.activeTaskRunContextSessionId = undefined;
        runtime.activeTaskRunOutputMessageId = undefined;
        runtime.activeTaskRunToolUseCount = 0;
        runtime.activeTaskRunToolResultCount = 0;
        runtime.lastTurnContextUsage = undefined;
      }
    });

    driver.start();
    const startMessage = driver.pid
      ? `${runtime.runtime} runtime started for agent ${agentId}: pid=${driver.pid} (status=starting, awaiting warmup)`
      : `${runtime.runtime} runtime start requested for agent ${agentId} (status=starting, awaiting ACP session/warmup)`;
    this.log(startMessage, 'info');
    console.error(`[Daemon] ${startMessage}`);
    this.emitRuntimeTrace({
      type: 'start',
      agentId,
      pid: driver.pid,
      resumeSessionId: resumeSessionId ?? undefined,
      status: 'starting',
    });

    if (runtime.runtime === 'pi') {
      // Pi is a lazy one-process-per-turn runtime. Driver initialization has
      // already validated and written its bundled configuration, while sending
      // a synthetic warmup would consume scarce trial LLM capacity before the
      // user has spoken. The first real message performs the live model check.
      this.markRuntimeReady(runtime, 'pi_lazy_driver_ready');
    } else {
      // Inject a startup warmup probe. The message is queued inside the driver
      // (pendingUserMessages) and self-drains once the child is writable.
      // The runtime must call the PATH-injected `aura` tool successfully for the daemon to flip
      // the status to 'running'; otherwise the warmup timer degrades it to ready.
      const warmupText = [
      '[event=system.warmup type=system]',
      'This is a startup readiness check, not a user message.',
      'Run `aura server info` once to confirm Slock connectivity and your agent identity.',
      'Use the bare `aura` command from PATH. Do not inspect or invoke generated absolute wrapper paths.',
      'then stop and wait for real messages. Do not send any chat message during this check.',
    ].join('\n');
    runtime.driver.sendUserMessage(warmupText);
    runtime.warmupStartedAt = Date.now();
    this.startWarmupTimer(runtime);
    }

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
    if (!this.stopping && runtime.activeTaskRunId) {
      void this.reportTaskRunLifecycle({
        agentId,
        taskRunId: runtime.activeTaskRunId,
        status: 'cancelled',
        workspaceId: runtime.workspaceId,
        runtimeSessionId: runtime.driver.sessionId ?? runtime.sessionId ?? undefined,
        contextSessionId: runtime.activeTaskRunContextSessionId,
        failureCode: 'RUNTIME_STOPPED',
        failureReason: 'Runtime stopped before TaskRun completed',
      });
      runtime.activeTaskRunId = undefined;
      runtime.activeTaskRunContextSessionId = undefined;
      runtime.activeTaskRunOutputMessageId = undefined;
      runtime.activeTaskRunToolUseCount = 0;
      runtime.activeTaskRunToolResultCount = 0;
      runtime.lastTurnContextUsage = undefined;
    }
    this.stopRuntimeStallWatchdog(runtime);
    runtime.driver.stop();
    if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');
    this.runtimes.delete(agentId);
    this.channelContexts.clearRuntime(agentId, runtime.wrapper.launchId);
    this.proxy.unregister(runtime.proxyToken);
  }

  private defaultRuntimeWorkspacePath(agentId: string, workspaceId?: string): string {
    const basePath = this.config.workspacePath ?? defaultDaemonWorkspaceRoot();
    if (this.credential?.agentId === agentId && this.runtimes.size === 0) {
      return basePath;
    }
    return daemonRuntimeWorkspacePath(basePath, {
      serverId: this.credential?.serverId,
      computerId: this.credential?.computerId || process.env.SLOCK_COMPUTER_ID,
      machineId: this.credential?.machineId || this.machineId || process.env.SLOCK_MACHINE_ID,
      workspaceId,
      agentId,
    });
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

  async executeRuntimeControlCommand(command: DaemonRuntimeControlCommand): Promise<DaemonRuntimeControlResult> {
    const runtime = this.runtimes.get(command.agentId);
    if (!runtime || (command.workspaceId && command.workspaceId !== runtime.workspaceId)) {
      const result: DaemonRuntimeControlResult = {
        accepted: false,
        delivered: false,
        action: command.action,
        agentId: command.agentId,
        reason: runtime ? 'runtime_workspace_mismatch' : 'runtime_not_running',
      };
      this.emit('runtime_control', result);
      return result;
    }

    const slashCommand = runtimeControlSlashCommand(runtime.runtime, command.action);
    if (!slashCommand) {
      const result: DaemonRuntimeControlResult = {
        accepted: false,
        delivered: false,
        action: command.action,
        agentId: command.agentId,
        runtime: runtime.runtime,
        reason: 'runtime_control_unsupported',
      };
      this.emit('runtime_control', result);
      return result;
    }

    const baseResult: DaemonRuntimeControlResult = {
      accepted: true,
      delivered: false,
      action: command.action,
      agentId: command.agentId,
      runtime: runtime.runtime,
      slashCommand,
    };
    if (runtime.driver.busy) {
      const result: DaemonRuntimeControlResult = {
        ...baseResult,
        reason: 'runtime_control_busy',
      };
      this.emit('runtime_control', result);
      return result;
    }
    const resultCollector = command.waitForResult
      ? collectRuntimeControlResult(runtime.driver, baseResult, command.timeoutMs)
      : null;
    let delivered = false;
    try {
      delivered = runtime.driver.sendUserMessage(slashCommand, { control: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resultCollector?.settle({ error: message });
      const result = {
        ...baseResult,
        error: message,
      };
      this.emit('runtime_control', result);
      return result;
    }
    const result: DaemonRuntimeControlResult = {
      ...baseResult,
      delivered,
      ...(!delivered ? { reason: 'runtime_control_not_delivered' } : {}),
    };
    if (!delivered) {
      resultCollector?.settle({ reason: result.reason });
    }
    this.emit('runtime_control', result);
    this.emitRuntimeTrace({
      type: 'runtime_control',
      agentId: command.agentId,
      action: command.action,
      runtime: runtime.runtime,
      delivered,
      sessionId: runtime.driver.sessionId,
    });
    return resultCollector && delivered
      ? resultCollector.promise.then((settled) => ({ ...settled, delivered: true }))
      : result;
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
      ?? (configRuntime === 'claude_code' ? 'claude' : undefined);
    const workspaces = Array.from(this.runtimes.values()).map((runtime) => ({
      agentId: runtime.agentId,
      workspaceId: runtime.workspaceId,
      runtime: runtime.runtime,
      runtimeCommand: runtime.runtime === 'codex' || runtime.runtimeProvider ? undefined : runtime.runtimeCommand ?? runtimeCommand,
      runtimeModel: runtime.runtimeProvider ? undefined : runtime.runtimeModel ?? this.config.runtimeModel,
      runtimeProvider: runtime.runtimeProvider,
      runtimeAgent: runtime.runtimeAgent,
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
      daemonVersion: DAEMON_VERSION,
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
   * Flip a runtime from 'starting' to 'running' once the warmup aura tool call
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
    void this.reportAgentRuntimeHeartbeat(runtime, 'running');
    if (!this.stopping) void this.registerDaemonLifecycle('heartbeat');
  }

  private async reportAgentRuntimeHeartbeat(runtime: RuntimeRecord, workspaceStatus: 'running' | 'stopped'): Promise<void> {
    const serverUrl = runtime.credential.serverUrl || this.config.serverUrl;
    try {
      const response = await fetch(new URL('/internal/agent-api/heartbeat', serverUrl), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${runtime.credential.token}`,
          'X-Agent-Id': runtime.agentId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: workspaceStatus === 'running' ? 'online' : 'offline',
          computerId: this.credential?.computerId,
          workspaceId: runtime.workspaceId,
          workspaceStatus,
          sessionId: runtime.driver.sessionId ?? runtime.sessionId ?? undefined,
          pid: runtime.driver.pid,
          cwd: runtime.workspacePath,
        }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.log(`Agent runtime heartbeat failed: ${response.status} ${text.slice(0, 200)}`, 'debug');
      }
    } catch (err) {
      this.log(`Agent runtime heartbeat failed: ${(err as Error).message}`, 'debug');
    }
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
   * values to keep network payload small. Calls enqueue onto a per-runtime
   * promise chain so the backend persists Working/Thinking/Output/Idle in the
   * observed provider order while the stream loop itself remains non-blocking.
   */
  private async reportRuntimeActivity(
    runtime: RuntimeRecord,
    kind: string,
    description: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    const truncated = truncateDetails(details, 200);
    runtime.activityReportChain = runtime.activityReportChain.then(async () => {
      if (!this.credential || this.stopping) return;
      const serverUrl = this.credential.serverUrl || this.config.serverUrl;
      try {
        const response = await fetch(new URL('/internal/agent-api/activity', serverUrl), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.credential.token}`,
            'X-Agent-Id': runtime.agentId,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ type: kind, description, details: truncated }),
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      } catch (err) {
        this.log(`Activity report failed (${kind}): ${(err as Error).message}`, 'debug');
      }
    });
    return runtime.activityReportChain;
  }

  async reportTaskRunLifecycle(report: TaskRunLifecycleReport): Promise<void> {
    if (!this.credential || this.stopping) return;
    const serverUrl = this.credential.serverUrl || this.config.serverUrl;
    const body = {
      status: report.status,
      workspaceId: report.workspaceId,
      runtimeSessionId: report.runtimeSessionId,
      workspaceSessionId: report.workspaceSessionId,
      contextSessionId: report.contextSessionId,
      contextUsage: report.contextUsage,
      tokenUsage: report.tokenUsage,
      toolUsageSummary: report.toolUsageSummary,
      outputMessageId: report.outputMessageId,
      failureCode: report.failureCode,
      failureReason: report.failureReason,
    };
    try {
      const response = await fetch(new URL(
        `/internal/agent-api/task-runs/${encodeURIComponent(report.taskRunId)}/lifecycle`,
        serverUrl,
      ), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.credential.token}`,
          'X-Agent-Id': report.agentId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        this.log(`TaskRun lifecycle report failed (${report.status}): ${response.status} ${text.slice(0, 200)}`, 'debug');
      }
    } catch (err) {
      this.log(`TaskRun lifecycle report failed (${report.status}): ${(err as Error).message}`, 'debug');
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
          runtimeAgent: runtime.runtimeAgent,
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
  const details = isRecord(value.details) ? value.details : undefined;
  assignIfPresent(message, 'eventId', firstString(value.eventId, value.event_id, value.id));
  assignIfPresent(message, 'target', firstString(value.target, value.channel, value.channelName));
  assignIfPresent(message, 'messageId', firstString(value.msg, value.messageId, value.message_id, value.id, value.shortId));
  assignIfPresent(message, 'eventSeq', firstString(value.eventSeq, value.eventLogCursor, value.eventCursor));
  assignIfPresent(message, 'traceId', firstString(value.traceId, value.trace_id, details?.traceId));
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
  assignIfPresent(message, 'taskRunId', firstString(value.taskRunId, value.task_run_id, details?.taskRunId, details?.task_run_id));
  assignIfPresent(message, 'taskNumber', firstString(value.taskNumber, value.task_number, value.number));
  assignIfPresent(message, 'status', firstString(value.status, value.taskStatus));
  assignIfPresent(message, 'title', firstString(value.title, value.taskTitle));
  assignIfPresent(message, 'promptProfile', firstString(value.promptProfile, value.prompt_profile, details?.promptProfile, details?.prompt_profile));
  assignIfPresent(message, 'contextSessionId', firstString(value.contextSessionId, value.context_session_id, details?.contextSessionId, details?.context_session_id));
  const taskRunTemplate = firstRecord(value.template, value.taskRunTemplate, value.task_run_template, details?.template, details?.taskRunTemplate, details?.task_run_template);
  if (taskRunTemplate) message.taskRunTemplate = taskRunTemplate;
  const taskRunRole = firstRecord(value.role, value.taskRunRole, value.task_run_role, value.roleSnapshot, value.role_snapshot, details?.role, details?.taskRunRole, details?.task_run_role);
  if (taskRunRole) message.taskRunRole = taskRunRole;
  assignIfPresent(message, 'completionPolicy', firstString(value.completionPolicy, value.completion_policy, details?.completionPolicy, details?.completion_policy));
  assignIfPresent(message, 'timestamp', firstString(value.time, value.timestamp, value.createdAt));
  assignIfPresent(message, 'sender', firstString(value.sender, value.author, value.user, value.username));
  assignIfPresent(message, 'actor', firstString(value.actor, value.actorId, value.actor_id, value.memberId, value.agentId));
  assignIfPresent(message, 'senderType', firstString(value.senderType, value.sender_type, value.type));
  assignIfPresent(message, 'assignee', firstString(value.assignee, value.assigneeHandle, value.assigneeName, details?.assignee));
  assignIfPresent(message, 'assigneeId', firstString(value.assigneeId, value.assignee_id, details?.assigneeId));
  const rosterRevision = positiveInteger(value.rosterRevision ?? value.roster_revision);
  if (rosterRevision !== undefined) message.rosterRevision = rosterRevision;
  const rosterMember = parseRuntimeChannelMember(value.member);
  if (rosterMember) message.member = rosterMember;
  const referenceUpdates = parseRuntimeReferenceUpdates(value.referenceUpdates ?? value.reference_updates);
  if (referenceUpdates.length > 0) message.referenceUpdates = referenceUpdates;
  assignIfPresent(message, 'removedAgentId', firstString(value.removedAgentId, value.removed_agent_id));
  if (eventType && eventType !== 'message_received') {
    message.eventType = eventType;
  }
  return message;
}

export function parseRuntimeChannelSnapshot(
  input: unknown,
  fallbackChannelId?: string,
): RuntimeChannelSnapshot | null {
  if (!isRecord(input)) return null;
  const channelId = firstString(input.channelId, input.channel_id, fallbackChannelId);
  const rosterRevision = positiveInteger(input.rosterRevision ?? input.roster_revision);
  if (!channelId || rosterRevision === undefined || !Array.isArray(input.members)) return null;
  const members: RuntimeChannelMember[] = [];
  for (const rawMember of input.members) {
    const member = parseRuntimeChannelMember(rawMember);
    if (member) members.push(member);
  }
  return { channelId, rosterRevision, members };
}

export function runtimeChannelMembershipChange(
  message: RuntimeIncomingMessage,
): RuntimeChannelMembershipChange | null {
  const eventType = canonicalChannelMembershipEventType(message.eventType);
  if (!eventType) return null;
  if (!message.channelId || message.rosterRevision === undefined || !message.member) return null;
  return {
    eventId: message.eventId,
    eventType,
    channelId: message.channelId,
    rosterRevision: message.rosterRevision,
    member: message.member,
    referenceUpdates: message.referenceUpdates ?? [],
    removedAgentId: message.removedAgentId,
  };
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
    message.taskRunId ? `run=${message.taskRunId}` : undefined,
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
    'Use these snippets as orientation only. For full details, call `aura memory read` or `aura memory search`.',
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
    'Use `aura task claim` for this task if it is still todo, do the requested work, then use `aura task update --status in_review` when ready for human review.',
  ];

  if (message.taskRunId || message.promptProfile || message.contextSessionId) {
    const runLabel = message.taskRunId ?? 'this TaskRun';
    const promptProfile = message.promptProfile ?? 'the assigned task prompt profile';
    const contextSession = message.contextSessionId ?? 'the assigned run context session';
    lines.push(`TaskRun ${runLabel} uses prompt profile ${promptProfile} and context session ${contextSession}.`);
    lines.push('Treat this as a run-scoped context boundary; do not assume unrelated channel or previous task context is already loaded.');
  }

  const templateBlock = formatTaskRunTemplateBlock(message);
  if (templateBlock.length > 0) {
    lines.push('', ...templateBlock);
  }

  if (message.target) {
    lines.push(`Post progress and the final result back to ${message.target} with \`aura message send --target "${message.target}"\`.`);
  } else {
    lines.push('Post progress and the final result back to the source task thread or visible source conversation.');
  }

  lines.push('', message.content);
  return lines.join('\n');
}

function formatTaskRunTemplateBlock(message: RuntimeIncomingMessage): string[] {
  const template = message.taskRunTemplate;
  const role = message.taskRunRole;
  if (!template && !role && !message.completionPolicy) return [];

  const lines = ['TaskRun Template:'];
  const templateName = firstString(template?.name, template?.displayName);
  const templateSlug = firstString(template?.slug, template?.key);
  if (templateName || templateSlug) {
    lines.push(`- Template: ${formatNameAndKey(templateName, templateSlug)}`);
  }

  const roleName = firstString(role?.displayName, role?.name);
  const roleKey = firstString(role?.roleKey, role?.key);
  const rolePurpose = firstString(role?.purpose);
  if (roleName || roleKey || rolePurpose) {
    const roleLabel = formatNameAndKey(roleName, roleKey);
    lines.push(`- Role: ${rolePurpose ? `${roleLabel} - ${truncateMemoryContextText(rolePurpose, 180)}` : roleLabel}`);
  }

  const toolSummary = summarizeToolPolicy(firstRecord(role?.toolPolicy, role?.tool_policy, template?.toolPolicy, template?.tool_policy));
  if (toolSummary) lines.push(`- Tools: ${toolSummary}`);

  const skillSummary = summarizeSkillPolicy(firstRecord(role?.skillPolicy, role?.skill_policy, template?.skillPolicy, template?.skill_policy));
  if (skillSummary) lines.push(`- Skills: ${skillSummary}`);

  const memorySummary = summarizeMemoryPolicy(firstRecord(role?.memoryPolicy, role?.memory_policy, template?.memoryPolicy, template?.memory_policy));
  if (memorySummary) lines.push(`- Memory: ${memorySummary}`);

  const outputSummary = summarizeOutputPolicy(firstRecord(role?.outputPolicy, role?.output_policy, template?.outputPolicy, template?.output_policy));
  if (outputSummary) lines.push(`- Outputs: ${outputSummary}`);

  const loopPolicy = firstRecord(role?.loopPolicy, role?.loop_policy, template?.loopPolicy, template?.loop_policy);
  const completionPolicy = firstString(message.completionPolicy, loopPolicy?.completionPolicy, loopPolicy?.completion_policy);
  if (completionPolicy) lines.push(`- Completion: ${completionPolicy}`);

  return lines.length > 1 ? lines : [];
}

function formatNameAndKey(name: string | undefined, key: string | undefined): string {
  if (name && key && name !== key) return `${name} (${key})`;
  return name ?? key ?? 'unspecified';
}

function summarizeToolPolicy(policy: Record<string, unknown> | undefined): string | undefined {
  if (!policy) return undefined;
  const allowed = arrayOfStrings(policy.allowedToolGroups ?? policy.allowed ?? policy.allow);
  const parts: string[] = [];
  if (allowed.length > 0) parts.push(allowed.join(', '));
  if (policy.writeSlockCommands === true || policy.write_slock_commands === true) parts.push('slock writes allowed');
  if (policy.shellExecution === true || policy.shell_execution === true) parts.push('shell allowed');
  if (policy.browserTools === true || policy.browser_tools === true) parts.push('browser tools allowed');
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function summarizeSkillPolicy(policy: Record<string, unknown> | undefined): string | undefined {
  if (!policy) return undefined;
  const required = arrayOfStrings(policy.requiredSkills ?? policy.required ?? policy.required_skills);
  const recommended = arrayOfStrings(policy.recommendedSkills ?? policy.recommended ?? policy.recommended_skills);
  if (required.length > 0) return required.join(', ');
  if (recommended.length > 0) return `recommended ${recommended.join(', ')}`;
  if (policy.allowAdditionalSkills === true || policy.allow_additional_skills === true) return 'runtime may choose additional skills';
  return undefined;
}

function summarizeMemoryPolicy(policy: Record<string, unknown> | undefined): string | undefined {
  if (!policy) return undefined;
  const readScopes = arrayOfStrings(policy.readScopes ?? policy.read_scopes);
  const writeScopes = arrayOfStrings(policy.writeScopes ?? policy.write_scopes);
  const parts: string[] = [];
  if (readScopes.length > 0) parts.push(`read ${readScopes.join(', ')}`);
  if (writeScopes.length > 0) parts.push(`write ${writeScopes.join(', ')}`);
  if (policy.summaryOnCompletion === true || policy.summary_on_completion === true) parts.push('summary on completion');
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function summarizeOutputPolicy(policy: Record<string, unknown> | undefined): string | undefined {
  if (!policy) return undefined;
  const outputTypes = arrayOfStrings(policy.expectedOutputTypes ?? policy.required ?? policy.expected_output_types);
  const parts: string[] = [];
  if (outputTypes.length > 0) parts.push(outputTypes.join(', '));
  if (policy.channelMessageRequired === true || policy.channel_message_required === true) parts.push('channel message required');
  if (policy.multipleOutputsAllowed === true || policy.multiple_outputs_allowed === true) parts.push('multiple outputs allowed');
  return parts.length > 0 ? parts.join('; ') : undefined;
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
  assignDefined(runtimeConfig, 'runtimeAgent', firstString(config.runtimeAgent, config.runtime_agent, value.runtimeAgent, value.runtime_agent, value.agent));
  assignDefined(runtimeConfig, 'runtimeCommand', firstString(config.runtimeCommand, config.runtime_command, value.runtimeCommand, value.runtime_command));
  assignDefined(runtimeConfig, 'runtimeProvider', firstString(config.runtimeProvider, config.runtime_provider, config.provider, value.runtimeProvider, value.runtime_provider, value.provider));
  assignDefined(runtimeConfig, 'workspacePath', firstString(config.workspacePath, config.workspace_path, value.workspacePath, value.cwd));
  assignDefined(runtimeConfig, 'workspaceId', command.workspaceId);
  assignDefined(runtimeConfig, 'backend', firstString(config.backend, value.backend));
  if (config.allowWrites === true || config.allow_writes === true || value.allowWrites === true || value.allow_writes === true) {
    runtimeConfig.allowWrites = true;
  }
  assignDefined(runtimeConfig, 'writeTargetAllowlist', firstString(
    config.writeTargetAllowlist,
    config.write_target_allowlist,
    value.writeTargetAllowlist,
    value.write_target_allowlist,
  ));
  const runtimeCommandArgs = arrayOfStrings(config.runtimeCommandArgs ?? config.runtime_command_args ?? value.runtimeCommandArgs);
  if (runtimeCommandArgs.length > 0) {
    runtimeConfig.runtimeCommandArgs = runtimeCommandArgs;
  }
  if (Object.keys(runtimeConfig).length > 0) {
    command.config = runtimeConfig;
  }
  return command;
}

export function parseDaemonRuntimeControlCommand(input: unknown): DaemonRuntimeControlCommand | null {
  const value = unwrapRuntimeControlPayload(input);
  if (!isRecord(value)) return null;

  const action = firstString(value.action, value.command, value.commandType);
  if (action !== 'inspect_context' && action !== 'compact' && action !== 'usage_status') return null;
  const agentId = firstString(value.agentId, value.agent_id, value.memberId, value.member_id);
  if (!agentId) return null;

  const command: DaemonRuntimeControlCommand = { action, agentId };
  assignDefined(command, 'workspaceId', firstString(value.workspaceId, value.workspace_id));
  if (value.waitForResult === true || value.wait_for_result === true) command.waitForResult = true;
  const timeoutMs = Number(value.timeoutMs ?? value.timeout_ms);
  if (Number.isFinite(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 120_000) command.timeoutMs = timeoutMs;
  return command;
}

function unwrapRuntimeControlPayload(input: unknown): unknown {
  if (!isRecord(input)) return input;
  const type = firstString(input.type, input.eventType);
  if ((type === 'runtime_control' || type === 'daemon.runtime_control') && isRecord(input.command)) {
    return unwrapRuntimeControlPayload(input.command);
  }
  if (type === 'runtime_control' || type === 'daemon.runtime_control') return input;
  const method = firstString(input.method);
  if (method === 'daemon.runtime_control' || method === 'daemon/runtime_control' || method === 'runtime_control') {
    return unwrapRuntimeControlPayload(input.params);
  }
  if (isRecord(input.params)) return unwrapRuntimeControlPayload(input.params);
  if (isRecord(input.event)) return unwrapRuntimeControlPayload(input.event);
  return input;
}

function runtimeControlSlashCommand(runtime: string, action: DaemonRuntimeControlCommand['action']): string | null {
  if (runtime === 'claude_code') {
    if (action === 'inspect_context') return '/context';
    if (action === 'compact') return '/compact';
    if (action === 'usage_status') return '/usage';
  }
  if (runtime === 'codex' || runtime === 'codex_acp') {
    if (action === 'compact') return '/compact';
    if (action === 'inspect_context' || action === 'usage_status') return '/status';
  }
  return null;
}

const RUNTIME_CONTROL_OUTPUT_MAX_CHARS = 65_536;

function collectRuntimeControlResult(
  driver: ManagedRuntimeDriver,
  baseResult: DaemonRuntimeControlResult,
  timeoutMs = 30_000,
): {
  promise: Promise<DaemonRuntimeControlResult>;
  settle: (patch?: Partial<DaemonRuntimeControlResult>) => void;
} {
  const chunks: string[] = [];
  let capturedChars = 0;
  let outputTruncated = false;
  let settleCollector: (patch?: Partial<DaemonRuntimeControlResult>) => void = () => {};
  const promise = new Promise<DaemonRuntimeControlResult>((resolveResult) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      driver.off('stream_event', onStreamEvent);
    };
    const settle = (patch: Partial<DaemonRuntimeControlResult> = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveResult({
        ...baseResult,
        output: chunks.join('').trim() || undefined,
        ...(outputTruncated ? { outputTruncated: true } : {}),
        ...patch,
      });
    };
    settleCollector = settle;
    const boundedTimeout = Math.min(120_000, Math.max(100, timeoutMs));
    const timer = setTimeout(() => settle({ reason: 'runtime_control_timeout' }), boundedTimeout);
    timer.unref?.();
    const onStreamEvent = (event: unknown) => {
      if (!isRecord(event)) return;
      if (event.type === 'assistant') {
        for (const block of getContentBlocks(event)) {
          if (block.type !== 'text' || typeof block.text !== 'string') continue;
          const remaining = RUNTIME_CONTROL_OUTPUT_MAX_CHARS - capturedChars;
          if (remaining <= 0) {
            outputTruncated = true;
            continue;
          }
          const captured = block.text.slice(0, remaining);
          chunks.push(captured);
          capturedChars += captured.length;
          if (captured.length < block.text.length) outputTruncated = true;
        }
      }
      if (event.type === 'result') {
        const isError = event.is_error === true || event.subtype === 'error';
        settle(isError ? { error: firstString(event.error, event.message) ?? 'runtime_control_failed' } : {});
      }
    };
    driver.on('stream_event', onStreamEvent);
  });
  return { promise, settle: settleCollector };
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
  if (runtime === 'opencode') return 'opencode';
  if (runtime === 'pi') return 'pi';
  return undefined;
}

function codexAcpRuntimeCommand(
  command: string | undefined,
  commandArgs: string[] | undefined,
  source: 'control' | 'daemon',
): string | undefined {
  const trimmed = command?.trim();
  if (!trimmed) return undefined;
  if (isCodexAcpLaunchCommand(trimmed, commandArgs)) return trimmed;
  console.warn(`Ignoring non-ACP ${source} runtimeCommand for codex runtime: ${trimmed}`);
  return undefined;
}

function isCodexAcpLaunchCommand(command: string, commandArgs: string[] | undefined): boolean {
  const commandName = (command.split(/[\\/]/).pop() ?? command).toLowerCase();
  if (/^npx(\.cmd)?$/.test(commandName)) return true;
  if (/^codex-acp(\.(cmd|ps1|bat))?$/.test(commandName)) return true;
  if (/^node(\.exe)?$/.test(commandName) && commandArgs && commandArgs.length > 0) return true;
  return false;
}

function requiresDetectedRuntimeCommand(runtime: DaemonRuntimeImplementation): boolean {
  return runtime === 'claude_code' || runtime === 'opencode';
}

function runtimeCommandDetectionError(runtime: DaemonRuntimeImplementation): string {
  if (runtime === 'claude_code') {
    return 'Cannot start claude_code runtime: no Claude Code command was detected. Install Claude Code or set SLOCK_CLAUDE_COMMAND/CLAUDE_COMMAND.';
  }
  if (runtime === 'opencode') {
    return 'Cannot start opencode runtime: no OpenCode command was detected. Install OpenCode or set SLOCK_OPENCODE_COMMAND/OPENCODE_COMMAND.';
  }
  return `Cannot start ${runtime} runtime: no launch command was detected.`;
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

type RuntimeDiagnosticSeverity = 'warning' | 'error';

function classifyRuntimeDiagnostic(text: string): RuntimeDiagnosticSeverity | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;

  // These are daemon-authored informational lines, not child diagnostics.
  if (/^Codex(?: ACP)? Slock prompt written to\b/i.test(normalized)) return undefined;
  if (/^Codex turn exited: code=0\b/i.test(normalized)) return undefined;

  const errorPatterns = [
    /^(?:error|fatal)(?:\b|\s*:)/i,
    /\bACP connection closed\b/i,
    /\bNo such file or directory\b/i,
    /\bMISSING_TOKEN\b/i,
    /\bpermission denied\b/i,
    /\bcommand not found\b/i,
    /\b(?:fetch|request|connection|spawn) failed\b/i,
  ];
  if (errorPatterns.some((pattern) => pattern.test(normalized))) return 'error';

  const warningPatterns = [
    /^(?:warning|warn)(?:\b|\s*:)/i,
    /\bModel metadata for .+ not found\. Defaulting to fallback metadata\b/i,
    /\bdefaulting to fallback metadata\b/i,
  ];
  if (warningPatterns.some((pattern) => pattern.test(normalized))) return 'warning';

  // Unclassified stderr remains available in daemon logs and is attached to
  // an unexpected-exit Error activity. Do not turn arbitrary stderr chatter
  // into a high-volume Activity feed.
  return undefined;
}

function runtimeDiagnosticDescription(severity: RuntimeDiagnosticSeverity, text: string): string {
  const prefix = severity === 'error' ? 'Runtime error: ' : 'Runtime warning: ';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return `${prefix}${normalized}`.slice(0, 240);
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

const SENSITIVE_SLOCK_ENV_NAMES = [
  'SLOCK_AGENT_PROXY_URL',
  'SLOCK_AGENT_PROXY_TOKEN',
  'SLOCK_AGENT_PROXY_TOKEN_FILE',
  'SLOCK_AGENT_ACTIVE_CAPABILITIES',
] as const;

export function sanitizeRuntimeCommandPreview(command: string): string {
  let preview = command;
  for (const name of SENSITIVE_SLOCK_ENV_NAMES) {
    preview = preview
      .replace(new RegExp(`^\\s*export\\s+${name}=.*(?:\\r?\\n|$)`, 'gmi'), '')
      .replace(new RegExp(`^\\s*set\\s+"${name}=.*"\\s*(?:\\r?\\n|$)`, 'gmi'), '')
      .replace(new RegExp(`^\\s*\\$env:${name}=.*(?:\\r?\\n|$)`, 'gmi'), '')
      .replace(new RegExp(`\\b${name}=(?:'((?:'\\\\''|[^'])*)'|"[^"]*"|\\S+)\\s*`, 'g'), '');
  }
  preview = preview.replace(/[^\s'"]*agent-proxy-tokens[^\s'"]*/g, '[slock-proxy-token-file]');
  return preview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractTaskRunOutputMessageIdFromEvent(event: unknown): string | undefined {
  const record = isRecord(event) ? event : {};
  for (const block of getContentBlocks(record)) {
    if (block.type !== 'tool_result') continue;
    const direct = extractMessageIdFromUnknown(block);
    if (direct) return direct;
  }
  if (isRecord(event)) {
    const direct = extractMessageIdFromUnknown(event.tool_use_result);
    if (direct) return direct;
  }
  return undefined;
}

function extractMessageIdFromUnknown(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return extractMessageIdFromUnknown(JSON.parse(trimmed));
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractMessageIdFromUnknown(item);
      if (found) return found;
    }
    return undefined;
  }
  if (!isRecord(value)) return undefined;
  const messageId = firstString(value.messageId, value.message_id);
  if (messageId && UUID_RE.test(messageId)) return messageId;
  const stdoutId = extractMessageIdFromUnknown(value.stdout);
  if (stdoutId) return stdoutId;
  const contentId = extractMessageIdFromUnknown(value.content);
  if (contentId) return contentId;
  return undefined;
}

function countToolResults(event: unknown): number {
  const record = isRecord(event) ? event : {};
  return getContentBlocks(record).filter((block) => block.type === 'tool_result').length;
}

export function buildTaskRunCompletionSummary(
  event: unknown,
  usage: { source?: string; inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number } | undefined,
  counters: { toolUseCount?: number; toolResultCount?: number; outputMessageId?: string | undefined },
  contextUsage?: { source?: string; knownTokens?: number; contextWindow?: number; occupancyRatio?: number },
): {
  tokenUsage: Record<string, unknown>;
  contextUsage: Record<string, unknown>;
  toolUsageSummary: Record<string, unknown>;
  outputMessageId?: string;
} {
  const resultData = isRecord(event) ? event : {};
  const providerUsage = isRecord(resultData.usage) ? resultData.usage : {};
  const inputTokens = usage?.inputTokens ?? numberFrom(providerUsage.input_tokens);
  const outputTokens = usage?.outputTokens ?? numberFrom(providerUsage.output_tokens);
  const cacheReadInputTokens = usage?.cacheReadInputTokens ?? numberFrom(providerUsage.cache_read_input_tokens);
  const totalTokens = sumNumbers(inputTokens, outputTokens, cacheReadInputTokens);
  const tokenUsage: Record<string, unknown> = {
    source: usage?.source ?? 'provider-stream-json',
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    totalTokens,
    durationMs: numberFrom(resultData.duration_ms),
    durationApiMs: numberFrom(resultData.duration_api_ms),
    numTurns: numberFrom(resultData.num_turns),
    totalCostUsd: numberFrom(resultData.total_cost_usd),
  };
  for (const key of Object.keys(tokenUsage)) {
    if (tokenUsage[key] === undefined) delete tokenUsage[key];
  }
  const fallbackKnownTokens = sumNumbers(inputTokens, outputTokens);
  const knownTokens = contextUsage?.knownTokens
    ?? numberFrom(resultData.used)
    ?? numberFrom(resultData.totalTokens)
    ?? numberFrom(resultData.total_tokens)
    ?? fallbackKnownTokens;
  const contextWindow = contextUsage?.contextWindow
    ?? numberFrom(resultData.contextWindow)
    ?? numberFrom(resultData.context_window)
    ?? numberFrom(resultData.size)
    ?? numberFrom(providerUsage.contextWindow)
    ?? numberFrom(providerUsage.context_window)
    ?? contextWindowFromModelUsage(resultData.modelUsage);
  const occupancyRatio = contextUsage?.occupancyRatio
    ?? (knownTokens !== undefined && contextWindow !== undefined && contextWindow > 0 ? knownTokens / contextWindow : undefined);
  const contextUsageSummary: Record<string, unknown> = {
    source: contextUsage?.source ?? 'provider-stream-json',
    knownTokens,
    contextWindow,
    occupancyRatio,
  };
  for (const key of Object.keys(contextUsageSummary)) {
    if (contextUsageSummary[key] === undefined) delete contextUsageSummary[key];
  }
  return {
    tokenUsage,
    contextUsage: contextUsageSummary,
    toolUsageSummary: {
      toolUseCount: counters.toolUseCount ?? 0,
      toolResultCount: counters.toolResultCount ?? 0,
    },
    outputMessageId: counters.outputMessageId,
  };
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function contextWindowFromModelUsage(value: unknown): number | undefined {
  if (!isRecord(value)) return undefined;
  const modelNames = Object.keys(value);
  for (const name of modelNames) {
    if (name === 'total') continue;
    const entry = isRecord(value[name]) ? value[name] : undefined;
    const contextWindow = numberFrom(entry?.contextWindow) ?? numberFrom(entry?.context_window);
    if (contextWindow !== undefined) return contextWindow;
  }
  const total = isRecord(value.total) ? value.total : undefined;
  return numberFrom(total?.contextWindow) ?? numberFrom(total?.context_window);
}

function sumNumbers(...values: Array<number | undefined>): number | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  return present.length ? present.reduce((total, value) => total + value, 0) : undefined;
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

  if (isChannelMembershipEventType(rawType) && isRecord(input.payload)) {
    const normalized: Record<string, unknown> = {
      ...input.payload,
      type: rawType,
    };
    assignRawIfMissing(normalized, 'eventId', input.eventId ?? input.event_id ?? input.id);
    assignRawIfMissing(normalized, 'eventSeq', input.eventSeq ?? input.eventLogCursor ?? input.eventCursor ?? input.seq);
    assignRawIfMissing(normalized, 'timestamp', input.timestamp ?? input.createdAt);
    assignRawIfMissing(normalized, 'channelId', input.channelId ?? input.channel_id);
    assignRawIfMissing(normalized, 'actor', input.actor ?? input.actorId ?? input.actor_id);
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

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  for (const value of values) {
    if (isRecord(value)) return value;
  }
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return Math.floor(parsed);
}

function parseRuntimeChannelMember(input: unknown): RuntimeChannelMember | null {
  if (!isRecord(input)) return null;
  const memberId = firstString(input.memberId, input.member_id, input.id);
  const kind = firstString(input.kind, input.type);
  const reference = firstString(input.reference, input.handle);
  if (!memberId || !kind || !reference) return null;
  const canonicalReference = reference.startsWith('@') ? reference : `@${reference}`;
  const member: RuntimeChannelMember = {
    memberId,
    kind,
    reference: canonicalReference,
  };
  const handle = firstString(input.handle);
  if (handle) member.handle = handle.startsWith('@') ? handle.slice(1) : handle;
  const status = firstString(input.status);
  if (status) member.status = status;
  const description = firstString(input.description);
  if (kind === 'agent' && description) member.description = description;
  return member;
}

function parseRuntimeReferenceUpdates(input: unknown): RuntimeChannelReferenceUpdate[] {
  if (!Array.isArray(input)) return [];
  const updates: RuntimeChannelReferenceUpdate[] = [];
  for (const rawUpdate of input) {
    if (!isRecord(rawUpdate)) continue;
    const memberId = firstString(rawUpdate.memberId, rawUpdate.member_id, rawUpdate.id);
    const reference = firstString(rawUpdate.reference, rawUpdate.handle);
    if (!memberId || !reference) continue;
    updates.push({
      memberId,
      reference: reference.startsWith('@') ? reference : `@${reference}`,
    });
  }
  return updates;
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

export function isChannelMembershipEventType(type?: string): boolean {
  return type === 'channel.member_joined'
    || type === 'channel.member_left'
    || type === 'channel_member_joined'
    || type === 'channel_member_left';
}

function canonicalChannelMembershipEventType(
  type?: string,
): RuntimeChannelMembershipChange['eventType'] | null {
  if (type === 'channel.member_joined' || type === 'channel_member_joined') {
    return 'channel.member_joined';
  }
  if (type === 'channel.member_left' || type === 'channel_member_left') {
    return 'channel.member_left';
  }
  return null;
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
