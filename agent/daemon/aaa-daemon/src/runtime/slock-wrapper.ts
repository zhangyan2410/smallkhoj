import { chmodSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
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

function quotePowerShell(value: string): string {
  return value.replace(/'/g, "''");
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function defaultSlockCliPath(): string {
  return resolve(process.argv[1], '..', '..', 'slock-cli.js');
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
  writeFileSync(tokenFile, options.proxyToken, 'utf-8');

  const commonEnv = {
    SLOCK_AGENT_PROXY_URL: options.proxyUrl,
    SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
    SLOCK_AGENT_ACTIVE_CAPABILITIES: options.activeCapabilities,
    SLOCK_AGENT_ID: options.credential.agentId,
    SLOCK_SERVER_URL: options.credential.serverUrl,
    SLOCK_CURRENT_WORKSPACE_PATH: options.workspacePath,
  };

  const bashWrapper = join(wrapperDir, 'slock');
  writeFileSync(bashWrapper, [
    '#!/usr/bin/env bash',
    `export SLOCK_AGENT_PROXY_URL=${quotePosix(commonEnv.SLOCK_AGENT_PROXY_URL)}`,
    `export SLOCK_AGENT_PROXY_TOKEN_FILE=${quotePosix(commonEnv.SLOCK_AGENT_PROXY_TOKEN_FILE)}`,
    `export SLOCK_AGENT_ACTIVE_CAPABILITIES=${quotePosix(commonEnv.SLOCK_AGENT_ACTIVE_CAPABILITIES)}`,
    `export SLOCK_AGENT_ID=${quotePosix(commonEnv.SLOCK_AGENT_ID)}`,
    `export SLOCK_SERVER_URL=${quotePosix(commonEnv.SLOCK_SERVER_URL)}`,
    `export SLOCK_CURRENT_WORKSPACE_PATH=${quotePosix(commonEnv.SLOCK_CURRENT_WORKSPACE_PATH)}`,
    `exec ${quotePosix(process.execPath)} ${quotePosix(cliPath)} "$@"`,
    '',
  ].join('\n'), 'utf-8');
  chmodSync(bashWrapper, 0o755);

  const cmdWrapper = join(wrapperDir, 'slock.cmd');
  writeFileSync(cmdWrapper, [
    '@echo off',
    `set "SLOCK_AGENT_PROXY_URL=${commonEnv.SLOCK_AGENT_PROXY_URL}"`,
    `set "SLOCK_AGENT_PROXY_TOKEN_FILE=${commonEnv.SLOCK_AGENT_PROXY_TOKEN_FILE}"`,
    `set "SLOCK_AGENT_ACTIVE_CAPABILITIES=${commonEnv.SLOCK_AGENT_ACTIVE_CAPABILITIES}"`,
    `set "SLOCK_AGENT_ID=${commonEnv.SLOCK_AGENT_ID}"`,
    `set "SLOCK_SERVER_URL=${commonEnv.SLOCK_SERVER_URL}"`,
    `set "SLOCK_CURRENT_WORKSPACE_PATH=${commonEnv.SLOCK_CURRENT_WORKSPACE_PATH}"`,
    `"${process.execPath}" "${cliPath}" %*`,
    '',
  ].join('\r\n'), 'utf-8');

  const psWrapper = join(wrapperDir, 'slock.ps1');
  writeFileSync(psWrapper, [
    `$env:SLOCK_AGENT_PROXY_URL='${quotePowerShell(commonEnv.SLOCK_AGENT_PROXY_URL)}'`,
    `$env:SLOCK_AGENT_PROXY_TOKEN_FILE='${quotePowerShell(commonEnv.SLOCK_AGENT_PROXY_TOKEN_FILE)}'`,
    `$env:SLOCK_AGENT_ACTIVE_CAPABILITIES='${quotePowerShell(commonEnv.SLOCK_AGENT_ACTIVE_CAPABILITIES)}'`,
    `$env:SLOCK_AGENT_ID='${quotePowerShell(commonEnv.SLOCK_AGENT_ID)}'`,
    `$env:SLOCK_SERVER_URL='${quotePowerShell(commonEnv.SLOCK_SERVER_URL)}'`,
    `$env:SLOCK_CURRENT_WORKSPACE_PATH='${quotePowerShell(commonEnv.SLOCK_CURRENT_WORKSPACE_PATH)}'`,
    `& '${quotePowerShell(process.execPath)}' '${quotePowerShell(cliPath)}' @args`,
    '',
  ].join('\n'), 'utf-8');

  return { slockHome: wrapperDir, launchId, wrapperDir, tokenFile, bashWrapper, cmdWrapper, psWrapper };
}

export function prependPathEnv(wrapperDir: string, basePath = process.env.PATH ?? ''): string {
  return `${wrapperDir}${process.platform === 'win32' ? ';' : ':'}${basePath}`;
}
