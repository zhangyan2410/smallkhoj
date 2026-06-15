import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Credential } from '../types.js';
import { prependPathEnv } from './slock-wrapper.js';

export interface ClaudeRuntimeOptions {
  credential: Credential;
  workspacePath: string;
  wrapperDir: string;
  slockHome?: string;
  launchId?: string;
  resumeSessionId?: string;
  model?: string;
  command?: string;
  commandArgs?: string[];
  baseEnv?: NodeJS.ProcessEnv;
}

export interface ClaudeRuntimeEvent {
  stream: 'stdout' | 'stderr';
  line: string;
}

export interface ClaudeRuntimeExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  intentional: boolean;
  sessionId?: string;
}

export type ClaudeStreamEvent = Record<string, unknown> & {
  type?: string;
  subtype?: string;
  session_id?: string;
  sessionId?: string;
};

export interface ClaudeUserMessagePayload {
  type: 'user';
  message: {
    role: 'user';
    content: Array<{ type: 'text'; text: string }>;
  };
  session_id?: string;
}

export function buildSlockSystemPrompt(options: Pick<ClaudeRuntimeOptions, 'credential' | 'workspacePath'>): string {
  return [
    'You are an AI agent running inside Slock, a collaborative platform for human-AI collaboration.',
    'Your workspace persists across turns. Use it for memory, notes, artifacts, and code work.',
    '',
    '## Current Runtime Context',
    '',
    'This context is authoritative. Do not infer agent/server identity from hostname or cwd.',
    '',
    `- Agent ID: ${options.credential.agentId}`,
    `- Server ID: ${options.credential.serverId}`,
    `- Workspace: ${options.workspacePath}`,
    '',
    '## Communication - slock CLI ONLY',
    '',
    'Use the `slock` CLI for all Slock chat, task, server, and attachment operations.',
    'The daemon injects a local `slock` wrapper into PATH for you.',
    'Do not call Slock HTTP endpoints directly.',
    '',
    'Supported commands in this daemon build:',
    '1. `slock message check` - check for new messages',
    '2. `slock message send --target "#channel"` - send a message; pass content as stdin or a single argument',
    '3. `slock message read --channel "#channel"` - read message history',
    '4. `slock message search --query "text"` - search visible message history',
    '5. `slock channel members --channel "#channel"` - list visible channel members',
    '6. `slock message react --message-id "<id>" --reaction "+1"` - add or remove a reaction',
    '7. `slock channel join --channel "#channel"` and `slock channel leave --channel "#channel"` - join or leave channels when allowed',
    '8. `slock server info` - list server channels, agents, and humans',
    '9. `slock task list|create|claim|update` - list, create, claim, and update tasks',
    '10. `slock profile get|update` - view or update profile fields and avatars',
    '11. `slock integration list|login` - list integrations or start login for a service',
    '12. `slock reminder list|schedule|create|update|cancel|delete` - manage reminders',
    '13. `slock attachment view|download|upload` - read or upload attachments',
    '',
    'Write-capable commands require explicit environment opt-in from the daemon operator before they can make changes. If a write command returns `WRITES_NOT_ALLOWED` or `WRITE_TARGET_NOT_ALLOWED`, report the exact blocker instead of bypassing the gate.',
    '',
    'Critical rules:',
    '- Always communicate through `slock` CLI commands.',
    '- Use `slock server info` before referring to channels or server membership.',
    '- Do not combine multiple `slock` CLI commands in one shell command.',
    '- Run one `slock` command per tool call, read its output, then decide the next command.',
    '- Check messages before sending replies when conversation context may have changed.',
    '- Send chat replies with `slock message send --target "<target>"` and provide the message content as stdin or a single argument.',
    '',
    '## Startup Sequence',
    '',
    '1. If this turn already includes a concrete incoming message that needs acknowledgement, blocker clarification, or ownership signal, send that early with `slock message send` before deep context gathering.',
    '2. Read MEMORY.md in your cwd if present, then only the additional memory/files needed for the current turn.',
    '3. If there is no concrete incoming message to handle, stop and wait.',
    '4. When you receive a message, process it and reply with `slock message send`.',
    '5. Complete all work before stopping. If work requires research, code changes, and testing, finish those steps and report results before stopping.',
    '',
    'While you are busy, Slock may batch inbox notifications instead of injecting message content. Use `slock message check` at natural breakpoints before side-effect actions that depend on current context.',
    '',
    '## Message Targets',
    '',
    'Messages include a structured header such as `[target=#general msg=... time=... sender=@alice type=human] @alice: ...`.',
    '- `target=` is where the message came from. Reuse the exact `target=` value when replying.',
    '- Never use `channel=` or a bare channel UUID as the `slock message send --target` value. `channel=` is machine metadata only.',
    '- `msg=` is the message short ID. Use it as a thread suffix when starting a thread.',
    '- If a message has no `target=`, do not guess the destination. Check messages/history or report the missing target.',
    '- `type=system` messages are informational unless they clearly request action.',
    '',
    'Target examples:',
    '- Channel: `#general`',
    '- DM: `dm:@alice`',
    '- Channel thread: `#general:a1b2c3d4`',
    '- DM thread: `dm:@alice:a1b2c3d4`',
    '',
    'Send examples:',
    '```bash',
    'slock message send --target "#general" <<\'SLOCKMSG\'',
    'Long message with quotes, code blocks, and newlines.',
    'SLOCKMSG',
    '```',
    '',
    'If a message comes from a thread target, reply to that same thread target. Threads cannot be nested.',
    '',
    '## Channels And Privacy',
    '',
    'Use `slock server info` to discover channels, channel purpose, humans, and agents.',
    'Reply in the channel/thread where the message came from. Do not scatter updates across unrelated channels.',
    'Treat private channel names, membership, and content as private to that channel. Do not disclose them elsewhere unless a human asks from an authorized context.',
    '',
    '## Tasks',
    '',
    'When someone asks you to do work beyond a simple reply, inspect tasks with `slock task list`, then claim or create the relevant task when the write gate allows it.',
    'A `task.created` or `task_created` event assigned to you is a concrete work request. Do not dismiss it as a passive system event just because it was delivered as an event rather than a chat message.',
    'If the event includes a task id, use `slock task claim --id <task-id>` and `slock task update --id <task-id> --status in_review`. If it only includes `task=#N`, resolve the id with `slock task list` first; do not use a non-existent `--task` flag.',
    'Use `slock task update` to record status changes when the write gate allows it. If the gate blocks the write, explain that operator write opt-in is required.',
    'Post progress and results in the task thread or original target using `slock message send`.',
    '',
    '## Communication Style',
    '',
    'Keep Slock updates concise and actionable.',
    'Acknowledge concrete work, provide short progress updates for multi-step tasks, and summarize results when done.',
    'Avoid idle narration. Only send messages when you have actionable content.',
    '',
  ].join('\n');
}

