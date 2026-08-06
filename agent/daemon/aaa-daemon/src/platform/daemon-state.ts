import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { dirname } from 'path';

import { daemonPaths } from './paths.js';

export type ManagedDaemonStatus = 'starting' | 'online' | 'offline' | 'error';

/**
 * Non-secret, atomically replaced lifecycle evidence shared by the managed
 * Aura child, `aura status`, and the product-semantic Integration Gate.
 * Credentials never belong in this file.
 */
export interface ManagedDaemonState {
  schemaVersion: 1;
  status: ManagedDaemonStatus;
  pid: number;
  daemonId?: string;
  activeDaemonId?: string;
  serverId?: string;
  computerId?: string;
  machineId?: string;
  daemonVersion?: string;
  lastHeartbeatAt?: string;
  leaseExpiresAt?: string;
  updatedAt: string;
  lastError?: string;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function readManagedDaemonState(path = daemonPaths().statePath): ManagedDaemonState | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const status = stringValue(value.status);
    const pid = numberValue(value.pid);
    if (!pid || !status || !['starting', 'online', 'offline', 'error'].includes(status)) return null;
    return {
      schemaVersion: 1,
      status: status as ManagedDaemonStatus,
      pid,
      daemonId: stringValue(value.daemonId),
      activeDaemonId: stringValue(value.activeDaemonId),
      serverId: stringValue(value.serverId),
      computerId: stringValue(value.computerId),
      machineId: stringValue(value.machineId),
      daemonVersion: stringValue(value.daemonVersion),
      lastHeartbeatAt: stringValue(value.lastHeartbeatAt),
      leaseExpiresAt: stringValue(value.leaseExpiresAt),
      updatedAt: stringValue(value.updatedAt) ?? '',
      lastError: stringValue(value.lastError),
    };
  } catch {
    return null;
  }
}

export function writeManagedDaemonState(
  value: Omit<ManagedDaemonState, 'schemaVersion' | 'updatedAt'> & Partial<Pick<ManagedDaemonState, 'updatedAt'>>,
  path = daemonPaths().statePath,
): ManagedDaemonState {
  const state: ManagedDaemonState = {
    ...value,
    schemaVersion: 1,
    updatedAt: value.updatedAt ?? new Date().toISOString(),
  };
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    renameSync(temporaryPath, path);
  } catch {
    // Windows can refuse an atomic replace while another process briefly has
    // the destination open. The complete temporary write remains the source.
    writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
    try { unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
  }
  return state;
}

export function clearManagedDaemonState(path = daemonPaths().statePath): void {
  try { unlinkSync(path); } catch { /* absent/stale state is already clear */ }
}

export function redactManagedDaemonError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value ?? 'Unknown daemon error');
  return message
    .replace(/\bsk_(?:public|account|machine|connect|agent)_[A-Za-z0-9._-]+\b/g, '[REDACTED]')
    .slice(0, 500);
}
