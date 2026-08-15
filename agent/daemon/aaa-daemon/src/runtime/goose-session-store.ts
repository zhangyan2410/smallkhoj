import { existsSync, mkdirSync, symlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { SessionIdCodec } from './codex-acp-bridge.js';

// goose keeps every session in one shared SQLite catalog. On a host that runs
// several workspaces (or resumes one across restarts) that single writer
// serializes turns and concurrent writers are unsafe. Each platform session
// therefore gets its own GOOSE_PATH_ROOT with a private tiny sessions.db:
// single-writer by construction, collision-free across workspaces.
//
// Unlike NAP we do not pre-generate platform UUIDs or keep a meta.json mapping
// table. The directory name IS the agent id, and the session id codec below
// namespaces goose's native ids by the same agent id, so the mapping is
// implicit and needs no boot GC of orphan directories.

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.USERPROFILE?.trim() || env.HOME?.trim() || homedir();
}

export function gooseSessionsBase(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDir(env), '.goose-sessions');
}

/**
 * Per-session data root passed to goose as `GOOSE_PATH_ROOT`. The agent id is
 * the stable identity a runtime driver is bound to (one bridge : one session :
 * one data dir), so it is a safe directory key after SAFE_ID validation.
 */
export function gooseSessionDataDir(agentId: string, env: NodeJS.ProcessEnv = process.env): string {
  if (!SAFE_ID.test(agentId)) {
    throw new Error(`Refusing unsafe agent id as goose session path component: ${agentId}`);
  }
  return join(gooseSessionsBase(env), agentId);
}

/**
 * Idempotently prepares a per-session goose data root: creates the directory
 * and symlinks `config` (shared config.yaml / AGENTS.md) and `.agents` (shared
 * skills) back to the user's home copies. `data/` and `state/` are left for
 * goose to create itself.
 */
export function prepareGooseSessionDir(agentId: string, env: NodeJS.ProcessEnv = process.env): string {
  const dir = gooseSessionDataDir(agentId, env);
  mkdirSync(dir, { recursive: true });
  const home = homeDir(env);
  ensureSharedLink(join(home, '.config', 'goose'), join(dir, 'config'));
  ensureSharedLink(join(home, '.agents'), join(dir, '.agents'));
  return dir;
}

function ensureSharedLink(target: string, link: string): void {
  mkdirSync(target, { recursive: true });
  if (existsSync(link)) return;
  try {
    // 'junction' is a no-op type on POSIX and avoids the admin privilege
    // requirement for directory symlinks on Windows.
    symlinkSync(target, link, 'junction');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EEXIST: a concurrent prepare raced us. EPERM/EINVAL: Windows without
    // symlink/junction rights — goose then self-creates a fresh (degraded)
    // config dir inside the root instead of sharing the user's config. Neither
    // is fatal to starting goose.
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EINVAL') throw error;
  }
}

/**
 * Session id codec that namespaces goose's native ids by the agent id.
 *
 * goose's native session ids are date-ordinal (`20260806_1`); two workspaces
 * that each open their first session on the same day collide. Prefixing with
 * the agent id makes every platform id globally unique while staying fully
 * reversible for the calls that must hand the native id back to goose
 * (loadSession/prompt/cancel).
 *
 * decode is a passthrough for ids that do not carry our prefix, so cross-core
 * ids (e.g. a resumed session id that predates this codec) reach goose
 * verbatim and goose reports its own not-found error, which the caller surfaces.
 */
export function agentNamespacedCodec(agentId: string): SessionIdCodec {
  const prefix = `${agentId}-`;
  return {
    encode: (nativeId) => (nativeId.startsWith(prefix) ? nativeId : `${prefix}${nativeId}`),
    decode: (platformId) => (platformId.startsWith(prefix) ? platformId.slice(prefix.length) : platformId),
  };
}
