# 聊天页内嵌取消按钮 + Claude Code 取消支持（B 增强）

## Goal

1. **Claude Code runtime 获得优雅取消能力**：`ClaudeRuntimeDriver` 实现
   `requestGracefulCancel()`，走 Claude Code stream-json 的 stdin 控制协议
   （本机 claude 2.1.201 二进制实锤存在：
   `{"type":"control_request","request_id":...,"request":{"subtype":"interrupt"}}`）。
2. **聊天页内嵌取消按钮**：用户在与 agent 对话时直接停止当前回合，不用切到
   电脑页——busy 态复用既有 `member.status` 实时流（THINKING/ACTIVE bucket）。

## Background

- B（08-15-agent-turn-cancel）已落地全链路：lifecycle action=cancel →
  cancel_turn → daemon → `requestGracefulCancel`。当时 claude/pi/opencode
  无该能力（PRD non-goal），本次补上 claude。
- Claude driver 是常驻进程 + stdin 消息流（`writeUserMessage` 写 JSON 行），
  与 interrupt 控制请求的适用模型一致；中断后回合以 result 事件结算
  （binary 里有 "interrupted"/"user_interrupted" 等 subtype 标注）。
- 聊天页 `channel-client.tsx` 已监听 `member.status.updated` 实时事件，
  `lib/agent-status.ts` 的 bucket（THINKING/ACTIVE）即忙态信号。
- lifecycle 端点是 workspace 维度；聊天页只知道 member id——需要按 agent
  member 解析活跃 workspace 的入口。

## Requirements

### R1 Claude driver 优雅取消
- `requestGracefulCancel()`：busy 且 stdin 可写时，写 interrupt
  control_request（带 request_id），返回 true；否则 false。
- `consumeStdoutLine` 过滤 `control_response` 帧（不作为 stream_event 污染
  activity 流，记 daemon line 供排障）。
- 中断后 claude 的 result 事件走既有路径（awaitingTurnResult 复位 →
  flushQueuedMessages）。

### R2 backend：按 member 取消入口
- `POST /api/v1/agents/{member_id}/cancel-turn`：解析该 agent 在本 server 的
  活跃 workspace（status running/pending），复用 lifecycle cancel 内核
  （入队 cancel_turn + activity + 零状态突变）；找不到活跃 workspace 时 409。

### R3 frontend：聊天页取消按钮
- 会话内有 agent 参与者且其状态 bucket 为 THINKING/ACTIVE 时，composer
  发送区显示停止按钮（Square 图标）；点击调 cancel-turn；DM 取 peer，
  频道取 THINKING/ACTIVE 的 agent 成员（多个时逐个调用）。
- 中英文案（chat.cancelTurn / 取消回合）。

## Non-goals

- ❌ pi / opencode 的取消能力（后续按需）。
- ❌ 后端 agent 状态机改动（忙态信号复用现状）。

## Acceptance Criteria

- [x] daemon 单测：fake claude 挂起回合 → requestGracefulCancel 写出
      interrupt control_request（fake 断言帧形状：type/request_id/subtype）→
      fake 以 result 结算 → busy 清空；空闲时返回 false。
- [x] control_response 帧不进 stream_event（单测断言；记 daemon line）。
- [x] backend pytest：cancel-turn 入队 cancel_turn + 零状态突变；无活跃
      workspace 409（2/2）。
- [x] frontend：composer 停止按钮（busy agent 存在时渲染，THINKING/ACTIVE
      bucket）+ 中英文案 + tsc 通过。
- [x] daemon 全套 npm test 回归绿：338/338；backend daemon_control 63/63。
      真机 claude/UI 验证待下次栈内联验收（帧形状取自真实 2.1.201 二进制，
      fake 单测已按真实形状固化）。
