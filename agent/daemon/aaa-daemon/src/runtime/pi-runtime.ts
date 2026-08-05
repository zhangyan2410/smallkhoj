import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import type { Credential } from '../types.js';
import { buildSlockSystemPrompt } from './claude-runtime.js';
import { prependPathEnv } from './slock-wrapper.js';
import {
  runtimeProcessSpawnOptions,
  scheduleRuntimeProcessTreeKill,
  signalRuntimeProcessTree,
} from './process-tree.js';
import type {
  ManagedRuntimeDriver,
  RuntimeExitEvent,
  RuntimeLineEvent,
  RuntimeSendOptions,
  RuntimeStreamEvent,
} from './runtime-driver.js';

export const BUNDLED_PI_VERSION = '0.73.1';
export const SMALLKHOJ_PI_PROVIDER = 'smallkhoj-minimax';

export interface BundledPiLayout {
  installRoot: string;
  nodePath: string;
  piEntry: string;
  version: string;
}

export interface PiRuntimeOptions {
  credential: Credential;
  workspacePath: string;
  nodePath: string;
  piEntry: string;
  proxyUrl: string;
  proxyToken: string;
  wrapperDir?: string;
  slockHome?: string;
  launchId?: string;
  provider?: string;
  model?: string;
  /** LLM 协议格式，驱动 provider extension 的 api 值和 relay 路径。默认 anthropic。 */
  apiFormat?: 'anthropic' | 'openai';
  baseEnv?: NodeJS.ProcessEnv;
  manageCapacity?: boolean;
  leasePollMs?: number;
  leaseHeartbeatMs?: number;
}

export interface PiRuntimeEnvOptions extends Pick<
  PiRuntimeOptions,
  'credential' | 'workspacePath' | 'proxyUrl' | 'proxyToken' | 'wrapperDir' | 'slockHome' | 'launchId'
> {
  configHome: string;
  runId?: string;
}

export interface PiLaunchOptions {
  nodePath: string;
  piEntry: string;
  sessionPath: string;
  extensionPath?: string;
  systemPromptPath?: string;
  provider?: string;
  model?: string;
}

type PendingPrompt = { text: string; options?: RuntimeSendOptions };

function buildPiSystemPrompt(options: PiRuntimeOptions): string {
  return buildSlockSystemPrompt({
    credential: options.credential,
    workspacePath: options.workspacePath,
    wrapperDir: options.wrapperDir,
  });
}

export function resolveBundledPiLayout(env: NodeJS.ProcessEnv = process.env): BundledPiLayout | undefined {
  const rawRoot = env.SMALLKHOJ_DAEMON_INSTALL_ROOT?.trim();
  if (!rawRoot) return undefined;
  const installRoot = resolve(rawRoot);
  const nodePath = env.SMALLKHOJ_BUNDLED_NODE?.trim() || join(
    installRoot,
    'runtime',
    'node',
    process.platform === 'win32' ? 'node.exe' : 'bin/node',
  );
  const piEntry = env.SMALLKHOJ_BUNDLED_PI_ENTRY?.trim() || join(
    installRoot,
    'node_modules',
    '@mariozechner',
    'pi-coding-agent',
    'dist',
    'cli.js',
  );
  if (!existsSync(nodePath) || !existsSync(piEntry)) return undefined;
  return { installRoot, nodePath, piEntry, version: BUNDLED_PI_VERSION };
}

export function resolvePiLaunch(options: PiLaunchOptions): { command: string; args: string[] } {
  const args = [
    options.piEntry,
    '-p',
    '--mode', 'json',
    '--session', options.sessionPath,
  ];
  if (options.extensionPath) args.push('--extension', options.extensionPath);
  if (options.systemPromptPath) args.push('--append-system-prompt', options.systemPromptPath);
  if (options.provider) args.push('--provider', options.provider);
  if (options.model) args.push('--model', options.model);
  return { command: options.nodePath, args };
}

