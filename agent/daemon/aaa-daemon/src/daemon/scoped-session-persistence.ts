import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { randomUUID } from 'crypto';
import { dirname } from 'path';

import { daemonPaths } from '../platform/paths.js';
import type { ScopedProviderSessionRecord } from './session-scope.js';

/**
 * G1 (task 08-15): the scope→provider-session mapping outlives the daemon.
 * Without it every daemon/runtime restart re-created a goose/codex session
 * per scope, and each new session's first LLM call paid the full uncached
 * input (measured 1-2% cache hit vs 98-99% within a session).
 *
 * Plain JSON in the daemon root, atomically replaced (temp + rename) like
 * daemon-state.json. Provider session ids are opaque platform ids — no
 * credentials ever live here. A missing or corrupt file degrades to an empty
 * mapping: the daemon then just mints fresh sessions as before.
 */

const SCHEMA_VERSION = 1;

interface ScopedSessionFile {
  schemaVersion: number;
  records: ScopedProviderSessionRecord[];
}

function isRecord(value: unknown): value is ScopedProviderSessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.agentId === 'string'
    && record.agentId.trim().length > 0
    && typeof record.scopeKey === 'string'
    && typeof record.providerSessionId === 'string'
    && record.providerSessionId.trim().length > 0
    && typeof record.scope === 'object' && record.scope !== null
    && typeof (record.scope as Record<string, unknown>).type === 'string'
    && typeof (record.scope as Record<string, unknown>).key === 'string'
    && (record.status === undefined || record.status === 'active' || record.status === 'dead');
}

export function loadScopedSessionRecords(path = daemonPaths().scopedSessionsPath): ScopedProviderSessionRecord[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    if (parsed.schemaVersion !== SCHEMA_VERSION || !Array.isArray(parsed.records)) return [];
    return parsed.records.filter(isRecord);
  } catch {
    return [];
  }
}

export function saveScopedSessionRecords(
  records: ScopedProviderSessionRecord[],
  path = daemonPaths().scopedSessionsPath,
): void {
  const file: ScopedSessionFile = { schemaVersion: SCHEMA_VERSION, records };
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: 0o600,
  });
  try {
    renameSync(temporaryPath, path);
  } catch {
    // Windows can refuse an atomic replace while another process briefly has
    // the destination open; fall back to a direct write of the same content.
    writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, {
      encoding: 'utf-8',
      mode: 0o600,
    });
  }
}
