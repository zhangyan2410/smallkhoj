import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cliPath = fileURLToPath(new URL('../dist/cmd/main.js', import.meta.url));

function runStatus(root, { running = false, standalone = false } = {}) {
  const paths = {
    config: join(root, 'config.json'),
    credential: join(root, 'credential.json'),
    machineId: join(root, 'machine-id'),
    pid: join(root, 'aura.pid'),
    log: join(root, 'aura.log'),
    workspace: join(root, 'workspaces'),
  };
  if (running) writeFileSync(paths.pid, `${process.pid}\n`);
  const env = {
    ...process.env,
    AURA_INSTALL_ROOT: root,
    AURA_CONFIG_FILE: paths.config,
    SLOCK_AGENT_CREDENTIAL: paths.credential,
    AAA_DAEMON_MACHINE_ID_FILE: paths.machineId,
    AURA_PID_FILE: paths.pid,
    AURA_LOG_FILE: paths.log,
    SMALLKHOJ_DAEMON_WORKSPACE_ROOT: paths.workspace,
  };
  if (standalone) env.AURA_STANDALONE = '1';
  else delete env.AURA_STANDALONE;

  return spawnSync(process.execPath, [cliPath, 'status', '--json', '--pid-file', paths.pid], {
    env,
    encoding: 'utf8',
  });
}

function assertPureStatusJson(result, expectedRunning, expectedImplementation) {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.running, expectedRunning);
  assert.equal(payload.implementation, expectedImplementation);
  assert.equal(payload.implementationType, expectedImplementation);
  assert.equal(typeof payload.platform, 'string');
  assert.equal(typeof payload.architecture, 'string');
  assert.equal(typeof payload.paths, 'object');
  assert.equal(result.stdout.trimEnd().endsWith('}'), true);
  return payload;
}

test('status --json emits one parseable JSON document when stopped', () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-status-json-'));
  try {
    const result = runStatus(root);
    assert.equal(result.status, 1);
    const payload = assertPureStatusJson(result, false, 'node-npx');
    for (const value of Object.values(payload.paths)) {
      assert.equal(value.startsWith(root), true, `status path escaped isolated root: ${value}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('status --json keeps running exit code and standalone implementation metadata', () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-status-running-'));
  try {
    const result = runStatus(root, { running: true, standalone: true });
    assert.equal(result.status, 0);
    assertPureStatusJson(result, true, 'aura-standalone');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('status and doctor tolerate a UTF-8 BOM in active.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-status-bom-'));
  try {
    const activePath = join(root, 'versions', 'v0.2.6-darwin-arm64');
    mkdirSync(join(activePath, 'dist', 'cmd'), { recursive: true });
    writeFileSync(join(activePath, 'manifest.json'), JSON.stringify({ version: '0.2.6', platform: 'darwin-arm64' }));
    writeFileSync(join(activePath, 'dist', 'cmd', 'main.js'), '');
    writeFileSync(join(root, 'active.json'), `\uFEFF${JSON.stringify({ version: '0.2.6', platform: 'darwin-arm64', path: activePath })}`);
    const result = runStatus(root);
    assert.equal(result.status, 1);
    const payload = assertPureStatusJson(result, false, 'node-npx');
    assert.equal(payload.installed, true);
    assert.equal(payload.activeVersion, '0.2.6');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
