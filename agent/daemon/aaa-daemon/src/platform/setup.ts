import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { daemonPaths, type DaemonPaths } from './paths.js';

export type DaemonSetupMode = 'managed' | 'legacy';

export interface DaemonSetupConfig {
  name: string;
  serverUrl: string;
  mode: DaemonSetupMode;
  machineId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SetupResult {
  config: DaemonSetupConfig;
  paths: DaemonPaths;
  created: boolean;
  reset: boolean;
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  // mode 0600 is honored on Unix. Windows ACLs are applied by the installer
  // and the real-host acceptance step; never print credential contents here.
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  renameSync(temporaryPath, path);
}

function atomicWriteText(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporaryPath, value, { encoding: 'utf-8', mode: 0o600 });
  renameSync(temporaryPath, path);
}

function readJson(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function normalizeMode(value: string | undefined): DaemonSetupMode {
  return value === 'legacy' ? 'legacy' : 'managed';
}

/**
 * Idempotent local Setup. It never contacts the server and never writes a
 * machine token. Re-running without ``reset`` preserves the identity and
 * Computer name, which makes reconnect and version upgrades safe.
 */
export function runSetup(options: {
  name: string;
  serverUrl: string;
  mode?: string;
  reset?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}): SetupResult {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const paths = daemonPaths(env, platform, options.home);
  const requestedName = options.name.trim();
  if (!requestedName) throw new Error('Computer name is required');
  if (requestedName.length > 255) throw new Error('Computer name must be 255 characters or fewer');
  const requestedServerUrl = options.serverUrl.trim();
  if (!requestedServerUrl) throw new Error('Server URL is required');

  const current = readJson(paths.configPath);
  const oldMachineId = typeof current?.machineId === 'string' ? current.machineId.trim() : '';
  const machineId = !options.reset && oldMachineId ? oldMachineId : randomUUID();
  const now = new Date().toISOString();
  const config: DaemonSetupConfig = {
    // Setup is idempotent for identity, while an explicit new name/server URL
    // is allowed to update local presentation/configuration without rotating
    // the machine ID.
    name: requestedName,
    serverUrl: requestedServerUrl,
    mode: normalizeMode(options.mode || (typeof current?.mode === 'string' ? current.mode : undefined)),
    machineId,
    createdAt: typeof current?.createdAt === 'string' ? current.createdAt : now,
    updatedAt: now,
  };

  atomicWriteJson(paths.configPath, config);
  atomicWriteText(paths.machineIdPath, `${machineId}\n`);
  return {
    config,
    paths,
    created: !current,
    reset: Boolean(options.reset),
  };
}

export function readSetup(paths = daemonPaths()): DaemonSetupConfig | null {
  const value = readJson(paths.configPath);
  if (!value) return null;
  if (typeof value.name !== 'string' || typeof value.serverUrl !== 'string' || typeof value.machineId !== 'string') {
    return null;
  }
  return {
    name: value.name,
    serverUrl: value.serverUrl,
    mode: normalizeMode(typeof value.mode === 'string' ? value.mode : undefined),
    machineId: value.machineId,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : '',
  };
}
