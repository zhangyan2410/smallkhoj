import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { Credential } from '../types.js';
import { runtimeCommandNeedsWindowsShell, runtimeProcessSpawnOptions, signalRuntimeProcessTree } from './process-tree.js';
import type { ManagedRuntimeDriver, RuntimeExitEvent, RuntimeLineEvent, RuntimeSendOptions, RuntimeStreamEvent } from './runtime-driver.js';

export interface OpenCodeServerRuntimeOptions {
  credential: Credential;
  workspacePath: string;
  wrapperDir: string;
  slockHome?: string;
  launchId?: string;
  command?: string;
  commandArgs?: string[];
  baseEnv?: NodeJS.ProcessEnv;
  resumeSessionId?: string;
  model?: string;
  agent?: string;
}

export type OpenCodeServerRuntimeEvent = RuntimeLineEvent;
export type OpenCodeServerRuntimeExitEvent = RuntimeExitEvent;
export type OpenCodeServerStreamEvent = RuntimeStreamEvent;

type PendingUserMessage = { text: string; options?: RuntimeSendOptions };

interface OpenCodeSession {
  id: string;
}

interface OpenCodeEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

interface OpenCodeMessageResponse {
  info?: Record<string, unknown>;
  parts?: Array<Record<string, unknown>>;
}

interface OpenCodeModelSelection {
  providerID?: string;
  modelID?: string;
}

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_AGENT = 'default';

export function resolveOpenCodeServeLaunchCommand(
  options: Pick<OpenCodeServerRuntimeOptions, 'command' | 'commandArgs'> = {},
): { command: string; args: string[] } {
  const command = options.command?.trim() || 'opencode';
  const configuredArgs = options.commandArgs?.filter((arg) => arg.trim().length > 0);
  if (configuredArgs && configuredArgs.length > 0) return { command, args: configuredArgs };
  return {
    command,
    args: ['serve', '--hostname', DEFAULT_HOST, '--port', '0', '--print-logs', '--log-level', 'INFO'],
  };
}

export function parseOpenCodeModel(model?: string): OpenCodeModelSelection {
  const trimmed = model?.trim();
  if (!trimmed) return {};
  const slash = trimmed.indexOf('/');
  if (slash <= 0 || slash === trimmed.length - 1) {
    return { modelID: trimmed };
  }
  return {
    providerID: trimmed.slice(0, slash),
    modelID: trimmed.slice(slash + 1),
  };
}