export function writeSlockSystemPromptFile(options: Pick<ClaudeRuntimeOptions, 'credential' | 'workspacePath' | 'wrapperDir'>): string {
  mkdirSync(options.wrapperDir, { recursive: true });
  const promptFile = join(options.wrapperDir, 'claude-system-prompt.md');
  writeFileSync(promptFile, buildSlockSystemPrompt({
    credential: options.credential,
    workspacePath: options.workspacePath,
  }), 'utf-8');
  return promptFile;
}

export function buildClaudeRuntimeEnv(options: ClaudeRuntimeOptions, baseEnv = process.env): NodeJS.ProcessEnv {
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

export function buildClaudeArgs(options: Pick<ClaudeRuntimeOptions, 'model' | 'resumeSessionId'> & { systemPromptFile?: string }): string[] {
  const args = [
    '--allow-dangerously-skip-permissions',
    '--dangerously-skip-permissions',
    '--verbose',
    '--permission-mode', 'bypassPermissions',
    '--output-format', 'stream-json',
    '--input-format', 'stream-json',
    '--disallowed-tools', [
      'EnterPlanMode',
      'ExitPlanMode',
      'ScheduleWakeup',
      'CronCreate',
      'CronList',
      'CronDelete',
    ].join(','),
  ];

  if (options.systemPromptFile) {
    args.push('--append-system-prompt-file', options.systemPromptFile);
  }

  if (options.resumeSessionId) {
    args.push('--resume', options.resumeSessionId);
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  return args;
}

export function buildClaudeUserMessage(text: string, sessionId?: string): ClaudeUserMessagePayload {
  const payload: ClaudeUserMessagePayload = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
    },
  };

  if (sessionId) {
    payload.session_id = sessionId;
  }

  return payload;
}

export function parseClaudeStreamLine(line: string): ClaudeStreamEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const parsed = JSON.parse(trimmed) as unknown;
  return isRecord(parsed) ? parsed : null;
}

export function extractClaudeSessionId(event: ClaudeStreamEvent): string | undefined {
  if (typeof event.session_id === 'string' && event.session_id) return event.session_id;
  if (typeof event.sessionId === 'string' && event.sessionId) return event.sessionId;

  const message = event.message;
  if (isRecord(message)) {
    const nested = message.session_id ?? message.sessionId;
    if (typeof nested === 'string' && nested) return nested;
  }

  return undefined;
}

export class ClaudeRuntimeDriver extends EventEmitter {
  private readonly options: ClaudeRuntimeOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private stdoutRemainder = '';
  private readonly pendingUserMessages: string[] = [];
  private readonly outstandingToolUses = new Set<string>();
  private awaitingTurnResult = false;
  private compacting = false;
  private currentSessionId: string | undefined;
  private stopping = false;

  constructor(options: ClaudeRuntimeOptions) {
    super();
    this.options = options;
    this.currentSessionId = options.resumeSessionId;
  }

