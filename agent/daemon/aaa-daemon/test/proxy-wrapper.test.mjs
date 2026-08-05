import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';

import { rewriteAgentPath } from '../dist/proxy/agent-proxy.js';
import { buildClaudeRuntimeEnv } from '../dist/runtime/claude-runtime.js';
import { buildCodexRuntimeEnv } from '../dist/runtime/codex-runtime.js';
import { buildOpenCodeRuntimeEnv } from '../dist/runtime/opencode-server-runtime.js';
import { buildPiRuntimeEnv } from '../dist/runtime/pi-runtime.js';
import { defaultSlockCliPath, prependPathEnv, writeSlockWrapper } from '../dist/runtime/slock-wrapper.js';

test('rewriteAgentPath preserves query strings and normalizes receive', () => {
  const agentId = 'agent 1';

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/history', '?channel=%23general&limit=20', agentId),
    '/internal/agent-api/history?channel=%23general&limit=20',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/receive', '?limit=10', agentId),
    '/internal/agent-api/events?limit=10&since=latest',
  );

  assert.equal(
    rewriteAgentPath('/api/attachments/file-1/download', '?inline=1', agentId),
    '/internal/agent-api/attachments/file-1/download?inline=1',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/attachments', '', agentId),
    '/internal/agent-api/attachments',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/knowledge/search', '?q=runtime', agentId),
    '/internal/agent-api/knowledge/search?q=runtime',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/memory/scopes/channel/ch-1/path/MEMORY.md', '', agentId),
    '/internal/agent-api/memory/scopes/channel/ch-1/path/MEMORY.md',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/memory/scopes/task/task-1/search', '?q=evidence', agentId),
    '/internal/agent-api/memory/scopes/task/task-1/search?q=evidence',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/tasks/task-1/claim', '', agentId),
    '/internal/agent-api/tasks/task-1/claim',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/messages/msg-1/reactions', '', agentId),
    '/internal/agent-api/messages/msg-1/reactions',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/channels/%23general/join', '', agentId),
    '/internal/agent-api/channels/%23general/join',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/threads/thread-1', '', agentId),
    '/internal/agent-api/threads/thread-1',
  );

  assert.equal(
    rewriteAgentPath('/internal/agent/agent%201/threads/thread-1/summary', '', agentId),
    '/internal/agent-api/threads/thread-1/summary',
  );
});

