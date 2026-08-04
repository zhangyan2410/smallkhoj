import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const isolatedResultRoot = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-cli-suite-'));
test.after(() => rmSync(isolatedResultRoot, { recursive: true, force: true }));

function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    handler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

function runCli(args, { serverId = 'server-1' } = {}) {
  return new Promise((resolve) => {
    let scopedArgs = serverId && !args.includes('--server-id')
      ? [...args, '--server-id', serverId]
      : args;
    if (!scopedArgs.includes('--result-dir')) {
      scopedArgs = [...scopedArgs, '--result-dir', isolatedResultRoot];
    }
    const child = spawn(process.execPath, ['tools/integration-gate/run.mjs', ...scopedArgs], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('integration gate CLI fails closed before network access when Server id is missing', async () => {
  const result = await runCli([], { serverId: null });

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^CONFIG_ERROR SERVER_ID_REQUIRED\b/);
  assert.doesNotMatch(result.stderr, /at .*run\.mjs/);
});

test('integration gate CLI rejects an unsupported runtime before network access', async () => {
  const result = await runCli([
    '--runtime', 'unsupported-runtime',
    '--api-base', 'http://127.0.0.1:1',
    '--frontend-base', 'http://127.0.0.1:1',
  ]);

  assert.equal(result.code, 2);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^CONFIG_ERROR UNSUPPORTED_RUNTIME runtime="unsupported-runtime"\n$/);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|fetch failed/);
});

test('integration gate CLI returns compact pass output for foundation-ready snapshot', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-cli-'));
  const contextFile = join(root, 'context.md');
  const runtimeControlFile = join(root, 'runtime-control.json');
  writeFileSync(contextFile, [
    '## Context Usage',
    '**Model:** MiniMax-M3',
    '**Tokens:** 35.1k / 200k (18%)',
  ].join('\n'));
  writeFileSync(runtimeControlFile, JSON.stringify({
    action: 'inspect_context',
    agentId: 'agent-1',
    accepted: true,
    delivered: true,
    runtime: 'claude_code',
    slashCommand: '/context',
    output: readFileSync(contextFile, 'utf-8'),
  }));

  const server = await startServer((req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Foundation Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
          agentWorkspaces: [{
            id: 'workspace-1',
            agentId: 'agent-1',
            status: 'running',
            runtime: 'claude_code',
            runtimeProvider: 'MiniMax',
            runtimeModel: 'MiniMax-M3',
            sessionId: 'session-1',
          }],
        }],
      }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--runtime', 'claude_code',
      '--runtime-control-result', runtimeControlFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout.trim(), /^PASS foundation-only 12\/12$/);
    assert.equal(result.stderr, '');
    assert.equal(server.requests.some((request) => request.url === '/api/v1/computers' && request.headers['x-account-token'] === 'test-session'), true);
    assert.equal(server.requests.every((request) => request.url === '/control/integration' || request.headers['x-server-id'] === 'server-1'), true);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI rejects static runtime-control evidence from another runtime agent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-runtime-control-mismatch-'));
  const runtimeControlFile = join(root, 'runtime-control.json');
  writeFileSync(runtimeControlFile, JSON.stringify({
    action: 'inspect_context',
    agentId: 'agent-codex',
    accepted: true,
    delivered: true,
    runtime: 'codex',
    slashCommand: '/status',
    output: 'Context window: 18% used',
  }));

  const server = await startServer((req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Foundation Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code' }],
          agentWorkspaces: [{
            agentId: 'agent-claude',
            status: 'running',
            runtime: 'claude_code',
            sessionId: 'session-claude',
          }],
        }],
      }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--runtime', 'claude_code',
      '--runtime-control-result', runtimeControlFile,
      '--json',
    ]);

    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.runtimeControl.identityFailure.code, 'RUNTIME_CONTROL_TARGET_MISMATCH');
    assert.equal(report.steps.find((step) => step.id === 'context-preflight')?.failure.code, 'RUNTIME_CONTROL_TARGET_MISMATCH');
    assert.equal(report.steps.find((step) => step.id === 'compact-if-needed')?.failure.code, 'RUNTIME_CONTROL_TARGET_MISMATCH');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI can collect context through daemon JSON-RPC runtime control', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-rpc-'));
  const resultFile = join(root, 'latest-foundation-gate.json');
  const rpcRequests = [];

  const server = await startServer(async (req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Foundation Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
          agentWorkspaces: [{
            id: 'workspace-1',
            agentId: 'agent-1',
            status: 'running',
            runtime: 'claude_code',
            runtimeProvider: 'MiniMax',
            runtimeModel: 'MiniMax-M3',
            sessionId: 'session-1',
          }],
        }],
      }));
      return;
    }
    if (req.url === '/internal/daemon/jsonrpc') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      rpcRequests.push(message);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          accepted: true,
          delivered: true,
          action: 'inspect_context',
          agentId: 'agent-1',
          runtime: 'claude_code',
          slashCommand: '/context',
          output: [
            '## Context Usage',
            '**Model:** MiniMax-M3',
            '**Tokens:** 35.1k / 200k (18%)',
          ].join('\n'),
        },
      }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--runtime', 'claude_code',
      '--daemon-rpc-base', server.url,
      '--runtime-agent-id', 'agent-1',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout.trim(), /^PASS foundation-only 12\/12$/);
    const runtimeControlRequest = rpcRequests.find((request) => request.method === 'daemon/runtime_control');
    assert.ok(runtimeControlRequest);
    assert.equal(rpcRequests.some((request) => request.method === 'daemon/logs'), true);
    assert.deepEqual(runtimeControlRequest.params, {
      action: 'inspect_context',
      agentId: 'agent-1',
      waitForResult: true,
      timeoutMs: 30_000,
    });

    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.ok, true);
    assert.match(report.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(report.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.ok(Date.parse(report.completedAt) >= Date.parse(report.startedAt));
    assert.equal(report.runtimeControl.action, 'inspect_context');
    assert.equal(report.steps.find((step) => step.id === 'context-preflight')?.evidence.source, 'daemon_runtime_control.inspect_context');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI surfaces daemon warmup bootstrap failures from logs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-logs-'));
  const resultFile = join(root, 'latest-foundation-gate.json');
  const rpcRequests = [];

  const server = await startServer(async (req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Foundation Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
          agentWorkspaces: [{
            id: 'workspace-1',
            agentId: 'agent-1',
            status: 'running',
            runtime: 'claude_code',
            runtimeProvider: 'MiniMax',
            runtimeModel: 'MiniMax-M3',
            sessionId: 'session-1',
          }],
        }],
      }));
      return;
    }
    if (req.url === '/internal/daemon/jsonrpc') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      rpcRequests.push(message);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (message.method === 'daemon/runtime_control') {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            accepted: true,
            delivered: true,
            action: 'inspect_context',
            agentId: 'agent-1',
            runtime: 'claude_code',
            slashCommand: '/context',
            output: [
              '## Context Usage',
              '**Model:** MiniMax-M3',
              '**Tokens:** 28.5k / 200k (14%)',
            ].join('\n'),
          },
        }));
        return;
      }
      if (message.method === 'daemon/logs') {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            entries: [
              { level: 'debug', message: 'claude_code runtime agent-1 stderr: `slock server info` failed with `MISSING_TOKEN`' },
              { level: 'warn', message: 'Runtime agent-1 warmup timed out after 60000ms; marking startup failed' },
            ],
          },
        }));
        return;
      }
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--runtime', 'claude_code',
      '--daemon-rpc-base', server.url,
      '--runtime-agent-id', 'agent-1',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 1);
    assert.match(result.stdout.trim(), /^FAIL foundation-only 11\/12/);
    assert.equal(rpcRequests.some((request) => request.method === 'daemon/logs'), true);

    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    const warmup = report.steps.find((step) => step.id === 'warmup-ready');
    assert.equal(report.ok, false);
    assert.equal(warmup.failure.code, 'RUNTIME_WARMUP_TOKEN_MISSING');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI selects the requested Codex runtime agent and parses status context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-codex-'));
  const resultFile = join(root, 'codex-foundation.json');
  const rpcRequests = [];
  const server = await startServer(async (req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Foundation Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [
            { type: 'claude_code', runtimeProvider: 'MiniMax' },
            { type: 'codex', runtimeProvider: 'MiniMax' },
          ],
          agentWorkspaces: [
            { agentId: 'agent-claude', status: 'running', runtime: 'claude_code', sessionId: 'session-claude' },
            { agentId: 'agent-codex', status: 'running', runtime: 'codex', sessionId: 'session-codex' },
          ],
        }],
      }));
      return;
    }
    if (req.url === '/internal/daemon/jsonrpc') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      rpcRequests.push(message);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (message.method === 'daemon/runtime_control') {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            accepted: true,
            delivered: true,
            action: 'inspect_context',
            agentId: message.params.agentId,
            runtime: 'codex',
            slashCommand: '/status',
            output: 'Context window: 18% used',
          },
        }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { entries: [] } }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--runtime', 'codex',
      '--daemon-rpc-base', server.url,
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    const runtimeRequest = rpcRequests.find((request) => request.method === 'daemon/runtime_control');
    assert.equal(runtimeRequest.params.agentId, 'agent-codex');
    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.runtime, 'codex');
    assert.equal(report.runtimeControl.slashCommand, '/status');
    assert.equal(report.steps.find((step) => step.id === 'target-runtime-ready')?.status, 'pass');
    assert.equal(report.steps.find((step) => step.id === 'context-preflight')?.status, 'pass');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI gives OpenCode strict runtime evidence with explicit context skips', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-opencode-'));
  const resultFile = join(root, 'opencode-foundation.json');
  const server = await startServer((req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Foundation Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'opencode', runtimeProvider: 'MiniMax' }],
          agentWorkspaces: [{
            agentId: 'agent-opencode',
            status: 'running',
            runtime: 'opencode',
            runtimeProvider: 'MiniMax Claude',
            sessionId: 'session-opencode',
          }],
        }],
      }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--runtime', 'opencode',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout.trim(), /^PASS foundation-only 10\/12 skipped=2$/);
    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.runtime, 'opencode');
    assert.equal(report.steps.find((step) => step.id === 'context-preflight')?.status, 'skip');
    assert.equal(report.steps.find((step) => step.id === 'compact-if-needed')?.applicable, false);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI does not let provider metadata cross-match an OpenCode target', async () => {
  const server = await startServer((req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Foundation Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'OpenCode MiniMax' }],
          agentWorkspaces: [{
            agentId: 'agent-claude',
            status: 'running',
            runtime: 'claude_code',
            runtimeProvider: 'OpenCode MiniMax',
            sessionId: 'session-claude',
          }],
        }],
      }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--runtime', 'opencode',
      '--json',
    ]);

    assert.equal(result.code, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.runtime, 'opencode');
    assert.equal(report.steps.find((step) => step.id === 'target-runtime-ready')?.status, 'fail');
    assert.equal(report.steps.find((step) => step.id === 'session-resume')?.status, 'fail');
  } finally {
    await server.close();
  }
});

