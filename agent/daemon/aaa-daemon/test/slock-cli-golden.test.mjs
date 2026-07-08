/**
 * Golden tests for the MVP CLI slice.
 *
 * Covers 4 categories per @codex-m-krill's contract:
 *   1. Canonical success (text mode)
 *   2. Structured error (three-part Error/Code/Next action)
 *   3. Write-gate denial (no CLI self-enable)
 *   4. Credential redaction
 *
 * Each category tests both --format text (default) and --format json
 * to verify the format switch doesn't break proxy request mapping.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ req, body });
      handler(req, res, body);
    });
  });
  return new Promise((resolveServer) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveServer({
        url: `http://127.0.0.1:${address.port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function runCli(args, env, input = '') {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [resolve('dist/slock-cli.js'), ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolveRun({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

function baseEnv(root, url) {
  const tokenFile = join(root, 'token.txt');
  writeFileSync(tokenFile, 'sap_test_token', 'utf-8');
  return {
    SLOCK_AGENT_PROXY_URL: url,
    SLOCK_AGENT_PROXY_TOKEN_FILE: tokenFile,
    SLOCK_AGENT_ID: 'agent-test',
  };
}

// ===========================================================================
// 1. CANONICAL SUCCESS (text mode)
// ===========================================================================

test('golden: message check canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      messages: [
        { target: '#general', msg: 'abc12345', time: '2026-07-08T15:00:00Z', type: 'human', sender: '@zy-ean', content: 'hello' },
        { target: '#general', msg: 'def67890', time: '2026-07-08T15:00:01Z', type: 'agent', sender: '@guanguan', content: 'hi there' },
      ],
    }));
  });
  try {
    const result = await runCli(['message', 'check'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    // Canonical text: [target=... msg=... time=... type=...] @sender: content
    assert.match(result.stdout, /\[target=#general msg=abc12345 time=2026-07-08T15:00:00Z type=human\] @zy-ean: hello/);
    assert.match(result.stdout, /\[target=#general msg=def67890 time=2026-07-08T15:00:01Z type=agent\] @guanguan: hi there/);
    assert.match(result.stdout, /No more new messages\./);
    // Must NOT contain raw JSON
    assert.doesNotMatch(result.stdout, /"messages"/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: message check empty canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ messages: [] }));
  });
  try {
    const result = await runCli(['message', 'check'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.equal(result.stdout.trim(), 'No new messages.');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: message send canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ state: 'sent', messageSeq: 42 }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['message', 'send', '--target', '#general', 'hello world'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Message sent/);
    assert.match(result.stdout, /seq=42/);
    // Must NOT contain raw JSON
    assert.doesNotMatch(result.stdout, /"state"/);
    // Verify proxy received correct request
    assert.equal(server.requests[0].req.method, 'POST');
    assert.deepEqual(JSON.parse(server.requests[0].body), { target: '#general', content: 'hello world' });
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: message check --format json preserves raw passthrough', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ messages: [{ target: '#general', content: 'hello' }] }));
  });
  try {
    const result = await runCli(['message', 'check', '--format', 'json'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    // With --format json, output should be raw JSON passthrough
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed.messages));
    assert.equal(parsed.messages[0].content, 'hello');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 2. STRUCTURED ERROR (three-part Error/Code/Next action)
// ===========================================================================

test('golden: missing --target structured error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(['message', 'send', 'hello content'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    // Three-part error format
    assert.match(result.stderr, /^Error: /m);
    assert.match(result.stderr, /Code: /);
    // Must NOT be JSON
    assert.doesNotMatch(result.stderr, /^\{/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: missing proxy config structured error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const env = baseEnv(root, 'http://127.0.0.1:1');
  delete env.SLOCK_AGENT_PROXY_URL;
  try {
    const result = await runCli(['message', 'check'], env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^Error: Missing SLOCK_AGENT_PROXY_URL/m);
    assert.match(result.stderr, /Code: MISSING_SLOCK_AGENT_PROXY_URL/);
    assert.match(result.stderr, /Next action:/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 3. WRITE-GATE DENIAL (no CLI self-enable)
// ===========================================================================

test('golden: write gate denial without --allow-writes flag', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    // No SLOCK_ALLOW_WRITES set
    const result = await runCli(['message', 'send', '--target', '#general', 'hello'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Error:.*SLOCK_ALLOW_WRITES/s);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.match(result.stderr, /Next action:.*daemon or operator/s);
    // No request should have been sent
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: write gate denial with --format json still uses canonical error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(['message', 'send', '--target', '#general', 'hello', '--format', 'json'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    // Errors are always canonical, regardless of --format
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.doesNotMatch(result.stderr, /^\{/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 4. CREDENTIAL REDACTION
// ===========================================================================

test('golden: proxy error with credential-shaped strings is redacted', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  // Server returns an error containing credential-shaped strings
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      detail: 'Invalid token sap_SECRET_TOKEN_123 in Authorization header Bearer sap_SECRET_TOKEN_123',
    }));
  });
  try {
    const result = await runCli(['message', 'check'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    // The credential-shaped strings must NOT appear in the output
    assert.doesNotMatch(result.stderr, /sap_SECRET_TOKEN_123/);
    assert.doesNotMatch(result.stderr, /Bearer sap_/);
    // Should be redacted
    assert.match(result.stderr, /sap_<redacted>|<redacted>/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: token file path is not leaked in errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const env = {
    SLOCK_AGENT_PROXY_URL: 'http://127.0.0.1:1',
    SLOCK_AGENT_PROXY_TOKEN_FILE: join(root, 'missing_token.txt'),
    SLOCK_AGENT_ID: 'agent-test',
  };
  try {
    const result = await runCli(['message', 'check'], env);
    assert.equal(result.code, 1);
    // The full file path should not be in the error output
    assert.match(result.stderr, /Code: TOKEN_READ_FAILED/);
    // The path itself should not appear
    assert.doesNotMatch(result.stderr, /missing_token\.txt/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 5. --format json does NOT pollute existing --json body parameter
// ===========================================================================

test('golden: --json body parameter still works for non-MVP commands (task update)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ updated: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    // task update uses --json for body data; this should NOT be confused with --format
    const result = await runCli(
      ['task', 'update', '--id', 'task-1', '--json', '{"priority":"high"}'],
      env,
    );
    assert.equal(result.code, 0, result.stderr);
    // Verify the --json was sent as body data, not as output format
    const body = JSON.parse(server.requests[0].body);
    assert.deepEqual(body.data, { priority: 'high' });
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 6. MVP command: memory read (smallkhoj extension)
// ===========================================================================

test('golden: memory read canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      content: '# Memory\n\nImportant notes here.',
      sha: 'abc123',
      path: 'notes.md',
    }));
  });
  try {
    const result = await runCli(
      ['memory', 'read', '--scope', 'channel', '--id', 'ch-1', '--path', 'notes.md'],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /# Memory/);
    assert.match(result.stdout, /Important notes here/);
    assert.match(result.stdout, /sha: abc123/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 7. Fix verification tests (P1/P2 from @codex-m-krill review)
// ===========================================================================

test('golden: HTTP 401 produces three-part structured error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Unauthorized' }));
  });
  try {
    const result = await runCli(['message', 'check'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^Error: /m);
    assert.match(result.stderr, /Code: HTTP_401/);
    assert.match(result.stderr, /Next action:.*proxy token/s);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: memory read --scope bogus is rejected locally', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(
      ['memory', 'read', '--scope', 'bogus', '--id', 'x', '--path', 'test.md'],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: INVALID_SCOPE/);
    // Must NOT hit the server
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: memory read --path ../secret is rejected locally', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(
      ['memory', 'read', '--scope', 'agent', '--id', 'x', '--path', '../secret'],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: INVALID_PATH/);
    // Must NOT hit the server
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: missing --scope is NOT MISSING_TARGET', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    // --scope is missing; commander should report MISSING_SCOPE not MISSING_TARGET
    const result = await runCli(
      ['memory', 'read', '--id', 'x', '--path', 'test.md'],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: MISSING_SCOPE/);
    assert.doesNotMatch(result.stderr, /MISSING_TARGET/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: --format json before command enters MVP path', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ messages: [] }));
  });
  try {
    // --format before command should still match MVP path
    const result = await runCli(['--format', 'json', 'message', 'check'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    // Should output raw JSON, not canonical text
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.messages !== undefined || parsed.events !== undefined);
    // Must NOT output canonical text
    assert.doesNotMatch(result.stdout, /No new messages/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 8. Batch 2 canonical text golden tests
// ===========================================================================

test('golden: server info canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'srv-1', name: 'My Server',
      channels: [{ name: 'general', joined: true, private: false, description: 'General chat' }],
      agents: [{ name: 'bot', status: 'online', description: 'Helper' }],
      humans: [{ name: 'alice', role: 'owner' }],
    }));
  });
  try {
    const result = await runCli(['server', 'info'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Server: My Server/);
    assert.match(result.stdout, /#general \[public, joined\]/);
    assert.match(result.stdout, /General chat/);
    assert.match(result.stdout, /@bot \(online\)/);
    assert.match(result.stdout, /@alice \[owner\]/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: message search canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      results: [
        { target: '#general', msg: 'abc12345', time: '2026-07-08T10:00:00Z', sender: '@alice', content: 'hello world' },
      ],
    }));
  });
  try {
    const result = await runCli(['message', 'search', '--query', 'hello'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /\[target=#general msg=abc12345 time=2026-07-08T10:00:00Z\] @alice: hello world/);
    assert.doesNotMatch(result.stdout, /"results"/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: message resolve canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ target: '#general:abc12345', channel: '#general', threadId: 'abc12345' }));
  });
  try {
    const result = await runCli(['message', 'resolve', '--message-id', 'abc12345'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Target: #general:abc12345/);
    assert.match(result.stdout, /Channel: #general/);
    assert.match(result.stdout, /Thread ID: abc12345/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: channel members canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      members: [
        { name: 'alice', role: 'owner' },
        { name: 'bot', type: 'agent', status: 'online' },
      ],
    }));
  });
  try {
    const result = await runCli(['channel', 'members', '--channel', '#general'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /@alice \[owner\]/);
    assert.match(result.stdout, /@bot.*\(online\)/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: thread read canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      messages: [
        { target: '#general:abc12345', msg: 'def67890', time: '2026-07-08T11:00:00Z', sender: '@bob', content: 'reply' },
      ],
    }));
  });
  try {
    const result = await runCli(['thread', 'read', '--thread-id', 'abc12345'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /\[target=#general:abc12345 msg=def67890 time=2026-07-08T11:00:00Z\] @bob: reply/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: message react --remove outputs removed not added', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ reacted: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['message', 'react', '--message-id', 'msg-1', '--reaction', '+1', '--remove'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Reaction removed\./);
    assert.doesNotMatch(result.stdout, /Reaction added/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: channel join canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ joined: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['channel', 'join', '--target', '#general'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Joined channel\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: write-gate denial for message react', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(['message', 'react', '--message-id', 'msg-1', '--reaction', '+1'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: legacy short aliases work for migrated commands', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ results: [{ target: '#general', msg: 'x', time: 't', sender: '@a', content: 'hi' }] }));
  });
  try {
    // -q alias for --query, -c alias for --channel
    const result = await runCli(['message', 'search', '-q', 'hello', '-c', '#general', '--format', 'json'], baseEnv(root, server.url));
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.results);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: channel members --target alias works', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ members: [{ name: 'alice', role: 'owner' }] }));
  });
  try {
    const result = await runCli(['channel', 'members', '--target', '#general', '--format', 'json'], baseEnv(root, server.url));
    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.members);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: channel members -c alias works', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ members: [] }));
  });
  try {
    const result = await runCli(['channel', 'members', '-c', '#general', '--format', 'json'], baseEnv(root, server.url));
    assert.equal(result.code, 0, result.stderr);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: channel join -c alias works', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ joined: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['channel', 'join', '-c', '#general', '--format', 'json'], env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).joined, true);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: channel leave -c alias works', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ left: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['channel', 'leave', '-c', '#general', '--format', 'json'], env);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).left, true);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 9. Batch 3: Task domain canonical text golden tests
// ===========================================================================

test('golden: task list canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ tasks: [
      { number: 1, title: 'Fix bug', status: 'in_progress', assignee: '@alice' },
      { number: 2, title: 'Write docs', status: 'todo' },
    ]}));
  });
  try {
    const result = await runCli(['task', 'list'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /#1 \[in_progress\] @alice — Fix bug/);
    assert.match(result.stdout, /#2 \[todo\] — Write docs/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task create canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ task: { title: 'New task' } }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['task', 'create', '--channel', '#general', '--title', 'New task'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Task created\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task claim canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ claimed: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['task', 'claim', '--id', 'task-1'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Task claimed\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task update canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ updated: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['task', 'update', '--id', 'task-1', '--status', 'done'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Task updated\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task write-gate denial', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(['task', 'claim', '--id', 'task-1'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task claim by channel+number canonical text', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ claimed: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['task', 'claim', '--channel', '#general', '--number', '3'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Task claimed\./);
    // Verify proxy received correct request
    assert.equal(server.requests[0].req.method, 'POST');
    assert.equal(server.requests[0].req.url, '/internal/agent/agent-test/tasks/claim');
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 10. Batch 3 fix: task unclaim/summary/promote golden + INVALID_JSON
// ===========================================================================

test('golden: task unclaim canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ unclaimed: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['task', 'unclaim', '--id', 'task-1'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Task unclaimed\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task summary canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(
      ['task', 'summary', '--id', 'task-1', '--summary', 'Work completed successfully.'],
      env,
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Task summary written\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task promote canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ promoted: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(
      ['task', 'promote', '--id', 'task-1', '--source-path', 'progress.md', '--channel-path', 'shared.md'],
      env,
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Task memory promoted\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task summary write-gate denial (task:memory scope)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(
      ['task', 'summary', '--id', 'task-1', '--summary', 'test'],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: task update --json invalid returns INVALID_JSON not CLI_FAILED', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(
      ['task', 'update', '--id', 'task-1', '--json', '{invalid'],
      env,
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: INVALID_JSON/);
    assert.doesNotMatch(result.stderr, /CLI_FAILED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 11. Batch 4: Profile domain canonical text golden tests
// ===========================================================================

test('golden: profile show canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      profile: { handle: '@alice', displayName: 'Alice', role: 'owner',
        description: 'Team lead', status: 'active' },
    }));
  });
  try {
    const result = await runCli(['profile', 'show', '--handle', '@alice'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Name: Alice/);
    assert.match(result.stdout, /Handle: @alice/);
    assert.match(result.stdout, /Role: owner/);
    assert.match(result.stdout, /Status: active/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: profile get alias works same as show', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ profile: { handle: '@bob', displayName: 'Bob' } }));
  });
  try {
    const result = await runCli(['profile', 'get'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Name: Bob/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: profile update canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ profile: { displayName: 'New Name' } }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['profile', 'update', '--display-name', 'New Name'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Profile updated\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: profile update write-gate denial', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(['profile', 'update', '--display-name', 'X'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: profile update --json invalid returns INVALID_JSON', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['profile', 'update', '--json', '{invalid'], env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: INVALID_JSON/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: profile update no fields returns MISSING_UPDATE_FIELDS', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['profile', 'update'], env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: MISSING_UPDATE_FIELDS/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: profile update --avatar-file outputs Profile updated (text mode)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const avatarFile = join(root, 'avatar.png');
  // Minimal valid PNG header
  writeFileSync(avatarFile, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ avatar: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['profile', 'update', '--avatar-file', avatarFile], env);
    assert.equal(result.code, 0, result.stderr);
    // Text mode should output canonical 'Profile updated.' not raw JSON
    assert.match(result.stdout, /Profile updated\./);
    assert.doesNotMatch(result.stdout, /"avatar"/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 12. Batch 5: Reminder + Integration domain golden tests
// ===========================================================================

test('golden: reminder list canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ reminders: [
      { title: 'Standup', fireAt: '2026-07-09T09:00:00Z', repeat: { cadence: 'daily' }, channel: '#general' },
      { title: 'Review', status: 'done' },
    ]}));
  });
  try {
    const result = await runCli(['reminder', 'list'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Standup @ 2026-07-09T09:00:00Z \(daily\) #general/);
    assert.match(result.stdout, /Review.*\[done\]/);
    // Must NOT have ## (double hash)
    assert.doesNotMatch(result.stdout, /##/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: reminder schedule canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ reminderId: 'rem-1' }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['reminder', 'schedule', '--title', 'Test', '--delay-seconds', '300'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Reminder scheduled\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: reminder cancel canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['reminder', 'cancel', '--id', 'rem-1'], env);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Reminder canceled\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: reminder write-gate denial', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(['reminder', 'schedule', '--title', 'Test', '--delay-seconds', '300'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: integration list canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ integrations: [
      { service: 'github', loggedIn: true },
      { service: 'slack', status: 'disconnected' },
    ]}));
  });
  try {
    const result = await runCli(['integration', 'list'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /github.*logged in/);
    assert.match(result.stdout, /slack.*disconnected/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: integration login write-gate denial', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(['integration', 'login', '--service', 'github'], baseEnv(root, server.url));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: reminder schedule invalid --delay-seconds returns INVALID_NUMBER', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(['reminder', 'schedule', '--title', 'Bad', '--delay-seconds', 'abc'], env);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: INVALID_NUMBER/);
    // Must NOT hit server
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 13. Batch 6: Memory write/propose/delete + thread summary golden tests
// ===========================================================================

test('golden: memory write canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sha: 'newsha123' }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(
      ['memory', 'write', '--scope', 'agent', '--id', 'me', '--path', 'notes.md', '--content', 'test content'],
      env,
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Memory written\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: memory write write-gate denial', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(
      ['memory', 'write', '--scope', 'agent', '--id', 'me', '--path', 'notes.md', '--content', 'test'],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: memory delete canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(
      ['memory', 'delete', '--scope', 'channel', '--id', 'ch-1', '--path', 'old.md'],
      env,
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Memory deleted\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: thread summary canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ updated: true }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(
      ['thread', 'summary', '--thread-id', 't-1', '--summary', 'Discussion resolved.'],
      env,
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Thread summary written\./);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: memory write --scope bogus rejected locally', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(
      ['memory', 'write', '--scope', 'bogus', '--id', 'x', '--path', 't.md', '--content', 'x'],
      env,
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: INVALID_SCOPE/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: memory search real backend shape (entries + contentText)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      scope: 'agent',
      entries: [
        { path: 'notes.md', contentText: 'Important notes about the project' },
        { path: 'todo.md', contentText: 'Remember to fix the bug' },
      ],
    }));
  });
  try {
    const result = await runCli(
      ['memory', 'search', '--scope', 'agent', '--id', 'me', '--query', 'notes'],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /notes\.md: Important notes/);
    assert.match(result.stdout, /todo\.md: Remember to fix/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: memory list-proposals alias works', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ proposals: [{ id: 'p1', path: 'notes.md', status: 'pending' }] }));
  });
  try {
    const result = await runCli(
      ['memory', 'list-proposals', '--scope', 'channel', '--id', 'ch-1'],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 0);
    assert.match(result.stdout, /p1 notes\.md \[pending\]/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// ===========================================================================
// 14. Batch 7: Attachment domain golden tests
// ===========================================================================

test('golden: attachment view canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: 'att-1', filename: 'report.pdf', mimeType: 'application/pdf', size: 1024 }));
  });
  try {
    const result = await runCli(['attachment', 'view', '--id', 'att-1'], baseEnv(root, server.url));
    assert.equal(result.code, 0);
    assert.match(result.stdout, /ID: att-1/);
    assert.match(result.stdout, /Filename: report\.pdf/);
    assert.match(result.stdout, /Type: application\/pdf/);
    assert.match(result.stdout, /Size: 1024/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: attachment upload canonical text output', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const uploadFile = join(root, 'test.txt');
  writeFileSync(uploadFile, 'test content', 'utf-8');
  const server = await startServer((req, res) => {
    const url = new URL(req.url, 'http://test');
    if (url.pathname.includes('resolve-channel')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ channelId: 'chan-1' }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ attachment: { id: 'att-new' } }));
  });
  try {
    const env = { ...baseEnv(root, server.url), SLOCK_ALLOW_WRITES: '1' };
    const result = await runCli(
      ['attachment', 'upload', '--channel', '#general', '--file', uploadFile],
      env,
    );
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Attachment uploaded.*att-new/);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('golden: attachment upload write-gate denial', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-golden-'));
  const uploadFile = join(root, 'test.txt');
  writeFileSync(uploadFile, 'test content', 'utf-8');
  const server = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await runCli(
      ['attachment', 'upload', '--channel', '#general', '--file', uploadFile],
      baseEnv(root, server.url),
    );
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Code: WRITES_NOT_ALLOWED/);
    assert.equal(server.requests.length, 0);
  } finally {
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
