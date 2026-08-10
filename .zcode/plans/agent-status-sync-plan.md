# 方案：创建 agent 后状态实时同步 + 启动反馈

## 问题

1. **状态不同步**：创建 agent 后，agent 在后端启动上线，但 chat DM 页面的头像在线状态（online/offline）和"Active agents"列表不实时更新，必须手动刷新页面。
2. **缺启动反馈**：agent 还没启动完用户就发消息，没回应也没提示，体验差。

## 根因（三层叠加）

### 根因 1：后端 agent 上下线时不发 member 事件（最根本，**含两个方向**）

agent 状态变更有两个入口，都只改 `agent_member.status` 不发 member 事件：

- **上线（heartbeat）**：`agent_api.py:1399-1402` — `_upsert_daemon_workspace` 把 status 改成 online/offline；调用方 `daemon_heartbeat`（`agent_api.py:1862-1877`）只发 `workspace.updated`，不感知 member.status 变化。
- **下线（shutdown）**：`agent_api.py:1954-1955` — `daemon_shutdown` 把 status 改成 `"offline"`；line 1956-1971 同样只发 `workspace_updated`，不发 member 事件。

结果：前端监听 `member.status.updated`/`member.updated`（`channel-client.tsx:832`、`members/page.tsx:844`），但 agent 上下线路径都不发 → 前端等不到信号。**两个方向必须都修，否则只修 heartbeat 的话 agent 下线时 UI 不更新，问题只修一半。**

### 根因 2：前端 sidebar 数据源是 SSR 快照，不实时刷新

`chat-sidebar.tsx:51` 通过 `useChatData()` 读 `ChatDataProvider` 的 value，而 `ChatDataProvider`（`chat-data-context.tsx:37-60`）的 value 是 `useMemo` 基于 SSR props（`chat/layout.tsx:22-52` server component 填充），**client 端没有任何代码 mutate 它**（全目录 grep 确认无 setter）。

即使后端发了 member 事件，`channel-client.tsx` 收到后只 `refreshAllMembers`/`refreshChannelsAndDms` 刷新**自己的 useState**（line 329-331），sidebar 的 context 完全收不到 → 只有整页刷新（`create-agent-dialog.tsx:74` 的 `window.location.href`）重新 SSR 才喂给 sidebar 新数据。

### 根因 3：创建瞬间 status 本来就是 offline，且"启动中"状态不透出

后端 `public_api.py:5428` 默认 `status="offline"`，workspace 是 `PENDING_RUNTIME_START_STATUS`（`public_api.py:5412`）。但 `serialize_member`（`member_serialization.py:80-118`）**只返回 `member.status`（online/offline），不返回 workspace.status**。

这意味着：agent 启动期间 `member.status` 就是 `"offline"`，前端永远看不到"启动中"状态——`pending_start`/`starting` 这些 workspace 状态根本没透出到 member 序列化。所以纯前端方案里 `getStatusBucket()` 的 `STARTING` 分支是**死代码**，永远不会命中。

---

## 修复方案

### 后端改动 A：agent 上下线时补发 member 事件（两处，用裸 EventRecord）

**不要走 `_record_activity("supervisor_member_updated")`**——那会往 supervisor activity feed 写"@agent-x updated @agent-x"（actor 是 agent 自己，语义怪异），daemon 重启/租约抖动会刷屏。

**照 `_record_computer_status_event`（`agent_api.py:1466-1490`）的正确先例**：状态变化直接写 `EventRecord`、不写 `ActivityLog`。

**新增 helper**（`agent_api.py`，放在 `_record_computer_status_event` 附近）：
```python
async def _record_member_status_event(
    db: AsyncSession,
    server: Server,
    member: Member,
    *,
    previous_status: str | None,
    action: str,
) -> None:
    db.add(EventRecord(
        server_id=server.id,
        event_type="member.updated",       # 前端监听 member.updated；member.status.updated 是别名
        actor_id=None,
        payload={
            "type": "member.updated",
            "memberId": str(member.id),
            "memberName": member.handle,
            "status": member.status,
            "previousStatus": previous_status,
            "action": action,               # "heartbeat" / "shutdown"
        },
    ))
```
- `event_type` 用 `member.updated`（不是 `.status.updated`）：`supervisor_member_updated` 在 `ACTIVITY_EVENT_TYPES:1020` 映射到 `member.updated`；`.status.updated` 只是 `public_events.py:33-38` 的别名。前端两个都监听，用 `member.updated` 直接、无歧义。
- payload 不含完整 member 序列化（前端收到后会自己 `refreshAllMembers` 重新拉），只带变更信号 + memberId，和 `_record_computer_status_event` 一致。

