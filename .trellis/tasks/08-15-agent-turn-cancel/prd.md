# 用户侧取消当前回合（登记项 B 落地）

## Goal

用户可以主动取消一个 agent 正在进行的回合（turn），而不是只能等回合自然
结束或被 stall 看门狗杀掉。走 08-15 已落地的驱动级
`requestGracefulCancel()`（ACP `session/cancel`，goose/codex 已实现），
参考 NAP 的 interrupt 端点形态。

## Background

- 08-15 登记项 B（用户已定后续做）：产品链路缺一个「取消当前 turn」的
  控制入口（backend 控制命令 → daemon → cancel）。
- NAP 参考实现：`POST /sessions/:id/interrupt` → `bridge.cancel(sessionId)`
  （acp-server.ts:659-669）——判定为「漏抄」。
- daemon 侧能力已就绪：`ManagedRuntimeDriver.requestGracefulCancel()`，
  假 ACP 单测 + 真机 cancel smoke（stopReason cancelled）均验证过。
- 现有控制命令通道：backend `POST /api/v1/workspaces/{id}/lifecycle` →
  `runtime_control_command()` → `daemon_control_hub.push()` → daemon
  register/heartbeat 响应里的 `controlCommands` → `handleControlCommand()`
  （start/stop/restart_runtime 三种）。

## Requirements

### R1 daemon：cancel_turn 控制命令
- `DaemonControlCommand.type` 增加 `cancel_turn`；`parseDaemonControlCommand`
  接受该类型（不需要 config）。
- `handleControlCommand` 分支 → `cancelRuntimeTurn(agentId, workspaceId?)`：
  校验 runtime 存在与 workspace 匹配 → 调 `driver.requestGracefulCancel()`
  （无该能力的 runtime 记录 not-cancellable；空闲时记录 idle）。
- 回合以 stopReason cancelled 自然结算（result 事件 → runtime_idle），
  不额外发明新 activity 类型。

### R2 backend：lifecycle action=cancel
- `runtime_control_command()` 支持 `cancel_turn`（信封仅 agentId+workspaceId）。
- lifecycle 端点新增 action `cancel`：不改 workspace/agent 状态、不做
  runtime provider 可用性检查（runtime 已在跑）、保留 computer 在线校验；
  推送控制命令 + 记录 activity（"@handle 回合取消已请求 on <computer>"）。

### R3 frontend：computers 页取消入口
- 电脑页 runtime 控件区增加「取消回合」按钮（复用既有 lifecycle 调用模式
  与 i18n）；点击调 lifecycle action=cancel，成功/排队提示复用现有文案结构。
- 聊天页内嵌按钮留作后续增强（需要 busy 态插线，另立小任务）。

## Non-goals

- ❌ 传输层 `$/cancel_request`（登记项 C：桥迁移新版 client API 后解锁）。
- ❌ 聊天页 composer 内嵌停止按钮（后续增强）。
- ❌ claude/pi/opencode 驱动的取消能力（它们未实现 requestGracefulCancel，
  入口对它们返回 not-cancellable 日志）。

## Acceptance Criteria

- [x] daemon：parseDaemonControlCommand 接受 cancel_turn；busy runtime 收到
      命令后 requestGracefulCancel 生效（假 ACP 挂起 → cancelled 结算）；
      空闲/无能力路径有日志且不崩。
      集成测试：daemon-runtime「daemon cancels a busy runtime turn via the
      cancel_turn control command」（events 投递回合 → 心跳携带 cancel_turn →
      marker cancelled）。实现修正：boot 级 runtime 无 workspaceId，守卫按
      未登记即匹配处理（单 agent 常态）。
- [x] backend：lifecycle action=cancel 入队 cancel_turn 信封（pytest），
      不改变 workspace 状态。
- [x] frontend：computers 页有取消按钮（中英文案），调通 lifecycle。
      （Square 图标 + computers.cancelTurn 文案；tsc 通过；真机 UI 验证待
      下次栈内联验收）
- [x] daemon 全套 npm test 回归绿：337/337（+1 新增）。
