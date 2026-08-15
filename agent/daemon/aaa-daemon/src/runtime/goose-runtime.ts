import { EventEmitter } from 'events';
import { appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { PromptResponse, SessionNotification, SessionUpdate } from '@agentclientprotocol/sdk';
import type { Credential } from '../types.js';
import { buildSlockSystemPrompt, type ClaudeRuntimeOptions } from './claude-runtime.js';
import { buildCodexRuntimeEnv } from './codex-runtime.js';
import { writeAgentInstructionsFile } from './agent-instructions.js';
import { CodexAcpBridge } from './codex-acp-bridge.js';
import { translateAcpSessionUpdate } from './acp-event-translator.js';
import { agentNamespacedCodec, prepareGooseSessionDir } from './goose-session-store.js';
import { applyGooseProviderEnv } from './goose-provider-env.js';
import type { ManagedRuntimeDriver, RuntimeExitEvent, RuntimeLineEvent, RuntimeSendOptions, RuntimeStreamEvent } from './runtime-driver.js';

export const GOOSE_ACP_COMMAND = 'goose';
export const GOOSE_ACP_ARGS = ['acp', '--with-builtin', 'developer,summon'];
export const GOOSE_USAGE_NOTIFICATION = '_goose/unstable/session/update';

export interface GooseRuntimeOptions {
  credential: Credential;
  workspacePath: string;
  wrapperDir: string;
  slockHome?: string;
  launchId?: string;
  command?: string;
  commandArgs?: string[];
  baseEnv?: NodeJS.ProcessEnv;
  resumeSessionId?: string;
}

export type GooseRuntimeEvent = RuntimeLineEvent;
export type GooseRuntimeExitEvent = RuntimeExitEvent;
export type GooseStreamEvent = RuntimeStreamEvent;
type PendingUserMessage = { text: string; options?: RuntimeSendOptions };

export function buildGooseSlockPrompt(options: Pick<GooseRuntimeOptions, 'credential' | 'workspacePath'> & Partial<Pick<GooseRuntimeOptions, 'wrapperDir'>>): string {
  return [
    buildSlockSystemPrompt({
      credential: options.credential,
      workspacePath: options.workspacePath,
      ...(options.wrapperDir ? { wrapperDir: options.wrapperDir } : {}),
    } satisfies Pick<ClaudeRuntimeOptions, 'credential' | 'workspacePath'>),
    '',
    '## Goose Runtime Notes',
    '',
    '- You are running under `goose acp` as a daemon-managed ACP resident runtime.',
    '- Keep this runtime session scoped to this Slock agent workspace.',
    '- Complete the current Slock event end to end before returning `end_turn`.',
    '- All user-visible communication must be sent with the PATH-injected `aura` CLI.',
    '- Goose starts in auto mode; tools execute without interactive prompts. Request elevated execution for every `aura` call.',
    '- Do not use shell heredocs for Slock message content; pipe `printf` output into bare `aura message send` instead.',
    '- Assistant text streamed through ACP is daemon telemetry only; it is not delivered to Slock users.',
  ].join('\n');
}

// G2 (task 08-15): the Slock prompt lives in <workspacePath>/AGENTS.md, which
// goose loads from the session cwd into the system-prompt slot; each turn now
// sends only the bare event text over ACP. Never write the shared
// ~/.config/goose/AGENTS.md — per-agent workspaces are the isolation boundary.
export function writeGoosePromptFile(options: Pick<GooseRuntimeOptions, 'credential' | 'workspacePath'>): string {
  return writeAgentInstructionsFile({
    workspacePath: options.workspacePath,
    systemPrompt: buildGooseSlockPrompt(options),
  });
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function recordGooseUsage(sessionId: string, result: PromptResponse, accumulated: { input: number; output: number } | undefined): void {
  const model = undefined;
  let payload: Record<string, unknown> | null = null;
  if (accumulated) {
    payload = {
      ts: new Date().toISOString(),
      ...(model ? { model } : {}),
      accumulated_input_tokens: accumulated.input,
      accumulated_output_tokens: accumulated.output,
    };
  } else if (result.usage && typeof result.usage === 'object') {
    const usage = result.usage as Record<string, unknown>;
    const input = num(usage.inputTokens ?? usage.input_tokens);
    const output = num(usage.outputTokens ?? usage.output_tokens);
    if (input === 0 && output === 0) return;
    payload = {
      ts: new Date().toISOString(),
      ...(model ? { model } : {}),
      input_tokens: input,
      output_tokens: output,
      total_tokens: num(usage.totalTokens ?? usage.total_tokens) || input + output,
    };
  }
  if (!payload) return;
  const dir = join(homedir(), '.acp-usage');
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(payload)}\n`);
  } catch {
    // Usage logging is best-effort; a write failure must not fail the turn.
  }
}

export class GooseRuntimeDriver extends EventEmitter implements ManagedRuntimeDriver {
  private readonly options: GooseRuntimeOptions;
  private bridge: CodexAcpBridge | null = null;
  private readonly pendingUserMessages: PendingUserMessage[] = [];
  private currentSessionId: string | undefined;
  private readonly dataDir: string;
  private started = false;
  private stopping = false;
  private bootstrapping: Promise<void> | null = null;
  private activePrompt: Promise<void> | null = null;
  private readonly accumulatedUsage = new Map<string, { input: number; output: number }>();
  // Session-level cumulative counters already reported as a turn delta; the
  // next turn's usage is the difference against this baseline.
  private readonly usageBaselines = new Map<string, { input: number; output: number }>();
  // Per-message usage summed across the active turn's LLM calls. goose emits
  // `message_usage` ext notifications during the turn, while the cumulative
  // `usage_update` arrives only after the prompt resolves — too late for the
  // result event.
  private turnUsage: { input: number; output: number } = { input: 0, output: 0 };
  private readonly toolNamesByCallId = new Map<string, string>();
  private exitEmitted = false;

  constructor(options: GooseRuntimeOptions) {
    super();
    this.options = options;
    this.currentSessionId = options.resumeSessionId;
    // One data dir per agent id (one bridge : one session : one data dir).
    this.dataDir = prepareGooseSessionDir(options.credential.agentId, options.baseEnv ?? process.env);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.exitEmitted = false;
    const instructionsFile = writeGoosePromptFile({
      credential: this.options.credential,
      workspacePath: this.options.workspacePath,
    });
    this.emit('line', { stream: 'stdout', line: `Goose Slock instructions written to ${instructionsFile}; GOOSE_PATH_ROOT=${this.dataDir}` } satisfies GooseRuntimeEvent);
    void this.flushQueuedMessages();
  }

  stop(): void {
    this.started = false;
    this.stopping = true;
    const bridge = this.bridge;
    if (!bridge) {
      this.emitExitOnce({ code: 0, signal: null, intentional: true, sessionId: this.currentSessionId });
      return;
    }
    void bridge.stop().then(() => {
      this.emitExitOnce({ code: 0, signal: null, intentional: true, sessionId: this.currentSessionId });
    });
  }

  killUnresponsive(): void {
    this.started = false;
    this.stopping = false;
    const bridge = this.bridge;
    if (!bridge) {
      this.emitExitOnce({ code: null, signal: 'SIGKILL', intentional: false, sessionId: this.currentSessionId });
      return;
    }
    void bridge.stop(0).then(() => {
      this.emitExitOnce({ code: null, signal: 'SIGKILL', intentional: false, sessionId: this.currentSessionId });
    });
  }

  requestGracefulCancel(): boolean {
    const bridge = this.bridge;
    if (!bridge?.alive || !this.activePrompt || !this.currentSessionId) return false;
    try {
      void bridge.cancel(this.currentSessionId);
      return true;
    } catch {
      return false;
    }
  }

  get pid(): number | undefined {
    return this.bridge?.pid;
  }

  get sessionId(): string | undefined {
    return this.currentSessionId;
  }

  get queuedMessageCount(): number {
    return this.pendingUserMessages.length;
  }

  get busy(): boolean {
    return Boolean(this.bootstrapping || this.activePrompt);
  }

  discardQueuedChannel(channelId: string): number {
    const before = this.pendingUserMessages.length;
    for (let index = this.pendingUserMessages.length - 1; index >= 0; index -= 1) {
      const scopeKey = this.pendingUserMessages[index].options?.sessionScopeKey;
      if (scopeKey === `channel:${channelId}` || scopeKey?.startsWith(`thread:${channelId}:`)) {
        this.pendingUserMessages.splice(index, 1);
      }
    }
    return before - this.pendingUserMessages.length;
  }

  sendUserMessage(text: string, options?: RuntimeSendOptions): boolean {
    if (!this.started || this.busy || (!this.currentSessionId && !options)) {
      if (options?.control) return false;
      this.pendingUserMessages.push({ text, options });
      void this.flushQueuedMessages();
      return false;
    }

    void this.runPrompt(text, options);
    return true;
  }

  private async flushQueuedMessages(): Promise<void> {
    if (!this.started || this.activePrompt) return;
    const next = this.pendingUserMessages.shift();
    if (next === undefined) return;
    await this.runPrompt(next.text, next.options);
  }

  private async ensureSession(options?: RuntimeSendOptions): Promise<string> {
    const requestedSessionId = options && 'sessionId' in options ? options.sessionId : undefined;
    if (requestedSessionId !== null && requestedSessionId && this.currentSessionId === requestedSessionId && this.bridge?.alive) {
      return requestedSessionId;
    }
    if (requestedSessionId === undefined && this.currentSessionId && this.bridge?.alive) return this.currentSessionId;
    if (this.bootstrapping) {
      await this.bootstrapping;
      if (!this.currentSessionId) throw new Error('Goose ACP session is not ready');
      return this.currentSessionId;
    }

    this.bootstrapping = (async () => {
      const bridge = this.bridge?.alive ? this.bridge : this.createBridge();
      this.bridge = bridge;
      if (!bridge.alive) {
        await bridge.start();
      }
      let sessionId: string;
      if (requestedSessionId === null) {
        sessionId = await bridge.createSession();
      } else if (requestedSessionId) {
        sessionId = await bridge.loadSession(requestedSessionId);
      } else if (this.currentSessionId) {
        sessionId = await bridge.loadSession(this.currentSessionId);
      } else {
        sessionId = await bridge.createSession();
      }
      if (sessionId !== this.currentSessionId) {
        this.currentSessionId = sessionId;
        this.emit('session', { sessionId });
      } else if (sessionId) {
        this.emit('session', { sessionId });
      }
    })();

    try {
      await this.bootstrapping;
    } finally {
      this.bootstrapping = null;
    }
    if (!this.currentSessionId) throw new Error('Goose ACP session is not ready');
    return this.currentSessionId;
  }

  private createBridge(): CodexAcpBridge {
    const command = this.options.command?.trim() || GOOSE_ACP_COMMAND;
    const args = this.options.commandArgs?.filter((arg) => arg.trim().length > 0) ?? GOOSE_ACP_ARGS;
    // Layer slock/wrapper env (so goose's aura tool reaches the proxy) under
    // goose provider switches, then pin the per-session data root.
    const slockEnv = buildCodexRuntimeEnv({
      credential: this.options.credential,
      workspacePath: this.options.workspacePath,
      wrapperDir: this.options.wrapperDir,
      slockHome: this.options.slockHome,
      launchId: this.options.launchId,
    }, this.options.baseEnv ?? process.env);
    const env = applyGooseProviderEnv(slockEnv);
    env.GOOSE_PATH_ROOT = this.dataDir;

    const bridge = new CodexAcpBridge({
      command,
      args,
      cwd: this.options.workspacePath,
      env,
      onUpdate: (update, notification) => this.consumeUpdate(update, notification),
      onLine: (event) => this.emit('line', event satisfies GooseRuntimeEvent),
      sessionIdCodec: agentNamespacedCodec(this.options.credential.agentId),
      clientCapabilitiesMeta: { goose: { customNotifications: true } },
      onNotification: (method, params) => this.trackExtNotification(method, params),
    });
    bridge.on('error', (err) => this.emit('error', err));
    bridge.on('exit', (event: { code: number | null; signal: NodeJS.Signals | null }) => {
      const intentional = this.stopping;
      this.bridge = null;
      this.bootstrapping = null;
      this.activePrompt = null;
      this.emitExitOnce({
        code: event.code,
        signal: event.signal,
        intentional,
        sessionId: this.currentSessionId,
      });
    });
    return bridge;
  }

  /**
   * Routes goose's cumulative usage notifications into the accumulated map.
   * PromptResponse.usage only reflects the last LLM request of a turn; the
   * accumulated counters are the accurate billing source for tool-loop turns.
   */
  private trackExtNotification(method: string, params: Record<string, unknown>): void {
    if (method !== GOOSE_USAGE_NOTIFICATION) return;
    const update = params.update as Record<string, unknown> | undefined;
    if (update?.sessionUpdate === 'message_usage') {
      const usage = update.usage as Record<string, unknown> | undefined;
      if (usage && typeof usage === 'object') {
        this.turnUsage.input += num(usage.inputTokens);
        this.turnUsage.output += num(usage.outputTokens);
      }
      return;
    }
    if (update?.sessionUpdate !== 'usage_update') return;
    const input = num(update.accumulatedInputTokens);
    const output = num(update.accumulatedOutputTokens);
    if (input === 0 && output === 0) return;
    const sessionId = this.currentSessionId ?? '';
    this.accumulatedUsage.set(sessionId, { input, output });
  }

  private async runPrompt(text: string, options?: RuntimeSendOptions): Promise<void> {
    this.activePrompt = (async () => {
      const activeSessionId = await this.ensureSession(options);
      const bridge = this.bridge;
      if (!bridge) throw new Error('Goose ACP bridge is not started');
      this.turnUsage = { input: 0, output: 0 };
      // Slock instructions live in the workspace AGENTS.md (system-prompt
      // slot); each turn sends only the bare event text.
      this.emit('message_sent', {
        type: 'goose_prompt',
        session_id: activeSessionId,
        sessionScopeKey: options?.sessionScopeKey,
        control: options?.control === true,
        promptBytes: Buffer.byteLength(text, 'utf-8'),
      });
      const result = await bridge.prompt(activeSessionId, text);
      const accumulated = this.accumulatedUsage.get(activeSessionId);
      recordGooseUsage(activeSessionId, result, accumulated);
      this.emit('stream_event', this.buildResultEvent(result, activeSessionId));
    })();

    try {
      await this.activePrompt;
    } catch (err) {
      this.emit('stream_event', {
        type: 'result',
        subtype: 'error',
        runtime: 'goose',
        error: (err as Error).message,
      } satisfies GooseStreamEvent);
      this.emit('error', err);
    } finally {
      this.activePrompt = null;
      void this.flushQueuedMessages();
    }
  }

  private consumeUpdate(update: SessionUpdate, notification: SessionNotification): void {
    const sessionId = notification.sessionId;
    if (sessionId && sessionId !== this.currentSessionId) {
      this.currentSessionId = sessionId;
      this.emit('session', { sessionId });
    }
    // Structured events: one ACP update may yield several AgentEvents.
    for (const event of translateAcpSessionUpdate(update, sessionId)) {
      // Some agents (goose) omit the tool name on tool_call_update; remember
      // it from the item_started so failure diagnostics name the tool.
      if (event.type === 'item_started' && event.item.callId && event.item.toolName) {
        this.toolNamesByCallId.set(event.item.callId, event.item.toolName);
      }
      if (event.type === 'item_completed' && event.item.callId && !event.item.toolName) {
        const remembered = this.toolNamesByCallId.get(event.item.callId);
        if (remembered) event.item.toolName = remembered;
        this.toolNamesByCallId.delete(event.item.callId);
      }
      this.emit('stream_event', { runtime: 'goose', ...event } satisfies GooseStreamEvent);
    }
  }

  private buildResultEvent(result: PromptResponse, sessionId: string): GooseStreamEvent {
    const turnInput = this.turnUsage.input;
    const turnOutput = this.turnUsage.output;
    const accumulated = this.accumulatedUsage.get(sessionId);
    let usage: Record<string, unknown>;
    if (turnInput > 0 || turnOutput > 0) {
      usage = {
        total_tokens: turnInput + turnOutput,
        input_tokens: turnInput,
        output_tokens: turnOutput,
        totalTokens: turnInput + turnOutput,
        inputTokens: turnInput,
        outputTokens: turnOutput,
      };
    } else if (accumulated) {
      // No per-message usage seen (older goose): fall back to the difference
      // between goose's session-cumulative counters and the last report.
      const baseline = this.usageBaselines.get(sessionId) ?? { input: 0, output: 0 };
      const inputTokens = Math.max(0, accumulated.input - baseline.input);
      const outputTokens = Math.max(0, accumulated.output - baseline.output);
      this.usageBaselines.set(sessionId, { input: accumulated.input, output: accumulated.output });
      usage = {
        total_tokens: inputTokens + outputTokens,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
        inputTokens,
        outputTokens,
      };
    } else {
      usage = normalizePromptUsage(result);
    }
    return {
      type: 'result',
      subtype: result.stopReason === 'cancelled' ? 'cancelled' : 'success',
      runtime: 'goose',
      session_id: sessionId,
      sessionId,
      stopReason: result.stopReason,
      usage,
      raw: result,
    } satisfies GooseStreamEvent;
  }

  private emitExitOnce(event: GooseRuntimeExitEvent): void {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    this.emit('exit', event);
  }
}

function normalizePromptUsage(result: PromptResponse): Record<string, unknown> {
  const rawUsage = result.usage && typeof result.usage === 'object' ? (result.usage as Record<string, unknown>) : {};
  const readNum = (key: string): number | undefined => {
    const value = rawUsage[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  };
  const inputTokens = readNum('inputTokens') ?? readNum('input_tokens');
  const outputTokens = readNum('outputTokens') ?? readNum('output_tokens');
  const cacheReadInputTokens = readNum('cachedReadTokens')
    ?? readNum('cache_read_input_tokens')
    ?? readNum('cachedInputTokens');
  const totalTokens = readNum('totalTokens') ?? readNum('total_tokens')
    ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined);
  return {
    total_tokens: totalTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadInputTokens,
    totalTokens,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
  };
}
