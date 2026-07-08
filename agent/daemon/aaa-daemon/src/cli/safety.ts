/**
 * Write-safety gate for CLI commands.
 *
 * Write permission must come from the daemon/operator via environment
 * variables or launch config. The CLI itself does NOT expose any flag
 * to self-enable writes.
 */

export interface WriteScope {
  /** Resource identifiers this command writes to (e.g. "#general", "dm:@user"). */
  resources: string[];
}

export function writeScope(...resources: Array<string | undefined>): WriteScope {
  return { resources: resources.filter((r): r is string => !!r) };
}

/**
 * Assert that writes are allowed in the current environment.
 * Throws an Error with `code` and `nextAction` properties if not allowed.
 */
export function assertWriteAllowed(scope: WriteScope | undefined, env: NodeJS.ProcessEnv): void {
  if (!scope) return;

  const allowWrites = env.SLOCK_ALLOW_WRITES === '1' || env.AAA_DAEMON_ALLOW_WRITES === '1';
  if (!allowWrites) {
    const err = new Error('Write-capable slock commands require SLOCK_ALLOW_WRITES=1');
    Object.assign(err, {
      code: 'WRITES_NOT_ALLOWED',
      nextAction: 'This permission must be granted by the daemon or operator via environment variable or launch config.',
    });
    throw err;
  }

  const allowlist = env.SLOCK_WRITE_TARGET_ALLOWLIST ?? env.AAA_DAEMON_WRITE_TARGET_ALLOWLIST;
  if (!allowlist) return;

  const allowed = allowlist.split(',').map((item) => item.trim()).filter(Boolean);
  if (allowed.length === 0) return;

  const denied = scope.resources.filter(
    (resource) => !allowed.some((entry) => resource === entry || resource.startsWith(entry)),
  );
  if (denied.length > 0) {
    const err = new Error(`Write target is not allowlisted: ${denied.join(', ')}`);
    Object.assign(err, {
      code: 'WRITE_TARGET_NOT_ALLOWED',
      nextAction: 'Add the target to SLOCK_WRITE_TARGET_ALLOWLIST or contact the operator.',
    });
    throw err;
  }
}
