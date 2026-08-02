# 实时活动指示框架：可复用可组装的红点/未读徽标体系

## Goal

后端已通过 `/api/v1/events/stream`（SSE）推送 activity / message / task 等实时事件，但前端除聊天侧栏外没有任何"有新动态"的可见指示（红点 / 未读数徽标）。本任务建设一个**可复用、可组装**的实时活动指示框架：任何导航项、列表行、标签页都能以统一方式挂上红点/计数徽标，由统一的实时事件源驱动，统一的"已读/清除"语义收尾。

## 背景：现状盘点（2026-07-30 只读调查）

已有资产：

- **SSE 事件流**：`frontend/lib/realtime-events.ts` 的 `connectRealtimeEvents`（含 high-water 去重、断线重连），事件带 `scope`（channel/dm/task/workspace/member/computer/server）与 `seq`。
- **聊天未读（仅聊天域）**：`frontend/lib/chat-unread-state.ts`（localStorage store + 自定义事件广播）+ `frontend/hooks/use-chat-unread-store.ts` + `deriveChatUnreadView`，仅被 `chat/[channel]/chat-sidebar.tsx` 使用。
- **展示原件**：`frontend/components/inkframe-object-ui.tsx` 的 `EventBadge`（红点/计数，`data-inkframe-unread` 协议）与列表项未读插槽。

缺口：

- **AppRail 主导航**（`frontend/components/app-rail.tsx`）：chat / tasks / activity(daemon) 等图标无任何活动指示 —— 用户在别的页面时完全感知不到新消息、新任务、新活动。
- **非聊天域**：task.created/updated、member.status.updated、computer.status.updated、workspace.updated 等事件只触发 `RealtimeRefresh` 静默刷新页面数据，无"有新内容"的视觉提示。
- 聊天未读实现是聊天域特化的（localStorage key、channel/dm scope 假设），无法直接复用到 tasks/activity 等域。

## Requirements

### R1 通用"未 seen 活动"状态层（框架核心）

- 按 **域（domain）×  scope** 两级键管理未读/未 seen 状态，例如 `chat:channel:<id>`、`chat:dm:<id>`、`task:all`、`activity:all`；域可扩展，不硬编码聊天概念。
- 由 SSE 事件驱动递增；保留现有 high-water 去重语义（同 epoch/seq 不重复计数）。
- 跨标签页/刷新可恢复（持久化，如沿用 localStorage 方案），并有服务端真源校准入口（如聊天现有 read-cursor 模式）。
- 提供"已读/清除"API：进入对应路由或查看对应内容后清除该键。
- 尽量泛化而非重写：评估将 `chat-unread-state.ts` 泛化为此状态层，聊天作为第一个消费方迁移进来，避免两套并存。

### R2 可组合的展示原件

- 提供与具体业务无关的指示原件，可附着到任意元素上：
  - 纯红点（无计数）
  - 计数徽标（复用/扩展 `EventBadge` 的视觉协议，含 `data-inkframe-unread` 等既有 data 属性约定）
  - 包裹式（wrapper，把指示定位到子元素角标，如图标右上角）
- 原件只接收 `hasUnread` / `count` 等展示 props，不直接耦合事件流；事件订阅通过 hook（如 `useActivityIndicator(domainKey)`）注入，方便在服务端/客户端组件边界两侧组装。

### R3 首批落地集成点

- AppRail：`chat`（有未读消息时）、`tasks`（有新任务/任务更新时）、`activity`（有新 agent 活动时）图标显示红点或计数；当前所在路由对应的指示自动清除。
- 聊天侧栏：迁移到 R1 状态层（验证框架可复用性的同时不丢既有行为，含 thread 未读）。
- 其余域（members/computers/control）本期只预留挂载点，不强制全部接入。

### R4 约束

- 不改变后端事件协议；新增逻辑在前端闭环。
- 不引入重型状态库；优先 React 原生（context/external store）+ 现有 localStorage 持久化模式。
- 视觉沿用 inkframe 既有 token 与 `EventBadge` 风格，红点语义 = "有未看内容"，不表达优先级/告警。
- 与任务 `07-30-frontend-perf-optimization` 的 P1（SSE 单连接 + 订阅分发）存在天然协同：若先做 P1，本框架应建立在分发层之上；若先做本任务，状态层的订阅口设计要为未来单连接留好位置（订阅方不感知连接管理）。两者不可重复各建一套事件监听。

## Acceptance Criteria

- [ ] 在任意非聊天页面，收到新聊天消息时 AppRail 的 chat 图标出现可见指示（红点或计数）；进入对应频道后指示清除（`./twd` 可见证据）。
- [ ] 收到新任务/任务更新时 AppRail 的 tasks 图标出现指示；访问 /tasks 后清除。
- [ ] 收到新 agent 活动时 activity(daemon) 图标出现指示；访问 /daemon 后清除。
- [ ] 刷新页面或新开标签后，未读指示不丢失（持久化生效）；重复事件（同 epoch/seq）不重复计数。
- [ ] 聊天侧栏未读行为与改造前一致（含计数、当前频道抑制、thread 未读），无两套未读状态并存。
- [ ] 展示原件可在不改变自身代码的情况下挂到新的任意元素上（以至少 1 个新增挂载点演示，如 tasks 页内某列表行）。
- [ ] lint、type-check 通过；`frontend/test` 相关测试更新或新增；e2e 不红。

## Notes

- 用户提供的参考图：波形/活动图标 + 右上角红点 —— 即"活动 + 角标"的组合形态，对应 R2 的包裹式原件。
- 建议实施顺序：R1 状态层 → R2 原件 → R3 集成（AppRail 先行）→ 聊天侧栏迁移。
- 用户明确要求：本任务仅完成规划文档，不进入实现（未执行 `task.py start`）。
