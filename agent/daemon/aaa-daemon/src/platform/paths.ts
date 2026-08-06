import { homedir } from 'os';
import { join as posixJoin, win32 as winPath } from 'path';

/** Native Windows architecture names supported by the standalone release. */
export type WindowsArchitecture = 'x64' | 'arm64' | 'x86' | 'unknown';

function pathJoin(platformValue: NodeJS.Platform, ...parts: string[]): string {
  if (platformValue !== 'win32') return posixJoin(...parts);

  // Tests and managed callers may deliberately inject a POSIX temporary root
  // while simulating `win32`.  `path.win32.join('/tmp/root', ...)` returns a
  // backslash-prefixed *relative* name on macOS, which can silently create
  // files inside the repository.  Keep POSIX roots POSIX-shaped; real Windows
  // drive/UNC paths still use the native joiner below.
  const hasPosixRoot = parts.some((part) => part === '/' || /^\/(?!\/)/.test(part));
  return (hasPosixRoot ? posixJoin : winPath.join)(...parts);
}

/**
 * Resolve the native Windows architecture without confusing ``win32`` (the
 * Node platform label) with a 32-bit CPU.  PROCESSOR_ARCHITEW6432 is the
 * authoritative signal when a 32-bit process runs on a 64-bit Windows host.
 */
export function detectWindowsArchitecture(
  env: NodeJS.ProcessEnv = process.env,
  nodeArch: string = process.arch,
): WindowsArchitecture {
  const raw = (env.PROCESSOR_ARCHITEW6432 || env.PROCESSOR_ARCHITECTURE || '').trim().toUpperCase();
  if (raw === 'AMD64' || raw === 'X86_64') return 'x64';
  if (raw === 'ARM64' || raw === 'AARCH64') return 'arm64';
  if (raw === 'X86' || raw === 'I386' || raw === 'I686') {
    // A 32-bit process may still be running on a 64-bit host.  The override
    // above wins in that case, so this branch is genuine x86 Windows.
    return 'x86';
  }
  if (nodeArch === 'x64' || nodeArch === 'amd64') return 'x64';
  if (nodeArch === 'arm64' || nodeArch === 'aarch64') return 'arm64';
  if (nodeArch === 'ia32' || nodeArch === 'x86') return 'x86';
  return 'unknown';
}

export function windowsPlatformLabel(
  env: NodeJS.ProcessEnv = process.env,
  nodeArch: string = process.arch,
): string {
  return `win32-${detectWindowsArchitecture(env, nodeArch)}`;
}

/** The user-visible Aura install root. */
export function auraInstallRoot(
  env: NodeJS.ProcessEnv = process.env,
  platformValue: NodeJS.Platform = process.platform,
  home = homedir(),
): string {
  const explicit = env.AURA_INSTALL_ROOT?.trim();
  if (explicit) return explicit;
  if (platformValue === 'win32') {
    const localAppData = env.LOCALAPPDATA?.trim() || pathJoin(platformValue, home, 'AppData', 'Local');
    return pathJoin(platformValue, localAppData, 'Aura');
  }
  return env.SMALLKHOJ_DAEMON_HOME?.trim() || pathJoin(platformValue, home, '.smallkhoj', 'daemon');
}

export interface DaemonPaths {
  installRoot: string;
  daemonRoot: string;
  configPath: string;
  credentialPath: string;
  machineIdPath: string;
  pidPath: string;
  logPath: string;
  workspaceRoot: string;
}

/**
 * Return all user-scoped paths used by Setup/Connect/Status.  Environment
 * overrides are intentionally explicit so tests and managed deployments can
 * isolate state without touching a real user's profile.
 */
export function daemonPaths(
  env: NodeJS.ProcessEnv = process.env,
  platformValue: NodeJS.Platform = process.platform,
  home = homedir(),
): DaemonPaths {
  const installRoot = auraInstallRoot(env, platformValue, home);
  const daemonRoot = platformValue === 'win32' ? pathJoin(platformValue, installRoot, 'daemon') : installRoot;
  const configPath = env.AURA_CONFIG_FILE?.trim() || pathJoin(platformValue, daemonRoot, 'config.json');
  const credentialPath = env.SLOCK_AGENT_CREDENTIAL?.trim() || pathJoin(platformValue, daemonRoot, 'credential.json');
  const machineIdPath =
    env.AAA_DAEMON_MACHINE_ID_FILE?.trim()
    || env.SLOCK_MACHINE_ID_FILE?.trim()
    || (platformValue === 'win32'
      ? pathJoin(platformValue, daemonRoot, 'machine-id')
      : pathJoin(platformValue, home, '.slock', 'aaa-daemon', 'machine-id'));
  const pidPath = env.AURA_PID_FILE?.trim() || pathJoin(platformValue, daemonRoot, 'aura.pid');
  const logPath = env.AURA_LOG_FILE?.trim() || pathJoin(platformValue, daemonRoot, 'aura.log');
  const workspaceRoot =
    env.SMALLKHOJ_DAEMON_WORKSPACE_ROOT?.trim()
    || pathJoin(platformValue, daemonRoot, 'workspaces');
  return {
    installRoot,
    daemonRoot,
    configPath,
    credentialPath,
    machineIdPath,
    pidPath,
    logPath,
    workspaceRoot,
  };
}
