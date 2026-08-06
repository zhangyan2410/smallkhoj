import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { win32 as winPath } from 'node:path';
import test from 'node:test';
import {
  auraInstallRoot,
  daemonPaths,
  detectWindowsArchitecture,
  windowsPlatformLabel,
} from '../dist/platform/paths.js';
import { readSetup, runSetup } from '../dist/platform/setup.js';

test('Windows architecture detection uses the native override, not win32 as x86', () => {
  assert.equal(detectWindowsArchitecture({ PROCESSOR_ARCHITECTURE: 'AMD64' }, 'ia32'), 'x64');
  assert.equal(
    detectWindowsArchitecture({ PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_ARCHITEW6432: 'AMD64' }, 'ia32'),
    'x64',
  );
  assert.equal(detectWindowsArchitecture({ PROCESSOR_ARCHITECTURE: 'ARM64' }, 'x64'), 'arm64');
  assert.equal(windowsPlatformLabel({ PROCESSOR_ARCHITECTURE: 'AMD64' }, 'ia32'), 'win32-x64');
});

test('Windows paths are user-scoped under LOCALAPPDATA\\Aura', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local' };
  const root = auraInstallRoot(env, 'win32', 'C:\\Users\\alice');
  assert.equal(root, 'C:\\Users\\alice\\AppData\\Local\\Aura');
  const paths = daemonPaths(env, 'win32', 'C:\\Users\\alice');
  assert.equal(paths.credentialPath, winPath.join(root, 'daemon', 'credential.json'));
  assert.equal(paths.machineIdPath, winPath.join(root, 'daemon', 'machine-id'));
});

test('Setup is local, idempotent, and explicit reset rotates identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-setup-'));
  try {
    const env = { AURA_INSTALL_ROOT: root };
    const first = runSetup({
      name: 'test-computer',
      serverUrl: 'https://smallkhoj.example.com',
      env,
      platform: 'win32',
      home: root,
    });
    assert.equal(first.created, true);
    assert.equal(existsSync(first.paths.configPath), true);
    assert.equal(first.paths.configPath, join(root, 'daemon', 'config.json'));
    const again = runSetup({
      name: 'ignored-on-idempotent-run',
      serverUrl: 'https://other.example.com',
      env,
      platform: 'win32',
      home: root,
    });
    assert.equal(again.config.machineId, first.config.machineId);
    assert.equal(again.config.name, 'ignored-on-idempotent-run');
    const reset = runSetup({
      name: 'cloned-computer',
      serverUrl: 'https://smallkhoj.example.com',
      reset: true,
      env,
      platform: 'win32',
      home: root,
    });
    assert.notEqual(reset.config.machineId, first.config.machineId);
    assert.equal(readSetup(reset.paths).machineId, reset.config.machineId);
    assert.equal(readFileSync(reset.paths.machineIdPath, 'utf8').trim(), reset.config.machineId);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
