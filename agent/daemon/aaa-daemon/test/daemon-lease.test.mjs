import assert from 'node:assert/strict';
import test from 'node:test';

import { isLeaseRevokedMessage } from '../dist/daemon/daemon.js';
import { LEASE_REVOKED_CLOSE_CODE } from '../dist/websocket.js';

// 单活跃 daemon 租约（08-16 六实例重复投递事故）：服务端用 lease.revoked
// 消息 + close 4001 宣告旧实例被取代，daemon 识别后停 runtimes 不再消费。

test('isLeaseRevokedMessage matches plain and wrapped lease.revoked payloads', () => {
  assert.equal(isLeaseRevokedMessage({ type: 'lease.revoked', reason: 'superseded_by_new_daemon' }), true);
  // 控制载荷包裹形态（unwrapControlPayload 兼容 params/event/command 包装）
  assert.equal(isLeaseRevokedMessage({ type: 'control', command: { type: 'lease.revoked' } }), true);
  assert.equal(isLeaseRevokedMessage({ params: { type: 'lease.revoked' } }), true);
  // 其它类型不误判
  assert.equal(isLeaseRevokedMessage({ type: 'start_runtime', agentId: 'a1' }), false);
  assert.equal(isLeaseRevokedMessage({ type: 'message' }), false);
  assert.equal(isLeaseRevokedMessage('lease.revoked'), false);
  assert.equal(isLeaseRevokedMessage(null), false);
});

test('lease revoked close code is stable at 4001', () => {
  assert.equal(LEASE_REVOKED_CLOSE_CODE, 4001);
});
