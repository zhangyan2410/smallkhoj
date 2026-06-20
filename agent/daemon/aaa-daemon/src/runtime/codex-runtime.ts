import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Credential } from '../types.js';
import { prependPathEnv } from './slock-wrapper.js';
import { runtimeProcessSpawnOptions, scheduleRuntimeProcessTreeKill, signalRuntimeProcessTree } from './process-tree.js';
import {
  buildSlockSystemPrompt,
  type ClaudeRuntimeOptions,
  type ClaudeStreamEvent,
  extractClaudeSessionId,
} from './claude-runtime.js';
import type { ManagedRuntimeDriver, RuntimeExitEvent, RuntimeLineEvent, RuntimeStreamEvent } from './runtime-driver.js';

export interface CodexRuntimeOptions {
  credential: Credential;
  workspacePath: string;
  wrapperDir: string;
  slockHome?: string;
  launchId?: string;
  model?: string;
  command?: string;
  commandArgs?: string[];
  baseEnv?: NodeJS.ProcessEnv;
  /** 上次会话的 thread_id，用于 daemon 重启后续接同一 codex 会话。 */
  resumeSessionId?: string;
}

export type CodexRuntimeEvent = RuntimeLineEvent;
export type CodexRuntimeExitEvent = RuntimeExitEvent;
export type CodexStreamEvent = RuntimeStreamEvent;

export function buildCodexSlockPrompt(options: Pick<CodexRuntimeOptions, 'credential' | 'workspacePath'>): string {
  return [
    buildSlockSystemPrompt({
      credential: options.credential,
      workspacePath: options.workspacePath,
    } satisfies Pick<ClaudeRuntimeOptions, 'credential' | 'workspacePath'>),
    '',
    '## Codex Runtime Notes',
    '',
    '- You are running under `codex exec` as a daemon-managed runtime.',
    '- Complete the current Slock event end to end before exiting.',
    '- All user-visible communication must be sent with the generated `slock` CLI wrapper.',
    '- Plain stdout/stderr from this process is daemon telemetry only; it is not delivered to Slock users.',
  ].join('\n');
}

export function writeCodexPromptFile(options: Pick<CodexRuntimeOptions, 'credential' | 'workspacePath' | 'wrapperDir'>): string {
  mkdirSync(options.wrapperDir, { recursive: true });
  const promptFile = join(options.wrapperDir, 'codex-slock-prompt.md');
  writeFileSync(promptFile, buildCodexSlockPrompt({
    credential: options.credential,
    workspacePath: options.workspacePath,
  }), 'utf-8');
  return promptFile;
}

export function buildCodexRuntimeEnv(options: CodexRuntimeOptions, baseEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  env.FORCE_COLOR = '0';
  env.SLOCK_HOME = options.slockHome ?? options.wrapperDir;
  env.SLOCK_AGENT_ID = options.credential.agentId;
  env.SLOCK_AGENT_LAUNCH_ID = options.launchId ?? `pid-${process.pid}`;
  env.SLOCK_SERVER_URL = options.credential.serverUrl;
  env.SLOCK_CURRENT_WORKSPACE_PATH = options.workspacePath;
  env.PATH = prependPathEnv(options.wrapperDir, baseEnv.PATH ?? '');

  delete env.SLOCK_AGENT_TOKEN;
  delete env.SLOCK_AGENT_PROXY_URL;
  delete env.SLOCK_AGENT_PROXY_TOKEN;
  delete env.SLOCK_AGENT_PROXY_TOKEN_FILE;
  delete env.SLOCK_AGENT_ACTIVE_CAPABILITIES;

  return env;
}

// codex CLI 是 turn-based：`exec` 跑一个 turn 退出，没有「一个进程持续吃
// 多条 stdin 消息」的模式（官方设计，见 developers.openai.com/codex/noninteractive）。
// 会话连续性靠 `codex exec resume <thread_id>` 续接：首条消息用 exec 生成
// thread_id，后续消息用 resume 恢复同一会话上下文（与 Claude --resume 同构）。
//
// 注意 codex 0.137.0：
//  - 没有 --ask-for-approval；用 `-c approval_policy=never` 等效跳过审批。
//  - `exec` 用 `-s danger-full-access`；`exec resume` 不支持 -s，
//    改用 `-c sandbox_mode=danger-full-access`。
export function buildCodexArgs(options: Pick<CodexRuntimeOptions, 'model'>): string[] {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox', 'danger-full-access',
    '-c', 'approval_policy=never',
    '-',
  ];

  if (options.model) {
    args.splice(1, 0, '--model', options.model);
  }

  return args;
}

