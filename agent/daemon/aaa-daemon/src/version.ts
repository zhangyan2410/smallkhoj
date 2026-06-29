import { readFileSync } from 'fs';

export function readDaemonPackageVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as { version?: unknown };
    if (typeof packageJson.version === 'string' && packageJson.version.trim()) {
      return packageJson.version.trim();
    }
  } catch {
    // Keep CLI startup usable even if package metadata is unavailable.
  }
  return '0.0.0-dev';
}

export const DAEMON_VERSION = readDaemonPackageVersion();
