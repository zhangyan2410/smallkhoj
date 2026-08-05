import { chmodSync, existsSync, mkdirSync, realpathSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import type { Credential } from '../types.js';

export interface SlockWrapperOptions {
  workspacePath: string;
  proxyUrl: string;
  proxyToken: string;
  credential: Credential;
  activeCapabilities: string;
  cliPath?: string;
  tokenHome?: string;
  launchId?: string;
  allowWrites?: boolean;
  writeTargetAllowlist?: string;
}

export interface SlockWrapperResult {
  slockHome: string;
  launchId: string;
  wrapperDir: string;
  tokenFile: string;
  bashWrapper: string;
  cmdWrapper: string;
  psWrapper: string;
}

const DEFAULT_MEMORY_MD = [
  '# Runtime Memory',
  '',
  '## Role',
  'New daemon-managed Slock/Raft runtime workspace.',
  '',
  '## Key Knowledge',
  '- No long-lived memory has been recorded yet.',
  '- Use `aura` from PATH for server info, message, task, channel, attachment, and profile operations. The daemon-managed `.slock/` directory is an implementation detail; do not call its absolute wrapper paths.',
  '',
  '## Active Context',
  '- First startup. Follow the current Slock event or warmup instruction.',
  '',
].join('\n');

function quotePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function defaultSlockCliPath(): string {
  if (process.argv[1]) {
    try {
      const entrypoint = realpathSync(process.argv[1]);
      const candidate = resolve(entrypoint, '..', '..', 'slock-cli.js');
      if (existsSync(candidate)) return candidate;
    } catch {
      // Fall through to the module-relative path for cases like `node -`.
    }
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'slock-cli.js');
}

export function writeSlockWrapper(options: SlockWrapperOptions): SlockWrapperResult {
  const wrapperDir = join(options.workspacePath, '.slock');
  const launchId = options.launchId ?? `pid-${process.pid}`;
  const tokenRoot = options.tokenHome ?? join(homedir(), '.slock', 'agent-proxy-tokens');
  const tokenDir = join(tokenRoot, options.credential.agentId);
  const tokenFile = join(tokenDir, `${launchId}.token`);
  const cliPath = options.cliPath ?? defaultSlockCliPath();

  mkdirSync(wrapperDir, { recursive: true });
  mkdirSync(tokenDir, { recursive: true });
  seedMemoryFile(options.workspacePath);
  writeFileSync(tokenFile, options.proxyToken, 'utf-8');

  const writeTargetAllowlist = options.writeTargetAllowlist?.trim();
  const writeGateEnv = {
    ...(options.allowWrites ? {
      SLOCK_ALLOW_WRITES: '1',
      AAA_DAEMON_ALLOW_WRITES: '1',
    } : {}),
    ...(writeTargetAllowlist ? {
      SLOCK_WRITE_TARGET_ALLOWLIST: writeTargetAllowlist,
      AAA_DAEMON_WRITE_TARGET_ALLOWLIST: writeTargetAllowlist,
    } : {}),
  };

  const commonEnv = {
    SLOCK_AGENT_PROXY_URL: options.proxyUrl,
    SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
    SLOCK_AGENT_ACTIVE_CAPABILITIES: options.activeCapabilities,
    SLOCK_AGENT_ID: options.credential.agentId,
    SLOCK_SERVER_URL: options.credential.serverUrl,
    SLOCK_CURRENT_WORKSPACE_PATH: options.workspacePath,
    ...writeGateEnv,
  };

  const bashWrapper = join(wrapperDir, 'slock');
  const bashEnvLines = Object.entries(commonEnv).map(([name, value]) => (
    `${name}=${quotePosix(value)} \\`
  ));
  const bashWrapperContent = [
    '#!/usr/bin/env bash',
    ...bashEnvLines,
    `exec ${quotePosix(process.execPath)} ${quotePosix(cliPath)} "$@"`,
    '',
  ].join('\n');
  writeFileSync(bashWrapper, bashWrapperContent, 'utf-8');
  chmodSync(bashWrapper, 0o755);
  const raftBashWrapper = join(wrapperDir, 'raft');
  writeFileSync(raftBashWrapper, bashWrapperContent, 'utf-8');
  chmodSync(raftBashWrapper, 0o755);
  const auraBashWrapper = join(wrapperDir, 'aura');
  writeFileSync(auraBashWrapper, bashWrapperContent, 'utf-8');
  chmodSync(auraBashWrapper, 0o755);

  const cmdWrapper = join(wrapperDir, 'slock.cmd');
  const cmdEnvLines = Object.entries(commonEnv).map(([name, value]) => (
    `set "${name}=${value}"`
  ));
  const cmdWrapperContent = [
    '@echo off',
    ...cmdEnvLines,
    `"${process.execPath}" "${cliPath}" %*`,
    '',
  ].join('\r\n');
  writeFileSync(cmdWrapper, cmdWrapperContent, 'utf-8');
  writeFileSync(join(wrapperDir, 'raft.cmd'), cmdWrapperContent, 'utf-8');
  writeFileSync(join(wrapperDir, 'aura.cmd'), cmdWrapperContent, 'utf-8');

  const psWrapper = join(wrapperDir, 'slock.ps1');
  const psEnvLines = Object.entries(commonEnv).map(([name, value]) => (
    `$env:${name}='${quotePowerShell(value)}'`
  ));
  const psWrapperContent = [
    ...psEnvLines,
    `& '${quotePowerShell(process.execPath)}' '${quotePowerShell(cliPath)}' @args`,
    '',
  ].join('\n');
  writeFileSync(psWrapper, psWrapperContent, 'utf-8');
  writeFileSync(join(wrapperDir, 'raft.ps1'), psWrapperContent, 'utf-8');
  writeFileSync(join(wrapperDir, 'aura.ps1'), psWrapperContent, 'utf-8');

  return { slockHome: wrapperDir, launchId, wrapperDir, tokenFile, bashWrapper, cmdWrapper, psWrapper };
}

export function seedMemoryFile(workspacePath: string): string {
  mkdirSync(workspacePath, { recursive: true });
  const memoryPath = join(workspacePath, 'MEMORY.md');
  if (!existsSync(memoryPath)) {
    writeFileSync(memoryPath, DEFAULT_MEMORY_MD, 'utf-8');
  }
  return memoryPath;
}

export function prependPathEnv(wrapperDir: string, basePath = process.env.PATH ?? ''): string {
  return `${wrapperDir}${process.platform === 'win32' ? ';' : ':'}${basePath}`;
}