// 续接已有会话：codex exec resume <thread_id>。sandbox 通过 config 传入。
export function buildCodexResumeArgs(threadId: string, options: Pick<CodexRuntimeOptions, 'model'>): string[] {
  const args = [
    'exec', 'resume',
    '--json',
    '--skip-git-repo-check',
    '-c', 'approval_policy=never',
    '-c', 'sandbox_mode=danger-full-access',
    threadId,
    '-',
  ];

  if (options.model) {
    args.splice(2, 0, '--model', options.model);
  }

  return args;
}

export function buildCodexPrompt(systemPrompt: string, text: string): string {
  return [
    systemPrompt,
    '',
    '## Current Slock Event',
    '',
    text,
  ].join('\n');
}

export function parseCodexJsonLine(line: string): CodexStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) return null;

  // Codex JSONL event shapes are intentionally treated as external and
  // versioned. Preserve the raw object, but normalize common fields for daemon
  // activity code that already consumes Claude-like stream events.
  if (typeof parsed.type !== 'string') {
    const event = typeof parsed.event === 'string' ? parsed.event : undefined;
    const msg = typeof parsed.msg === 'string' ? parsed.msg : undefined;
    if (event) parsed.type = event;
    else if (msg) parsed.type = msg;
  }
  return parsed;
}

export class CodexRuntimeDriver extends EventEmitter implements ManagedRuntimeDriver {
  private readonly options: CodexRuntimeOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutRemainder = '';
  private stderrRemainder = '';
  private readonly pendingUserMessages: string[] = [];
  private currentSessionId: string | undefined;
  private started = false;
  private stopping = false;
  private forceKillTimer: ReturnType<typeof setTimeout> | null = null;
  private systemPrompt = '';
  private sawStructuredEvent = false;

  constructor(options: CodexRuntimeOptions) {
    super();
    this.options = options;
    // 恢复 daemon 重启前的会话，使后续消息能 `codex exec resume` 续接上下文。
    this.currentSessionId = options.resumeSessionId;
  }

  start(): void {
    this.started = true;
    this.stopping = false;
    const promptFile = writeCodexPromptFile({
      credential: this.options.credential,
      workspacePath: this.options.workspacePath,
      wrapperDir: this.options.wrapperDir,
    });
    this.systemPrompt = buildCodexSlockPrompt({
      credential: this.options.credential,
      workspacePath: this.options.workspacePath,
    });
    this.emit('line', { stream: 'stderr', line: `Codex Slock prompt written to ${promptFile}` } satisfies CodexRuntimeEvent);
    this.flushQueuedMessages();
  }

  stop(): void {
    this.terminate(true);
    this.started = false;
    if (!this.child) {
      this.emit('exit', {
        code: 0,
        signal: null,
        intentional: true,
        sessionId: this.currentSessionId,
      } satisfies CodexRuntimeExitEvent);
    }
  }

