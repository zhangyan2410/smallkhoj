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
