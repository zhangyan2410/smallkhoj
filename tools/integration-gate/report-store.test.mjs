import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  redactGateReport,
  writeGateReport,
} from './report-store.mjs';

test('redactGateReport removes nested credential-shaped values without mutating safe evidence', () => {
  const source = {
    mode: 'foundation-only',
    target: { serverId: 'server-1', apiBase: 'http://127.0.0.1:8000' },
    accountToken: 'secret-account',
    evidence: {
      authorization: 'Bearer secret-machine',
      nested: [{ publicKey: 'secret-public', detail: 'safe detail' }],
    },
  };

  const redacted = redactGateReport(source);
  assert.equal(redacted.accountToken, '[REDACTED]');
  assert.equal(redacted.evidence.authorization, '[REDACTED]');
  assert.equal(redacted.evidence.nested[0].publicKey, '[REDACTED]');
  assert.equal(redacted.evidence.nested[0].detail, 'safe detail');
  assert.equal(redacted.target.serverId, 'server-1');
  assert.equal(source.accountToken, 'secret-account');
});

test('writeGateReport publishes atomic run, latest, and index documents outside source data', () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-store-'));
  try {
    const result = writeGateReport({
      resultDir: root,
      report: {
        schemaVersion: 1,
        runId: 'foundation-001',
        mode: 'foundation-only',
        ok: true,
        startedAt: '2026-07-29T00:00:00.000Z',
        completedAt: '2026-07-29T00:00:01.000Z',
        target: { serverId: 'server-1' },
      },
    });

    assert.equal(result.runPath, join(root, 'runs', 'foundation-001.json'));
    assert.equal(result.latestPath, join(root, 'latest', 'foundation-only.json'));
    assert.equal(existsSync(result.runPath), true);
    assert.equal(existsSync(result.latestPath), true);
    assert.equal(existsSync(join(root, 'index.json')), true);
    assert.equal(JSON.parse(readFileSync(result.latestPath, 'utf8')).target.serverId, 'server-1');
    assert.deepEqual(readdirSync(join(root, 'latest')), ['foundation-only.json']);
    assert.equal(readdirSync(root).some((name) => name.includes('.tmp-')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