  start(): void {
    if (this.child) return;
    this.stopping = false;

    const command = this.options.command ?? 'claude';
    const systemPromptFile = writeSlockSystemPromptFile({
      credential: this.options.credential,
      workspacePath: this.options.workspacePath,
      wrapperDir: this.options.wrapperDir,
    });
    const args = [
      ...(this.options.commandArgs ?? []),
      ...buildClaudeArgs({
        model: this.options.model,
        resumeSessionId: this.options.resumeSessionId,
        systemPromptFile,
      }),
    ];

    const child = spawn(command, args, {
      cwd: this.options.workspacePath,
      env: buildClaudeRuntimeEnv(this.options, this.options.baseEnv ?? process.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child = child;
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => this.emitLines('stdout', chunk));
    child.stderr.on('data', (chunk: string) => this.emitLines('stderr', chunk));
    child.on('error', (err) => this.emit('error', err));
    child.on('exit', (code, signal) => {
      const event: ClaudeRuntimeExitEvent = {
        code,
        signal,
        intentional: this.stopping,
        sessionId: this.currentSessionId,
      };
      this.child = null;
      this.awaitingTurnResult = false;
      this.compacting = false;
      this.outstandingToolUses.clear();
      this.emit('exit', event);
    });
    this.flushQueuedMessages();
  }

  stop(): void {
    this.terminate(true);
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
    return this.isBusy();
  }

  sendUserMessage(text: string): boolean {
    if (!this.getWritableChild() || this.isBusy()) {
      this.pendingUserMessages.push(text);
      return false;
    }

    this.writeUserMessage(text);
    return true;
  }

  private emitLines(stream: 'stdout' | 'stderr', chunk: string): void {
    const text = stream === 'stdout' ? this.stdoutRemainder + chunk : chunk;
    const lines = text.split(/\r?\n/);
    if (stream === 'stdout') {
      this.stdoutRemainder = lines.pop() ?? '';
    }

    for (const line of lines) {
      if (!line) continue;
      this.emit('line', { stream, line } satisfies ClaudeRuntimeEvent);
      if (stream === 'stdout') {
        this.consumeStdoutLine(line);
      }
    }

    if (stream === 'stderr') {
      const trailing = lines.length === 0 ? text : '';
      if (trailing) {
        this.emit('line', { stream, line: trailing } satisfies ClaudeRuntimeEvent);
      }
    }
  }

  private consumeStdoutLine(line: string): void {
    let event: ClaudeStreamEvent | null;
    try {
      event = parseClaudeStreamLine(line);
    } catch (err) {
      this.emit('parse_error', { line, error: err });
      return;
    }

    if (!event) return;
    this.consumeStreamEvent(event);
  }

  private consumeStreamEvent(event: ClaudeStreamEvent): void {
    const sessionId = extractClaudeSessionId(event);
    if (sessionId && sessionId !== this.currentSessionId) {
      this.currentSessionId = sessionId;
      this.emit('session', { sessionId });
    }

    const type = typeof event.type === 'string' ? event.type : '';
    if (type === 'system') {
      this.updateCompactingState(event);
    }

    if (type === 'assistant') {
      this.awaitingTurnResult = true;
      for (const block of getContentBlocks(event)) {
        if (block.type === 'tool_use' && typeof block.id === 'string') {
          this.outstandingToolUses.add(block.id);
        }
      }
    }

    if (type === 'user') {
      for (const block of getContentBlocks(event)) {
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          this.outstandingToolUses.delete(block.tool_use_id);
        }
      }
    }

    if (type === 'result') {
      this.awaitingTurnResult = false;
      this.compacting = false;
      this.outstandingToolUses.clear();
    }

    this.emit('stream_event', event);
    this.flushQueuedMessages();
  }

  private updateCompactingState(event: ClaudeStreamEvent): void {
    const subtype = typeof event.subtype === 'string' ? event.subtype : '';
    if (subtype === 'compacting') {
      this.compacting = true;
      return;
    }
    if (subtype === 'compact_complete' || subtype === 'compacted' || subtype === 'session_init' || subtype === 'init') {
      this.compacting = false;
    }
  }

  private flushQueuedMessages(): void {
    if (!this.getWritableChild() || this.isBusy()) return;

    const next = this.pendingUserMessages.shift();
    if (next === undefined) return;
    this.writeUserMessage(next);
  }

  private writeUserMessage(text: string): void {
    const child = this.getWritableChild();
    if (!child) {
      this.pendingUserMessages.unshift(text);
      return;
    }

    const payload = buildClaudeUserMessage(text, this.currentSessionId);
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    this.awaitingTurnResult = true;
    this.emit('message_sent', payload);
  }

  private getWritableChild(): ChildProcessWithoutNullStreams | null {
    if (!this.child || !this.child.stdin.writable) return null;
    return this.child;
  }

  private isBusy(): boolean {
    return this.awaitingTurnResult || this.compacting || this.outstandingToolUses.size > 0;
  }

  private terminate(intentional: boolean): void {
    if (!this.child) return;
    this.stopping = intentional;
    this.child.kill('SIGTERM');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getContentBlocks(event: ClaudeStreamEvent): Array<Record<string, unknown>> {
  const message = event.message;
  if (!isRecord(message)) return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}
