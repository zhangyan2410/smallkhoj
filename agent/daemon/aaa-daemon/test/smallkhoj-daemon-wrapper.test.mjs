import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

const wrapperPath = new URL('../../../../smallkhoj-daemon', import.meta.url);
const wrapperFile = wrapperPath.pathname;

test('smallkhoj-daemon wrapper scopes its default lock by server URL', async () => {
  const source = await readFile(wrapperPath, 'utf8');

  assert.match(
    source,
    /LOCK_DIR=.*SMALLKHOJ_DAEMON_LOCK_DIR/s,
    'wrapper should allow overriding the lock directory without forcing one global lock file',
  );
  assert.match(
    source,
    /LOCK_KEY=.*SERVER_URL/s,
    'wrapper should derive the default lock key from the parsed server URL',
  );
  assert.match(
    source,
    /shasum -a 256/,
    'wrapper should hash the server URL so arbitrary URLs remain safe lock-file names',
  );
  assert.doesNotMatch(
    source,
    /LOCK_FILE="\$\{SMALLKHOJ_DAEMON_LOCK:-\$\{HOME\}\/\.smallkhoj\/daemon\.pid\}"/,
    'wrapper must not use one global ~/.smallkhoj/daemon.pid lock for every backend',
  );
});

test('smallkhoj-daemon wrapper explains when an existing daemon blocks startup', async () => {
  const source = await readFile(wrapperPath, 'utf8');

  assert.match(
    source,
    /Existing daemon for \$SERVER_URL is already running .*from \$LOCK_FILE/,
    'singleton guard log should include the server URL and lock file that blocked startup',
  );
  assert.doesNotMatch(
    source,
    /stop_pid_tree "\$old_pid"/,
    'a wrapper with an invalid or reused connect token must not terminate an already-running daemon',
  );
});

test('smallkhoj-daemon wrapper execs the daemon as the foreground process', async () => {
  const source = await readFile(wrapperPath, 'utf8');

  assert.doesNotMatch(
    source,
    /\n\s*"\$@"\s*&\s*\n\s*DAEMON_PID=\$!\s*\n\s*wait "\$DAEMON_PID"/,
    'wrapper must not background the daemon and wait from a parent shell that can receive its own TERM',
  );
  assert.match(
    source,
    /\bexec env SLOCK_CONNECT_TOKEN=/,
    'connect mode should replace the wrapper with the daemon process',
  );
  assert.match(
    source,
    /\bexec env SLOCK_AGENT_TOKEN=/,
    'machine-token start mode should replace the wrapper with the daemon process',
  );
});

test('smallkhoj-daemon wrapper isolates servers and refuses same-server auto-replacement', async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'smallkhoj-daemon-wrapper-'));
  const fakeBin = join(tempRoot, 'bin');
  const lockDir = join(tempRoot, 'locks');
  const fakeNodeLog = join(tempRoot, 'node.log');
  const processes = [];

  await mkdir(fakeBin, { recursive: true });
  await writeFile(
    join(fakeBin, 'npm'),
    '#!/usr/bin/env bash\nexit 0\n',
  );
  await writeFile(
    join(fakeBin, 'node'),
    [
      '#!/usr/bin/env bash',
      'echo "$$ $*" >> "$FAKE_NODE_LOG"',
      'trap "exit 143" TERM',
      'while true; do sleep 1; done',
      '',
    ].join('\n'),
  );
  await chmod(join(fakeBin, 'npm'), 0o755);
  await chmod(join(fakeBin, 'node'), 0o755);

  const env = {
    ...process.env,
    PATH: `${fakeBin}:${process.env.PATH}`,
    SMALLKHOJ_DAEMON_LOCK_DIR: lockDir,
    FAKE_NODE_LOG: fakeNodeLog,
  };

  const launch = async (serverUrl, options = {}) => {
    const child = spawn(
      'bash',
      [wrapperFile, 'connect', '--token', 'sk_connect_test', '--server', serverUrl],
      { env, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    processes.push(child);
    child.stderrText = '';
    child.stderr.on('data', (chunk) => {
      child.stderrText += String(chunk);
    });
    if (options.expectDaemonStart === false) {
      await waitFor(() => child.exitCode !== null, 3000);
    } else {
      await waitFor(() => childHasDaemonLog(fakeNodeLog, serverUrl), 3000);
    }
    return child;
  };

  try {
    const first = await launch('http://localhost:8015');
    const second = await launch('http://127.0.0.1:8000');

    assert.equal(first.exitCode, null, 'different server URL must not stop the first wrapper');
    assert.equal(second.exitCode, null, 'second wrapper should keep running');

    const replacement = await launch('http://127.0.0.1:8015', { expectDaemonStart: false });
    await waitFor(() => replacement.exitCode !== null, 6000);

    assert.equal(first.exitCode, null, 'same-server startup must not stop an existing daemon automatically');
    assert.notEqual(replacement.exitCode, 0, 'same-server startup should fail fast when a daemon is already running');
    assert.match(
      replacement.stderrText,
      /Existing daemon for http:\/\/127\.0\.0\.1:8015 is already running .*from .*daemon-[0-9a-f]{16}\.pid/,
    );
    assert.equal(second.exitCode, null, 'same-server replacement must not stop another server wrapper');
  } finally {
    for (const child of processes) {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    }
    await Promise.all(processes.map((child) => onceExit(child)));
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function childHasDaemonLog(logFile, serverUrl) {
  const text = await readFile(logFile, 'utf8').catch(() => '');
  return text.includes('--server ' + serverUrl);
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (lastError) {
    throw lastError;
  }
  throw new Error('Timed out waiting for condition');
}

async function onceExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => child.once('exit', resolve));
}
