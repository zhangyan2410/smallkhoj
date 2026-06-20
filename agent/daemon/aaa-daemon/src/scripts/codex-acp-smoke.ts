#!/usr/bin/env node
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { CodexAcpBridge, buildCodexAcpCommand, translateAcpUpdate } from '../runtime/codex-acp-bridge.js';

interface Args {
  command?: string;
  npmPackage?: string;
  cwd?: string;
  prompt: string;
  keepWorkspace: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    prompt: 'Reply with exactly: codex-acp-smoke-ok',
    keepWorkspace: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    const next = argv[i + 1];
    if (item === '--command' && next) {
      args.command = next;
      i++;
    } else if (item === '--npm-package' && next) {
      args.npmPackage = next;
      i++;
    } else if (item === '--cwd' && next) {
      args.cwd = next;
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
  node dist/scripts/codex-acp-smoke.js [options]

Options:
  --command <cmd>        ACP binary to run, default codex-acp
  --npm-package <pkg>    Run via npx -y <pkg>, e.g. @zed-industries/codex-acp@0.16.0
  --cwd <dir>            Workspace directory, default temporary directory
  --prompt <text>        Prompt to send to the ACP session
  --keep-workspace       Keep the temporary workspace after exit
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const workspace = args.cwd ? resolve(args.cwd) : mkdtempSync(`${tmpdir()}/aaa-codex-acp-smoke-`);
  const command = buildCodexAcpCommand({ command: args.command, npmPackage: args.npmPackage });
  const events: unknown[] = [];
  const bridge = new CodexAcpBridge({
    command: command.command,
    args: command.args,
    cwd: workspace,
    onUpdate: (update) => {
      const translated = translateAcpUpdate(update);
      events.push(translated);
      console.log(JSON.stringify({ type: 'update', translated }));
    },
    onLine: (line) => {
      console.error(JSON.stringify({ type: 'process_line', ...line }));
    },
  });

  try {
    console.log(JSON.stringify({ type: 'start', command, workspace }));
    await bridge.start();
    console.log(JSON.stringify({ type: 'started', pid: bridge.pid }));
    const sessionId = await bridge.createSession();
    console.log(JSON.stringify({ type: 'session', sessionId }));
    const result = await bridge.prompt(sessionId, args.prompt);
    console.log(JSON.stringify({ type: 'result', sessionId, result, eventCount: events.length }));
  } finally {
    await bridge.stop();
    if (!args.cwd && !args.keepWorkspace) {
      rmSync(workspace, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
});
