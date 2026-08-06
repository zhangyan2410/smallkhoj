import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';

const cliPath = resolve('dist/cmd/main.js');

async function startServer(handler) {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      await handler(req, res, body);
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function waitFor(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, reject) => {
    const tick = () => {
      try {
        if (predicate()) {
          resolveWait();
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timed out waiting for managed daemon test condition'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function isolatedEnv(root, serverUrl) {
  const daemonRoot = join(root, 'daemon');
  return {
    ...process.env,
    AURA_STANDALONE: '1',
    AURA_INSTALL_ROOT: root,
    AURA_CONFIG_FILE: join(daemonRoot, 'config.json'),
    SLOCK_AGENT_CREDENTIAL: join(daemonRoot, 'credential.json'),
    AAA_DAEMON_MACHINE_ID_FILE: join(daemonRoot, 'machine-id'),
    AURA_PID_FILE: join(daemonRoot, 'aura.pid'),
    AURA_STATE_FILE: join(daemonRoot, 'daemon-state.json'),
    AURA_LOG_FILE: join(daemonRoot, 'aura.log'),
    SMALLKHOJ_DAEMON_WORKSPACE_ROOT: join(daemonRoot, 'workspaces'),
    AURA_SERVER_URL: serverUrl,
    AURA_CONNECT_TIMEOUT_MS: '5000',
  };
}

async function stopChildFromState(root, env) {
  const pidPath = env.AURA_PID_FILE;
  if (!existsSync(pidPath)) return;
  const pid = Number.parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
  if (!Number.isFinite(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  await waitFor(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  }, 5_000).catch(() => {});
}

test('standalone product connect backgrounds only after register succeeds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-managed-connect-'));
  const requests = [];
  const upstream = await startServer(async (req, res, body) => {
    const path = new URL(req.url, 'http://upstream.test').pathname;
    requests.push({ path, body: body ? JSON.parse(body) : null });
    res.setHeader('content-type', 'application/json');
    if (path === '/internal/agent-api/daemon/connect') {
      res.end(JSON.stringify({
        connected: true,
        daemonId: 'daemon-managed-connect',
        machineToken: 'sk_machine_managed_connect',
        computer: {
          id: 'computer-managed-connect',
          serverId: 'server-managed-connect',
          machineId: requests.at(-1).body.machineId,
        },
      }));
      return;
    }
    if (path === '/internal/agent-api/daemon/register' || path === '/internal/agent-api/daemon/heartbeat') {
      res.end(JSON.stringify({
        registered: true,
        ok: true,
        computer: {
          id: 'computer-managed-connect',
          serverId: 'server-managed-connect',
          activeDaemonId: 'daemon-managed-connect',
          daemonLeaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          lastHeartbeatAt: new Date().toISOString(),
        },
        workspaces: [],
        controlCommands: [],
      }));
      return;
    }
    if (path === '/internal/agent-api/daemon/shutdown') {
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });
  const env = isolatedEnv(root, upstream.url);
  const setup = spawnSync(process.execPath, [
    cliPath,
    'setup',
    '--name', 'managed-connect-test',
    '--server-url', upstream.url,
  ], { env, encoding: 'utf8' });
  assert.equal(setup.status, 0, `${setup.stdout}\n${setup.stderr}`);

  const parent = spawn(process.execPath, [
    cliPath,
    '--server-url', upstream.url,
    '--api-key', 'sk_connect_managed_connect',
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  parent.stdout.setEncoding('utf8');
  parent.stderr.setEncoding('utf8');
  parent.stdout.on('data', (chunk) => { stdout += chunk; });
  parent.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    parent.once('error', rejectExit);
    parent.once('exit', (code) => resolveExit(code));
  });

  try {
    assert.equal(exitCode, 0, `${stdout}\n${stderr}`);
    assert.match(stdout, /Connected and running in background/);
    assert.equal(requests.some((item) => item.path === '/internal/agent-api/daemon/connect'), true);
    assert.equal(requests.some((item) => item.path === '/internal/agent-api/daemon/register'), true);

    const state = JSON.parse(readFileSync(env.AURA_STATE_FILE, 'utf8'));
    assert.equal(state.status, 'online');
    assert.equal(state.daemonId, 'daemon-managed-connect');
    assert.equal(state.activeDaemonId, 'daemon-managed-connect');
    assert.equal(state.computerId, 'computer-managed-connect');
    assert.equal(state.serverId, 'server-managed-connect');

    const status = spawnSync(process.execPath, [cliPath, 'status', '--json'], { env, encoding: 'utf8' });
    assert.equal(status.status, 0, `${status.stdout}\n${status.stderr}`);
    const payload = JSON.parse(status.stdout);
    assert.equal(payload.implementationType, 'aura-standalone');
    assert.equal(payload.connected, true);
    assert.equal(payload.online, true);
    assert.equal(payload.computerId, 'computer-managed-connect');
  } finally {
    await stopChildFromState(root, env);
    await upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('standalone product connect fails closed when register is rejected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aura-managed-connect-fail-'));
  const upstream = await startServer(async (req, res, body) => {
    const path = new URL(req.url, 'http://upstream.test').pathname;
    res.setHeader('content-type', 'application/json');
    if (path === '/internal/agent-api/daemon/connect') {
      res.end(JSON.stringify({
        connected: true,
        daemonId: 'daemon-managed-fail',
        machineToken: 'sk_machine_managed_fail',
        computer: { id: 'computer-managed-fail', serverId: 'server-managed-fail', machineId: JSON.parse(body).machineId },
      }));
      return;
    }
    if (path === '/internal/agent-api/daemon/register') {
      res.statusCode = 503;
      res.end(JSON.stringify({ detail: 'registration unavailable' }));
      return;
    }
    res.end(JSON.stringify({ events: [] }));
  });
  const env = isolatedEnv(root, upstream.url);
  const setup = spawnSync(process.execPath, [cliPath, 'setup', '--name', 'managed-fail', '--server-url', upstream.url], { env, encoding: 'utf8' });
  assert.equal(setup.status, 0, `${setup.stdout}\n${setup.stderr}`);
  const parent = spawn(process.execPath, [cliPath, '--server-url', upstream.url, '--api-key', 'sk_connect_managed_fail'], { env, encoding: 'utf8' });
  let stdout = '';
  let stderr = '';
  parent.stdout.setEncoding('utf8');
  parent.stderr.setEncoding('utf8');
  parent.stdout.on('data', (chunk) => { stdout += chunk; });
  parent.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    parent.once('error', rejectExit);
    parent.once('exit', (code) => resolveExit(code));
  });
  try {
    assert.notEqual(exitCode, 0);
    assert.match(`${stdout}\n${stderr}`, /registration|server|Aura/i);
    const state = JSON.parse(readFileSync(env.AURA_STATE_FILE, 'utf8'));
    assert.equal(state.status, 'error');
    assert.match(state.lastError, /registration|503/i);
  } finally {
    await upstream.close();
    rmSync(root, { recursive: true, force: true });
  }
});
