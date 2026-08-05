import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { writeSlockWrapper } from '../dist/runtime/slock-wrapper.js';
import {
  OpenCodeServerRuntimeDriver,
  buildOpenCodeRuntimeEnv,
  buildOpenCodeSlockPrompt,
  parseOpenCodeModel,
  resolveOpenCodeServeLaunchCommand,
} from '../dist/runtime/opencode-server-runtime.js';

function waitFor(predicate, timeoutMs = 5_000) {
  const started = Date.now();
  return new Promise((resolveWait, rejectWait) => {
    const tick = () => {
      if (predicate()) {
        resolveWait(undefined);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        rejectWait(new Error('Timed out waiting for condition'));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

function fakeOpenCodeServeEval(marker) {
  return `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const marker = ${JSON.stringify(marker)};
const password = process.env.OPENCODE_SERVER_PASSWORD || '';
let nextSession = 1;
const clients = new Set();

function record(patch) {
  const current = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')) : { sessions: [], messages: [], permissionReplies: [] };
  if (patch.sessions) current.sessions.push(...patch.sessions);
  if (patch.messages) current.messages.push(...patch.messages);
  if (patch.permissionReplies) current.permissionReplies.push(...patch.permissionReplies);
  writeFileSync(marker, JSON.stringify(current));
}

function authorized(req) {
  const header = req.headers.authorization || '';
  return header === 'Basic ' + Buffer.from('opencode:' + password).toString('base64');
}

function sendEvent(type, properties = {}) {
  const payload = 'data: ' + JSON.stringify({ id: 'evt_' + Date.now(), type, properties }) + '\\n\\n';
  for (const res of clients) res.write(payload);
}

const server = http.createServer((req, res) => {
  if (!authorized(req)) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ _tag: 'UnauthorizedError', message: 'unauthorized' }));
    return;
  }
  if (req.url === '/event') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    clients.add(res);
    res.write('data: ' + JSON.stringify({ type: 'server.connected', properties: {} }) + '\\n\\n');
    req.on('close', () => clients.delete(res));
    return;
  }
  if (req.url === '/global/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ healthy: true, version: 'fake' }));
    return;
  }
  let body = '';
  req.setEncoding('utf8');
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/session') {
      const input = body ? JSON.parse(body) : {};
      const id = 'ses_fake_' + nextSession++;
      record({ sessions: [{ id, input }] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id }));
      return;
    }
    const messageMatch = req.url.match(/^\\/session\\/([^/]+)\\/message$/);
    if (req.method === 'POST' && messageMatch) {
      const sessionID = decodeURIComponent(messageMatch[1]);
      const input = body ? JSON.parse(body) : {};
      record({ messages: [{ sessionID, input }] });
      const userMessageID = 'msg_user_1';
      const assistantMessageID = 'msg_assistant_1';
      sendEvent('message.part.updated', { sessionID, part: { id: 'part_user_1', messageID: userMessageID, type: 'text', text: input.parts?.[0]?.text || '' } });
      sendEvent('message.updated', { sessionID, info: { id: userMessageID, sessionID, role: 'user' } });
      sendEvent('message.part.updated', { sessionID, part: { id: 'part_reasoning_1', messageID: assistantMessageID, type: 'reasoning', text: 'checking the repository' } });
      sendEvent('message.updated', { sessionID, info: { id: assistantMessageID, sessionID, role: 'assistant' } });
      sendEvent('message.part.delta', { sessionID, messageID: assistantMessageID, partID: 'part_text_1', field: 'text', delta: 'hello from fake opencode' });
      sendEvent('message.part.updated', { sessionID, part: { type: 'tool', id: 'tool_1', messageID: assistantMessageID, callID: 'tool_1', tool: 'bash', state: { status: 'pending' } } });
      sendEvent('message.part.updated', { sessionID, part: { type: 'tool', id: 'tool_1', messageID: assistantMessageID, callID: 'tool_1', tool: 'bash', state: { status: 'running', input: { command: input.parts?.[0]?.text || '' } } } });
      sendEvent('permission.asked', {
        id: 'per_fake_1',
        sessionID,
        permission: 'bash',
        patterns: [input.parts?.[0]?.text || 'not-wrapper'],
        metadata: { command: input.parts?.[0]?.text || '' },
        always: [],
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        info: { id: assistantMessageID, role: 'assistant', tokens: { input: 10, output: 3, total: 13 }, cost: 0.01 },
        parts: [{ type: 'text', text: 'done' }]
      }));
      setTimeout(() => {
        sendEvent('message.part.updated', { sessionID, part: { type: 'tool', id: 'tool_1', messageID: assistantMessageID, callID: 'tool_1', tool: 'bash', state: { status: 'completed', output: 'ok' } } });
        sendEvent('message.part.delta', { sessionID, messageID: assistantMessageID, partID: 'part_text_2', field: 'text', delta: 'after the tool' });
      }, 20);
      return;
    }
    const permissionMatch = req.url.match(/^\\/permission\\/([^/]+)\\/reply$/);
    if (req.method === 'POST' && permissionMatch) {
      record({ permissionReplies: [{ id: decodeURIComponent(permissionMatch[1]), input: body ? JSON.parse(body) : {} }] });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(true));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
});

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  console.log('opencode server listening on http://127.0.0.1:' + address.port);
});
`;
}

function makeDriver(root, marker, extra = {}) {
  const workspacePath = join(root, 'workspace');
  mkdirSync(workspacePath, { recursive: true });
  const credential = {
    serverUrl: 'http://127.0.0.1:9',
    token: 'fake_machine_test',
    agentId: 'agent-opencode',
  };
  const wrapper = writeSlockWrapper({
    workspacePath,
    proxyUrl: 'http://127.0.0.1:9',
    proxyToken: 'proxy-token',
    credential,
    activeCapabilities: 'send,read,mentions,tasks,reactions,server,channels',
  });
  const driver = new OpenCodeServerRuntimeDriver({
    credential,
    workspacePath,
    wrapperDir: wrapper.wrapperDir,
    slockHome: wrapper.slockHome,
    launchId: wrapper.launchId,
    command: process.execPath,
    commandArgs: ['--input-type=module', '--eval', fakeOpenCodeServeEval(marker)],
    model: 'kimi-for-coding/k2p5',
    agent: 'default',
    ...extra,
  });
  return { driver, workspacePath, wrapper };
}

test('opencode model parser keeps provider and model explicit', () => {
  assert.deepEqual(parseOpenCodeModel('kimi-for-coding/k2p5'), {
    providerID: 'kimi-for-coding',
    modelID: 'k2p5',
  });
  assert.deepEqual(parseOpenCodeModel('k2p5'), { modelID: 'k2p5' });
});

test('opencode serve command defaults to local HTTP server mode', () => {
  assert.deepEqual(resolveOpenCodeServeLaunchCommand({ command: 'opencode' }), {
    command: 'opencode',
    args: ['serve', '--hostname', '127.0.0.1', '--port', '0', '--print-logs', '--log-level', 'INFO'],
  });
});

test('opencode prompt includes final Phase 2 prompt-gate constraints', () => {
  const prompt = buildOpenCodeSlockPrompt({
    credential: { serverUrl: 'http://127.0.0.1:9', token: 'fake_machine_test', agentId: 'agent-opencode' },
    workspacePath: '/tmp/workspace',
    wrapperDir: '/tmp/wrapper',
    model: 'kimi-for-coding/k2p5',
    agent: 'default',
  });
  assert.match(prompt, /OpenCode provider: kimi-for-coding/);
  assert.match(prompt, /OpenCode model: k2p5/);
  assert.match(prompt, /OpenCode agent: default/);
  assert.match(prompt, /oh-my-openagent/);
  assert.match(prompt, /exact-command approve once/i);
  assert.match(prompt, /template allowlist/i);
  assert.match(prompt, /MCP servers/);
  assert.match(prompt, /Claude Code runtime/i);
  assert.match(prompt, /WRITES_NOT_ALLOWED/);
  assert.match(prompt, /WRITE_TARGET_NOT_ALLOWED/);
  assert.match(prompt, /Aura CLI Only/);
  assert.match(prompt, /aura message check/);
  assert.doesNotMatch(prompt, /\/tmp\/wrapper/);
  assert.doesNotMatch(prompt, /`(?:slock|raft)\s+(?:message|task|server|channel|thread)\b/i);
});

test('opencode runtime env resolves the workspace aura wrapper first and strips proxy secrets', () => {
  const env = buildOpenCodeRuntimeEnv({
    credential: { serverUrl: 'http://127.0.0.1:9', token: 'fake_machine_test', agentId: 'agent-opencode' },
    workspacePath: '/tmp/workspace',
    wrapperDir: '/tmp/workspace/.slock',
    slockHome: '/tmp/workspace/.slock',
    launchId: 'launch-opencode',
  }, {
    PATH: 'HOST_PATH',
    SLOCK_AGENT_TOKEN: 'secret',
    SLOCK_AGENT_PROXY_URL: 'http://127.0.0.1:1',
    SLOCK_AGENT_PROXY_TOKEN: 'sap_secret',
    SLOCK_AGENT_PROXY_TOKEN_FILE: 'token-file',
    SLOCK_AGENT_ACTIVE_CAPABILITIES: 'send',
  });

  assert.equal(env.PATH, `/tmp/workspace/.slock${process.platform === 'win32' ? ';' : ':'}HOST_PATH`);
  assert.equal(env.SLOCK_HOME, '/tmp/workspace/.slock');
  assert.equal(env.SLOCK_AGENT_ID, 'agent-opencode');
  assert.equal(env.SLOCK_AGENT_LAUNCH_ID, 'launch-opencode');
  assert.equal(env.SLOCK_AGENT_PROXY_URL, undefined);
  assert.equal(env.SLOCK_AGENT_PROXY_TOKEN, undefined);
  assert.equal(env.SLOCK_AGENT_PROXY_TOKEN_FILE, undefined);
  assert.equal(env.SLOCK_AGENT_ACTIVE_CAPABILITIES, undefined);
});

test('opencode serve runtime creates session, sends prompt, maps SSE, and approves permissions with Claude parity', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aaa-opencode-runtime-'));
  const marker = join(root, 'marker.json');
  const { driver } = makeDriver(root, marker);
  const auraCommand = "aura message send --target '#test' <<'AURAMSG'\nhello\nAURAMSG";
  const sessions = [];
  const sent = [];
  const events = [];
  const exits = [];
  driver.on('session', event => sessions.push(event));
  driver.on('message_sent', event => sent.push(event));
  driver.on('stream_event', event => events.push(event));
  driver.on('exit', event => exits.push(event));

  try {
    driver.start();
    driver.sendUserMessage(auraCommand);

    await waitFor(() => events.some(event => event.type === 'result'));
    await waitFor(() => {
      const record = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf-8')) : {};
      return record.permissionReplies?.length > 0;
    });

    assert.equal(sessions.length, 1);
    assert.match(sessions[0].sessionId, /^ses_fake_/);
    assert.equal(driver.sessionId, sessions[0].sessionId);

    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'opencode_prompt');
    assert.equal(sent[0].providerID, 'kimi-for-coding');
    assert.equal(sent[0].modelID, 'k2p5');

    const assistantEvents = events.filter(event => event.type === 'assistant' && event.runtime === 'opencode');
    assert.ok(assistantEvents.some(event => event.message.content.some(block => block.type === 'thinking' && block.thinking === 'checking the repository')));
    assert.ok(assistantEvents.some(event => event.message.content.some(block => block.type === 'text' && block.text === 'hello from fake opencode')));
    assert.ok(assistantEvents.some(event => event.message.content.some(block => block.type === 'text' && block.text === 'after the tool')));
    assert.equal(
      assistantEvents.some(event => event.message.content.some(block => block.type === 'text' && block.text === auraCommand)),
      false,
      'user-authored text parts must not be re-emitted as assistant Activity telemetry',
    );
    const toolUseEvent = assistantEvents.find(event => event.message.content.some(block => block.type === 'tool_use'));
    assert.ok(toolUseEvent);
    assert.equal(toolUseEvent.message.content[0].input.command, auraCommand);
    assert.ok(events.some(event => event.type === 'user' && event.runtime === 'opencode'));
    const result = events.find(event => event.type === 'result');
    const finalAssistantIndex = events.findIndex(event => event.type === 'assistant' && event.message.content.some(block => block.text === 'after the tool'));
    const toolResultIndex = events.findIndex(event => event.type === 'user' && event.message.content.some(block => block.type === 'tool_result'));
    const resultIndex = events.indexOf(result);
    assert.ok(finalAssistantIndex >= 0 && finalAssistantIndex < resultIndex, JSON.stringify(events));
    assert.ok(toolResultIndex >= 0 && toolResultIndex < resultIndex, JSON.stringify(events));
    assert.equal(result.runtime, 'opencode');
    assert.equal(result.subtype, 'success');
    assert.equal(result.usage.input_tokens, 10);
    assert.equal(result.usage.output_tokens, 3);

    const record = JSON.parse(readFileSync(marker, 'utf-8'));
    assert.equal(record.sessions[0].input.model.providerID, 'kimi-for-coding');
    assert.equal(record.sessions[0].input.model.id, 'k2p5');
    assert.equal(record.sessions[0].input.agent, 'default');
    assert.equal('agent' in record.messages[0].input, false);
    assert.equal(record.sessions[0].input.permission.some(rule => rule.permission === 'bash' && rule.action === 'ask'), true);
    assert.match(record.messages[0].input.system, /opencode serve/);
    assert.match(record.messages[0].input.system, /oh-my-openagent/);
    assert.deepEqual(record.permissionReplies[0].input, {
      reply: 'once',
      message: 'Approved exact daemon-owned Aura command once.',
    });
  } finally {
    driver.stop();
    await waitFor(() => exits.length > 0 || !driver.pid).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
