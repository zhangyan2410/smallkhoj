import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';

import { daemonPaths } from './paths.js';

export interface ReleasePointer {
  version: string;
  platform: string;
  path: string;
  artifactSha256?: string;
}

const RELEASE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$/;

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function isReleaseVersion(value: string): boolean {
  return RELEASE_VERSION_RE.test(value.trim().replace(/^v/, ''));
}

export function compareReleaseVersions(left: string, right: string): number {
  const parse = (value: string): [number, number, number, string] => {
    const normalized = value.trim().replace(/^v/, '');
    const match = normalized.match(RELEASE_VERSION_RE);
    if (!match) throw new Error(`Invalid Aura release version: ${value}`);
    return [Number(match[1]), Number(match[2]), Number(match[3]), normalized];
  };
  const a = parse(left);
  const b = parse(right);
  const numericA = a.slice(0, 3) as [number, number, number];
  const numericB = b.slice(0, 3) as [number, number, number];
  for (let i = 0; i < numericA.length; i += 1) {
    if (numericA[i] !== numericB[i]) return numericA[i] > numericB[i] ? 1 : -1;
  }
  // Stable releases sort before a pre-release with the same numeric core.
  const aPre = a[3].includes('-') || a[3].includes('+');
  const bPre = b[3].includes('-') || b[3].includes('+');
  if (aPre !== bPre) return aPre ? -1 : 1;
  return 0;
}

function pointerPath(installRoot: string): string {
  return join(installRoot, 'active.json');
}

function previousPointerPath(installRoot: string): string {
  return join(installRoot, 'previous.json');
}

function safeReleasePath(installRoot: string, candidate: string): string | undefined {
  const root = resolve(installRoot);
  const path = resolve(candidate);
  const rel = relative(root, path);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return undefined;
  return path;
}

function readPointerFile(path: string, installRoot: string): ReleasePointer | null {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    const version = stringValue(value.version);
    const platform = stringValue(value.platform);
    const rawPath = stringValue(value.path);
    if (!version || !platform || !rawPath || !isReleaseVersion(version)) return null;
    const releasePath = safeReleasePath(installRoot, rawPath);
    if (!releasePath) return null;
    const artifactSha256 = stringValue(value.artifactSha256);
    return { version, platform, path: releasePath, ...(artifactSha256 ? { artifactSha256 } : {}) };
  } catch {
    return null;
  }
}

export function readReleasePointer(
  installRoot = daemonPaths().installRoot,
  kind: 'active' | 'previous' = 'active',
): ReleasePointer | null {
  return readPointerFile(
    kind === 'active' ? pointerPath(installRoot) : previousPointerPath(installRoot),
    installRoot,
  );
}

function writePointerFile(path: string, pointer: ReleasePointer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(pointer, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
  try {
    renameSync(temporary, path);
  } catch {
    writeFileSync(path, `${JSON.stringify(pointer, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
    try { unlinkSync(temporary); } catch { /* best effort cleanup */ }
  }
}

export function writeReleasePointer(
  installRoot: string,
  pointer: ReleasePointer,
  { preserveActive = true }: { preserveActive?: boolean } = {},
): void {
  if (!safeReleasePath(installRoot, pointer.path)) throw new Error('Aura release path must stay inside the install root');
  const current = readReleasePointer(installRoot);
  if (preserveActive && current) writePointerFile(previousPointerPath(installRoot), current);
  writePointerFile(pointerPath(installRoot), pointer);
}

function platformReleaseDirectory(installRoot: string, version: string, platform: string): string {
  return join(installRoot, 'versions', `v${version}-${platform}`);
}

function releaseIsComplete(path: string, platform: string): boolean {
  if (!existsSync(path) || !existsSync(join(path, 'manifest.json')) || !existsSync(join(path, 'dist', 'cmd', 'main.js'))) return false;
  const executable = platform.startsWith('win32-') ? 'aura.exe' : 'aura';
  if (!existsSync(join(path, executable))) return false;
  if (platform.startsWith('win32-') && !existsSync(join(path, 'node.exe'))) return false;
  return true;
}

export function rollbackRelease({
  installRoot = daemonPaths().installRoot,
  version,
  platform,
}: {
  installRoot?: string;
  version: string;
  platform?: string;
}): { previous: ReleasePointer; active: ReleasePointer } {
  if (!isReleaseVersion(version)) throw new Error(`Invalid Aura release version: ${version}`);
  const current = readReleasePointer(installRoot);
  if (!current) throw new Error('Aura has no active release pointer; run the installer first.');
  const targetPlatform = platform || current.platform;
  const targetPath = platformReleaseDirectory(installRoot, version, targetPlatform);
  if (!releaseIsComplete(targetPath, targetPlatform)) {
    throw new Error(`Aura release ${version} (${targetPlatform}) is not installed or is incomplete.`);
  }
  if (compareReleaseVersions(current.version, version) === 0 && resolve(current.path) === resolve(targetPath)) {
    return { previous: current, active: current };
  }
  const active: ReleasePointer = {
    version,
    platform: targetPlatform,
    path: targetPath,
  };
  writeReleasePointer(installRoot, active);
  return { previous: current, active };
}
