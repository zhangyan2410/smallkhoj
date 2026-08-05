import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import test from 'node:test';

import {
  DaemonCore,
  normalizeRuntimeIncomingMessage,
  runtimeChannelMembershipChange,
} from '../dist/daemon/daemon.js';
import {
  RuntimeChannelContextRegistry,
  channelMembershipPromptRules,
  formatChannelRosterSnapshot,
} from '../dist/runtime/channel-context.js';

const channelId = '11111111-1111-4111-8111-111111111111';
const agentId = '22222222-2222-4222-8222-222222222222';
const humanId = '33333333-3333-4333-8333-333333333333';

function snapshot(revision = 3) {
  return {
    channelId,
    rosterRevision: revision,
    members: [
      { memberId: humanId, kind: 'human', handle: 'ean', reference: '@ean', description: 'must-not-leak' },
      { memberId: agentId, kind: 'agent', handle: 'open2', reference: '@open2', description: '擅长后端排障' },
    ],
  };
}

function change(overrides = {}) {
  return {
    eventId: '44444444-4444-4444-8444-444444444444',
    eventType: 'channel.member_joined',
    channelId,
    rosterRevision: 4,
    member: {
      memberId: '55555555-5555-4555-8555-555555555555',
      kind: 'human',
      reference: '@ean-s7k2m',
    },
    referenceUpdates: [{ memberId: humanId, reference: '@ean-s9p4x' }],
    ...overrides,
  };
}

test('registry applies compact changes, detects replay/gaps, and clears removed Agent context', () => {
  const registry = new RuntimeChannelContextRegistry();
  registry.initialize(agentId, 'launch-1', snapshot());

  assert.deepEqual(registry.apply(agentId, 'launch-1', change()), {
    kind: 'applied',
    rosterRevision: 4,
  });
  assert.deepEqual(registry.snapshot(agentId, 'launch-1', channelId).members.map((member) => member.reference), [
    '@ean-s9p4x',
    '@open2',
    '@ean-s7k2m',
  ]);
  assert.equal(registry.apply(agentId, 'launch-1', change()).kind, 'duplicate');
  assert.deepEqual(registry.apply(agentId, 'launch-1', change({
    eventId: '66666666-6666-4666-8666-666666666666',
    rosterRevision: 7,
  })), {
    kind: 'gap',
    expectedRevision: 5,
    receivedRevision: 7,
  });

  const removed = change({
    eventId: '77777777-7777-4777-8777-777777777777',
    eventType: 'channel.member_left',
    rosterRevision: 5,
    member: { memberId: agentId, kind: 'agent', reference: '@open2' },
    referenceUpdates: [],
    removedAgentId: agentId,
  });
  assert.equal(registry.apply(agentId, 'launch-1', removed).kind, 'removed');
  assert.equal(registry.has(agentId, 'launch-1', channelId), false);
});