**入口 1：`daemon_heartbeat`（上线方向）**
- `_upsert_daemon_workspace`（`agent_api.py:1399-1402`）改 status 前，先记 `previous_status = agent_member.status`（需要在 `_upsert_daemon_workspace` 内部返回旧值，或设 `_smallkhoj_previous_member_status` 标记，仿已有的 `_smallkhoj_realtime_changed`，line 1413-1415）。
- `daemon_heartbeat` 循环里（line 1843-1878），workspace 变更分支旁加：
  ```python
  prev = getattr(agent_member, "_smallkhoj_previous_member_status", None)
  if prev is not None and prev != agent_member.status:
      await _record_member_status_event(db, server, agent_member, previous_status=prev, action="heartbeat")
  ```

**入口 2：`daemon_shutdown`（下线方向）**
- `daemon_shutdown`（line 1948-1971）的循环里，`agent_member.status = "offline"`（line 1955）之前记旧值，之后判断变了就调 `_record_member_status_event(..., action="shutdown")`。

**两处都已有 `await db.commit()` + `await _push_committed_events(...)`**（heartbeat line 1901-1903、shutdown line 1974-1976），补发的 EventRecord 会被推到前端，机制成立。

### 后端改动 B：serialize_member 透出 workspace 启动状态（runtimeStatus）

**文件**：`backend/routers/member_serialization.py`

**位置**：`serialize_member`（line 97-118）的 payload 构建。

**改动**：给 agent member 的 payload 加一个 `runtimeStatus` 字段，取对应 workspace 的 status：
```python
if member.kind == "agent":
    # workspace_id 已在上面算出；查 workspace.status
    runtime_status = await _member_runtime_status(db, member, workspace_id)
    if runtime_status:
        payload["runtimeStatus"] = runtime_status
```
- `_member_runtime_status`：按 workspace_id 查 `AgentWorkspace.status`。`workspace_id` 可能为 None（刚创建还没 workspace），此时不透出。
- `PENDING_RUNTIME_START_STATUS`（如 "pending_start"）、"running"/"idle"/"stopped" 等 workspace 状态会透出，前端能据此判断"启动中"。

**注意**：`serialize_member` 已有 `_workspace_id` 预取参数（line 70）避免 N+1；`_member_runtime_status` 的查询也应尽量复用已有 prefetch 或走 `serialization_prefetch`，避免每个 member 多一次 DB 查询。确认 `serialization_prefetch.py` 里是否有 workspace 预取机制可复用。

### 前端改动（2 处）

#### 前端改动 A：让 ChatDataProvider 可被 client 刷新（解决 sidebar 不同步）

**文件**：`frontend/app/(app)/chat/chat-data-context.tsx`

**改动**：给 `ChatDataProvider` 加 client 端刷新能力：
- 内部用 `useState` 持有 `channels/dms/allMembers`，初始值来自 SSR props。
- 暴露 `refreshChatData()` 方法（通过 context value），client 端可调用它重新 fetch `/api/v1/channels`、`/api/v1/dms`、`/api/v1/members` 并更新 state。
- `chat-sidebar.tsx` 收到 member/workspace 事件时调 `refreshChatData()`。

**文件**：`frontend/app/(app)/chat/[channel]/chat-sidebar.tsx`

**改动**：加 `useRealtimeSubscription`，监听 `member.status.updated` 和 `workspace.updated` 事件，收到后调 `refreshChatData()` 刷新 sidebar 自己的列表。

**关于 SSE 连接数（重要）**：`useRealtimeSubscription` **不新建 SSE 连接**。`RealtimeProvider`（`components/realtime-provider.tsx`）在 `(app)/layout.tsx` 里已建立**一条共享 SSE 连接**（`RealtimeTransportOwner`，单连接 + 高水位去重）。`useRealtimeSubscription` 只是往这条共享连接注册一个回调，和 `channel-client.tsx:817`、`background-notification-tracker`、`activity-unread-tracker` 用的是同一个机制。所以 sidebar 加订阅**不增加连接数**，符合前端 SSE 优化约定（单连接、多订阅）。

#### 前端改动 B：DM 页面显示 agent 启动状态反馈

**文件**：`frontend/app/(app)/chat/[channel]/channel-client.tsx`

**显示位置（两个候选，需确认）**：

**候选 1（推荐）：MessageList 和 ChatComposer 之间，紧贴输入框上方的提示条**

位置在 `channel-client.tsx:1524-1526`（`<MessageList />` 和 `<ChatComposer />` 之间）插入一个条件渲染的提示条：
```tsx
<MessageList ... />
{dmAgentStatusBanner}   {/* ← 这里：仅 DM + agent 非正常状态时渲染 */}
<ChatComposer ... />
```
- 优点：用户发消息前一定看到；不挡消息内容；不改 MessageList 内部；类似 Slack "正在输入" 提示条的位置。
- 样式参考 files tab 已有的 `InkframeObjectSurface material="blocked"`（line 1384-1398）提示条样式，保持一致。

**候选 2：header 标题下的状态行**

