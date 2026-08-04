import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { delimiter, join } from 'path';
import { Readable, Writable } from 'stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type ContentBlock,
  type McpServer,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import { runtimeCommandSpawnSpec, runtimeProcessSpawnOptions, signalRuntimeProcessTree } from './process-tree.js';

export interface CodexAcpCommandOptions {
  command?: string;
  npmPackage?: string;
}

export interface CodexAcpBridgeOptions {
  command?: string;
  args?: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  mcpServers?: McpServer[];
  onUpdate?: (update: SessionUpdate, notification: SessionNotification) => void;
  onLine?: (event: { stream: 'stdout' | 'stderr'; line: string }) => void;
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
  return commandAppearsOnPath('npx.cmd', env.PATH ?? '') ? 'npx.cmd' : 'npx';
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
    return { command: resolveNpxCommand(), args: ['-y', options.npmPackage] };
  }
  return { command: options.command ?? 'codex-acp', args: [] };
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
        toolName: update.kind ?? update.title ?? undefined,
        status: update.status ?? undefined,
        raw: update,
      };
    case 'tool_call_update':
      return {
        type: update.status === 'completed' || update.status === 'failed' ? 'tool_result' : 'tool_call',
        toolName: update.kind ?? update.title ?? undefined,
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
  private connection: ClientSideConnection | null = null;
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
    });

    const input = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
    const output = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
    const client: Client = {
      sessionUpdate: (notification) => {
        this.options.onUpdate?.(notification.update, notification);
        this.emit('update', notification.update, notification);
      },
      requestPermission: (request) => this.approveFirstPermissionOption(request),
    };

    this.connection = new ClientSideConnection(() => client, ndJsonStream(input, output));
    await this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });
  }

  async createSession(options: { cwd?: string; mcpServers?: McpServer[] } = {}): Promise<string> {
    const connection = this.requireConnection();
    const result = await connection.newSession({
      cwd: options.cwd ?? this.options.cwd,
      mcpServers: options.mcpServers ?? this.options.mcpServers ?? [],
    });
    this.sessionIds.add(result.sessionId);
    return result.sessionId;
  }

  async loadSession(sessionId: string, options: { cwd?: string; mcpServers?: McpServer[] } = {}): Promise<string> {
    const connection = this.requireConnection();
    await connection.loadSession({
      sessionId,
      cwd: options.cwd ?? this.options.cwd,
      mcpServers: options.mcpServers ?? this.options.mcpServers ?? [],
    });
    this.sessionIds.add(sessionId);
    return sessionId;
  }

  async prompt(sessionId: string, text: string): Promise<PromptResponse> {
    const connection = this.requireConnection();
    const prompt: ContentBlock[] = [{ type: 'text', text }];
    return connection.prompt({ sessionId, prompt });
  }

  async cancel(sessionId: string): Promise<void> {
    const connection = this.requireConnection();
    await connection.cancel({ sessionId });
  }

  destroy(): void {
    void this.stop(0);
  }

  async stop(timeoutMs = 2000): Promise<void> {
    this.connection = null;
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

  private requireConnection(): ClientSideConnection {
    if (!this.connection) throw new Error('Codex ACP bridge is not started');
    return this.connection;
  }

  private approveFirstPermissionOption(request: RequestPermissionRequest): RequestPermissionResponse {
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
