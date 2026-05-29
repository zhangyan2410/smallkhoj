#!/usr/bin/env node
/**
 * Real Slock e2e smoke for aaa-daemon.
 *
 * It imports an existing local Slock runtime, starts this project's AgentProxy,
 * writes a disposable slock wrapper, then verifies send/read/search against the
 * real Slock API.  It does not contain browser automation itself; use
 * test/slock-browser-helper.mjs with the current GA runcode bridge (or the
 * future extracted bridge) to send a browser message, then rerun/read via CLI.
 *
 * Usage:
 *   npm.cmd run test:slock-real-e2e
 *
 * Optional env:
 *   SLOCK_REAL_RUNTIME_DIR=...       Existing Slock runtime dir to import
 *   SLOCK_REAL_TARGET=dm:@zy-ean     DM/channel target. For the verified DM,
 *                                    use the human peer, not dm:@deepseek.
 *   SLOCK_REAL_SKIP_SEND=1           Only read/search; do not send a real msg
 *   SLOCK_REAL_SEARCH_QUERY=...      Query to search after read
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { AgentProxy } from '../dist/proxy/agent-proxy.js';
import { importSlockRuntime } from '../dist/runtime/import-slock-runtime.js';
import { prependPathEnv, writeSlockWrapper } from '../dist/runtime/slock-wrapper.js';
import { runSlockCli } from '../dist/slock-cli.js';

const DEFAULT_RUNTIME_DIR = 'C:/Users/zhangyan.ean/.slock/agents/d7942034-805b-4ee4-956d-4fe9483fdcd8/.slock';
const DEFAULT_TARGET = 'dm:@zy-ean';
const DEFAULT_CAPABILITIES = 'send,read,mentions,tasks,reactions,server,channels';

function failHint(message) {
  console.error(JSON.stringify({ ok: false, code: 'SLOCK_REAL_E2E_FAILED', message }, null, 2));
  process.exitCode = 1;
}

async function cli(args, env) {
  let stdout = '';
  let stderr = '';
  const code = await runSlockCli(args, {
    env,
    stdout: { write: (chunk) => { stdout += String(chunk); return true; } },
    stderr: { write: (chunk) => { stderr += String(chunk); return true; } },
  });
  return { code, stdout, stderr };
}

async function main() {
  const runtimeDir = resolve(process.env.SLOCK_REAL_RUNTIME_DIR ?? DEFAULT_RUNTIME_DIR);
  const target = process.env.SLOCK_REAL_TARGET ?? DEFAULT_TARGET;
  if (target === 'dm:@deepseek') {
    throw new Error('For the verified DeepSeek DM, target must be the human peer dm:@zy-ean, not dm:@deepseek (the agent itself).');
  }

  const imported = importSlockRuntime(runtimeDir);
  const proxy = new AgentProxy();
  const tempRoot = mkdtempSync(join(tmpdir(), 'aaa-slock-real-e2e-'));

  try {
    const proxyCredential = imported.credential;

    await proxy.start(0);
    const wrapper = writeSlockWrapper({
      workspacePath: process.cwd(),
      proxyUrl: proxy.getProxyUrl(),
      proxyToken: proxyCredential.token,
      credential: proxyCredential,
      activeCapabilities: DEFAULT_CAPABILITIES,
      rootDir: tempRoot,
      cliPath: resolve('dist/slock-cli.js'),
    });

    proxy.register({
      token: proxyCredential.token,
      credential: proxyCredential,
      activeCapabilities: DEFAULT_CAPABILITIES,
    });

    const env = {
      ...process.env,
      PATH: prependPathEnv(wrapper.wrapperDir),
      SLOCK_AGENT_ID: proxyCredential.agentId,
      SLOCK_AGENT_PROXY_URL: proxy.getProxyUrl(),
      SLOCK_AGENT_PROXY_TOKEN_FILE: wrapper.tokenFile,
      SLOCK_WRITE_TARGET_ALLOWLIST: target,
    };

    const stamp = new Date().toISOString();
    const sentText = `aaa-daemon real e2e ${stamp}`;

    if (process.env.SLOCK_REAL_SKIP_SEND !== '1') {
      const sent = await cli(['message', 'send', '--target', target, sentText], env);
      assert.equal(sent.code, 0, sent.stderr || sent.stdout);
      console.log(JSON.stringify({ step: 'send', target, response: JSON.parse(sent.stdout) }, null, 2));
    }

    const read = await cli(['message', 'read', '--target', target, '--limit', '10'], env);
    assert.equal(read.code, 0, read.stderr || read.stdout);
    console.log(JSON.stringify({ step: 'read', target, response: JSON.parse(read.stdout) }, null, 2));

    const query = process.env.SLOCK_REAL_SEARCH_QUERY ?? (process.env.SLOCK_REAL_SKIP_SEND === '1' ? 'aaa-daemon real e2e' : sentText);
    const search = await cli(['message', 'search', '--target', target, '--query', query, '--limit', '10'], env);
    assert.equal(search.code, 0, search.stderr || search.stdout);
    console.log(JSON.stringify({ step: 'search', target, query, response: JSON.parse(search.stdout) }, null, 2));

    console.log(JSON.stringify({ ok: true, runtimeDir, target, note: 'Real Slock e2e completed through local AgentProxy.' }, null, 2));
  } finally {
    proxy.stop();
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err) => failHint(err?.stack || err?.message || String(err)));