test('snapshot formatting includes Agent expertise once and never Human description', () => {
  const text = formatChannelRosterSnapshot(snapshot());
  assert.match(text, /@open2 .*擅长后端排障/);
  assert.match(text, /@ean \[human/);
  assert.doesNotMatch(text, /must-not-leak/);
  assert.match(channelMembershipPromptRules().join('\n'), /may change frequently/);
  assert.match(channelMembershipPromptRules().join('\n'), /Do not send a chat reply merely to acknowledge/);
  assert.match(channelMembershipPromptRules().join('\n'), /without reading long-lived memory, checking messages, or calling tools/);
  assert.match(text, /Do not read long-lived memory, check messages, call tools, or send an acknowledgment/);
});

test('daemon normalizes the durable membership payload contract', () => {
  const normalized = normalizeRuntimeIncomingMessage({
    type: 'channel.member_joined',
    eventId: 'event-1',
    channelId,
    rosterRevision: 9,
    member: { memberId: humanId, kind: 'human', reference: '@张翰' },
    referenceUpdates: [{ memberId: agentId, reference: '@open2-s7k2m' }],
    agentId,
  });
  assert.ok(normalized);
  assert.deepEqual(runtimeChannelMembershipChange(normalized), {
    eventId: 'event-1',
    eventType: 'channel.member_joined',
    channelId,
    rosterRevision: 9,
    member: { memberId: humanId, kind: 'human', reference: '@张翰' },
    referenceUpdates: [{ memberId: agentId, reference: '@open2-s7k2m' }],
    removedAgentId: undefined,
  });
});

function startSnapshotServer() {
  let snapshotRequests = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.includes('/channel-members')) {
      snapshotRequests += 1;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(snapshot()));
      return;
    }
    if (req.url?.includes('/memory/context-manifest')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        get snapshotRequests() { return snapshotRequests; },
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

class FakeDriver extends EventEmitter {
  sent = [];
  queued = [
    { scope: `channel:${channelId}` },
    { scope: `thread:${channelId}:root-1` },
    { scope: 'channel:other-channel' },
  ];
  get busy() { return false; }
  get queuedMessageCount() { return this.queued.length; }
  get pid() { return 1; }
  get sessionId() { return 'session-1'; }
  start() {}
  stop() {}
  killUnresponsive() {}
  sendUserMessage(text, options) {
    this.sent.push({ text, options });
    return true;
  }
  discardQueuedChannel(removedChannelId) {
    const before = this.queued.length;
    this.queued = this.queued.filter(({ scope }) => (
      scope !== `channel:${removedChannelId}` && !scope.startsWith(`thread:${removedChannelId}:`)
    ));
    return before - this.queued.length;
  }
}

function runtimeRecord(driver) {
  return {
    agentId,
    runtime: 'claude_code',
    proxyToken: 'sap_test',
    wrapper: { launchId: 'launch-1' },
    driver,
    sessionId: 'session-1',
    sessionScopesByKey: new Map(),
    pendingActivityTurns: [],
    channelContextDeliveryChain: Promise.resolve(),
  };
}

test('daemon injects one snapshot, sends compact updates without Activity, and cuts off a removed Channel', async () => {
  const backend = await startSnapshotServer();
  try {
    const daemon = new DaemonCore({ agentId, serverUrl: backend.url, proxyPort: 0 });
    daemon.proxy = { getProxyUrl: () => backend.url, setActiveTrace() {} };
    let activityTurns = 0;
    daemon.beginRuntimeActivityTurn = () => { activityTurns += 1; };
    const driver = new FakeDriver();
    const runtime = runtimeRecord(driver);
    daemon.runtimes.set(agentId, runtime);

    assert.equal(daemon.deliverRuntimeMessage({
      agentId,
      actor: humanId,
      channelId,
      channelType: 'channel',
      target: '#general',
      sender: '@ean',
      content: 'first work',
    }), true);
    await runtime.channelContextDeliveryChain;
    assert.equal(backend.snapshotRequests, 1);
    assert.match(driver.sent[0].text, /channel\.members\.snapshot/);
    assert.match(driver.sent[0].text, /擅长后端排障/);
    assert.equal(activityTurns, 1);

    daemon.deliverRuntimeMessage({
      agentId,
      actor: humanId,
      channelId,
      channelType: 'channel',
      target: '#general',
      sender: '@ean',
      content: 'second work',
    });
    await runtime.channelContextDeliveryChain;
    assert.equal(backend.snapshotRequests, 1);
    assert.doesNotMatch(driver.sent[1].text, /擅长后端排障/);
    assert.equal(activityTurns, 2);

    daemon.deliverRuntimeMessage({ agentId, ...change() });
    await runtime.channelContextDeliveryChain;
    assert.match(driver.sent[2].text, /channel\.member_joined/);
    assert.match(driver.sent[2].text, /Do not read long-lived memory, check messages, call tools, or send an acknowledgment/);
    assert.equal(activityTurns, 2);

    daemon.deliverRuntimeMessage({ agentId, ...change() });
    await runtime.channelContextDeliveryChain;
    assert.equal(driver.sent.length, 3, 'transport replay must not create a second runtime turn');

    runtime.pendingActivityTurns.push(
      { channelId, content: 'queued removed work' },
      { channelId: 'other-channel', content: 'keep other work' },
    );
    daemon.deliverRuntimeMessage({ agentId, ...change({
      eventId: '88888888-8888-4888-8888-888888888888',
      eventType: 'channel.member_left',
      rosterRevision: 5,
      member: { memberId: agentId, kind: 'agent', reference: '@open2' },
      referenceUpdates: [],
      removedAgentId: agentId,
    }) });
    await runtime.channelContextDeliveryChain;
    assert.match(driver.sent.at(-1).text, /You have been removed from this Channel/);
    assert.deepEqual(runtime.pendingActivityTurns.map((message) => message.channelId), ['other-channel']);
    assert.deepEqual(driver.queued.map(({ scope }) => scope), ['channel:other-channel']);
  } finally {
    await backend.close();
  }
});
