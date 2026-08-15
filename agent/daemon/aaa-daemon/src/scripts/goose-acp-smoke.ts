#!/usr/bin/env node
// R1.1 前置 gate: verify the ACP 0.28 bridge + real goose binary combination.
// Exercises the goose-specific knobs added to the shared bridge — codec encode
// on createSession, the _goose/unstable/session/update notification stream
// (unlocked by clientCapabilitiesMeta), codec decode on loadSession — against a
// real `goose acp` process. Requires goose on PATH (`brew install goose`) plus
// a configured provider (`goose configure`).
import { mkdtempSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { CodexAcpBridge } from '../runtime/codex-acp-bridge.js';
import { translateAcpSessionUpdate } from '../runtime/acp-event-translator.js';
import { agentNamespacedCodec, prepareGooseSessionDir } from '../runtime/goose-session-store.js';
import { applyGooseProviderEnv } from '../runtime/goose-provider-env.js';

interface Args {
  command?: string;
  cwd?: string;
  agentId: string;
  prompt: string;
  keepWorkspace: boolean;
  /** After N ACP events, cancel the prompt; expect stopReason 'cancelled'. */
  cancelAfterEvents?: number;
}

/** goose's fixed wrapper phrasing when it streams an agent-side error turn. */
const ERROR_TURN_TEXT = /ran into this error/i;

function parseArgs(argv: string[]): Args {
  const args: Args = {
    agentId: 'goose-smoke',
    prompt: 'Reply with exactly: goose-acp-smoke-ok',
    keepWorkspace: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    const next = argv[i + 1];
    if (item === '--command' && next) {
      args.command = next;
      i++;
    } else if (item === '--cwd' && next) {
      args.cwd = next;
      i++;
    } else if (item === '--agent-id' && next) {
      args.agentId = next;
      i++;
    } else if (item === '--prompt' && next) {
      args.prompt = next;
      i++;
    } else if (item === '--keep-workspace') {
      args.keepWorkspace = true;
    } else if (item === '--cancel-after-events' && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed) && parsed > 0) args.cancelAfterEvents = parsed;
      i++;
    } else if (item === '--help' || item === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${item}`);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`Usage:
  node dist/scripts/goose-acp-smoke.js [options]

Options:
  --command <cmd>     goose binary to run, default 'goose'
  --cwd <dir>         Workspace directory, default temporary directory
  --agent-id <id>     Agent id used to namespace session ids and the data dir
  --prompt <text>     Prompt to send to the goose session
  --keep-workspace    Keep the temporary workspace after exit
  --cancel-after-events <n>
                      Cancel the prompt after n ACP events; verifies the
                      agent honors session/cancel with stopReason 'cancelled'
`);
}

function log(value: unknown): void {
  console.log(JSON.stringify(value));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workspace = args.cwd ? resolve(args.cwd) : mkdtempSync(`${tmpdir()}/aaa-goose-acp-smoke-`);
  const command = args.command?.trim() || 'goose';
  if (!commandExists(command)) {
    throw new Error(`goose binary not found on PATH: ${command}. Install goose (\`brew install goose\`) and configure a provider (\`goose configure\`) first.`);
  }
  // Per-session GOOSE_PATH_ROOT so the smoke does not touch the user's catalog.
  const dataDir = prepareGooseSessionDir(args.agentId);
  const env = applyGooseProviderEnv();
  env.GOOSE_PATH_ROOT = dataDir;

  const codec = agentNamespacedCodec(args.agentId);
  const events: unknown[] = [];
  let sawUsageNotification = false;
  // Error turns (401/empty reply) surface usage counters stuck at zero — the
  // only truthful "the model actually answered" signal is positive usage.
  let maxUsageTokens = 0;

  const bridge = new CodexAcpBridge({
    command,
    args: ['acp', '--with-builtin', 'developer,summon'],
    cwd: workspace,
    env,
    sessionIdCodec: codec,
    clientCapabilitiesMeta: { goose: { customNotifications: true } },
    onNotification: (method, params) => {
      if (method === '_goose/unstable/session/update') {
        sawUsageNotification = true;
        const usage = (params as { update?: { usage?: Record<string, unknown>; accumulatedInputTokens?: number } }).update?.usage;
        if (usage) {
          maxUsageTokens = Math.max(
            maxUsageTokens,
            Number(usage.inputTokens ?? 0) || 0,
            Number(usage.cacheReadTokens ?? 0) || 0,
          );
        }
        const update = (params as { update?: { accumulatedInputTokens?: number } }).update;
        if (update?.accumulatedInputTokens) {
          maxUsageTokens = Math.max(maxUsageTokens, update.accumulatedInputTokens);
        }
      }
      log({ type: 'notification', method, params });
    },
    onUpdate: (update) => {
      for (const event of translateAcpSessionUpdate(update, '')) {
        events.push(event);
        log({ type: 'event', event });
      }
    },
    onLine: (line) => {
      console.error(JSON.stringify({ type: 'process_line', ...line }));
    },
  });

  try {
    log({ type: 'start', command, workspace, dataDir });
    await bridge.start();
    log({ type: 'started', pid: bridge.pid });
    const sessionId = await bridge.createSession();
    const encodedOk = sessionId.startsWith(`${args.agentId}-`);
    log({ type: 'session', sessionId, codecEncodeOk: encodedOk });
    if (!encodedOk) throw new Error(`codec.encode did not namespace the session id: ${sessionId}`);
    let result: Awaited<ReturnType<typeof bridge.prompt>>;
    if (args.cancelAfterEvents) {
      const cancelTimer = setInterval(() => {
        if (events.length >= args.cancelAfterEvents!) {
          clearInterval(cancelTimer);
          log({ type: 'cancelling', sessionId, eventsSeen: events.length });
          void bridge.cancel(sessionId).catch((err) => log({ type: 'cancel_error', message: String(err) }));
        }
      }, 100);
      try {
        result = await bridge.prompt(sessionId, `${args.prompt} Take your time and be thorough.`);
      } finally {
        clearInterval(cancelTimer);
      }
      log({ type: 'result', sessionId, stopReason: result.stopReason, eventCount: events.length });
      log({ type: 'cancel_check', stopReason: result.stopReason, ok: result.stopReason === 'cancelled' });
      if (result.stopReason !== 'cancelled') {
        throw new Error(`agent did not honor session/cancel: stopReason=${result.stopReason}`);
      }
    } else {
      result = await bridge.prompt(sessionId, args.prompt);
      log({ type: 'result', sessionId, stopReason: result.stopReason, eventCount: events.length });
    }
    // R1.1 (task 08-15): an error turn must NOT pass. goose 1.46 streams the
    // error itself as an item_delta ("Ran into this error: ..."), so counting
    // deltas alone is not enough: PASS additionally requires that no streamed
    // text is goose's error wrapper and that the usage counters actually moved
    // (error turns report zero usage).
    const streamingDeltas = events.filter(event =>
      typeof event === 'object' && event !== null && (event as { type?: string }).type === 'item_delta');
    const errorDeltas = streamingDeltas.filter(event =>
      /ran into this error/i.test(String((event as { delta?: { text?: string } }).delta?.text ?? '')));
    log({ type: 'summary', sawUsageNotification, eventCount: events.length, streamingDeltas: streamingDeltas.length, maxUsageTokens });
    if (errorDeltas.length > 0) {
      throw new Error(
        `smoke streamed a goose error turn (eventCount=${events.length}, stopReason=${result.stopReason}) — check the provider key and goose logs before trusting this run`,
      );
    }
    if (streamingDeltas.length === 0 || maxUsageTokens === 0) {
      throw new Error(
        `smoke saw no real model output (eventCount=${events.length}, streamingDeltas=${streamingDeltas.length}, maxUsageTokens=${maxUsageTokens}, stopReason=${result.stopReason}) — this is the error-turn signature; check the provider key and goose logs before trusting this run`,
      );
    }
    // Verify codec.decode round-trips back to the native id for loadSession.
    const restored = await bridge.loadSession(sessionId);
    log({ type: 'load_session', sessionId, restoredEqual: restored === sessionId });
  } finally {
    await bridge.stop();
    if (!args.cwd && !args.keepWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--version'], { encoding: 'utf-8', env: process.env });
  return result.status === 0;
}

main().catch((err) => {
  console.error(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
