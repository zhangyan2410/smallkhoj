import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { delimiter, join } from 'path';
import { Readable, Writable } from 'stream';
import {
  client as createClientApp,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type ClientContext,
  type ContentBlock,
  type McpServer,
  type PromptResponse,
  type SessionNotification,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { runtimeCommandSpawnSpec, runtimeProcessSpawnOptions, signalRuntimeProcessTree } from './process-tree.js';
import { resolveWindowsRegistryPath } from './slock-wrapper.js';

export interface CodexAcpCommandOptions {
  command?: string;
  npmPackage?: string;
}

/**
 * Bidirectional session id mapping between an agent's native id space and the
 * platform id space. `encode` maps a freshly-created native id to the stable
 * platform id; `decode` reverses it before handing the id back to the agent.
 * When unset the bridge is an identity codec (codex path).
 */
export interface SessionIdCodec {
  encode(nativeId: string): string;
  decode(platformId: string): string;
}

export interface CodexAcpBridgeOptions {
  command?: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  mcpServers?: McpServer[];
  onUpdate?: (update: SessionUpdate, notification: SessionNotification) => void;
  onLine?: (event: { stream: 'stdout' | 'stderr'; line: string }) => void;
  /** Maps native ⇄ platform session ids. Omit for an identity codec. */
  sessionIdCodec?: SessionIdCodec;
  /** Extra `clientCapabilities._meta` sent at initialize (e.g. goose flags). */
  clientCapabilitiesMeta?: Record<string, unknown>;
  /**
   * Agent→client extension notification methods this bridge should receive
   * (e.g. goose's `_goose/unstable/session/update`). The new client API
   * registers notification handlers per method name, so runtimes declare the
   * ext methods they consume instead of a legacy catch-all.
   */
  extNotificationMethods?: string[];
  /** Receives the declared agent→client extension notifications. */
  onNotification?: (method: string, params: Record<string, unknown>) => void;
}

export interface CodexAcpTranslatedUpdate {
  type: 'message_delta' | 'thought_delta' | 'tool_call' | 'tool_result' | 'usage' | 'unknown';
  text?: string;
  toolName?: string;
  status?: string;
  raw: SessionUpdate;
}

export function resolveNpxCommand(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== 'win32') return 'npx';
  // The daemon process may have inherited an empty PATH (npx/connect-ticket launch).
  // Fall back to the persisted registry PATH so we resolve `npx.cmd` (the real shim)
  // instead of bare `npx`, which Windows cannot CreateProcess without a shell.
  let pathValue = env.PATH ?? '';
  if (!pathValue.trim()) {
    const registryPath = resolveWindowsRegistryPath();
    if (registryPath) pathValue = registryPath;
  }
  return commandAppearsOnPath('npx.cmd', pathValue) ? 'npx.cmd' : 'npx';
}

function commandAppearsOnPath(command: string, pathValue: string): boolean {
  if (!pathValue) return false;
  for (const pathDir of pathValue.split(delimiter)) {
    if (!pathDir) continue;
    if (existsSync(join(pathDir, command))) return true;
  }
  return false;
}

export function buildCodexAcpCommand(options: CodexAcpCommandOptions = {}): { command: string; args: string[] } {
  if (options.npmPackage) {
    return {
      command: resolveNpxCommand(),
      // Daemon-managed agents run trusted on the user's machine; matching the
      // codex exec path's danger-full-access keeps aura wrapper calls working
      // without per-call model escalation.
      args: ['-y', options.npmPackage, '-c', 'sandbox_mode=danger-full-access'],
    };
  }
  return { command: options.command ?? 'codex-acp', args: ['-c', 'sandbox_mode=danger-full-access'] };
}

export function translateAcpUpdate(update: SessionUpdate): CodexAcpTranslatedUpdate {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = update.content;
      if (content?.type === 'text') {
        return { type: 'message_delta', text: content.text, raw: update };
      }
      return { type: 'unknown', raw: update };
    }
    case 'agent_thought_chunk': {
      const content = update.content;
      if (content?.type === 'text') {
        return { type: 'thought_delta', text: content.text, raw: update };
      }
      return { type: 'unknown', raw: update };
    }
    case 'tool_call':
      return {
        type: 'tool_call',
        toolName: update.title ?? update.kind ?? undefined,
        status: update.status ?? undefined,
        raw: update,
      };
    case 'tool_call_update':
      return {
        type: update.status === 'completed' || update.status === 'failed' ? 'tool_result' : 'tool_call',
        toolName: update.title ?? update.kind ?? undefined,
        status: update.status ?? undefined,
        raw: update,
      };
    case 'usage_update':
      return { type: 'usage', raw: update };
    case 'plan':
    case 'available_commands_update':
    case 'current_mode_update':
      return { type: 'unknown', raw: update };
    default:
      return { type: 'unknown', raw: update };
  }
}

export class CodexAcpBridge extends EventEmitter {
  private readonly options: CodexAcpBridgeOptions;
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: ClientConnection | null = null;
  private agentContext: ClientContext | null = null;
  readonly sessionIds = new Set<string>();

