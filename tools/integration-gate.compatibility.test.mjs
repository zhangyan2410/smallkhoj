import assert from 'node:assert/strict';
import test from 'node:test';

import { CHAT_GATE_SCENARIOS } from './integration-gate/chat-gate.mjs';
import { COLLAB_GATE_SCENARIOS } from './integration-gate/collab-gate.mjs';
import { buildFoundationGateReport } from './integration-gate/foundation-gate.mjs';

const EXPECTED_MODES = [
  'foundation-only',
  'chat-reply-channel-base',
  'chat-reply-channel-group',
  'chat-reply-dm',
  'product-chat-reply-claude',
  'collab-channel-v1',
  'collab-channel-v2',
  'collab-channel-v3',
];

test('restored integration gate exposes the complete historical mode contract', () => {
  const foundation = buildFoundationGateReport();
  assert.equal(foundation.mode, 'foundation-only');
  assert.deepEqual(
    [foundation.mode, ...CHAT_GATE_SCENARIOS, ...COLLAB_GATE_SCENARIOS],
    EXPECTED_MODES,
  );
});