test('writeSlockWrapper writes wrappers and proxy token', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-wrapper-'));
  try {
    const workspace = join(root, 'workspace');
    const tokenHome = join(root, 'tokens');
    const result = writeSlockWrapper({
      workspacePath: workspace,
      tokenHome,
      launchId: 'pid-test',
      proxyUrl: 'http://127.0.0.1:3456',
      proxyToken: 'sap_test_token',
      activeCapabilities: 'send,read',
      cliPath: 'D:/repo/dist/slock-cli.js',
      credential: {
        agentId: 'agent-123',
        serverId: 'server-123',
        token: 'sk_machine_secret',
        serverUrl: 'https://api.slock.ai',
      },
    });

    assert.equal(readFileSync(result.tokenFile, 'utf-8'), 'sap_test_token');
    assert.equal(result.slockHome, result.wrapperDir);
    assert.equal(result.launchId, 'pid-test');
    const bashWrapper = readFileSync(result.bashWrapper, 'utf-8');
    assert.doesNotMatch(bashWrapper, /^export SLOCK_AGENT_PROXY_URL=/m);
    assert.doesNotMatch(bashWrapper, /^export SLOCK_AGENT_PROXY_TOKEN_FILE=/m);
    assert.doesNotMatch(bashWrapper, /SLOCK_ALLOW_WRITES='1'/);
    assert.doesNotMatch(bashWrapper, /SLOCK_WRITE_TARGET_ALLOWLIST=/);
    assert.match(bashWrapper, /SLOCK_AGENT_PROXY_URL='http:\/\/127\.0\.0\.1:3456'/);
    assert.match(bashWrapper, /SLOCK_AGENT_PROXY_TOKEN_FILE='[^']+' \\/);
    assert.match(bashWrapper, /exec '.*node(\.exe)?' 'D:\/repo\/dist\/slock-cli\.js' "\$@"/);
    const cmdWrapper = readFileSync(result.cmdWrapper, 'utf-8');
    const psWrapper = readFileSync(result.psWrapper, 'utf-8');
    assert.match(cmdWrapper, /set "SLOCK_AGENT_ID=agent-123"/);
    assert.match(psWrapper, /\$env:SLOCK_SERVER_URL='https:\/\/api\.slock\.ai'/);
    for (const alias of ['slock', 'raft', 'aura']) {
      assert.equal(readFileSync(join(result.wrapperDir, alias), 'utf-8'), bashWrapper);
      assert.equal(readFileSync(join(result.wrapperDir, `${alias}.cmd`), 'utf-8'), cmdWrapper);
      assert.equal(readFileSync(join(result.wrapperDir, `${alias}.ps1`), 'utf-8'), psWrapper);
    }
    assert.match(readFileSync(join(workspace, 'MEMORY.md'), 'utf-8'), /Use `aura` from PATH/);
    assert.doesNotMatch(readFileSync(join(workspace, 'MEMORY.md'), 'utf-8'), /`(?:slock|raft)\s/);
    assert.equal(prependPathEnv(result.wrapperDir, 'BASE'), `${result.wrapperDir}${process.platform === 'win32' ? ';' : ':'}BASE`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PATH-injected collaboration aliases resolve the same workspace agent CLI', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-aura-path-'));
  try {
    const cliPath = join(root, 'fake-slock-cli.mjs');
    writeFileSync(cliPath, [
      "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), agentId: process.env.SLOCK_AGENT_ID }));",
      '',
    ].join('\n'));
    const result = writeSlockWrapper({
      workspacePath: join(root, 'workspace'),
      tokenHome: join(root, 'tokens'),
      launchId: 'aura-path-test',
      proxyUrl: 'http://127.0.0.1:3456',
      proxyToken: 'sap_test_token',
      activeCapabilities: 'send,read',
      cliPath,
      credential: {
        agentId: 'agent-aura',
        serverId: 'server-aura',
        token: 'fake_machine_secret',
        serverUrl: 'https://api.slock.ai',
      },
    });

    for (const alias of ['aura', 'slock', 'raft']) {
      const command = process.platform === 'win32' ? `${alias}.cmd` : alias;
      const run = spawnSync(command, ['server', 'info'], {
        encoding: 'utf-8',
        env: { ...process.env, PATH: prependPathEnv(result.wrapperDir, process.env.PATH ?? '') },
        shell: process.platform === 'win32',
      });
      assert.equal(run.status, 0, `${alias}: ${run.stderr}`);
      assert.deepEqual(JSON.parse(run.stdout), {
        args: ['server', 'info'],
        agentId: 'agent-aura',
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('clean first-start envs resolve workspace aura before a poisoned host command', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-aura-clean-start-'));
  try {
    const workspacePath = join(root, 'workspace');
    const cleanHome = join(root, 'home');
    const hostBin = join(root, 'host-bin');
    const cliPath = join(root, 'fake-slock-cli.mjs');
    mkdirSync(cleanHome, { recursive: true });
    mkdirSync(hostBin, { recursive: true });
    writeFileSync(cliPath, [
      "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), agentId: process.env.SLOCK_AGENT_ID, home: process.env.HOME || process.env.USERPROFILE }));",
      '',
    ].join('\n'));

    if (process.platform === 'win32') {
      writeFileSync(join(hostBin, 'aura.cmd'), '@echo HOST_AURA_SHOULD_NOT_RUN\r\n');
    } else {
      const hostAura = join(hostBin, 'aura');
      writeFileSync(hostAura, '#!/usr/bin/env bash\nprintf HOST_AURA_SHOULD_NOT_RUN\n');
      chmodSync(hostAura, 0o755);
    }

    const credential = {
      agentId: 'agent-clean-start',
      serverId: 'server-clean-start',
      token: 'fake_machine_secret',
      serverUrl: 'https://api.slock.ai',
    };
    const wrapper = writeSlockWrapper({
      workspacePath,
      tokenHome: join(root, 'tokens'),
      launchId: 'clean-start',
      proxyUrl: 'http://127.0.0.1:3456',
      proxyToken: 'sap_clean_start',
      activeCapabilities: 'send,read',
      cliPath,
      credential,
    });
    const baseEnv = {
      HOME: cleanHome,
      USERPROFILE: cleanHome,
      // The poisoned host command is first in the untrusted base PATH. The
      // generated workspace wrapper must still be prepended ahead of it.
      PATH: `${hostBin}${delimiter}${process.env.PATH ?? ''}`,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...(process.env.ComSpec ? { ComSpec: process.env.ComSpec } : {}),
      ...(process.env.PATHEXT ? { PATHEXT: process.env.PATHEXT } : {}),
      SLOCK_AGENT_PROXY_URL: 'http://should-not-leak.invalid',
      SLOCK_AGENT_PROXY_TOKEN: 'should-not-leak',
      SLOCK_AGENT_PROXY_TOKEN_FILE: join(root, 'should-not-leak.token'),
      SLOCK_AGENT_ACTIVE_CAPABILITIES: 'should-not-leak',
    };
    const commonOptions = {
      credential,
      workspacePath,
      wrapperDir: wrapper.wrapperDir,
      slockHome: wrapper.slockHome,
      launchId: wrapper.launchId,
    };
    const runtimeEnvs = new Map([
      ['claude_code', buildClaudeRuntimeEnv(commonOptions, baseEnv)],
      ['codex', buildCodexRuntimeEnv(commonOptions, baseEnv)],
      ['opencode', buildOpenCodeRuntimeEnv(commonOptions, baseEnv)],
      ['pi', buildPiRuntimeEnv({
        ...commonOptions,
        proxyUrl: 'http://127.0.0.1:3456',
        proxyToken: 'sap_clean_start',
        configHome: join(workspacePath, '.smallkhoj', 'pi'),
      }, baseEnv)],
    ]);

    for (const [runtime, env] of runtimeEnvs) {
      assert.equal(env.PATH?.split(delimiter)[0], wrapper.wrapperDir, `${runtime} must put its workspace wrapper first`);
      assert.equal(env.HOME, cleanHome, `${runtime} must not require an existing user HOME`);
      assert.equal(env.SLOCK_HOME, wrapper.wrapperDir);
      assert.equal(env.SLOCK_AGENT_PROXY_URL, undefined);
      assert.equal(env.SLOCK_AGENT_PROXY_TOKEN, undefined);
      assert.equal(env.SLOCK_AGENT_PROXY_TOKEN_FILE, undefined);
      assert.equal(env.SLOCK_AGENT_ACTIVE_CAPABILITIES, undefined);

      const run = spawnSync(process.platform === 'win32' ? 'aura.cmd' : 'aura', ['server', 'info'], {
        encoding: 'utf-8',
        env,
        shell: process.platform === 'win32',
      });
      assert.equal(run.status, 0, `${runtime}: ${run.stderr || run.stdout}`);
      assert.deepEqual(JSON.parse(run.stdout), {
        args: ['server', 'info'],
        agentId: 'agent-clean-start',
        home: cleanHome,
      });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('defaultSlockCliPath resolves package bin symlinks to the real slock CLI', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-wrapper-bin-symlink-'));
  const previousArgv1 = process.argv[1];
  try {
    const packageRoot = join(root, 'node_modules', '@smallkhoj', 'smallkhoj-daemon');
    const binRoot = join(root, 'node_modules', '.bin');
    mkdirSync(join(packageRoot, 'dist', 'cmd'), { recursive: true });
    mkdirSync(binRoot, { recursive: true });
    writeFileSync(join(packageRoot, 'dist', 'cmd', 'main.js'), '');
    writeFileSync(join(packageRoot, 'dist', 'slock-cli.js'), '');
    symlinkSync('../@smallkhoj/smallkhoj-daemon/dist/cmd/main.js', join(binRoot, 'smallkhoj-daemon'));

    process.argv[1] = join(binRoot, 'smallkhoj-daemon');

    assert.equal(defaultSlockCliPath(), realpathSync(join(packageRoot, 'dist', 'slock-cli.js')));
  } finally {
    process.argv[1] = previousArgv1;
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeSlockWrapper bakes explicit write gate policy into wrappers', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-wrapper-write-gate-'));
  try {
    const workspace = join(root, 'workspace');
    const result = writeSlockWrapper({
      workspacePath: workspace,
      tokenHome: join(root, 'tokens'),
      launchId: 'pid-test',
      proxyUrl: 'http://127.0.0.1:3456',
      proxyToken: 'sap_test_token',
      activeCapabilities: 'send,read',
      cliPath: 'D:/repo/dist/slock-cli.js',
      allowWrites: true,
      writeTargetAllowlist: "#slock-fk,dm:@owner's",
      credential: {
        agentId: 'agent-123',
        serverId: 'server-123',
        token: 'fake_machine_secret',
        serverUrl: 'https://api.slock.ai',
      },
    });

    const bashWrapper = readFileSync(result.bashWrapper, 'utf-8');
    assert.match(bashWrapper, /SLOCK_ALLOW_WRITES='1' \\/);
    assert.match(bashWrapper, /AAA_DAEMON_ALLOW_WRITES='1' \\/);
    assert.match(bashWrapper, /SLOCK_WRITE_TARGET_ALLOWLIST='#slock-fk,dm:@owner'\\''s' \\/);
    assert.match(bashWrapper, /AAA_DAEMON_WRITE_TARGET_ALLOWLIST='#slock-fk,dm:@owner'\\''s' \\/);

    const cmdWrapper = readFileSync(result.cmdWrapper, 'utf-8');
    assert.match(cmdWrapper, /set "SLOCK_ALLOW_WRITES=1"/);
    assert.match(cmdWrapper, /set "AAA_DAEMON_ALLOW_WRITES=1"/);
    assert.match(cmdWrapper, /set "SLOCK_WRITE_TARGET_ALLOWLIST=#slock-fk,dm:@owner's"/);
    assert.match(cmdWrapper, /set "AAA_DAEMON_WRITE_TARGET_ALLOWLIST=#slock-fk,dm:@owner's"/);

    const psWrapper = readFileSync(result.psWrapper, 'utf-8');
    assert.match(psWrapper, /\$env:SLOCK_ALLOW_WRITES='1'/);
    assert.match(psWrapper, /\$env:AAA_DAEMON_ALLOW_WRITES='1'/);
    assert.match(psWrapper, /\$env:SLOCK_WRITE_TARGET_ALLOWLIST='#slock-fk,dm:@owner''s'/);
    assert.match(psWrapper, /\$env:AAA_DAEMON_WRITE_TARGET_ALLOWLIST='#slock-fk,dm:@owner''s'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeSlockWrapper preserves existing runtime memory', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-wrapper-memory-'));
  try {
    const workspace = join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, 'MEMORY.md'), '# Existing Memory\n');

    writeSlockWrapper({
      workspacePath: workspace,
      tokenHome: join(root, 'tokens'),
      proxyUrl: 'http://127.0.0.1:3456',
      proxyToken: 'sap_test_token',
      activeCapabilities: 'send,read',
      cliPath: 'D:/repo/dist/slock-cli.js',
      credential: {
        agentId: 'agent-123',
        serverId: 'server-123',
        token: 'sk_machine_secret',
        serverUrl: 'https://api.slock.ai',
      },
    });

    assert.equal(readFileSync(join(workspace, 'MEMORY.md'), 'utf-8'), '# Existing Memory\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('writeSlockWrapper shell-quotes bash wrapper values', () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-wrapper-quote-'));
  try {
    const workspace = join(root, "work'space");
    const tokenHome = join(root, "tok'ens");
    const result = writeSlockWrapper({
      workspacePath: workspace,
      tokenHome,
      launchId: 'pid-test',
      proxyUrl: 'http://127.0.0.1:3456',
      proxyToken: 'sap_test_token',
      activeCapabilities: 'send,read',
      cliPath: "/repo/o'clock/dist/slock-cli.js",
      credential: {
        agentId: 'agent-123',
        serverId: 'server-123',
        token: 'sk_machine_secret',
        serverUrl: 'https://api.slock.ai',
      },
    });

    const wrapper = readFileSync(result.bashWrapper, 'utf-8');
    assert.match(wrapper, /SLOCK_AGENT_PROXY_TOKEN_FILE='.*'\\''.*'/);
    assert.match(wrapper, /SLOCK_CURRENT_WORKSPACE_PATH='.*'\\''.*'/);
    assert.match(wrapper, /exec '.*node(\.exe)?' '\/repo\/o'\\''clock\/dist\/slock-cli\.js' "\$@"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