export function buildOpenCodeSlockPrompt(options: Pick<OpenCodeServerRuntimeOptions, 'credential' | 'workspacePath' | 'wrapperDir' | 'model' | 'agent'>): string {
  const model = parseOpenCodeModel(options.model);
  const raftWrapper = join(options.wrapperDir, 'raft');
  return [
    'You are an AI agent in Raft (formerly Slock), a collaborative platform for human-AI collaboration. Raft is a shared message and task service for humans and agents that may be running on different computers.',
    '',
    '## Who You Are',
    '',
    'You are a persistent colleague, not a one-shot CLI assistant. Your workspace and MEMORY.md persist across turns, so you can recover context when resumed. Treat MEMORY.md as your recovery entry point and keep durable knowledge easy for your future self to find.',
    '',
    '## Current Runtime Context',
    '',
    'This section is authoritative when injected by the daemon. Do not infer computer identity from hostname, cwd, shell, or OpenCode defaults when this section is present.',
    '',
    `- Agent ID: ${options.credential.agentId}`,
    `- Server ID: ${options.credential.serverId ?? '<server-id>'}`,
    `- Workspace: ${options.workspacePath}`,
    '- Runtime: opencode serve',
    '- Runtime route: daemon-managed HTTP/SSE resident server',
    `- Raft CLI wrapper: ${raftWrapper}`,
    `- OpenCode provider: ${model.providerID ?? '<provider-id>'}`,
    `- OpenCode model: ${model.modelID ?? '<model-id>'}`,
    `- OpenCode agent: ${options.agent ?? DEFAULT_AGENT}`,
    '',
    '## Communication: Raft CLI Only',
    '',
    `Use the daemon-provided Raft CLI wrapper at \`${raftWrapper}\` for all chat, task, attachment, reminder, profile, and integration operations. The primary CLI name is \`raft\`; \`slock\` may exist as a legacy alias only. If bare \`raft\` is not available or reports a local auth/profile error, retry with the exact wrapper path before reporting a blocker.`,
    '',
    '- Always communicate through `raft message send` when a visible reply is required. Text produced only in the runtime transcript is not delivered to anyone.',
    '- Reuse the exact `target=` from the message you are replying to. If a message came from a thread target such as `#channel:msgid`, reply to that same thread target.',
    '- Use one Raft CLI command per shell/tool call. Do not chain multiple Raft commands with shell separators.',
    '- Use heredocs for message bodies so quotes, backticks, variables, and multiline content are not interpreted by the shell.',
    '- Do not send idle narration. Send updates when they are actionable: ownership, blockers, material progress, review-ready output, or completion.',
    '',
    '## Startup Sequence',
    '',
    '1. If the current turn includes a concrete incoming message and it needs an acknowledgment, blocker question, or ownership signal, send that early in the same target before deep work.',
    '2. Read MEMORY.md, then only the additional notes/files needed for the task.',
    '3. If the turn only includes an inbox notice, remember that message bodies are withheld, not absent. Use `raft message check` when you choose to inspect them; never conclude there is no work from a content-free notice.',
    '4. Process the message in its original target. For thread messages, reply in the same thread.',
    '5. Finish all feasible work before stopping. For multi-step work, carry it through implementation/research, verification, and a concise report unless blocked.',
    '6. At natural breakpoints, especially before side-effecting actions, run `raft message check` to review fresh messages that may have arrived while you were working.',
    '',
    '## Task Ownership: Claim First',
    '',
    '- Claim-first is mandatory. If fulfilling a message requires action beyond answering in chat, claim the task/message before starting.',
    '- If the message already has a task number, use `raft task claim --target <channel> --number <n>`.',
    '- If the work exists as a regular top-level message, claim it by message id instead of creating a duplicate task.',
    '- If the claim fails, do not work on that task unless an owner/admin explicitly redirects it to you.',
    '- Thread replies are discussion context; keep claims and task metadata on the top-level task/message.',
    '',
    '## Task Status Flow',
    '',
    '- `todo` means unstarted.',
    '- `in_progress` means someone is actively working.',
    '- `in_review` means the worker believes the deliverable is complete and needs validation.',
    '- `done` means owner/human approval or explicit DRI validation approval has been given.',
    '',
    'When you start claimed work, move or leave the task as `in_progress` according to current state. When you finish your deliverable, update it to `in_review`, not `done`. `done` requires owner/human approval or explicit DRI validation approval; the runtime must not independently mark implementation tasks done.',
    '',
    '## Thread Reporting',
    '',
    '- Report work in the task thread, not scattered channels.',
    '- Post concise progress updates at natural milestones for multi-step work.',
    '- Post blockers with: the blocked dimension, exact missing input or failure, and your recommended next step.',
    '- Post final summaries with evidence, changed files/artifacts, commands/tests run, residual risk, and requested reviewer/owner action.',
    '- If another agent is actively handling a thread, do not duplicate their report. Join only when mentioned or when you own the task.',
    '',
    '## Credential Hygiene',
    '',
    'Never paste credentials into public Raft channels, public-channel threads, public task fields, or public attachments.',
    '',
    '- Redact credential-shaped strings before posting logs or errors. Use shapes such as `sk_agent_<redacted>` or `<provider-key-redacted>`.',
    '- Do not copy provider API keys into runtime prompt text, provider inventory text, Raft messages, trace summaries, or status reports.',
    '- If a secret must be handed off, use an authorized DM/private channel and verify the audience first.',
    '- If a secret is accidentally exposed in a public surface, immediately notify the credential owner so it can be rotated.',
    '- Prefer daemon-managed integrations and local secret stores over asking a human to paste tokens.',
    '',
    '## Scope Discipline: Do Not Exceed the Task',
    '',
    '- Do not modify repositories, configs, data, or generated artifacts unless the task requires it.',
    '- Do not refactor unrelated code while implementing a focused change.',
    '- Do not reset, revert, or discard user/agent changes unless explicitly requested.',
    '- If the worktree is dirty, inspect only the relevant files and work with existing changes instead of overwriting them.',
    '- If the task is research-only, produce notes/evidence and do not write product code.',
    '- If the task is implementation, keep edits scoped to the relevant module boundaries and existing code patterns.',
    '',
    '## Cross-Agent Coordination',
    '',
    '- Use Raft tasks and threads for cross-agent work.',
    '- Do not privately coordinate public project decisions that belong in a channel/thread.',
    '- If you need another agent’s work, mention them in the relevant task/thread and describe the exact handoff.',
    '- If you split work, prefer independent subtasks or explicit phase gates; avoid accidental serial chains.',
    '- Only the worker who performed a task should report its final technical result unless asked to summarize coordination state.',
    '',
    '## Fail Fast on Blockers',
    '',
    'When blocked, do not silently spin or pretend progress. Report what you tried, the exact blocker or command/error class with secrets redacted, what you already checked, the decision/input needed, and your recommended next step.',
    '',
    '## Trace Reuse and Observability',
    '',
    '- Preserve and report relevant Raft task number, message id/thread target, runtime session id, and trace id when available.',
    '- Reuse existing trace/session context when continuing work instead of creating disconnected evidence.',
    '- For OpenCode serve, expect the daemon to map HTTP/SSE events such as session status, message updates, message part updates/deltas, permission events, aborts, and errors into runtime trace/status.',
    '- In reports, include redacted event shapes and actionable error summaries rather than raw private logs.',
    '- If an error is generic, include enough context for the daemon to wrap it into an actionable user-facing error later.',
    '',
    '## Executor Identity',
    '',
    '- Speak as the current Raft agent, not as the human owner or another agent.',
    '- When reporting actions performed by the runtime, identify whether they were done by you, by the daemon, by OpenCode, or by another named agent.',
    '- Do not imply approval from an owner/reviewer unless it was explicitly given in the visible context.',
    '- Mention other agents by their Raft handle when requesting review or handoff; do not mention yourself.',
    '',
    '## OpenCode Serve Runtime Notes',
    '',
    '- The daemon injects durable collaboration rules through the `system` field and volatile task/message context through user messages.',
    '- Assistant text streamed through OpenCode is runtime telemetry unless you explicitly send it through the Raft CLI.',
    '- The daemon aligns OpenCode coding-runtime permission semantics with the existing Claude Code runtime, which runs with model-level permissions bypassed and relies on Raft CLI write gates, workspace/task discipline, and traceability for collaboration safety.',
    '- Do not assume OpenCode default agents, plugins, model routing, MCP servers, or project AGENTS.md have higher priority than this system prompt.',
    '- If OpenCode, oh-my-openagent, MCP, plugin, model routing, or project configuration conflicts with Raft collaboration rules, follow the Raft rules and report the conflict.',
    '- The project/plugin name is `oh-my-openagent`; schema filenames may still contain `oh-my-opencode` as a historical artifact.',
    '',
    '## Permission and Tool Policy for OpenCode Serve',
    '',
    '- Prefer read-only inspection until the task clearly requires writes, but normal coding-runtime bash/edit/web/MCP capabilities may be available when needed, matching the Claude Code runtime model.',
    '- Raft write protection lives in the daemon-provided wrapper CLI. Write-capable Raft commands require daemon/operator opt-in and may fail with `WRITES_NOT_ALLOWED` or `WRITE_TARGET_NOT_ALLOWED`; report those exact blockers and do not bypass them.',
    '- Do not bypass daemon policy with alternate Raft credentials, browser sessions, host-global config, or direct MCP calls outside the OpenCode session.',
    '- The daemon may specially recognize exact-command approve once daemon-owned Raft wrapper round-trips for auditing. Do not broaden this into a template allowlist, and do not treat it as the only command shape that can run.',
    '- If a Raft wrapper permission or write gate is rejected, report the rejection as a blocker or task outcome; do not retry through another path.',
    '- MCP servers, when injected by the daemon or an OpenCode plugin, are part of the same tool and permission policy. Treat their network access and side effects with the same scrutiny as built-in tools such as bash, edit, and web.',
    '',
    '## Comparison Readiness: OpenCode vs Claude Code',
    '',
    'Keep behavior comparable with the existing Claude Code runtime where possible: same Raft identity/context model, same CLI-only communication contract, same claim-first lifecycle, same credential hygiene, same thread reporting and blocker format, same trace/status expectations, and same refusal to bypass permissions or mutate out of scope. When OpenCode behavior differs from Claude Code behavior, name the difference in final reports.',
    '',
    '## Completion and Exit Etiquette',
    '',
    '- Before stopping, ensure no required Raft reply is still pending in the active task/thread.',
    '- Update task status when appropriate.',
    '- Report final deliverables, evidence paths, verification results, and residual risk.',
    '- If a specific person is blocked on you, send one minimal actionable handoff message.',
    '- Do not leave long-running local servers/processes alive unless the task explicitly requires them and you reported how to manage them.',
  ].join('\n');
}