  constructor(options: CodexAcpBridgeOptions) {
    super();
    this.options = options;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  get alive(): boolean {
    return Boolean(this.child && this.child.exitCode === null && this.child.signalCode === null);
  }

  async start(): Promise<void> {
    if (this.child) return;
    const { command, args } = buildCodexAcpCommand({ command: this.options.command });
    const spawnSpec = runtimeCommandSpawnSpec(command, [...(this.options.args ?? args)]);
    const child = spawn(spawnSpec.command, spawnSpec.args, runtimeProcessSpawnOptions({
      cwd: this.options.cwd,
      // An explicit env is already the caller-owned child environment. Merging
      // process.env again would refill launcher-only keys the caller removed.
      env: { ...(this.options.env ?? process.env) },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: spawnSpec.shell,
    }));
    this.child = child;

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => this.emitProcessLines('stderr', chunk));
    child.on('error', (err) => this.emit('error', err));
    child.on('exit', (code, signal) => {
      this.emit('exit', { code, signal });
      this.child = null;
      this.connection = null;
      this.agentContext = null;
    });

    const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const codec = this.options.sessionIdCodec;
    const app = createClientApp({ name: 'smallkhoj-daemon' });
    app.onNotification(methods.client.session.update, (context) => {
      // Translate the notification's native sessionId into the platform id
      // space when a codec is configured, so consumers compare against the
      // stable platform id the driver tracks.
      const notification = context.params;
      const rawSessionId = notification.sessionId;
      const platformSessionId = codec && rawSessionId ? codec.encode(rawSessionId) : rawSessionId;
      const translated = platformSessionId === rawSessionId
        ? notification
        : { ...notification, sessionId: platformSessionId };
      this.options.onUpdate?.(translated.update, translated);
      this.emit('update', translated.update, translated);
    });
    app.onRequest(methods.client.session.requestPermission, (context) =>
      this.approveFirstPermissionOption(context.params));
    const onNotification = this.options.onNotification;
    if (onNotification) {
      for (const method of this.options.extNotificationMethods ?? []) {
        const passthrough = (params: unknown) => params as Record<string, unknown>;
        app.onNotification(method, passthrough, (context) => onNotification(method, context.params));
      }
    }

    // The deprecated ClientSideConnection is a shim over exactly this app
    // machinery; connecting directly keeps us on the supported path and
    // unlocks SendRequestOptions.cancellationSignal ($/cancel_request).
    const connection = app.connect(ndJsonStream(input, output));
    this.connection = connection;
    this.agentContext = connection.agent;
    void connection.closed.catch(() => {});
    await this.agentContext.request(methods.agent.initialize, {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: this.options.clientCapabilitiesMeta
        ? { _meta: this.options.clientCapabilitiesMeta }
        : {},
    });
  }

  async createSession(options: { cwd?: string; mcpServers?: McpServer[] } = {}): Promise<string> {
    const agent = this.requireAgentContext();
    const result = await agent.request(methods.agent.session.new, {
      cwd: options.cwd ?? this.options.cwd,
      mcpServers: options.mcpServers ?? this.options.mcpServers ?? [],
    });
    const codec = this.options.sessionIdCodec;
    const sessionId = codec ? codec.encode(result.sessionId) : result.sessionId;
    this.sessionIds.add(sessionId);
    return sessionId;
  }

  async loadSession(sessionId: string, options: { cwd?: string; mcpServers?: McpServer[] } = {}): Promise<string> {
    const agent = this.requireAgentContext();
    const codec = this.options.sessionIdCodec;
    const nativeId = codec ? codec.decode(sessionId) : sessionId;
    await agent.request(methods.agent.session.load, {
      sessionId: nativeId,
      cwd: options.cwd ?? this.options.cwd,
      mcpServers: options.mcpServers ?? this.options.mcpServers ?? [],
    });
    this.sessionIds.add(sessionId);
    return sessionId;
  }

  async prompt(sessionId: string, text: string, options: { signal?: AbortSignal } = {}): Promise<PromptResponse> {
    const agent = this.requireAgentContext();
    const codec = this.options.sessionIdCodec;
    const nativeId = codec ? codec.decode(sessionId) : sessionId;
    const prompt: ContentBlock[] = [{ type: 'text', text }];
    // An aborted signal makes the SDK send $/cancel_request for this prompt —
    // the transport-level sibling of the agent-domain session/cancel.
    return agent.request(
      methods.agent.session.prompt,
      { sessionId: nativeId, prompt },
      options.signal ? { cancellationSignal: options.signal } : undefined,
    );
  }

  async cancel(sessionId: string): Promise<void> {
    const agent = this.requireAgentContext();
    const codec = this.options.sessionIdCodec;
    const nativeId = codec ? codec.decode(sessionId) : sessionId;
    await agent.notify(methods.agent.session.cancel, { sessionId: nativeId });
  }

  destroy(): void {
    void this.stop(0);
  }

  async stop(timeoutMs = 2000): Promise<void> {
    this.connection?.close();
    this.connection = null;
    this.agentContext = null;
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once('exit', () => resolve());
    });

    signalRuntimeProcessTree(child, 'SIGTERM');
    if (timeoutMs > 0) {
      const timedOut = await Promise.race([
        exited.then(() => false),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(true), timeoutMs)),
      ]);
      if (timedOut) {
        signalRuntimeProcessTree(child, 'SIGKILL');
        await exited.catch(() => {});
      }
    }
    this.child = null;
  }

  private requireAgentContext(): ClientContext {
    if (!this.agentContext) throw new Error('Codex ACP bridge is not started');
    return this.agentContext;
  }

  private approveFirstPermissionOption(request: { options?: Array<{ optionId?: string }> }): { outcome: { outcome: 'selected'; optionId: string } } {
    const optionId = request.options?.[0]?.optionId ?? 'allow-once';
    return { outcome: { outcome: 'selected', optionId } };
  }

  private emitProcessLines(stream: 'stdout' | 'stderr', chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) {
      if (!line) continue;
      this.options.onLine?.({ stream, line });
      this.emit('line', { stream, line });
    }
  }
}