  killUnresponsive(): void {
    this.terminate(false);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get sessionId(): string | undefined {
    return this.currentSessionId;
  }

  get queuedMessageCount(): number {
    return this.pendingUserMessages.length;
  }

  get busy(): boolean {
    return Boolean(this.child);
  }

  sendUserMessage(text: string): boolean {
    if (!this.started || this.child) {
      this.pendingUserMessages.push(text);
      return false;
    }

    this.spawnTurn(text);
    return true;
  }

  private flushQueuedMessages(): void {
    if (!this.started || this.child) return;
    const next = this.pendingUserMessages.shift();
    if (next === undefined) return;
    this.spawnTurn(next);
  }

  private spawnTurn(text: string): void {
    const command = this.options.command ?? 'codex';
    // 已有会话则 resume 续接（保持上下文连续），否则首条用 exec 生成会话。
    const baseArgs = this.currentSessionId
      ? buildCodexResumeArgs(this.currentSessionId, { model: this.options.model })
      : buildCodexArgs({ model: this.options.model });
    const args = [
      ...(this.options.commandArgs ?? []),
      ...baseArgs,
    ];
    const child = spawn(command, args, runtimeProcessSpawnOptions({
      cwd: this.options.workspacePath,
      env: buildCodexRuntimeEnv(this.options, this.options.baseEnv ?? process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    }));

    this.child = child;
    this.stdoutRemainder = '';
    this.stderrRemainder = '';
    this.sawStructuredEvent = false;
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => this.emitLines('stdout', chunk));
    child.stderr.on('data', (chunk: string) => this.emitLines('stderr', chunk));
    child.on('error', (err) => this.emit('error', err));
    child.on('exit', (code, signal) => {
      this.clearForceKillTimer();
      this.flushRemainders();
      const intentional = this.stopping;
      this.child = null;
      const resultEvent: CodexStreamEvent = {
        type: 'result',
        subtype: code === 0 ? 'success' : 'error',
        exitCode: code,
        signal,
        runtime: 'codex_cli',
      };
      this.emit('stream_event', resultEvent);
      this.emit('line', {
        stream: 'stderr',
        line: `Codex turn exited: code=${code} signal=${signal ?? 'none'}`,
      } satisfies CodexRuntimeEvent);
      if (intentional || !this.started) {
        this.emit('exit', {
          code,
          signal,
          intentional,
          sessionId: this.currentSessionId,
        } satisfies CodexRuntimeExitEvent);
        return;
      }
      this.flushQueuedMessages();
    });

    const prompt = buildCodexPrompt(this.systemPrompt || buildCodexSlockPrompt(this.options), text);
    child.stdin.end(prompt);
    this.emit('message_sent', {
      type: 'codex_exec',
      promptBytes: Buffer.byteLength(prompt, 'utf-8'),
      hasSessionId: Boolean(this.currentSessionId),
    });
  }

  private emitLines(stream: 'stdout' | 'stderr', chunk: string): void {
    const text = stream === 'stdout' ? this.stdoutRemainder + chunk : this.stderrRemainder + chunk;
    const lines = text.split(/\r?\n/);
    const remainder = lines.pop() ?? '';
    if (stream === 'stdout') this.stdoutRemainder = remainder;
    else this.stderrRemainder = remainder;

    for (const line of lines) {
      if (!line) continue;
      this.emit('line', { stream, line } satisfies CodexRuntimeEvent);
      if (stream === 'stdout') this.consumeStdoutLine(line);
    }
  }

  private flushRemainders(): void {
    if (this.stdoutRemainder) {
      const line = this.stdoutRemainder;
      this.stdoutRemainder = '';
      this.emit('line', { stream: 'stdout', line } satisfies CodexRuntimeEvent);
      this.consumeStdoutLine(line);
    }
    if (this.stderrRemainder) {
      const line = this.stderrRemainder;
      this.stderrRemainder = '';
      this.emit('line', { stream: 'stderr', line } satisfies CodexRuntimeEvent);
    }
  }

  private consumeStdoutLine(line: string): void {
    let event: CodexStreamEvent | null;
    try {
      event = parseCodexJsonLine(line);
    } catch {
      if (!this.sawStructuredEvent) {
        this.emit('stream_event', {
          type: 'assistant',
          message: { content: [{ type: 'text', text: line }] },
          runtime: 'codex_cli',
        } satisfies CodexStreamEvent);
      }
      return;
    }
    if (!event) return;
    this.sawStructuredEvent = true;
    // codex 的会话标识是 thread.started 事件里的 thread_id（不是 Claude 的
    // session_id）。捕获后用于后续消息的 `codex exec resume <thread_id>`。
    const threadId = isRecord(event) && typeof event.thread_id === 'string' && event.type === 'thread.started'
      ? event.thread_id
      : undefined;
    const sessionId = threadId ?? extractClaudeSessionId(event as ClaudeStreamEvent);
    if (sessionId && sessionId !== this.currentSessionId) {
      this.currentSessionId = sessionId;
      this.emit('session', { sessionId });
    }
    this.emit('stream_event', event);
  }

  private terminate(intentional: boolean): void {
    this.stopping = intentional;
    if (!this.child) return;
    this.clearForceKillTimer();
    signalRuntimeProcessTree(this.child, 'SIGTERM');
    this.forceKillTimer = scheduleRuntimeProcessTreeKill(this.child);
  }

  private clearForceKillTimer(): void {
    if (!this.forceKillTimer) return;
    clearTimeout(this.forceKillTimer);
    this.forceKillTimer = null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
