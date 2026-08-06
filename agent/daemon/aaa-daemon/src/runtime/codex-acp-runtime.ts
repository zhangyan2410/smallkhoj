import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import type { PromptResponse, SessionNotification, SessionUpdate } from '@agentclientprotocol/sdk';
import type { Credential } from '../types.js';
import { buildSlockSystemPrompt, type ClaudeRuntimeOptions } from './claude-runtime.js';
import { buildCodexPrompt, buildCodexRuntimeEnv } from './codex-runtime.js';
import { CodexAcpBridge, resolveNpxCommand, translateAcpUpdate } from './codex-acp-bridge.js';
import type { ManagedRuntimeDriver, RuntimeExitEvent, RuntimeLineEvent, RuntimeSendOptions, RuntimeStreamEvent } from './runtime-driver.js';

export const DEFAULT_CODEX_ACP_PACKAGE = '@zed-industries/codex-acp@0.16.0';
export const CODEX_ACP_VERSION = '0.16.0';

const CODEX_ACP_REASONING_COMPATIBILITY_ARGS = ['-c', 'model_reasoning_effort=xhigh'];

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

/**
 * Resolve the release-owned ACP executable before considering npx.  Managed
 * Aura artifacts set AURA_RELEASE_ROOT from their launcher, while tests and
 * embedding callers can provide AURA_CODEX_ACP_PATH explicitly.  Returning an
 * absolute path is important: child-process PATH inheritance is not reliable
 * for a daemon started from a copied Connect command.
 */
export function resolveBundledCodexAcpPath(
  env: NodeJS.ProcessEnv = process.env,
  releaseRoot = env.AURA_RELEASE_ROOT?.trim(),
): string | undefined {
  const explicit = env.AURA_CODEX_ACP_PATH?.trim();
  const moduleRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const candidates = [
    explicit,
    releaseRoot ? join(releaseRoot, 'sidecars', 'codex-acp', process.platform === 'win32' ? 'codex-acp.exe' : 'codex-acp') : undefined,
    join(moduleRoot, 'sidecars', 'codex-acp', process.platform === 'win32' ? 'codex-acp.exe' : 'codex-acp'),
  ].filter((value): value is string => Boolean(value));
  return candidates.find((candidate) => existsSync(candidate));
}

export function codexAcpReadiness(
  env: NodeJS.ProcessEnv = process.env,
  releaseRoot = env.AURA_RELEASE_ROOT?.trim(),
): { available: boolean; path?: string; reason?: string } {
  const bundled = resolveBundledCodexAcpPath(env, releaseRoot);
  if (bundled) {
    const compatibilityArgs = codexAcpCompatibilityArgs(env);
    return {
      available: true,
      path: bundled,
      reason: compatibilityArgs.length > 0
        ? `Aura will pass model_reasoning_effort=xhigh to ACP ${CODEX_ACP_VERSION} because the user config requests the newer max value.`
        : undefined,
    };
  }
  if (env.AURA_STANDALONE === '1') {
    return {
      available: false,
      reason: `Codex ACP ${CODEX_ACP_VERSION} is not present in the Aura release (expected sidecars/codex-acp/${process.platform === 'win32' ? 'codex-acp.exe' : 'codex-acp'}). Reinstall a complete artifact or set AURA_CODEX_ACP_PATH for an explicitly managed binary.`,
    };
  }
  return {
    available: false,
    reason: `Codex ACP ${CODEX_ACP_VERSION} is unavailable locally; development mode may fall back to npx.`,
  };
}

/**
 * Codex CLI releases newer than ACP 0.16.0 accept `max` as a reasoning
 * effort, while the pinned ACP binary only accepts up to `xhigh`.  Keep the
 * user's global config untouched and apply a narrow launch-time override when
 * that exact incompatible value is present.
 */
export function codexAcpCompatibilityArgs(env: NodeJS.ProcessEnv = process.env): string[] {
  const codexHome = env.CODEX_HOME?.trim()
    || (process.platform === 'win32' ? env.USERPROFILE?.trim() : env.HOME?.trim())
    || homedir();
  const configPath = join(codexHome, '.codex', 'config.toml');
  const directConfigPath = env.CODEX_HOME?.trim() ? join(codexHome, 'config.toml') : undefined;
  const candidates = [directConfigPath, configPath].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      const config = readFileSync(candidate, 'utf-8');
      if (/^\s*model_reasoning_effort\s*=\s*["']max["']\s*(?:#.*)?$/m.test(config)) {
        return [...CODEX_ACP_REASONING_COMPATIBILITY_ARGS];
      }
    } catch {
      // A config read failure should not make Claude-only installations fail;
      // ACP will report its own actionable parse/auth error if it is selected.
    }
  }
  return [];
}

