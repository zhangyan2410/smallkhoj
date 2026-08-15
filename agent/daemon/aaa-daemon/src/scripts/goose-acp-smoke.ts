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
}

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

  const bridge = new CodexAcpBridge({
    command,
    args: ['acp', '--with-builtin', 'developer,summon'],
    cwd: workspace,
    env,
    sessionIdCodec: codec,
    clientCapabilitiesMeta: { goose: { customNotifications: true } },
    onNotification: (method, params) => {
      if (method === '_goose/unstable/session/update') sawUsageNotification = true;
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
    const result = await bridge.prompt(sessionId, args.prompt);
    log({ type: 'result', sessionId, stopReason: result.stopReason, eventCount: events.length });
    // Verify codec.decode round-trips back to the native id for loadSession.
    const restored = await bridge.loadSession(sessionId);
    log({ type: 'load_session', sessionId, restoredEqual: restored === sessionId });
    log({ type: 'summary', sawUsageNotification, eventCount: events.length });
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