位置在 `channel-client.tsx:1188-1190`（已有 `RuntimeChip` 显示 "私信"/"频道" 的那一行），加一个 peer 状态 chip：
```tsx
<div className="mt-0.5 flex items-center gap-2 text-xs text-sand-muted">
  <RuntimeChip>{currentIsDm ? tChat("directMessageChip") : tChat("channel")}</RuntimeChip>
  {dmAgentStatusChip}   {/* ← 这里：peer 状态 pill */}
</div>
```
- 优点：和头像并列，位置语义清晰（状态属于这个 agent）；不占消息区空间。
- 缺点：header 信息可能被忽略，用户直接打字时不会看 header。

**判定逻辑**（两种位置共用）：
- 用 `lib/agent-status.ts` 的 `getStatusBucket()` 判断。**优先读 `peer.runtimeStatus`（后端改动 B 新透出的 workspace 状态），fallback 到 `peer.status`**：
  ```ts
  const effectiveStatus = peer.runtimeStatus ?? peer.status
  const bucket = getStatusBucket(effectiveStatus)
  ```
  这样 `pending_start`/`starting` 等 workspace 状态能真正命中 `STARTING` 分支（之前纯前端方案里这是死代码，因为 `member.status` 只有 online/offline）。
- 仅在 `currentIsDm && dmAgent`（当前是 DM 且 peer 是 agent）时生效。
- `STARTING`（pending_start/starting/loading/restarting）→ "正在启动…"
- `OFFLINE`（offline，且 runtimeStatus 也不是启动中）→ "未在线，消息可能无法及时回复"
- `ACTIVE/THINKING/IDLE/ERROR` → 不显示。
- 不阻止发消息，只提示。

**i18n**：`messages/en.json`、`zh-CN.json` 加 `chat.agentStarting`、`chat.agentOffline`。

**文件**：`frontend/messages/en.json`、`frontend/messages/zh-CN.json`

---

## 改动清单

| 文件 | 改动 | 说明 |
|---|---|---|
| `backend/routers/agent_api.py` | 新增 `_record_member_status_event` helper（裸 EventRecord，仿 `_record_computer_status_event`）；`daemon_heartbeat` + `daemon_shutdown` 两处补发 | agent 上下线时前端都能收到信号（不污染 activity feed） |
| `backend/routers/member_serialization.py` | `serialize_member` agent payload 加 `runtimeStatus`（workspace.status） | 透出启动中状态，前端"正在启动"分支不再死代码 |
| `frontend/lib/control-plane.ts` | `Member` 类型加 `runtimeStatus?: string`（可选） | 类型对齐 |
| `frontend/app/(app)/chat/chat-data-context.tsx` | ChatDataProvider 加 client 刷新能力（useState + refreshChatData） | sidebar 可实时更新 |
| `frontend/app/(app)/chat/[channel]/chat-sidebar.tsx` | 加 `useRealtimeSubscription`（复用共享连接，不增连接数），收到 member/workspace 事件刷新 | sidebar 头像/列表实时同步 |
| `frontend/app/(app)/chat/[channel]/channel-client.tsx` | MessageList 和 ChatComposer 之间加启动状态提示条（候选 1），用 `peer.runtimeStatus ?? peer.status` 判定 | 用户知道 agent 没就绪 |
| `frontend/messages/en.json`、`zh-CN.json` | 加 `chat.agentStarting`、`chat.agentOffline` | i18n |

## 验证点

1. 创建 agent → 跳转 DM → agent daemon 上线后，**不刷新页面**，头像自动变 online、sidebar "Active agents" 出现该 agent。
2. agent daemon **下线**（shutdown/断开）后，不刷新页面，头像自动变 offline、sidebar 移出 Active agents。
3. DM 页面在 agent 启动期间（runtimeStatus = pending_start）显示"正在启动"提示，上线后消失。
4. agent offline 时显示降级提示，但不阻止发消息。
5. daemon 高频心跳不会刷屏（只在 status 真变时发事件）。
6. activity feed 不出现 "@agent updated @agent" 冗余条目（因为走裸 EventRecord 不写 ActivityLog）。

## 注意事项

- `daemon_heartbeat` 是高频接口（daemon 定期心跳），补发事件只在 status **真的变了**时发（对比 previous_status），避免每次心跳发冗余事件。
- `_record_member_status_event` 用裸 `EventRecord`（不写 ActivityLog），避免污染 supervisor activity feed——这是 `_record_computer_status_event` 已验证的正确模式。
- `serialize_member` 加 `runtimeStatus` 要注意 N+1：`workspace_id` 已有预取（`_workspace_id` 参数 / `member_workspace_id`），workspace.status 查询应复用 `serialization_prefetch` 机制。
- `ChatDataProvider` 加 client 刷新后，首次渲染用 SSR 值（不闪），client 刷新只在收到 SSE 事件后触发。
- `useRealtimeSubscription` 复用 `(app)/layout.tsx` 已有的**单条共享 SSE 连接**，不新建连接。
