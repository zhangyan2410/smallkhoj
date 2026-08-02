# 前端性能优化：聊天页重渲、SSE 连接合并与清理

## Goal

基于 2026-07-29 前端粗略审计（只读，未改代码），落地前端运行时性能优化与仓库卫生清理。优化项按收益排序，可分批实施；每一项独立可验证。

## 背景：审计发现

### P0 — 聊天页巨型 client component 导致全量重渲

`frontend/app/(app)/chat/[channel]/channel-client.tsx`（2045 行，36 个 useState）：

- 输入框 `setInput` state 在 ChannelClient 内（`:1739`，thread 输入框 `:1942`），每敲一个键整个组件重渲。
- 消息列表 `messages.map`（`:1606`）全量渲染、无虚拟化；每条消息经 `MarkdownMessage`（`frontend/components/markdown-message.tsx:54`，未 memo）重新跑 react-markdown 解析。
- 结果：打字卡顿随消息数线性恶化。
- 正向参考：同文件内 `ChatScrollRail` 与 pointer 转发已用 ref + DOM 直写避开重渲，方向一致。

### P1 — SSE 连接重复开

4 处各自调用 `connectRealtimeEvents`（`frontend/lib/realtime-events.ts`）：

- `frontend/components/realtime-refresh.tsx`
- `frontend/components/task-board.tsx`（2 处：任务列表流 + TaskMemoryInline 的 task 级流）
- `frontend/app/(app)/chat/[channel]/channel-client.tsx:797`

聊天页同时挂 ChannelClient + TaskBoard + RealtimeRefresh 时，到 `/api/v1/events/stream` 的长连接 ≥3 条。

### P2 — TaskBoard 刷新行为

`frontend/components/task-board.tsx`：

- `refreshTasks`（`:705`）每次 SSE 事件全量重取任务列表且 `setLoading(true)`，已有数据时后台刷新会闪 loading 态。
- 首次加载套了无意义的 `setTimeout(0)`（`:718`）。
- `TaskMemoryInline` 用 `loadingTaskId === taskId` 字符串比较当 loading 标记（`:569`），hack 但能用，顺手清理。

### P3 — 死代码与仓库卫生

- `frontend/hooks/use-websocket.ts` 无任何引用 → 删除，并卸载 `react-use-websocket` 依赖（`ws` 仍被 `frontend/server.ts` 使用，保留）。
- `frontend/.runtime/`（dev-server.log、dev-server.pid、start-dev.sh）被 git 跟踪 → 加入 `.gitignore` 并 `git rm --cached`。

### P4 — 次要（可不做）

- `frontend/app/(app)/daemon/page.tsx` 900 行服务端组件，可拆分；因在服务端执行，优先级低。

## Requirements

- P0：拆分 ChannelClient —— 至少拆出 memo 化的 `MessageList`/`MessageItem` 与独立 `Composer`；`MarkdownMessage` 加 memo；打字、thread 输入等局部 state 不再触发消息列表重渲。消息虚拟化列为可选项（消息量级大时再做）。
- P1：设计并实现单条 SSE 连接 + 订阅分发机制（如 context/provider），替换页面级多连接；保留现有 high-water 去重与断线重连语义。
- P2：TaskBoard 后台刷新不再触发可见 loading 态；移除 `setTimeout(0)`；`loadingTaskId` 换布尔。
- P3：删除 `use-websocket.ts` 与 `react-use-websocket` 依赖；`.runtime/` 移出 git 跟踪。
- 不做大范围样式/结构重构，不改变用户可见行为（除性能改善外）。

## Acceptance Criteria

- [ ] P0：聊天页输入框连续打字时，消息列表组件不重渲（React DevTools Profiler 或等效证据）；lint + type-check 通过。
- [ ] P0：浏览器可见证据（`./twd`）确认聊天页收发消息、markdown 渲染、thread 回复行为无回归。
- [ ] P1：聊天页（含 TaskBoard、RealtimeRefresh 挂载时）到 `/api/v1/events/stream` 的连接数为 1（Network 面板证据）；断线重连与事件去重行为不变。
- [ ] P2：任务看板收到 SSE 事件后静默刷新，无 loading 闪烁（`./twd` 证据）。
- [ ] P3：`grep -r react-use-websocket frontend --include='*.ts*'`（排除 node_modules/lockfile）无引用；`git ls-files frontend/.runtime` 为空。
- [ ] 全部改动：`frontend` lint、type-check 通过；相关 e2e 不红。

## Notes

- 实施顺序建议：P3（快速清理）→ P0（收益最大）→ P1 → P2；也可按批次拆子任务。
- 审计原始结论在本会话中产出，未写入 research/；如需外部调研（如虚拟化库选型）再补 `research/`。
- 用户明确要求：本任务仅完成规划文档，不进入实现（未执行 `task.py start`）。