export function writeOpenCodePromptFile(options: Pick<OpenCodeServerRuntimeOptions, 'credential' | 'workspacePath' | 'wrapperDir' | 'model' | 'agent'>): string {
  mkdirSync(options.wrapperDir, { recursive: true });
  const promptFile = join(options.wrapperDir, 'opencode-slock-prompt.md');
  writeFileSync(promptFile, buildOpenCodeSlockPrompt(options), 'utf-8');
  return promptFile;
}

export class OpenCodeServerRuntimeDriver extends EventEmitter implements ManagedRuntimeDriver {
  private readonly options: OpenCodeServerRuntimeOptions;
  private readonly pendingUserMessages: PendingUserMessage[] = [];
  private readonly serverPassword = randomBytes(24).toString('base64url');
  private child: ChildProcessWithoutNullStreams | null = null;
  private started = false;
  private stopping = false;
  private bootstrapping: Promise<void> | null = null;
  private activePrompt: Promise<void> | null = null;
  private serverUrl: string | undefined;
  private currentSessionId: string | undefined;
  private systemPrompt = '';
  private exitEmitted = false;
  private sseAbort: AbortController | null = null;
  private approvedWrapperCommands = new Set<string>();

  constructor(options: OpenCodeServerRuntimeOptions) {
    super();
    this.options = options;
    this.currentSessionId = options.resumeSessionId;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.exitEmitted = false;
    const promptFile = writeOpenCodePromptFile(this.options);
    this.systemPrompt = buildOpenCodeSlockPrompt(this.options);
    this.emit('line', { stream: 'stderr', line: `OpenCode Slock prompt written to ${promptFile}` } satisfies OpenCodeServerRuntimeEvent);
    this.spawnServer();
    void this.flushQueuedMessages();
  }