test('integration gate CLI defaults Foundation to the four-runtime matrix', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-gate-all-runtimes-'));
  const resultFile = join(root, 'all-runtimes-foundation.json');
  const rpcRequests = [];
  const runtimes = ['claude_code', 'codex', 'opencode', 'pi'];
  const server = await startServer(async (req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Foundation Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-all',
          status: 'online',
          detectedRuntimes: runtimes.map((runtime) => ({ type: runtime, runtimeProvider: 'MiniMax' })),
          agentWorkspaces: runtimes.map((runtime) => ({
            agentId: `agent-${runtime}`,
            status: 'running',
            runtime,
            runtimeProvider: 'MiniMax',
            sessionId: `session-${runtime}`,
          })),
        }],
      }));
      return;
    }
    if (req.url === '/internal/daemon/jsonrpc') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      rpcRequests.push(message);
      res.writeHead(200, { 'content-type': 'application/json' });
      if (message.method === 'daemon/logs') {
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id: message.id,
          result: {
            entries: [
              { level: 'error', message: 'opencode runtime unrelated-agent stderr: MISSING_TOKEN' },
              { level: 'warn', message: 'Runtime unrelated-agent warmup timed out after 60000ms; degrading to ready' },
            ],
          },
        }));
        return;
      }
      const isCodex = message.params.agentId === 'agent-codex';
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          accepted: true,
          delivered: true,
          action: 'inspect_context',
          agentId: message.params.agentId,
          runtime: isCodex ? 'codex' : 'claude_code',
          slashCommand: isCodex ? '/status' : '/context',
          output: 'Context window: 16% used',
        },
      }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--daemon-rpc-base', server.url,
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.match(result.stdout.trim(), /^PASS foundation-only 44\/48 skipped=4$/);
    const controlledAgents = rpcRequests
      .filter((request) => request.method === 'daemon/runtime_control')
      .map((request) => request.params.agentId)
      .sort();
    assert.deepEqual(controlledAgents, ['agent-claude_code', 'agent-codex']);
    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.runtime, 'all');
    assert.deepEqual(report.runtimeReports.map((item) => item.runtime), runtimes);
    assert.equal(report.summary.skipped, 4);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI runs controlled channel chat reply mode and writes a separate report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-chat-gate-cli-'));
  const resultFile = join(root, 'latest-chat-reply-channel-base-gate.json');
  const messages = [];
  const postedBodies = [];

  const server = await startServer(async (req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Integration Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          name: 'devbox',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
          agentWorkspaces: [{
            id: 'workspace-1',
            agentId: 'agent-1',
            agentName: 'MiniMax Agent',
            status: 'running',
            runtime: 'claude_code',
            runtimeProvider: 'MiniMax',
            runtimeModel: 'MiniMax-M3',
            sessionId: 'session-1',
          }],
        }],
      }));
      return;
    }
    if (req.url === '/api/v1/channels/channel-1/members') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        members: [
          { id: 'human-1', kind: 'human', displayName: 'Human' },
          { id: 'agent-1', kind: 'agent', displayName: 'MiniMax Agent', computerId: 'computer-1' },
        ],
      }));
      return;
    }
    if (req.url?.startsWith('/api/v1/activity')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        activity: [
          {
            id: 'activity-idle',
            agentId: 'agent-1',
            type: 'runtime_idle',
            details: {
              tokens: { input: 100, output: 20, cacheRead: 300 },
              usageSource: 'session-jsonl',
            },
            timestamp: '2026-06-24T00:00:04.000Z',
          },
          {
            id: 'activity-output',
            agentId: 'agent-1',
            type: 'runtime_output',
            details: {
              traceId: 'chat-gate:trace-cli',
              toolName: 'Bash',
              commandPreview: 'slock message send --target #gate-lab --content "ACK CHAT-GATE:test-cli"',
              replyMessageId: 'msg-reply-1',
            },
            timestamp: '2026-06-24T00:00:03.000Z',
          },
          {
            id: 'activity-thinking',
            agentId: 'agent-1',
            type: 'runtime_thinking',
            details: { thought: 'Send the requested ACK.' },
            timestamp: '2026-06-24T00:00:02.000Z',
          },
          {
            id: 'activity-working',
            agentId: 'agent-1',
            type: 'runtime_working',
            details: { traceId: 'chat-gate:trace-cli', messageId: 'msg-user-1' },
            timestamp: '2026-06-24T00:00:01.000Z',
          },
        ],
      }));
      return;
    }
    if (req.url?.startsWith('/api/v1/channels/gate-lab/messages')) {
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body);
        postedBodies.push(parsed);
        messages.push({
          id: 'msg-user-1',
          channelId: 'channel-1',
          senderId: 'human-1',
          senderType: 'human',
          sender: '@Human',
          content: parsed.content,
          createdAt: '2026-06-24T00:00:01.000Z',
        });
        messages.push({
          id: 'msg-reply-1',
          channelId: 'channel-1',
          senderId: 'agent-1',
          senderType: 'agent',
          sender: '@MiniMax Agent',
          content: 'ACK CHAT-GATE:test-cli',
          createdAt: '2026-06-24T00:00:05.000Z',
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          created: true,
          traceId: parsed.traceId,
          message: messages[0],
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ channelName: 'gate-lab', messages }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--mode', 'chat-reply-channel-base',
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--agent-id', 'agent-1',
      '--channel', 'gate-lab',
      '--channel-id', 'channel-1',
      '--trace-id', 'chat-gate:trace-cli',
      '--marker', 'CHAT-GATE:test-cli',
      '--expected-ack', 'ACK CHAT-GATE:test-cli',
      '--reply-timeout-ms', '500',
      '--poll-interval-ms', '10',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'PASS chat-reply-channel-base 11/11');
    assert.equal(postedBodies.length, 1);
    assert.equal(postedBodies[0].traceId.startsWith('chat-gate:'), true);
    assert.match(postedBodies[0].content, /ACK CHAT-GATE:test-cli/);

    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.scenario, 'chat-reply-channel-base');
    assert.equal(report.ok, true);
    assert.equal(report.messages.userMessageId, 'msg-user-1');
    assert.equal(report.messages.replyMessageId, 'msg-reply-1');
    assert.equal(report.target.channelId, 'channel-1');
    assert.equal(report.replyEvidence.visible, true);
    assert.equal(report.usage.inputTokens, 100);
    assert.equal(report.usage.outputTokens, 20);
    assert.equal(report.usage.cacheReadTokens, 300);
    assert.equal(report.usage.usageSource, 'session-jsonl');
    assert.equal(report.warnings.some((warning) => warning.code === 'TOKEN_USAGE_MISSING'), false);
    assert.equal(report.latency.totalSendToVisibleMs, 4000);
    assert.equal(report.latency.persistToRuntimeDeliveryMs, 0);
    assert.equal(report.latency.deliveryToThinkingMs, 1000);
    assert.equal(report.latency.thinkingToToolMs, 1000);
    assert.equal(report.latency.toolToReplyPersistMs, 2000);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI runs channel group mode with explicit responder policy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-chat-group-gate-cli-'));
  const resultFile = join(root, 'latest-chat-reply-channel-group-gate.json');
  const messages = [];

  const server = await startServer(async (req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Integration Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
          agentWorkspaces: [{
            id: 'workspace-1',
            agentId: 'agent-1',
            agentName: 'MiniMax Agent',
            status: 'running',
            runtime: 'claude_code',
            runtimeProvider: 'MiniMax',
            runtimeModel: 'MiniMax-M3',
            sessionId: 'session-1',
          }],
        }],
      }));
      return;
    }
    if (req.url === '/api/v1/channels/channel-1/members') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        members: [
          { id: 'agent-1', kind: 'agent', displayName: 'MiniMax Agent' },
          { id: 'agent-2', kind: 'agent', displayName: 'Observer Agent' },
        ],
      }));
      return;
    }
    if (req.url?.startsWith('/api/v1/activity')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ activity: runtimeActivity('chat-gate:trace-group', 'msg-user-1', 'msg-reply-1', '#gate-lab', 'CHAT-GATE:test-group') }));
      return;
    }
    if (req.url?.startsWith('/api/v1/channels/gate-lab/messages')) {
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body);
        messages.push({
          id: 'msg-user-1',
          channelId: 'channel-1',
          senderId: 'human-1',
          senderType: 'human',
          sender: '@Human',
          content: parsed.content,
          createdAt: '2026-06-24T00:00:01.000Z',
        });
        messages.push({
          id: 'msg-reply-1',
          channelId: 'channel-1',
          senderId: 'agent-1',
          senderType: 'agent',
          sender: '@MiniMax Agent',
          content: 'ACK CHAT-GATE:test-group',
          createdAt: '2026-06-24T00:00:02.000Z',
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ created: true, traceId: parsed.traceId, message: messages[0] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ channelName: 'gate-lab', messages }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--mode', 'chat-reply-channel-group',
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--agent-id', 'agent-1',
      '--channel', 'gate-lab',
      '--expected-agent-ids', 'agent-1',
      '--responder-policy', 'one',
      '--trace-id', 'chat-gate:trace-group',
      '--marker', 'CHAT-GATE:test-group',
      '--expected-ack', 'ACK CHAT-GATE:test-group',
      '--reply-timeout-ms', '500',
      '--poll-interval-ms', '10',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'PASS chat-reply-channel-group 11/11');
    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.scenario, 'chat-reply-channel-group');
    assert.deepEqual(report.target.visibleAgentIds, ['agent-1', 'agent-2']);
    assert.deepEqual(report.target.expectedResponderAgentIds, ['agent-1']);
    assert.equal(report.audienceEvidence.repliesByAuthor['agent-1'], 1);
    assert.equal(
      server.requests.filter((request) => request.url === '/api/v1/channels/channel-1/members').length,
      1,
    );
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI runs DM chat reply mode with reply-safe target backfill', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-chat-dm-gate-cli-'));
  const resultFile = join(root, 'latest-chat-reply-dm-gate.json');
  const messages = [];

  const server = await startServer(async (req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Integration Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
          agentWorkspaces: [{
            id: 'workspace-1',
            agentId: 'agent-1',
            agentName: 'MiniMax Agent',
            status: 'running',
            runtime: 'claude_code',
            runtimeProvider: 'MiniMax',
            runtimeModel: 'MiniMax-M3',
            sessionId: 'session-1',
          }],
        }],
      }));
      return;
    }
    if (req.url === '/api/v1/dm' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        channel: {
          id: 'dm-1',
          name: 'dm:human-agent',
          type: 'dm',
          peer: { id: 'agent-1', kind: 'agent', displayName: 'MiniMax Agent' },
        },
      }));
      return;
    }
    if (req.url?.startsWith('/api/v1/activity')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ activity: runtimeActivity('chat-gate:trace-dm', 'msg-user-1', 'msg-reply-1', 'dm:@Human', 'CHAT-GATE:test-dm') }));
      return;
    }
    if (req.url?.startsWith('/api/v1/channels/dm%3Ahuman-agent/messages')) {
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body);
        messages.push({
          id: 'msg-user-1',
          channelId: 'dm-1',
          senderId: 'human-1',
          senderType: 'human',
          sender: '@Human',
          content: parsed.content,
          createdAt: '2026-06-24T00:00:01.000Z',
        });
        messages.push({
          id: 'msg-reply-1',
          channelId: 'dm-1',
          senderId: 'agent-1',
          senderType: 'agent',
          sender: '@MiniMax Agent',
          content: 'ACK CHAT-GATE:test-dm',
          createdAt: '2026-06-24T00:00:02.000Z',
        });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ created: true, traceId: parsed.traceId, message: messages[0] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ channelName: 'dm:human-agent', messages }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  try {
    const result = await runCli([
      '--mode', 'chat-reply-dm',
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--agent-id', 'agent-1',
      '--peer', 'MiniMax Agent',
      '--user-member-id', 'human-1',
      '--trace-id', 'chat-gate:trace-dm',
      '--marker', 'CHAT-GATE:test-dm',
      '--expected-ack', 'ACK CHAT-GATE:test-dm',
      '--reply-timeout-ms', '500',
      '--poll-interval-ms', '10',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'PASS chat-reply-dm 11/11');
    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.scenario, 'chat-reply-dm');
    assert.equal(report.target.dmId, 'dm-1');
    assert.equal(report.target.userMemberId, 'human-1');
    assert.equal(report.target.agentMemberId, 'agent-1');
    assert.equal(report.target.replyTarget, 'dm:@Human');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function runtimeActivity(traceId, userMessageId, replyMessageId, target, marker) {
  return [
    {
      id: `${traceId}-idle`,
      agentId: 'agent-1',
      type: 'runtime_idle',
      details: { traceId, messageId: userMessageId },
      timestamp: '2026-06-24T00:00:04.000Z',
    },
    {
      id: `${traceId}-output`,
      agentId: 'agent-1',
      type: 'runtime_output',
      details: {
        traceId,
        toolName: 'Bash',
        commandPreview: `slock message send --target ${target} --content "ACK ${marker}"`,
        replyMessageId,
      },
      timestamp: '2026-06-24T00:00:03.000Z',
    },
    {
      id: `${traceId}-thinking`,
      agentId: 'agent-1',
      type: 'runtime_thinking',
      details: { traceId, messageId: userMessageId },
      timestamp: '2026-06-24T00:00:02.000Z',
    },
    {
      id: `${traceId}-working`,
      agentId: 'agent-1',
      type: 'runtime_working',
      details: { traceId, messageId: userMessageId },
      timestamp: '2026-06-24T00:00:01.000Z',
    },
  ];
}

test('integration gate CLI runs V1 channel collaboration mode and writes a separate report', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-collab-v1-cli-'));
  const resultFile = join(root, 'latest-collab-channel-v1-gate.json');
  const server = await startCollabServer({ scenario: 'collab-channel-v1', marker: 'COLLAB-GATE:test-v1' });

  try {
    const result = await runCli([
      '--mode', 'collab-channel-v1',
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--channel', 'gate-lab',
      '--trace-id', 'collab:trace-v1',
      '--marker', 'COLLAB-GATE:test-v1',
      '--architect-agent-id', 'agent-architect',
      '--worker-agent-id', 'agent-worker',
      '--human-member-id', 'human-1',
      '--reply-timeout-ms', '500',
      '--poll-interval-ms', '10',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, `${result.stderr}${result.stdout}${readFileSync(resultFile, 'utf-8')}`);
    assert.equal(result.stdout.trim(), 'PASS collab-channel-v1 11/11');
    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.scenario, 'collab-channel-v1');
    assert.equal(report.ok, true);
    assert.match(report.messages.humanRequest.content, /\bproof=artifact-v1\b/);
    assert.match(report.messages.humanRequest.content, /\bchecksum=sha256:[a-f0-9]{12}\b/);
    assert.equal(report.messages.architectDelegation.id, 'msg-architect-delegation');
    assert.equal(report.messages.workerResult.id, 'msg-worker-result');
    assert.equal(report.artifactEvidence.artifactId, 'artifact-v1');
    assert.equal(report.roles.workerAgentId, 'agent-worker');
    assert.equal(
      server.requests.filter((request) => request.url === '/api/v1/channels/channel-1/members').length,
      1,
    );
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI runs V2 channel collaboration mode with reviewer validation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-collab-v2-cli-'));
  const resultFile = join(root, 'latest-collab-channel-v2-gate.json');
  const server = await startCollabServer({ scenario: 'collab-channel-v2', marker: 'COLLAB-GATE:test-v2' });

  try {
    const result = await runCli([
      '--mode', 'collab-channel-v2',
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--channel', 'gate-lab',
      '--channel-id', 'channel-1',
      '--trace-id', 'collab:trace-v2',
      '--marker', 'COLLAB-GATE:test-v2',
      '--architect-agent-id', 'agent-architect',
      '--worker-agent-id', 'agent-worker',
      '--reviewer-agent-id', 'agent-reviewer',
      '--human-member-id', 'human-1',
      '--reply-timeout-ms', '500',
      '--poll-interval-ms', '10',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'PASS collab-channel-v2 13/13');
    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.scenario, 'collab-channel-v2');
    assert.equal(report.reviewEvidence.accepted, true);
    assert.equal(report.messages.reviewerValidation.id, 'msg-reviewer-validation');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('integration gate CLI runs V3 channel collaboration mode with task workflow evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'smallkhoj-collab-v3-cli-'));
  const resultFile = join(root, 'latest-collab-channel-v3-gate.json');
  const server = await startCollabServer({ scenario: 'collab-channel-v3', marker: 'COLLAB-GATE:test-v3' });

  try {
    const result = await runCli([
      '--mode', 'collab-channel-v3',
      '--api-base', server.url,
      '--frontend-base', server.url,
      '--account-token', 'test-session',
      '--channel', 'gate-lab',
      '--channel-id', 'channel-1',
      '--trace-id', 'collab:trace-v3',
      '--marker', 'COLLAB-GATE:test-v3',
      '--architect-agent-id', 'agent-architect',
      '--worker-agent-id', 'agent-worker',
      '--human-member-id', 'human-1',
      '--reply-timeout-ms', '500',
      '--poll-interval-ms', '10',
      '--result-out', resultFile,
    ]);

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), 'PASS collab-channel-v3 15/15');
    const report = JSON.parse(readFileSync(resultFile, 'utf-8'));
    assert.equal(report.scenario, 'collab-channel-v3');
    assert.equal(report.taskEvidence.taskId, 'task-v3');
    assert.equal(report.taskEvidence.status, 'in_review');
    assert.equal(report.taskEvidence.sourceChannelId, 'channel-1');
    assert.equal(report.taskEvidence.sourceMessageId, 'msg-human-request');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

async function startCollabServer({ scenario, marker }) {
  const messages = [];
  const artifactId = scenario === 'collab-channel-v1' ? 'artifact-v1' : scenario === 'collab-channel-v2' ? 'artifact-v2' : 'artifact-v3';
  return startServer(async (req, res) => {
    if (req.url === '/control/integration') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Integration Gate</h1>');
      return;
    }
    if (req.url === '/api/v1/computers') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        computers: [{
          id: 'computer-1',
          status: 'online',
          detectedRuntimes: [{ type: 'claude_code', runtimeProvider: 'MiniMax', model: 'MiniMax-M3' }],
          agentWorkspaces: [
            runtimeWorkspace('agent-architect', 'Gate Architect'),
            runtimeWorkspace('agent-worker', 'RunCode Worker'),
            runtimeWorkspace('agent-reviewer', 'Gate Reviewer'),
          ],
        }],
      }));
      return;
    }
    if (req.url === '/api/v1/channels/channel-1/members') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        members: [
          { id: 'human-1', kind: 'human', displayName: 'Human' },
          { id: 'agent-architect', kind: 'agent', displayName: 'Gate Architect' },
          { id: 'agent-worker', kind: 'agent', displayName: 'RunCode Worker' },
          { id: 'agent-reviewer', kind: 'agent', displayName: 'Gate Reviewer' },
        ],
      }));
      return;
    }
    if (req.url?.startsWith('/api/v1/activity')) {
      const url = new URL(req.url, serverUrl(req));
      const agentId = url.searchParams.get('agentId');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ activity: collabActivity(agentId, marker, artifactId) }));
      return;
    }
    if (req.url?.startsWith('/api/v1/tasks')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        tasks: scenario === 'collab-channel-v3' ? [{
          id: 'task-v3',
          status: 'in_review',
          assigneeId: 'agent-worker',
          channelId: 'channel-1',
          messageId: 'msg-human-request',
          sourceChannelId: 'channel-1',
          sourceMessageId: 'msg-human-request',
          data: { reviewVisible: true },
        }] : [],
      }));
      return;
    }
    if (req.url?.startsWith('/api/v1/channels/gate-lab/messages')) {
      if (req.method === 'POST') {
        let body = '';
        for await (const chunk of req) body += chunk;
        const parsed = JSON.parse(body);
        messages.length = 0;
        messages.push(...collabMessages({ scenario, marker, artifactId, humanContent: parsed.content }));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ created: true, traceId: parsed.traceId, message: messages[0] }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ channelName: 'gate-lab', messages }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
}

