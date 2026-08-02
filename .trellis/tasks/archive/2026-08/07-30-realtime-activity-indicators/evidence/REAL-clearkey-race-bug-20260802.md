# Bug 报告:进 DM/频道后未读清不掉(React state 与 localStorage 同步竞态)

> 这是独立于 scope.kind 修复的另一个前端 bug。scope.kind 已修(store key 现在正确为 `chat:dm:*`),但进 DM 清除仍失效,根因在此。
> 复现环境:38190 caddy 栈,Better Auth 正常登录(session 稳定),worktree 前端 + main-head-fixed 后端。

## 现象(用户可见 + 实测)
- 收到 DM → chat 徽标出现(count 写入 `chat:dm:*`,scope.kind 修复后 key 正确)。
- 点进该 DM 会话 → 徽标**不归零**(切回 /tasks 仍显示 HAS,count 还在)。
- 实测:进 DM 时后端有 `POST /api/v1/chat/read-cursors 200 OK`(sidebar 清除 effect **触发了**),但 localStorage store 没清掉。
- store key 与 entity id 完全一致(已排除 key 不匹配):store `chat:dm:id:9114625b` = DM channel id = DM 列表 entity id。

## 根因(代码定位,确凿)
**两条写入路径不同步**:
1. **递增路径**(`components/activity-unread-tracker.tsx:53`):tracker 收 SSE 事件 → `markActivityUnread` → 直接 `writeActivityUnreadStore(localStorage)` + `notifyActivityUnreadChanged`(dispatch `ACTIVITY_UNREAD_EVENT`),**绕过 React state**。
2. **清除路径**(`hooks/use-activity-unread-store.ts:40-45`):sidebar 进 DM → `clearKeys` → `setStore(previous => { const next = clearActivityUnread(previous, keys); writeActivityUnreadStore(localStorage, next); return next })`,**`previous` 是 React state,不是最新 localStorage**。

React state(`store`)由 `refresh` 异步从 localStorage 读入(`useEffect` 里 `setTimeout(refresh, 0)` + 监听 `ACTIVITY_UNREAD_EVENT`/`storage` event)。**竞态**:sidebar 的清除 effect(依赖 `channels/dms/currentChannelName`)在 DM 页挂载时立即触发,若此时 `refresh` 尚未把 tracker 最新写入的 localStorage 同步进 React state,`previous` 为旧值/空 → `clearActivityUnread(previous, keys)`(`lib/activity-unread-state.ts:61-66`)中 `keys.filter(key => key in store)` 找不到匹配 → 返回 `store` 不变 → **没清掉**,且 `writeActivityUnreadStore` 写回的是基于旧 state 的版本。

即使 `previous` 恰好是最新,`clearActivityUnread` 写回后 React state 更新了,但**下一次 tracker 递增又会直接覆写 localStorage**(不经 React state),清除结果可能被后续递增覆盖,反之亦然。两条路径各写各的,没有单一真源。

## 关键文件:行号
- `hooks/use-activity-unread-store.ts:19-50`:store state 初始化(`useState({})`)、refresh(异步)、clearKeys(用 `previous`)。
- `lib/activity-unread-state.ts:61-66` `clearActivityUnread`:只在 key 存在于传入 store 时才删。
- `lib/activity-unread-state.ts:152-162` `markActivityUnread`:直接写 localStorage + dispatch event,不经 React state。
- `components/activity-unread-tracker.tsx:45-59`:递增路径,调 markActivityUnread。
- `app/(app)/chat/[channel]/chat-sidebar.tsx:45-62`:清除触发点,调 `clearKeys(chatEntityKeys(activeEntity))`。

## 修复方向(交给实现方,二选一或组合)
1. **clearKeys 基于最新 localStorage**(最直接):在 `clearKeys` 内先 `readActivityUnreadStore(localStorage)` 拿最新快照,`clearActivityUnread(最新快照, keys)`,再 `writeActivityUnreadStore` + `setStore`。不依赖 React state 的 `previous`。
2. **统一写入真源**:让 tracker 的递增也走 `setStore`(或一个 external store + useSyncExternalStore),使 React state 与 localStorage 始终一致,清除和递增都操作同一真源。这是更彻底的修法,参考 React `useSyncExternalStore` 模式处理 external store(localStorage)。

推荐方案 1(最小改动、风险低):只改 `clearKeys` 一处,确保清除基于最新 localStorage 快照。

## 验证方式
1. Better Auth 正常登录(非 twd-auth,避免 session 干扰)。
2. 停 /tasks,从另一成员发 DM → store 出现 `chat:dm:*` count>0,徽标 HAS。
3. 点进该 DM → store 清零(count 消失或归 0),徽标 NO。
4. 切回 /tasks → 徽标仍 NO(不复活)。
5. `chat_thread_read_cursors` 表有新行(read-cursor 回写,可选)。
6. 边界:连续快速收多条 DM 后立即进 DM,确认竞态下也能清(方案1 应能覆盖)。

## 关联
- scope.kind 修复(`backend/services/public_events.py` `_event_scope` + `frontend/lib/chat-unread-state.ts` `chatEntityKeys`)已生效,见 `REAL-fix-verify-20260802.md`。
- 本 bug 是清除链路独立问题,修了 scope.kind 但不清除仍失效,根因在此。
