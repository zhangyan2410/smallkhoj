import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { PromptResponse, SessionNotification, SessionUpdate } from '@agentclientprotocol/sdk';
import type { Credential } from '../types.js';
import { buildSlockSystemPrompt, type ClaudeRuntimeOptions } from './claude-runtime.js';
import { buildCodexPrompt, buildCodexRuntimeEnv } from './codex-runtime.js';
import { CodexAcpBridge, translateAcpUpdate } from './codex-acp-bridge.js';
import type { ManagedRuntimeDriver, RuntimeExitEvent, RuntimeLineEvent, RuntimeSendOptions, RuntimeStreamEvent } from './runtime-driver.js';

const DEFAULT_CODEX_ACP_PACKAGE = '@zed-industries/codex-acp@0.16.0';

export interface CodexAcpRuntimeOptions {
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

export type CodexAcpRuntimeEvent = RuntimeLineEvent;
export type CodexAcpRuntimeExitEvent = RuntimeExitEvent;
export type CodexAcpStreamEvent = RuntimeStreamEvent;
type PendingUserMessage = { text: string; options?: RuntimeSendOptions };

export function resolveCodexAcpLaunchCommand(options: Pick<CodexAcpRuntimeOptions, 'command' | 'commandArgs'> = {}): { command: string; args: string[] } {
  const command = options.command?.trim() || 'npx';
  const commandArgs = options.commandArgs?.filter((arg) => arg.trim().length > 0);
  if (commandArgs && commandArgs.length > 0) {
    return { command, args: commandArgs };
  }
  if (command === 'npx' || command.endsWith('/npx')) {
    return { command, args: ['-y', DEFAULT_CODEX_ACP_PACKAGE] };
  }
  return { command, args: [] };
}

export function buildCodexAcpSlockPrompt(options: Pick<CodexAcpRuntimeOptions, 'credential' | 'workspacePath'>): string {
  return [
    buildSlockSystemPrompt({
      credential: options.credential,
      workspacePath: options.workspacePath,
    } satisfies Pick<ClaudeRuntimeOptions, 'credential' | 'workspacePath'>),
    '',
    '## Codex ACP Runtime Notes',
    '',
    '- You are running under `codex-acp` as a daemon-managed ACP resident runtime.',
    '- Keep this runtime session scoped to this Slock agent workspace.',
    '- Complete the current Slock event end to end before returning `end_turn`.',
    '- All user-visible communication must be sent with the generated `slock` CLI wrapper.',
    '- Assistant text streamed through ACP is daemon telemetry only; it is not delivered to Slock users.',
  ].join('\n');
}

export function writeCodexAcpPromptFile(options: Pick<CodexAcpRuntimeOptions, 'credential' | 'workspacePath' | 'wrapperDir'>): string {
  mkdirSync(options.wrapperDir, { recursive: true });
  const promptFile = join(options.wrapperDir, 'codex-acp-slock-prompt.md');
  writeFileSync(promptFile, buildCodexAcpSlockPrompt({
    credential: options.credential,
    workspacePath: options.workspacePath,
  }), 'utf-8');
  return promptFile;
}

export class CodexAcpRuntimeDriver extends EventEmitter implements ManagedRuntimeDriver {
  private readonly options: CodexAcpRuntimeOptions;
  private bridge: CodexAcpBridge | null = null;
  private readonly pendingUserMessages: PendingUserMessage[] = [];
  private currentSessionId: string | undefined;
  private started = false;
  private stopping = false;
  private bootstrapping: Promise<void> | null = null;
  private activePrompt: Promise<void> | null = null;
  private systemPrompt = '';
  private lastUsageUpdate: Record<string, unknown> | undefined;
  private exitEmitted = false;

