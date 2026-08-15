# ACP 桥迁移新版 client API（登记项 C 落地）

## Goal

把 `CodexAcpBridge` 从 @deprecated 的 `ClientSideConnection` 迁到 SDK 1.3
的正式 client API（`client().connect()` + `ClientContext.request()`），解锁：

1. **`$/cancel_request` 传输层取消**：`SendRequestOptions.cancellationSignal`
   （AbortSignal）——中止即自动发送 `$/cancel_request`；与 agent 域
   `session/cancel` 形成双通道取消（对不理会 session/cancel 的挂死 agent，
   传输层取消是第二条生路）。
2. **对齐 SDK 支持路径**：legacy 构造器已标注废弃，未来大版本可能移除。

## Background

- 升级审计（08-15 任务 research/upstream-changelog-audit.md）：0.29.0 引入
  请求取消（unstable → 现为正式 SendRequestOptions 字段）；1.1.0 handler
  请求上下文；legacy `ClientSideConnection.prompt` 不透传 cancellationSignal
  ——这正是登记项 C 的动机。
- SDK 内部事实（读 dist 证实）：`ClientSideConnection` 本身就是
  `legacyClientApp(...)` shim——迁移是把 shim 换成直连。
- goose 消费的 ext 通知只有 `_goose/unstable/session/update`（usage 记账）；
  新 API 的通知注册按方法名进行，桥改为由 runtime 声明监听清单
  （`extNotificationMethods`），保持桥的通用性。

## Requirements

### R1 桥迁移（公开 API，公开面不变）
- `client({ name: 'smallkhoj-daemon' })` 构建 app；
  `onNotification(methods.client.session.update)`（含 codec 翻译，行为不变）、
  `onRequest(methods.client.session.requestPermission)`（首选项自动批准不变）、
  ext 通知按 `extNotificationMethods` 清单注册（passthrough parser）。
- `app.connect(stream)` 持久连接；`conn.agent` 作为请求上下文：
  initialize/newSession/loadSession/prompt/cancel 语义与返回类型不变。
- 桥的公开方法签名保持兼容（drivers 无需改动即可编译）。

### R2 传输层取消
- `bridge.prompt(sessionId, text, options?: { signal?: AbortSignal })` →
  `request(..., { cancellationSignal })`；abort 即发 `$/cancel_request`。
- SDK 语义：promise 仍由 peer 的最终响应结算（可能正常/部分/RequestCancelled），
  不引入本地新错误路径。

### R3 驱动双通道取消
- goose / codex-acp driver：每 turn 创建 `AbortController`，prompt 传 signal，
  turn 结束清理；`requestGracefulCancel()` = `bridge.cancel`（session/cancel）
  **加** `controller.abort()`（$/cancel_request）。
- stall watchdog / B 的 cancel_turn 入口无需改动，自动获得双通道。

## Non-goals

- ❌ ACP v2 / HTTP 传输（experimental，不启用）。
- ❌ 用 `$/cancel_request` 替代 `session/cancel`（主通道仍是 agent 域取消）。
- ❌ 大改 ActiveSession/SessionBuilder 流式封装（现桥的 onUpdate 推送模型
  保持不变，迁移是传输层替换）。

## Acceptance Criteria

- [x] 桥迁移完成，全部现有单测（fake-ACP 家族）不改断言即绿：43/43。
- [x] 新增单测：假 ACP 记录收到 `$/cancel_request`（driver
      requestGracefulCancel 后），且 turn 以 cancelled 结算（CANCEL_PROBE 文件
      断言，双 driver）。
- [x] goose driver 声明 `_goose/unstable/session/update` ext 监听，usage
      记账路径回归绿；smoke 直连桥也补声明（迁移后发现 ext 通知需显式
      注册——R1.1 真值门当场抓住 usage=0 的回归，验证了门的价值）。
- [x] 真机 smoke：goose + MiniMax 双通过（正常 exit 0 usage=5254；cancel
      exit 0 中断结算 4ms）。**新发现（裸 JSON-RPC 直测 goose stdin 证实）**：
      goose 1.46 + openai 兼容路径对流中 session/cancel 会立即中断生成，但
      stopReason 标注 end_turn 而非 cancelled——标注是 goose 侧行为，与传输
      无关。smoke cancel 判定改为真值语义：stopReason=cancelled 或取消后
      ≤10s 内结算（长任务被真实中断）；R1.1 usage 门限定正常模式（中断回合
      本就无 usage）。
- [x] daemon 全套 npm test 回归绿：337/337。
