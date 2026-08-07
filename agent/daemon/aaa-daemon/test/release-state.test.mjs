import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../dist/cmd/main.js', import.meta.url));

function release(root, version) {
  const path = join(root, 'versions', `v${version}-darwin-arm64`);
  mkdirSync(join(path, 'dist', 'cmd'), { recursive: true });
  writeFileSync(join(path, 'manifest.json'), JSON.stringify({ version, platform: 'darwin-arm64' }));
  writeFileSync(join(path, 'dist', 'cmd', 'main.js'), '');
  const launcher = join(path, 'aura');
  writeFileSync(launcher, '#!/bin/sh\n');
  chmodSync(launcher, 0o755);
  return path;
}

function writePointer(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

test('rollback switches an installed release and preserves setup credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-rollback-'));
  try {
    const oldPath = release(root, '0.2.5');
    const currentPath = release(root, '0.2.6');
    writePointer(join(root, 'active.json'), {
      version: '0.2.6',
      platform: 'darwin-arm64',
      path: currentPath,
    });
    const daemonRoot = join(root, 'daemon');
    mkdirSync(daemonRoot, { recursive: true });
    const credential = JSON.stringify({ token: 'sk_machine_test', machine_id: 'machine-test' });
    writeFileSync(join(daemonRoot, 'credential.json'), credential);

    const result = spawnSync(process.execPath, [cliPath, 'rollback', '--target-version', '0.2.5'], {
      env: { ...process.env, AURA_INSTALL_ROOT: root },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const active = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8'));
    const previous = JSON.parse(readFileSync(join(root, 'previous.json'), 'utf8'));
    assert.equal(active.version, '0.2.5');
    assert.equal(active.path, oldPath);
    assert.equal(previous.version, '0.2.6');
    assert.equal(readFileSync(join(daemonRoot, 'credential.json'), 'utf8'), credential);
    assert.equal(existsSync(currentPath), true);
    assert.match(result.stdout, /Rolled back Aura from 0\.2\.6 to 0\.2\.5/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rollback refuses an incomplete or missing release', () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-rollback-missing-'));
  try {
    const currentPath = release(root, '0.2.6');
    writePointer(join(root, 'active.json'), {
      version: '0.2.6',
      platform: 'darwin-arm64',
      path: currentPath,
    });
    const result = spawnSync(process.execPath, [cliPath, 'rollback', '--target-version', '0.2.4'], {
      env: { ...process.env, AURA_INSTALL_ROOT: root },
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /not installed or is incomplete/i);
    assert.equal(JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')).version, '0.2.6');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