export function buildPiRuntimeEnv(
  options: PiRuntimeEnvOptions,
  baseEnv: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    PI_CODING_AGENT_DIR: options.configHome,
    SMALLKHOJ_LLM_PROXY_URL: options.proxyUrl,
    SMALLKHOJ_LLM_PROXY_TOKEN: options.proxyToken,
    ...(options.runId ? { SMALLKHOJ_LLM_RUN_ID: options.runId } : {}),
    FORCE_COLOR: '0',
    SLOCK_HOME: options.slockHome ?? options.wrapperDir,
    SLOCK_AGENT_ID: options.credential.agentId,
    SLOCK_AGENT_LAUNCH_ID: options.launchId ?? `pid-${process.pid}`,
    SLOCK_SERVER_URL: options.credential.serverUrl,
    SLOCK_CURRENT_WORKSPACE_PATH: options.workspacePath,
    PATH: options.wrapperDir
      ? prependPathEnv(options.wrapperDir, baseEnv.PATH ?? process.env.PATH ?? '')
      : baseEnv.PATH ?? process.env.PATH ?? '',
  };
  delete env.SLOCK_AGENT_TOKEN;
  delete env.SLOCK_AGENT_PROXY_URL;
  delete env.SLOCK_AGENT_PROXY_TOKEN;
  delete env.SLOCK_AGENT_PROXY_TOKEN_FILE;
  delete env.SLOCK_AGENT_ACTIVE_CAPABILITIES;
  delete env.SMALLKHOJ_MACHINE_TOKEN;
  delete env.LLM_API_KEY;
  delete env.PI_LLM_API_KEY;
  return env;
}

function writeProviderExtension(
  configHome: string,
  options: Pick<PiRuntimeOptions, 'credential' | 'proxyUrl' | 'provider' | 'model' | 'apiFormat'>,
): string {
  const extensionsDir = join(configHome, 'extensions');
  mkdirSync(extensionsDir, { recursive: true });
  const provider = options.provider || SMALLKHOJ_PI_PROVIDER;
  const apiFormat = options.apiFormat ?? 'anthropic';
  const isAnthropic = apiFormat === 'anthropic';
  const model = options.model || (isAnthropic ? 'MiniMax-M3' : 'MiniMax-M2.1');
  const extensionPath = join(extensionsDir, 'smallkhoj-provider.js');
  const baseUrl = `${options.proxyUrl.replace(/\/$/, '')}/internal/agent/${encodeURIComponent(options.credential.agentId)}/llm/${isAnthropic ? 'anthropic' : 'openai/v1'}`;
  const apiValue = isAnthropic ? 'anthropic-messages' : 'openai-completions';
  writeFileSync(extensionPath, [
    'export default function registerSmallKhojProvider(pi) {',
    `  pi.registerProvider(${JSON.stringify(provider)}, {`,
    `    baseUrl: ${JSON.stringify(baseUrl)},`,
    "    apiKey: process.env.SMALLKHOJ_LLM_PROXY_TOKEN || '',",
    "    headers: { 'X-SmallKhoj-Llm-Run-Id': process.env.SMALLKHOJ_LLM_RUN_ID || '' },",
    `    api: ${JSON.stringify(apiValue)},`,
    '    models: [{',
    `      id: ${JSON.stringify(model)},`,
    `      name: ${JSON.stringify(model)},`,
    "      reasoning: true, input: ['text', 'image'], contextWindow: 200000, maxTokens: 8192,",
    '    }],',
    '  });',
    '}',
    '',
  ].join('\n'), { encoding: 'utf-8', mode: 0o600 });
  return extensionPath;
}