function runtimeWorkspace(agentId, agentName) {
  return {
    id: `${agentId}-workspace`,
    agentId,
    agentName,
    status: 'running',
    runtime: 'claude_code',
    runtimeProvider: 'MiniMax',
    runtimeModel: 'MiniMax-M3',
    sessionId: `${agentId}-session`,
  };
}

function collabMessages({ scenario, marker, artifactId, humanContent }) {
  const messages = [
    collabMessage('msg-human-request', 'human-1', 'human', humanContent, '2026-06-24T00:00:01.000Z'),
    collabMessage('msg-architect-delegation', 'agent-architect', 'agent', `[COLLAB:${marker}:ARCHITECT_DELEGATION] @worker reply with [COLLAB:${marker}:WORKER_RESULT] proof=${artifactId}`, '2026-06-24T00:00:05.000Z'),
    collabMessage('msg-worker-result', 'agent-worker', 'agent', `[COLLAB:${marker}:WORKER_RESULT] proof=${artifactId} checksum=sha256:abc`, '2026-06-24T00:00:12.000Z'),
  ];
  if (scenario === 'collab-channel-v2') {
    messages.push(collabMessage('msg-reviewer-validation', 'agent-reviewer', 'agent', `[COLLAB:${marker}:REVIEWER_ACCEPTED] ${artifactId} checksum=sha256:abc accepted`, '2026-06-24T00:00:15.000Z'));
  }
  const finalSuffix = scenario === 'collab-channel-v2'
    ? `reviewer accepted ${artifactId} checksum=sha256:abc`
    : scenario === 'collab-channel-v3'
      ? `task-v3 in_review ${artifactId} checksum=sha256:abc`
      : `worker proof ${artifactId} checksum=sha256:abc`;
  messages.push(collabMessage('msg-architect-final', 'agent-architect', 'agent', `[COLLAB:${marker}:ARCHITECT_FINAL] ${finalSuffix}`, '2026-06-24T00:00:18.000Z'));
  return messages;
}

function collabMessage(id, senderId, senderType, content, createdAt) {
  return {
    id,
    channelId: 'channel-1',
    senderId,
    senderType,
    sender: senderType === 'human' ? '@Human' : `@${senderId}`,
    content,
    createdAt,
  };
}

function collabActivity(agentId, marker, artifactId) {
  if (agentId === 'agent-worker') {
    return [{
      id: 'worker-message-sent',
      agentId,
      type: 'message_sent',
      details: {
        traceId: `collab:${marker}`,
        target: '#gate-lab',
        content: `[COLLAB:${marker}:WORKER_RESULT] proof=${artifactId} checksum=sha256:abc`,
        messageId: 'msg-worker-result',
        marker,
      },
      timestamp: '2026-06-24T00:00:10.000Z',
    }];
  }
  return [{
    id: `${agentId}-working`,
    agentId,
    type: 'runtime_working',
    details: { marker },
    timestamp: '2026-06-24T00:00:02.000Z',
  }];
}

function serverUrl(req) {
  return `http://${req.headers.host ?? '127.0.0.1'}`;
}