  stop(): void {
    this.started = false;
    this.stopping = true;
    this.sseAbort?.abort();
    const child = this.child;
    if (!child) {
      this.emitExitOnce({ code: 0, signal: null, intentional: true, sessionId: this.currentSessionId });
      return;
    }
    signalRuntimeProcessTree(child, 'SIGTERM');
  }

  killUnresponsive(): void {
    this.started = false;
    this.stopping = false;
    this.sseAbort?.abort();
    const child = this.child;
    if (!child) {
      this.emitExitOnce({ code: null, signal: 'SIGKILL', intentional: false, sessionId: this.currentSessionId });
      return;
    }
    signalRuntimeProcessTree(child, 'SIGKILL');
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
    return Boolean(this.bootstrapping || this.activePrompt);
  }

  sendUserMessage(text: string, options?: RuntimeSendOptions): boolean {
    if (!this.started || this.busy) {
      this.pendingUserMessages.push({ text, options });
      void this.flushQueuedMessages();
      return false;
    }
    void this.runPrompt(text, options);
    return true;
  }

  private spawnServer(): void {
    if (this.child) return;
    const { command, args } = resolveOpenCodeServeLaunchCommand(this.options);
    const child = spawn(command, args, runtimeProcessSpawnOptions({
      cwd: this.options.workspacePath,
      env: {
        ...(this.options.baseEnv ?? process.env),
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        OPENCODE_SERVER_PASSWORD: this.serverPassword,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: runtimeCommandNeedsWindowsShell(command),
    }));
    this.child = child;
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => this.consumeProcessOutput('stdout', chunk));
    child.stderr.on('data', (chunk: string) => this.consumeProcessOutput('stderr', chunk));
    child.on('error', (err) => this.emit('error', err));
    child.on('exit', (code, signal) => {
      const intentional = this.stopping;
      this.child = null;
      this.bootstrapping = null;
      this.activePrompt = null;
      this.sseAbort?.abort();
      this.emitExitOnce({ code, signal, intentional, sessionId: this.currentSessionId });
    });
  }