export class PiRuntimeDriver extends EventEmitter implements ManagedRuntimeDriver {
  private readonly options: PiRuntimeOptions;
  private readonly configHome: string;
  private readonly sessionPath: string;
  private readonly extensionPath: string;
  private readonly systemPromptPath: string;
  private readonly pending: PendingPrompt[] = [];
  private child: ChildProcessWithoutNullStreams | null = null;
  private started = false;
  private stopping = false;
  private activeSessionId: string | undefined;
  private activeTurn = false;
  private activeRunId: string | undefined;
  private leaseHeartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: PiRuntimeOptions) {
    super();
    this.options = options;
    this.configHome = join(options.workspacePath, '.smallkhoj', 'pi');
    this.sessionPath = join(this.configHome, 'session.jsonl');
    this.extensionPath = join(this.configHome, 'extensions', 'smallkhoj-provider.js');
    this.systemPromptPath = join(this.configHome, 'smallkhoj-system-prompt.md');
  }

  get pid(): number | undefined { return this.child?.pid; }
  get sessionId(): string | undefined { return this.activeSessionId; }
  get queuedMessageCount(): number { return this.pending.length; }
  get busy(): boolean { return this.activeTurn; }

  discardQueuedChannel(channelId: string): number {
    const before = this.pending.length;
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      const scopeKey = this.pending[index].options?.sessionScopeKey;
      if (scopeKey === `channel:${channelId}` || scopeKey?.startsWith(`thread:${channelId}:`)) {
        this.pending.splice(index, 1);
      }
    }
    return before - this.pending.length;
  }

  start(): void {
    if (this.started) return;
    mkdirSync(this.configHome, { recursive: true });
    writeProviderExtension(this.configHome, this.options);
    writeFileSync(this.systemPromptPath, buildPiSystemPrompt(this.options), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    this.started = true;
    this.stopping = false;
  }

  sendUserMessage(text: string, options?: RuntimeSendOptions): boolean {
    if (!this.started) this.start();
    if (this.activeTurn) {
      this.pending.push({ text, options });
      return false;
    }
    this.activeTurn = true;
    void this.preparePrompt({ text, options });
    return true;
  }

  stop(): void {
    if (!this.started && !this.child) return;
    this.stopping = true;
    this.started = false;
    this.pending.length = 0;
    const child = this.child;
    if (child) {
      signalRuntimeProcessTree(child, 'SIGTERM');
      scheduleRuntimeProcessTreeKill(child);
      return;
    }
    if (this.activeTurn) {
      void this.finishTurn(0, null, true);
    } else {
      this.emit('exit', { code: 0, signal: null, intentional: true, sessionId: this.activeSessionId } satisfies RuntimeExitEvent);
    }
  }

  killUnresponsive(): void {
    if (this.child) signalRuntimeProcessTree(this.child, 'SIGKILL');
  }

  private async preparePrompt(prompt: PendingPrompt): Promise<void> {
    let runId: string | undefined;
    try {
      if (this.options.manageCapacity) {
        runId = `pi-${randomUUID()}`;
        this.activeRunId = runId;
        while (this.started && !this.stopping) {
          const lease = await this.postLease('acquire', { runId });
          if (lease.status === 'active') break;
          if (lease.status !== 'waiting') {
            throw new Error(`Pi capacity lease entered unexpected state ${String(lease.status)}`);
          }
          this.emit('stream_event', {
            type: 'capacity_waiting',
            run_id: runId,
            position: lease.position,
          } satisfies RuntimeStreamEvent);
          await new Promise((resolveWait) => setTimeout(resolveWait, this.options.leasePollMs ?? 1_500));
        }
        if (!this.started || this.stopping) {
          await this.finishTurn(0, null, true);
          return;
        }
        this.emit('stream_event', { type: 'capacity_running', run_id: runId } satisfies RuntimeStreamEvent);
        this.leaseHeartbeatTimer = setInterval(() => {
          void this.postLease('heartbeat', { runId }).catch((error) => {
            this.emit('line', { stream: 'stderr', line: `Pi capacity heartbeat failed: ${(error as Error).message}` } satisfies RuntimeLineEvent);
          });
        }, this.options.leaseHeartbeatMs ?? 30_000);
      }
      this.runPrompt(prompt, runId);
    } catch (error) {
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      await this.finishTurn(1, null, false);
    }
  }

  private runPrompt(prompt: PendingPrompt, runId?: string): void {
    const launch = resolvePiLaunch({
      nodePath: this.options.nodePath,
      piEntry: this.options.piEntry,
      sessionPath: this.sessionPath,
      extensionPath: this.extensionPath,
      systemPromptPath: this.systemPromptPath,
      provider: this.options.provider || SMALLKHOJ_PI_PROVIDER,
      model: this.options.model || (this.options.apiFormat === 'openai' ? 'MiniMax-M2.1' : 'MiniMax-M3'),
    });
    const env = buildPiRuntimeEnv({
      credential: this.options.credential,
      workspacePath: this.options.workspacePath,
      proxyUrl: this.options.proxyUrl,
      proxyToken: this.options.proxyToken,
      wrapperDir: this.options.wrapperDir,
      slockHome: this.options.slockHome,
      launchId: this.options.launchId,
      configHome: this.configHome,
      runId,
    }, this.options.baseEnv);

    const child = spawn(launch.command, launch.args, runtimeProcessSpawnOptions({
      cwd: this.options.workspacePath,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.emit('message_sent', {
      type: 'pi_prompt',
      sessionScopeKey: prompt.options?.sessionScopeKey,
      promptBytes: Buffer.byteLength(prompt.text, 'utf-8'),
    });

    this.consumeLines(child.stdout, 'stdout');
    this.consumeLines(child.stderr, 'stderr');
    child.once('error', (error) => this.emit('error', error));
    child.once('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      void this.finishTurn(code, signal, this.stopping);
    });
    child.stdin.end(prompt.text);
  }

  private async postLease(action: 'acquire' | 'heartbeat' | 'release', body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(
      `/internal/agent/${encodeURIComponent(this.options.credential.agentId)}/llm/runs/${action}`,
      this.options.proxyUrl,
    ), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.proxyToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`Pi capacity ${action} failed with status ${response.status}`);
    }
    return payload;
  }

  private async finishTurn(
    code: number | null,
    signal: NodeJS.Signals | null,
    intentional: boolean,
  ): Promise<void> {
    if (this.leaseHeartbeatTimer) {
      clearInterval(this.leaseHeartbeatTimer);
      this.leaseHeartbeatTimer = null;
    }
    const runId = this.activeRunId;
    this.activeRunId = undefined;
    if (this.options.manageCapacity && runId) {
      await this.postLease('release', {
        runId,
        failed: !intentional && code !== 0,
        ...(code !== 0 ? { failureCode: 'PI_RUNTIME_EXITED' } : {}),
      }).catch((error) => {
        this.emit('line', { stream: 'stderr', line: `Pi capacity release failed: ${(error as Error).message}` } satisfies RuntimeLineEvent);
      });
    }
    this.activeTurn = false;
    if (intentional || code !== 0) {
      this.emit('exit', { code, signal, intentional, sessionId: this.activeSessionId } satisfies RuntimeExitEvent);
      return;
    }
    const next = this.pending.shift();
    if (next) {
      this.activeTurn = true;
      void this.preparePrompt(next);
    }
  }

  private consumeLines(stream: NodeJS.ReadableStream, source: 'stdout' | 'stderr'): void {
    stream.setEncoding('utf-8');
    let buffered = '';
    stream.on('data', (chunk: string) => {
      buffered += chunk;
      let newline = buffered.indexOf('\n');
      while (newline >= 0) {
        const line = buffered.slice(0, newline).trimEnd();
        buffered = buffered.slice(newline + 1);
        if (line) this.handleLine(source, line);
        newline = buffered.indexOf('\n');
      }
    });
    stream.on('end', () => {
      const line = buffered.trimEnd();
      if (line) this.handleLine(source, line);
    });
  }

  private handleLine(source: 'stdout' | 'stderr', line: string): void {
    this.emit('line', { stream: source, line } satisfies RuntimeLineEvent);
    if (source !== 'stdout') return;
    try {
      const event = JSON.parse(line) as RuntimeStreamEvent;
      const sessionId = typeof event.session_id === 'string'
        ? event.session_id
        : typeof event.sessionId === 'string' ? event.sessionId : undefined;
      if (sessionId && sessionId !== this.activeSessionId) {
        this.activeSessionId = sessionId;
        this.emit('session', { sessionId });
      }
      this.emit('stream_event', event);
    } catch {
      // Pi may print a human-readable diagnostic before JSON events. It is
      // already available through the redacted line event and is not fatal.
    }
  }
}
