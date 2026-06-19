import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Credential } from '../types.js';
import { prependPathEnv } from './slock-wrapper.js';
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

export function buildCodexArgs(options: Pick<CodexRuntimeOptions, 'model'>): string[] {
  const args = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--sandbox', 'danger-full-access',
    '--ask-for-approval', 'never',
    '-',
  ];

  if (options.model) {
    args.splice(1, 0, '--model', options.model);
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
  private systemPrompt = '';
  private sawStructuredEvent = false;

  constructor(options: CodexRuntimeOptions) {
    super();
    this.options = options;
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
    const args = [
      ...(this.options.commandArgs ?? []),
      ...buildCodexArgs({ model: this.options.model }),
    ];
    const child = spawn(command, args, {
      cwd: this.options.workspacePath,
      env: buildCodexRuntimeEnv(this.options, this.options.baseEnv ?? process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

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
    const sessionId = extractClaudeSessionId(event as ClaudeStreamEvent);
    if (sessionId && sessionId !== this.currentSessionId) {
      this.currentSessionId = sessionId;
      this.emit('session', { sessionId });
    }
    this.emit('stream_event', event);
  }

  private terminate(intentional: boolean): void {
    this.stopping = intentional;
    if (!this.child) return;
    this.child.kill('SIGTERM');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