export function resolveCodexAcpLaunchCommand(options: Pick<CodexAcpRuntimeOptions, 'command' | 'commandArgs' | 'baseEnv'> = {}): { command: string; args: string[] } {
  const baseEnv = options.baseEnv ?? process.env;
  const command = options.command?.trim() || resolveNpxCommand(baseEnv);
  const commandArgs = options.commandArgs?.filter((arg) => arg.trim().length > 0);
  if (commandArgs && commandArgs.length > 0) {
    return { command, args: commandArgs };
  }
  const bundled = resolveBundledCodexAcpPath(baseEnv);
  if (bundled && (isNpxCommand(command) || command === bundled)) {
    return { command: bundled, args: codexAcpCompatibilityArgs(baseEnv) };
  }
  if (isNpxCommand(command)) {
    return { command, args: ['-y', DEFAULT_CODEX_ACP_PACKAGE] };
  }
  return { command, args: [] };
}

function isNpxCommand(command: string): boolean {
  return /(^|[/\\])npx(\.cmd)?$/i.test(command);
}

export function buildCodexAcpSlockPrompt(options: Pick<CodexAcpRuntimeOptions, 'credential' | 'workspacePath' | 'wrapperDir'>): string {
  return [
    buildSlockSystemPrompt({
      credential: options.credential,
      workspacePath: options.workspacePath,
      wrapperDir: options.wrapperDir,
    } satisfies Pick<ClaudeRuntimeOptions, 'credential' | 'workspacePath' | 'wrapperDir'>),
    '',
    '## Codex ACP Runtime Notes',
    '',
    '- You are running under `codex-acp` as a daemon-managed ACP resident runtime.',
    '- Keep this runtime session scoped to this Slock agent workspace.',
    '- Complete the current Slock event end to end before returning `end_turn`.',
    '- All user-visible communication must be sent with the PATH-injected `aura` CLI.',
    '- Codex ACP starts with a read-only, network-restricted sandbox. For every `aura` call, request elevated execution immediately; do not attempt an unprivileged call first.',
    '- Do not use shell heredocs for Slock message content under Codex ACP; pipe `printf` output into bare `aura message send` instead.',
    '- Assistant text streamed through ACP is daemon telemetry only; it is not delivered to Slock users.',
  ].join('\n');
}

export function writeCodexAcpPromptFile(options: Pick<CodexAcpRuntimeOptions, 'credential' | 'workspacePath' | 'wrapperDir'>): string {
  mkdirSync(options.wrapperDir, { recursive: true });
  const promptFile = join(options.wrapperDir, 'codex-acp-slock-prompt.md');
  writeFileSync(promptFile, buildCodexAcpSlockPrompt({
    credential: options.credential,
    workspacePath: options.workspacePath,
    wrapperDir: options.wrapperDir,
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
      wrapperDir: this.options.wrapperDir,
    });
    this.emit('line', { stream: 'stdout', line: `Codex ACP Slock prompt written to ${promptFile}` } satisfies CodexAcpRuntimeEvent);
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
      const prompt = options?.control
        ? text
        : buildCodexPrompt(this.systemPrompt || buildCodexAcpSlockPrompt(this.options), text);
      this.emit('message_sent', {
        type: 'codex_acp_prompt',
        session_id: activeSessionId,
        sessionScopeKey: options?.sessionScopeKey,
        control: options?.control === true,
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

    if ((translated.type === 'message_delta' || translated.type === 'thought_delta') && translated.text) {
      const content = translated.type === 'thought_delta'
        ? { type: 'thinking', thinking: translated.text }
        : { type: 'text', text: translated.text };
      this.emit('stream_event', {
        type: 'assistant',
        runtime: 'codex_acp',
        session_id: sessionId,
        sessionId,
        message: { content: [content] },
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
            input: {
              status: translated.status,
              command: codexToolCommandPreview(update),
              raw: update,
            },
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

function codexToolCommandPreview(update: SessionUpdate): string | undefined {
  const rawUpdate = update as unknown as Record<string, unknown>;
  const rawInputValue = rawUpdate.rawInput;
  const rawInput = isRecord(rawInputValue) ? rawInputValue : undefined;
  if (!rawInput) return typeof rawInputValue === 'string' ? rawInputValue : undefined;
  for (const key of ['command', 'cmd', 'script']) {
    const value = stringField(rawInput, key);
    if (value) return value;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
