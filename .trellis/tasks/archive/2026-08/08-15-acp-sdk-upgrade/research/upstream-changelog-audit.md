# @agentclientprotocol/sdk 0.28.1 → 1.3.0 变更审计

> 来源：上游 [CHANGELOG.md](https://github.com/agentclientprotocol/typescript-sdk)（release-please
> 生成）+ 两版产物直接 diff（0.28.1 本地 node_modules vs 1.3.0 npm pack）。
> 审计日期 2026-08-15。

## 版本阶梯（0.28.1 之后共 6 个正式版）

| 版本 | 日期 | 变更 |
|---|---|---|
| 0.29.0 | 06-22 | **新**：unstable 请求取消（request cancellation）支持 |
| 1.0.0 | 06-24 | schema v1.16.0；**1.0 稳定版**（无 BREAKING 区块——API 冻结声明） |
| 1.1.0 | 06-29 | **新**：handler 上下文暴露 request id |
| 1.2.0 | 07-06 | schema v1.17→v1.19；**行为修复**：`ndJsonStream` 接收路径消息大小线性化（大输出性能）；**JSON-RPC 校验策略跨传输统一**（#211 报的 bug 修复） |
| 1.2.1 | 07-07 | SSE 关闭/响应投递确定性；TS schema 保留可扩展联合语义（类型层面：联合不再收窄成封闭集） |
| 1.3.0 | 07-21 | schema v1.20.0 + v2.0.0-alpha.2；**新**：experimental ACP v2 API |

## 对我们代码的影响面（逐项核对）

### 无破坏（已 diff 证实）

- `PROTOCOL_VERSION` 仍是 `1` —— 握手不受影响。
- **SessionUpdate 联合成员两版完全一致**（agent_message_chunk /
  agent_thought_chunk / tool_call / tool_call_update / usage_update / plan* /
  user_message_chunk / available_commands_update / config_option_update /
  current_mode_update / session_info_update）——`acp-event-translator.ts`
  的 switch 不需要改，`default` 分支继续兜底新成员。
- `Client` 接口形状不变：`sessionUpdate(params)` / `requestPermission(params)` /
  可选 `extNotification(method, params)` —— goose 桥的三个钩子原样可用。
- `ClientSideConnection` / `ndJsonStream` / `initialize()` 导出仍在
  （`ndJsonStream` 还从 acp.js 顶层新增了显式导出）。
- zod `tool_call` 必填 `title`、`ToolKind` 封闭枚举——两版一致（0.28.1 已如此，
  codex-activity 测试里已固化这两个事实）。

### 新能力（升级后可用，按需启用）

1. **请求取消**（0.29.0，unstable）：`bridge.cancel()` 之外的上游取消语义；
   未来 daemon 的 stall watchdog kill 路径可以换成协议级取消。
2. **handler 请求上下文**（1.1.0）：`AgentRequestContext`/`ClientRequestContext`
   暴露 request id——排查"哪条 prompt 对应哪条响应"时有用。
3. **guards.gen**：运行时类型守卫生成物，`dist/schema/guards.gen.js`。
4. **ACP v2 实验 API + schema v2.0.0-alpha.2**（1.3.0）：预览，不启用；
   等 v2 正式化后单独立任务。

### 需要回归验证的行为变化（无 API 破坏但语义可能变）

1. **1.2.0 JSON-RPC 校验策略统一**：旧版 stdio 路径对非法通知的处理与 HTTP
   路径不一致（#211）；统一后非法帧的拒绝方式/日志可能变化——goose ext 通知
   （`_goose/unstable/*`）和 codex 通知流要过一遍 smoke + 单测确认。
2. **1.2.0 ndJsonStream 线性化**：大工具输出（如长 aura stdout）的吞吐改善——
   正向，无需动作，但 e2e 里留意分帧行为。
3. **1.2.1 可扩展联合 TS 语义**：`SessionUpdate` TS 类型不再封闭——我们
  translator 的 `default` 分支本就存在，编译期无影响。

## 升级方案

- daemon `package.json`：`@agentclientprotocol/sdk` `^0.28.1` → `^1.3.0`。
- 无源码 API 改动预期；编译期靠 `tsc` 验证，行为期靠测试阶梯。

## 回归阶梯（升级后全跑）

1. `npm run build`（tsc 编译期破坏检测）。
2. daemon 单测：codex-acp-activity / codex-acp-runtime / codex-acp-mvp /
   acp-event-translator / runtime-activity / pi。
3. `npm run smoke:goose-acp`（真实 goose 1.46 + MiniMax 中继：initialize→
   codec→prompt→ext 通知→loadSession，覆盖 1.2.0 校验策略变化）。
4. （可选，如前三步有疑点）隔离 daemon E2E 复跑一轮。

## 参考

- 上游仓库 diff 与 CHANGELOG（本任务 research 时 clone 到 /tmp，未入库）。
- codex-activity 测试中固化的 0.28 协议事实（title 必填、ToolKind 枚举）在
  1.3.0 复核无变化。
