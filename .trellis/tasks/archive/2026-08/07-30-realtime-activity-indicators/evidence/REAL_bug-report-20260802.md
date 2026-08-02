# Activity 指示器 Bug 报告(用户 UI 复现 + 代码根因定位)

> 范围:`07-30-realtime-activity-indicators`。代码在 worktree `feat/frontend-perf-optimization`。
> 复现环境:38190 caddy 栈。
> **后端:已用 main HEAD(commit `fddcf2e`,2026-08-02)重新 build 镜像 `smallkhoj-backend:main-head` 复现,Bug A 在最新后端代码上确认成立**(非旧镜像伪影)。
> **前端:worktree 待测代码镜像 `smallkhoj-frontend:feperf-test`**。
> zy-ean(human)与 agent member `cc` 的 DM,以及与 colleague(human 空壳)的 DM。

## Bug A(确凿,后端):进 DM/频道后未读清不掉,徽标数字不归零

**现象(用户 UI 复现)**
- 收到 DM 后,AppRail 的 chat 图标出现未读徽标(数字)。
- 点击进入该 DM 会话,**徽标数字不归零**;切到别的页面再切回来,数字仍在。
- 侧栏该 DM 项的红点也不清除。

**根因(代码定位,确凿,main HEAD 实测)**
后端构造 SSE event 的 scope 时,对 `message.*` 事件**统一用 `kind="channel"`,不区分 DM**:

**main-head 实测证据**(从 `smallkhoj-backend:main-head` 的 SSE 流抓取的真实事件):
```json
type: message.created
scope: {"kind": "channel", "id": "10bc1efc-...", "name": "dm:@colleague"}   ← kind 是 "channel",不是 "dm"
```
这是一条 DM 消息(channelType=dm)产生的事件,但 scope.kind 仍是 "channel"。
- `backend/services/public_events.py` `_event_scope()`(message.* 分支,约 283-290 行):
  ```python
  if event_type.startswith("message.") or ...:
      scope: dict[str, Any] = {"kind": "channel"}   # ← DM 也被标成 channel
  ```
- 因此前端**递增**未读时,`chatScopeKeys(scope)` 用 `scope.kind="channel"` 生成 key:`chat:channel:id:<id>` / `chat:channel:name:dm:<name>`。

但前端**清除**未读时,用的是 entity 的 type(DM 的 `type="dm"`):
- `frontend/lib/chat-unread-state.ts:62` `entityKind(value)`: `value === "dm" ? "dm" : "channel"`
- `frontend/lib/chat-unread-state.ts:74` `chatEntityKeys(entity)` 对 DM entity 生成 key:`chat:dm:id:<id>` / `chat:dm:name:<name>`。

**key 的 kind 段不一致(channel ≠ dm),导致 `clearUnreadKeys` 清的 key 不在 store 里,清不掉。** 实测 store 里恒为 `chat:channel:*`,清除尝试写的是 `chat:dm:*`。

**连锁后果**
- `chat_thread_read_cursors` 表不写入(进 DM 时 `apiPost("/api/v1/chat/read-cursors")` 虽 HTTP 200,但后端按 thread/root 维度写,DM channel 级 cursor 不落库——需后端确认)。
- 未读只增不减,数字越累越大(用户看到的"4"即多次累加)。

**修复方向(交给实现方)**
后端 `_event_scope` 对 DM channel(type=="dm")应返回 `{"kind": "dm", ...}` 而非 `"channel"`。需在 message.* 分支查 channel 的 type 判断;或前端两侧统一 kind 取值(但后端语义上 DM 就是 DM,改后端更合理)。改后需保证 `chatScopeKeys`(递增)和 `chatEntityKeys`(清除)生成的 key 在 kind 上一致。

---

## Bug B(确凿,前端):徽标聚合数字与实际未读会话数不符

**现象(用户 UI 复现)**
- AppRail chat 图标徽标显示"4",但实际只有 1~2 个 DM 有未读,且消息数对不上。

**根因**
`frontend/components/app-rail.tsx` 的 chat 徽标把 `smallkhoj.activity.unread.v1` 里**所有 `chat:` 前缀键的 count 相加**作为展示数(聚合)。由于 Bug A 导致 store 只增不清,历史累加的多个 channel 键(包括已不存在的旧 channel id、测试残留)的 count 全部累加,数字虚高。

**修复方向**
- 主修 Bug A(清不掉是根因,修了 store 能正常归零,数字自然准)。
- 次要:徽标聚合应只统计**当前仍存在的会话**(过滤掉已删除 channel 的 key),或在清除时彻底删除 key(目前 `clearActivityUnread` 是 delete key,但前提是 kind 匹配——被 Bug A 阻断)。

---

## 关于"自己发的消息被计入未读"——经核实不是 bug

> 我之前报了这个,经代码核实**推翻**,在此更正,避免实现方误修。

**核实结论**:self-filter 逻辑正确,会排除自己发的消息。
- `frontend/lib/activity-unread-state.ts:200-201`:
  ```ts
  const sender = normalizeSender(message?.sender)  // "@zy-ean" → "zy-ean"
  if (sender && currentMemberNames.some(name => normalizeSender(name) === sender)) return []
  ```
- `currentMemberNames`(`frontend/app/(app)/layout.tsx:29-32`)= `[member.name, member.displayName, member.handle]` = `["zy-ean","zy-ean","@zy-ean"]`,normalize 后全为 `"zy-ean"`,与 sender `"@zy-ean"`→`"zy-ean"` 匹配 → 返回 `[]`(不计)。
- 我之前观察到"自发被计",是因为测试时 tab 停在 DM 页 + 用了错误的 channel(sender 字段实际是 `@colleague`),误判。**此条不构成 bug。**

---

## 复现步骤(供实现方验证)

环境:38190 caddy 栈或任何 SSE 不被缓冲的环境(dev :3000 的 Next 代理会缓冲 SSE,不能用)。
1. zy-ean 登录,停在 `/tasks`(非 chat 页)。
2. 从另一个真实成员(agent runtime 或任一 server 内成员)向 zy-ean 发 DM。
3. 观察:AppRail chat 出现徽标(正常)。store 出现 `chat:channel:id:<dm-id>`(注意是 channel 不是 dm)。
4. 点击进入该 DM 会话。
5. 观察:**徽标不归零**,store 里 `chat:channel:id:<dm-id>` 仍在,`chat_thread_read_cursors` 无新行。
6. 切到 /tasks 再切回该 DM,数字仍在。

## 关键文件:行号
- 后端 scope 构造(根因):`backend/services/public_events.py` `_event_scope()` message.* 分支(约 283-290)
- 前端递增 key:`frontend/lib/chat-unread-state.ts:83-91` `chatScopeKeys`
- 前端清除 key:`frontend/lib/chat-unread-state.ts:74-81` `chatEntityKeys` + `:62-64` `entityKind`
- 前端清除触发:`frontend/app/(app)/chat/[channel]/chat-sidebar.tsx:45-62`
- 徽标聚合:`frontend/components/app-rail.tsx`(chat 图标)
- self-filter(已排除):`frontend/lib/activity-unread-state.ts:200-201`
