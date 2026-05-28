import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { importSlockRuntime } from '../dist/runtime/import-slock-runtime.js';
import { runReadOnlySmoke } from '../dist/cmd/smoke.js';

function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf-8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requests.push({ req, body });
      handler(req, res, body);
    });
  });

  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveServer({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise(resolveClose => server.close(resolveClose)),
      });
    });
  });
}

function writeRuntimeConfig(runtimeDir, serverUrl) {
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(join(runtimeDir, 'claude-mcp-config.json'), JSON.stringify({
    mcpServers: {
      chat: {
        command: 'node',
        args: [
          'chat-bridge.js',
          '--agent-id', 'agent-real',
          '--server-url', serverUrl,
          '--auth-token', 'sk_machine_real',
          '--runtime', 'claude',
          '--runtime-actions-only',
        ],
      },
    },
  }), 'utf-8');
}

function writeManagedProxyWrapper(runtimeDir, proxyUrl, tokenFile) {
  writeFileSync(join(runtimeDir, 'slock.cmd'), [
    '@echo off',
    `set "SLOCK_AGENT_PROXY_URL=${proxyUrl}"`,
    `set "SLOCK_AGENT_PROXY_TOKEN_FILE=${tokenFile}"`,
    'set "SLOCK_AGENT_ACTIVE_CAPABILITIES=send,read,mentions,tasks,reactions,server,channels"',
    '"node" "slock-cli.js" %*',
    '',
  ].join('\r\n'), 'utf-8');
}

test('importSlockRuntime reads agent/server/token from claude mcp config', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-import-runtime-'));
  try {
    writeRuntimeConfig(root, 'https://api.slock.ai');
    const imported = importSlockRuntime(root);
    assert.equal(imported.credential.agentId, 'agent-real');
    assert.equal(imported.credential.serverUrl, 'https://api.slock.ai');
    assert.equal(imported.credential.token, 'sk_machine_real');
    assert.equal(imported.source, 'mcp-config');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('importSlockRuntime prefers managed local proxy credentials when wrapper exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-import-managed-runtime-'));
  try {
    writeRuntimeConfig(root, 'https://api.slock.ai');
    const tokenDir = join(root, 'tokens');
    mkdirSync(tokenDir, { recursive: true });
    const tokenFile = join(tokenDir, 'pid-test.token');
    writeFileSync(tokenFile, 'sap_original_proxy_token', 'utf-8');
    writeManagedProxyWrapper(root, 'http://127.0.0.1:50001', tokenFile);

    const imported = importSlockRuntime(root);
    assert.equal(imported.source, 'managed-proxy');
    assert.equal(imported.credential.agentId, 'agent-real');
    assert.equal(imported.credential.serverUrl, 'http://127.0.0.1:50001');
    assert.equal(imported.credential.token, 'sap_original_proxy_token');
    assert.equal(imported.mcpCredential.serverUrl, 'https://api.slock.ai');
    assert.equal(imported.mcpCredential.token, 'sk_machine_real');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('read-only smoke imports runtime config and calls only server info', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-smoke-test-'));
  const upstream = await startServer((req, res) => {
    const url = new URL(req.url, 'http://upstream.test');
    assert.equal(url.pathname, '/internal/agent-api/server');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'server-real',
      name: 'Real Server',
      channels: [{ name: 'general' }, { name: 'dev' }],
      agents: [{ name: 'agent-real' }],
      humans: [{ name: 'human-real' }],
    }));
  });

  try {
    const runtimeDir = join(root, '.slock');
    writeRuntimeConfig(runtimeDir, upstream.url);
    const code = await runReadOnlySmoke({
      importSlockRuntime: runtimeDir,
      workspace: join(root, 'workspace'),
    });

    assert.equal(code, 0);
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].req.method, 'GET');
    assert.equal(upstream.requests[0].req.url, '/internal/agent-api/server');
    assert.equal(upstream.requests[0].req.headers.authorization, 'Bearer sk_machine_real');
    assert.equal(upstream.requests[0].req.headers['x-agent-id'], 'agent-real');
  } finally {
    await upstream.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test('read-only smoke can chain through imported managed Slock proxy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-smoke-managed-test-'));
  const upstream = await startServer((req, res) => {
    const url = new URL(req.url, 'http://upstream.test');
    assert.equal(url.pathname, '/internal/agent-api/server');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'server-real',
      name: 'Real Server',
      channels: [{ name: 'general' }],
      agents: [{ name: 'agent-real' }],
      humans: [{ name: 'human-real' }],
    }));
  });

  try {
    const runtimeDir = join(root, '.slock');
    writeRuntimeConfig(runtimeDir, 'https://api.slock.ai');
    const tokenDir = join(root, 'tokens');
    mkdirSync(tokenDir, { recursive: true });
    const tokenFile = join(tokenDir, 'pid-test.token');
    writeFileSync(tokenFile, 'sap_original_proxy_token', 'utf-8');
    writeManagedProxyWrapper(runtimeDir, upstream.url, tokenFile);

    const code = await runReadOnlySmoke({
      importSlockRuntime: runtimeDir,
      workspace: join(root, 'workspace'),
    });

    assert.equal(code, 0);
    assert.equal(upstream.requests.length, 1);
    assert.equal(upstream.requests[0].req.method, 'GET');
    assert.equal(upstream.requests[0].req.url, '/internal/agent-api/server');
    assert.equal(upstream.requests[0].req.headers.authorization, 'Bearer sap_original_proxy_token');
    assert.equal(upstream.requests[0].req.headers['x-agent-id'], 'agent-real');
  } finally {
    await upstream.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
