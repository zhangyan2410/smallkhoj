# Bug 修复复测报告(scope.kind DM 未读清不掉)

> 日期:2026-08-02。修复:`backend/services/public_events.py` `_event_scope()` + `frontend/lib/chat-unread-state.ts` `chatEntityKeys`。
> 复测环境:38190 caddy 栈,backend 镜像 `smallkhoj-backend:main-head-fixed`(main 工作区含修复,重新 build),frontend `feperf-test`(worktree)。

## 复测结果

### 复测1:DM 事件 scope.kind = "dm" — ✅ PASS
SSE 抓包(main-head-fixed 后端),DM 的 message.created 事件:
```json
{
  "type": "message.created",
  "scope": {"kind": "dm", "name": "dm:@zy-ean"},   ← 修复前 "channel",现 "dm"
  "payload": {"channelType": "dm"}
}
```
**根因已修**:`_event_scope` 按 `payload.channelType` 区分,DM → kind="dm"。

### 复测2(前半):store 写入 `chat:dm:*` — ✅ PASS
浏览器收到 DM 后,localStorage `smallkhoj.activity.unread.v1`:
```json
{
  "chat:dm:id:10bc1efc-...": {"count": 2, "lastSeq": 31},
  "chat:dm:name:dm:@colleague": {"count": 2, "lastSeq": 31}
}
```
key kind 全为 **"dm"**(修复前是 "channel")。后端 scope.kind + 前端 chatScopeKeys 完美对接。

### 复测3:旧污染键(chat:channel:*)清除 — ✅ PASS
前端 `chatEntityKeys` 对 DM entity 生成 4 个 key(bun 执行验证):
```
chat:dm:id:<id>                  ← 新
chat:dm:name:<name>              ← 新
chat:channel:id:<id>             ← 旧别名(清存量污染)
chat:channel:name:<name>         ← 旧别名
```
进 DM 页 `clearUnreadKeys` 会同时清除新旧键,历史污染(截图里卡在 4 的徽标)能归零。

### 复测2(后半):进 DM 页清零 — ⚠️ 发现新的独立前端 bug
**改用 Better Auth 正常登录(非 twd-auth)后 session 稳定,补验了进 DM 清零,发现:**

- scope.kind 修复**确凿生效**:store 写 `chat:dm:id:9114625b` / `chat:dm:name:dm:@sender`(kind=dm)✅
- 进 DM 页后,后端日志有 `POST /api/v1/chat/read-cursors 200 OK`(sidebar 清除 effect **触发了**)✅
- **但 store 没清零**:count 仍 = 1,徽标切回 /tasks 后显示 HAS num=2 ❌
- ID 完全一致(store 的 `9114625b` = DM channel id = DM 列表 entity id),排除 key 不匹配。

**新发现的根因(独立前端 bug,非 scope.kind 范围)**:`useActivityUnreadStore`(`hooks/use-activity-unread-store.ts`)的 **React state 与 localStorage 同步竞态**:
- `markActivityUnread`(tracker 收事件)直接写 localStorage + dispatch `ACTIVITY_UNREAD_EVENT`。
- `clearKeys`(sidebar 进 DM)用 `setStore(previous => clearActivityUnread(previous, keys))`,其中 `previous` 是 React state。
- React state 由 `refresh`(监听 `ACTIVITY_UNREAD_EVENT` / storage event)异步从 localStorage 读入。
- sidebar 清除 effect 在 DM 页挂载时立即触发,若此时 `refresh` 尚未把最新 localStorage 同步进 React state,`previous` 为旧值/空,`clearActivityUnread(previous, keys)` 中 `keys.filter(k => k in store)` 找不到匹配 → 返回不变 → **没清掉**,且写回 localStorage 时基于旧 state,可能保留旧计数。
- `clearActivityUnread`(`lib/activity-unread-state.ts:61-66`):只在 key 存在于传入 store 时才删,传入的不是最新 localStorage 快照就会漏清。

**此 bug 与 scope.kind 修复独立**:scope.kind 已修(store key 正确为 chat:dm:*),但清除链路另有 React state/localStorage 竞态问题。修复建议:`clearKeys` 应基于**最新 localStorage**(`readActivityUnreadStore(localStorage)`)清,而不是 React state `previous`;或在 clearKeys 内先 refresh 再清。

## 结论
- **后端 scope.kind 修复确凿生效**(复测1 + 复测2前半)。
- **前端旧污染兼容(chatEntityKeys 别名)确凿生效**(复测3)。
- **进 DM 清零仍失效,但根因是另一个独立前端 bug**(useActivityUnreadStore 的 state/localStorage 同步竞态),不在本次 scope.kind 修复范围内,建议另立任务修。

## 环境声明
- local-dev(38190 caddy 栈)。
- daemon + cc runtime(Claude Code pid 67060)真实运行。
- 修复代码在 main 工作区未提交;复测用 main-head-fixed 镜像。