  constructor(options: CodexAcpRuntimeOptions) {
    super();
    this.options = options;
    this.currentSessionId = options.resumeSessionId;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.exitEmitted = false;
    const promptFile = writeCodexAcpPromptFile({
      credential: this.options.credential,
      workspacePath: this.options.workspacePath,
      wrapperDir: this.options.wrapperDir,
    });
    this.systemPrompt = buildCodexAcpSlockPrompt({
      credential: this.options.credential,
      workspacePath: this.options.workspacePath,
    });
    this.emit('line', { stream: 'stderr', line: `Codex ACP Slock prompt written to ${promptFile}` } satisfies CodexAcpRuntimeEvent);
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

  sendUserMessage(text: string, options?: RuntimeSendOptions): boolean {
    if (!this.started || this.busy || (!this.currentSessionId && !options)) {
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
      if (!this.currentSessionId) throw new Error('Codex ACP session is not ready');
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
    if (!this.currentSessionId) throw new Error('Codex ACP session is not ready');
    return this.currentSessionId;
  }

  private createBridge(): CodexAcpBridge {
    const { command, args } = resolveCodexAcpLaunchCommand(this.options);
    const bridge = new CodexAcpBridge({
      command,
      args,
      cwd: this.options.workspacePath,
      env: buildCodexRuntimeEnv({
        ...this.options,
        model: undefined,
      }, this.options.baseEnv ?? process.env),
      onUpdate: (update, notification) => this.consumeUpdate(update, notification),
      onLine: (event) => this.emit('line', event satisfies CodexAcpRuntimeEvent),
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

  private async runPrompt(text: string, options?: RuntimeSendOptions): Promise<void> {
    this.activePrompt = (async () => {
      const activeSessionId = await this.ensureSession(options);
      const bridge = this.bridge;
      if (!bridge) throw new Error('Codex ACP bridge is not started');
      const prompt = buildCodexPrompt(this.systemPrompt || buildCodexAcpSlockPrompt(this.options), text);
      this.emit('message_sent', {
        type: 'codex_acp_prompt',
        session_id: activeSessionId,
        sessionScopeKey: options?.sessionScopeKey,
        promptBytes: Buffer.byteLength(prompt, 'utf-8'),
      });
      const result = await bridge.prompt(activeSessionId, prompt);
      this.emit('stream_event', this.buildResultEvent(result));
    })();

    try {
      await this.activePrompt;
    } catch (err) {
      this.emit('stream_event', {
        type: 'result',
        subtype: 'error',
        runtime: 'codex_acp',
        error: (err as Error).message,
      } satisfies CodexAcpStreamEvent);
      this.emit('error', err);
    } finally {
      this.activePrompt = null;
      void this.flushQueuedMessages();
    }
  }

  private consumeUpdate(update: SessionUpdate, notification: SessionNotification): void {
    const translated = translateAcpUpdate(update);
    const sessionId = notification.sessionId;
    if (sessionId && sessionId !== this.currentSessionId) {
      this.currentSessionId = sessionId;
      this.emit('session', { sessionId });
    }

    if (translated.type === 'message_delta' && translated.text) {
      this.emit('stream_event', {
        type: 'assistant',
        runtime: 'codex_acp',
        session_id: sessionId,
        sessionId,
        message: { content: [{ type: 'text', text: translated.text }] },
        acpUpdate: update.sessionUpdate,
      } satisfies CodexAcpStreamEvent);
      return;
    }

    if (translated.type === 'tool_call') {
      const toolId = stringField(update, 'toolCallId') ?? stringField(update, 'id') ?? `${sessionId ?? 'codex-acp'}-tool`;
      this.emit('stream_event', {
        type: 'assistant',
        runtime: 'codex_acp',
        session_id: sessionId,
        sessionId,
        message: {
          content: [{
            type: 'tool_use',
            id: toolId,
            name: translated.toolName ?? 'tool',
            input: { status: translated.status, raw: update },
          }],
        },
        acpUpdate: update.sessionUpdate,
      } satisfies CodexAcpStreamEvent);
      return;
    }

    if (translated.type === 'tool_result') {
      const toolId = stringField(update, 'toolCallId') ?? stringField(update, 'id') ?? `${sessionId ?? 'codex-acp'}-tool`;
      this.emit('stream_event', {
        type: 'user',
        runtime: 'codex_acp',
        session_id: sessionId,
        sessionId,
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: toolId,
            content: JSON.stringify({ status: translated.status, raw: update }),
            is_error: translated.status === 'failed',
          }],
        },
        acpUpdate: update.sessionUpdate,
      } satisfies CodexAcpStreamEvent);
      return;
    }

    if (translated.type === 'usage') {
      this.lastUsageUpdate = update as unknown as Record<string, unknown>;
      this.emit('stream_event', {
        type: 'usage',
        runtime: 'codex_acp',
        session_id: sessionId,
        sessionId,
        used: numberField(update, 'used'),
        contextWindow: numberField(update, 'size'),
        raw: update,
      } satisfies CodexAcpStreamEvent);
    }
  }

  private buildResultEvent(result: PromptResponse): CodexAcpStreamEvent {
    const usage = normalizePromptUsage(result, this.lastUsageUpdate);
    return {
      type: 'result',
      subtype: result.stopReason === 'cancelled' ? 'cancelled' : 'success',
      runtime: 'codex_acp',
      session_id: this.currentSessionId,
      sessionId: this.currentSessionId,
      stopReason: result.stopReason,
      usage,
      raw: result,
    } satisfies CodexAcpStreamEvent;
  }

  private emitExitOnce(event: CodexAcpRuntimeExitEvent): void {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    this.emit('exit', event);
  }
}

function normalizePromptUsage(result: PromptResponse, usageUpdate?: Record<string, unknown>): Record<string, unknown> {
  const rawUsage = isRecord(result.usage) ? result.usage : {};
  const inputTokens = numberField(rawUsage, 'inputTokens') ?? numberField(rawUsage, 'input_tokens');
  const outputTokens = numberField(rawUsage, 'outputTokens') ?? numberField(rawUsage, 'output_tokens');
  const cacheReadInputTokens = numberField(rawUsage, 'cachedReadTokens')
    ?? numberField(rawUsage, 'cache_read_input_tokens')
    ?? numberField(rawUsage, 'cachedInputTokens');
  const totalTokens = numberField(rawUsage, 'totalTokens') ?? numberField(rawUsage, 'total_tokens') ?? numberField(usageUpdate, 'used');
  const contextWindow = numberField(usageUpdate, 'size');

  return {
    total_tokens: totalTokens,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_read_input_tokens: cacheReadInputTokens,
    context_window: contextWindow,
    inputTokens,
    outputTokens,
    cacheReadInputTokens,
    contextWindow,
  };
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'number' ? field : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