  private consumeProcessOutput(stream: 'stdout' | 'stderr', chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line) continue;
      const sanitized = sanitizeOpenCodeLine(line);
      this.emit('line', { stream, line: sanitized } satisfies OpenCodeServerRuntimeEvent);
      const match = line.match(/opencode server listening on (https?:\/\/[^\s]+)/i);
      if (match && !this.serverUrl) {
        this.serverUrl = match[1].replace(/\/$/, '');
        void this.startEventStream();
        void this.flushQueuedMessages();
      }
    }
  }

  private async flushQueuedMessages(): Promise<void> {
    if (!this.started || this.activePrompt) return;
    const next = this.pendingUserMessages.shift();
    if (next === undefined) return;
    await this.runPrompt(next.text, next.options);
  }

  private async ensureSession(options?: RuntimeSendOptions): Promise<string> {
    const requestedSessionId = options && 'sessionId' in options ? options.sessionId : undefined;
    if (requestedSessionId !== null && requestedSessionId && this.currentSessionId === requestedSessionId) {
      return requestedSessionId;
    }
    if (requestedSessionId === undefined && this.currentSessionId) return this.currentSessionId;
    if (this.bootstrapping) {
      await this.bootstrapping;
      if (!this.currentSessionId) throw new Error('OpenCode session is not ready');
      return this.currentSessionId;
    }

    this.bootstrapping = (async () => {
      await this.waitForServer();
      const session = requestedSessionId
        ? { id: requestedSessionId }
        : await this.createSession();
      if (session.id !== this.currentSessionId) {
        this.currentSessionId = session.id;
        this.emit('session', { sessionId: session.id });
      } else {
        this.emit('session', { sessionId: session.id });
      }
    })();

    try {
      await this.bootstrapping;
    } finally {
      this.bootstrapping = null;
    }
    if (!this.currentSessionId) throw new Error('OpenCode session is not ready');
    return this.currentSessionId;
  }

  private async waitForServer(timeoutMs = 15_000): Promise<void> {
    const startedAt = Date.now();
    while (!this.serverUrl) {
      if (Date.now() - startedAt > timeoutMs) throw new Error('OpenCode server did not report a listening URL');
      await delay(50);
    }
    while (Date.now() - startedAt <= timeoutMs) {
      try {
        const health = await this.request('/global/health');
        if (isRecord(health) && health.healthy === true) return;
      } catch {
        // retry until timeout
      }
      await delay(100);
    }
    throw new Error('OpenCode server health check timed out');
  }

  private async createSession(): Promise<OpenCodeSession> {
    const model = parseOpenCodeModel(this.options.model);
    const body: Record<string, unknown> = {
      title: `raft-${this.options.credential.agentId}`,
      agent: this.options.agent ?? DEFAULT_AGENT,
      permission: claudeParityOpenCodePermissionRules(),
    };
    if (model.providerID && model.modelID) {
      body.model = { id: model.modelID, providerID: model.providerID };
    }
    const result = await this.request('/session', { method: 'POST', body });
    const sessionId = stringField(result, 'id');
    if (!sessionId) throw new Error('OpenCode session.create returned no session id');
    return { id: sessionId };
  }

  private async runPrompt(text: string, options?: RuntimeSendOptions): Promise<void> {
    this.activePrompt = (async () => {
      const activeSessionId = await this.ensureSession(options);
      const model = parseOpenCodeModel(this.options.model);
      const body: Record<string, unknown> = {
        system: this.systemPrompt || buildOpenCodeSlockPrompt(this.options),
        parts: [{ type: 'text', text }],
      };
      if (model.providerID && model.modelID) {
        body.model = { providerID: model.providerID, modelID: model.modelID };
      }
      this.emit('message_sent', {
        type: 'opencode_prompt',
        session_id: activeSessionId,
        sessionScopeKey: options?.sessionScopeKey,
        promptBytes: Buffer.byteLength(text, 'utf-8'),
        providerID: model.providerID,
        modelID: model.modelID,
        agent: this.options.agent ?? DEFAULT_AGENT,
      });
      const response = await this.request(`/session/${encodeURIComponent(activeSessionId)}/message`, { method: 'POST', body }) as OpenCodeMessageResponse;
      this.emit('stream_event', this.buildResultEvent(response));
    })();

    try {
      await this.activePrompt;
    } catch (err) {
      this.emit('stream_event', {
        type: 'result',
        subtype: 'error',
        runtime: 'opencode',
        session_id: this.currentSessionId,
        sessionId: this.currentSessionId,
        error: actionableOpenCodeError(err),
      } satisfies OpenCodeServerStreamEvent);
      this.emit('error', err);
    } finally {
      this.activePrompt = null;
      void this.flushQueuedMessages();
    }
  }

  private async startEventStream(): Promise<void> {
    if (this.sseAbort || !this.serverUrl) return;
    const controller = new AbortController();
    this.sseAbort = controller;
    try {
      const response = await fetch(`${this.serverUrl}/event`, {
        headers: this.authHeaders(),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) throw new Error(`OpenCode SSE failed: HTTP ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const data = chunk.split('\n').find((line) => line.startsWith('data:'));
          if (!data) continue;
          try {
            this.consumeOpenCodeEvent(JSON.parse(data.slice(5).trim()) as OpenCodeEvent);
          } catch (err) {
            this.emit('line', { stream: 'stderr', line: `OpenCode SSE parse skipped: ${(err as Error).message}` });
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted && this.started) {
        this.emit('stream_event', {
          type: 'error',
          runtime: 'opencode',
          error: actionableOpenCodeError(err),
        } satisfies OpenCodeServerStreamEvent);
      }
    } finally {
      if (this.sseAbort === controller) this.sseAbort = null;
    }
  }

  private consumeOpenCodeEvent(event: OpenCodeEvent): void {
    const eventType = event.type;
    const properties = event.properties ?? {};
    const sessionId = stringField(properties, 'sessionID') ?? this.currentSessionId;
    if (eventType === 'message.part.delta') {
      const delta = stringField(properties, 'delta');
      if (delta) {
        this.emit('stream_event', {
          type: 'assistant',
          runtime: 'opencode',
          session_id: sessionId,
          sessionId,
          message: { content: [{ type: 'text', text: delta }] },
          opencodeEvent: eventType,
        } satisfies OpenCodeServerStreamEvent);
      }
      return;
    }
    if (eventType === 'message.part.updated') {
      const part = isRecord(properties.part) ? properties.part : {};
      this.consumePartUpdate(sessionId, part, eventType);
      return;
    }
    if (eventType === 'permission.asked') {
      void this.respondToPermission(properties);
    }
    this.emit('stream_event', {
      type: mapOpenCodeEventType(eventType),
      runtime: 'opencode',
      session_id: sessionId,
      sessionId,
      opencodeEvent: eventType,
      raw: event,
    } satisfies OpenCodeServerStreamEvent);
  }

  private consumePartUpdate(sessionId: string | undefined, part: Record<string, unknown>, opencodeEvent: string): void {
    const partType = stringField(part, 'type');
    if (partType === 'text') {
      const text = stringField(part, 'text');
      if (!text) return;
      this.emit('stream_event', {
        type: 'assistant',
        runtime: 'opencode',
        session_id: sessionId,
        sessionId,
        message: { content: [{ type: 'text', text }] },
        opencodeEvent,
      } satisfies OpenCodeServerStreamEvent);
      return;
    }
    if (partType === 'tool') {
      const tool = stringField(part, 'tool') ?? 'tool';
      const callId = stringField(part, 'callID') ?? stringField(part, 'id') ?? `${sessionId ?? 'opencode'}-tool`;
      const state = isRecord(part.state) ? part.state : {};
      const status = stringField(state, 'status');
      if (status === 'completed' || status === 'error') {
        this.emit('stream_event', {
          type: 'user',
          runtime: 'opencode',
          session_id: sessionId,
          sessionId,
          message: {
            content: [{
              type: 'tool_result',
              tool_use_id: callId,
              content: JSON.stringify({ status, tool, output: state.output, error: state.error }),
              is_error: status === 'error',
            }],
          },
          opencodeEvent,
        } satisfies OpenCodeServerStreamEvent);
        return;
      }
      this.emit('stream_event', {
        type: 'assistant',
        runtime: 'opencode',
        session_id: sessionId,
        sessionId,
        message: {
          content: [{
            type: 'tool_use',
            id: callId,
            name: tool,
            input: { status, command: toolCommandPreview(state), raw: part },
          }],
        },
        opencodeEvent,
      } satisfies OpenCodeServerStreamEvent);
    }
  }

  private async respondToPermission(properties: Record<string, unknown>): Promise<void> {
    const permissionId = stringField(properties, 'id');
    if (!permissionId) return;
    const patterns = Array.isArray(properties.patterns)
      ? properties.patterns.filter((item): item is string => typeof item === 'string')
      : [];
    const command = patterns[0] ?? stringField(isRecord(properties.metadata) ? properties.metadata : {}, 'command') ?? '';
    const wrapperRoundTrip = this.isExactWrapperCommand(command);
    if (wrapperRoundTrip) this.approvedWrapperCommands.add(command);
    await this.request(`/permission/${encodeURIComponent(permissionId)}/reply`, {
      method: 'POST',
      body: {
        reply: 'once',
        message: wrapperRoundTrip
          ? 'Approved exact daemon-owned Raft wrapper command once.'
          : 'Approved once to match Claude Code runtime permission parity; Raft CLI writes remain gated by wrapper policy.',
      },
    }).catch((err) => {
      this.emit('error', err);
    });
  }

  private isExactWrapperCommand(command: string): boolean {
    if (!command || this.approvedWrapperCommands.has(command)) return false;
    const wrapperPath = join(this.options.wrapperDir, 'raft');
    const legacyWrapperPath = join(this.options.wrapperDir, 'slock');
    const invokesWrapper = command.includes(wrapperPath) || command.includes(legacyWrapperPath);
    return invokesWrapper && /\bmessage\s+send\b/.test(command) && /<<['"]?[A-Z0-9_]+['"]?/.test(command);
  }

  private async request(path: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
    if (!this.serverUrl) throw new Error('OpenCode server URL is not ready');
    const response = await fetch(`${this.serverUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...this.authHeaders(),
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    const parsed = parseJsonMaybe(text);
    if (!response.ok) {
      throw new Error(openCodeHttpErrorMessage(response.status, parsed));
    }
    return parsed;
  }

  private authHeaders(): Record<string, string> {
    return {
      authorization: `Basic ${Buffer.from(`opencode:${this.serverPassword}`).toString('base64')}`,
    };
  }

  private buildResultEvent(response: OpenCodeMessageResponse): OpenCodeServerStreamEvent {
    const info = isRecord(response.info) ? response.info : {};
    const error = isRecord(info.error) ? info.error : undefined;
    return {
      type: 'result',
      subtype: error ? 'error' : 'success',
      runtime: 'opencode',
      session_id: this.currentSessionId,
      sessionId: this.currentSessionId,
      usage: normalizeOpenCodeUsage(info),
      error: error ? actionableOpenCodeError(error) : undefined,
      raw: response,
    } satisfies OpenCodeServerStreamEvent;
  }

  private emitExitOnce(event: OpenCodeServerRuntimeExitEvent): void {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    this.emit('exit', event);
  }
}

function claudeParityOpenCodePermissionRules(): Array<Record<string, string>> {
  return [
    { permission: 'bash', pattern: '*', action: 'ask' },
    { permission: 'edit', pattern: '*', action: 'ask' },
    { permission: 'webfetch', pattern: '*', action: 'ask' },
    { permission: 'websearch', pattern: '*', action: 'ask' },
  ];
}

function normalizeOpenCodeUsage(info: Record<string, unknown>): Record<string, unknown> {
  const tokens = isRecord(info.tokens) ? info.tokens : {};
  return {
    input_tokens: numberField(tokens, 'input') ?? numberField(tokens, 'inputTokens'),
    output_tokens: numberField(tokens, 'output') ?? numberField(tokens, 'outputTokens'),
    cache_read_input_tokens: numberField(tokens, 'cacheRead') ?? numberField(tokens, 'cache_read_input_tokens'),
    total_tokens: numberField(tokens, 'total') ?? numberField(tokens, 'totalTokens'),
    inputTokens: numberField(tokens, 'input') ?? numberField(tokens, 'inputTokens'),
    outputTokens: numberField(tokens, 'output') ?? numberField(tokens, 'outputTokens'),
    cacheReadInputTokens: numberField(tokens, 'cacheRead') ?? numberField(tokens, 'cache_read_input_tokens'),
    totalTokens: numberField(tokens, 'total') ?? numberField(tokens, 'totalTokens'),
    cost: numberField(info, 'cost'),
  };
}

function openCodeHttpErrorMessage(status: number, body: unknown): string {
  const name = stringField(body, 'name') ?? stringField(body, '_tag') ?? `HTTP_${status}`;
  const data = isRecord(body) && isRecord(body.data) ? body.data : body;
  const message = stringField(data, 'message') ?? (typeof body === 'string' ? body : undefined) ?? 'OpenCode request failed';
  if (status === 500 && name === 'UnknownError') {
    return `OpenCode request failed with a generic 500 UnknownError. Check provider/model policy and OpenCode logs. Details: ${message}`;
  }
  return `OpenCode request failed: HTTP ${status} ${name}: ${message}`;
}

function actionableOpenCodeError(err: unknown): string {
  if (err instanceof Error) return sanitizeOpenCodeLine(err.message);
  if (typeof err === 'string') return sanitizeOpenCodeLine(err);
  if (isRecord(err)) {
    const name = stringField(err, 'name') ?? stringField(err, '_tag') ?? 'OpenCodeError';
    const data = isRecord(err.data) ? err.data : err;
    const message = stringField(data, 'message') ?? JSON.stringify(err);
    return sanitizeOpenCodeLine(`${name}: ${message}`);
  }
  return 'Unknown OpenCode error';
}

function parseJsonMaybe(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function mapOpenCodeEventType(eventType?: string): string {
  if (!eventType) return 'opencode_event';
  if (eventType.startsWith('permission.')) return 'permission';
  if (eventType.startsWith('session.status')) return 'status';
  if (eventType.startsWith('session.')) return 'session_status';
  if (eventType.startsWith('message.')) return 'message';
  return 'opencode_event';
}

function toolCommandPreview(state: Record<string, unknown>): string | undefined {
  const input = isRecord(state.input) ? state.input : undefined;
  return input ? stringField(input, 'command') : undefined;
}

function sanitizeOpenCodeLine(line: string): string {
  return line
    .replace(/sk_agent_[A-Za-z0-9_-]+/g, 'sk_agent_<redacted>')
    .replace(/sk_machine_[A-Za-z0-9_-]+/g, 'sk_machine_<redacted>')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>')
    .replace(/(api[_-]?key["']?\s*[:=]\s*["']?)[^"',\s]+/gi, '$1<redacted>');
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
