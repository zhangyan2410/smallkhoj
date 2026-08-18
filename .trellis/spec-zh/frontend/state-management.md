# 状态管理

> 前端状态如何被拥有、持久化和刷新。

SmallKhoj 的 web 前端今天刻意保持简单：服务器数据通过 Next 服务器
组件/actions 和 `lib/control-plane.ts` 获取；客户端状态是本地 React 状态或
路由局部 context。除非状态跨路由，且无法用 URL/search 参数、服务器数据或
一个小型 provider 表示，否则不要添加全局状态层。

---

## 状态类别

| 类别 | 拥有者 | 示例 | 持久化 |
| --- | --- | --- | --- |
| 服务器状态 | 后端 API + 服务器组件 | tasks、members、computers、channels、activity | 后端数据库 |
| URL 状态 | 路由/搜索参数 | 选中的成员、选中的计算机、当前标签/过滤器 | 浏览器 URL |
| 本地 UI 状态 | 客户端组件 | 对话框开关、输入区（composer）草稿文本、悬停/展开的局部控件 | 仅内存 |
| 持久偏好 | 浏览器偏好层 | 主题、可调面板宽度 | 带命名空间的 `localStorage` |
| 路由局部共享状态 | 就近放置的 provider | chat 频道/dm/成员数据 | 仅内存 |

---

## 必需模式

### 服务器状态保持服务器所有

服务器获取的数据必须在服务器 actions 之后由 `revalidatePath()` 刷新，或在
runtime 事件（event）到达时由既有的实时刷新路径刷新。不要为了过滤、排序或
渲染而把服务器数据拷贝进本地组件状态。

> **`router.refresh()` 与外壳 chrome：** `router.refresh()` 重新获取当前
> 路由的服务器组件，但**不会**重建树中更高层的布局（layout）。因为工作台
> chrome（栏 + 背景）位于 `app/(app)/layout.tsx`，`router.refresh()`（被
> `RealtimeRefresh`、发送后的输入区、计算机连接轮询使用）刷新路由数据而
> 不拆卸外壳——实时驱动的刷新不再造成可见的"工作台重载"。不要把 chrome
> 移回每页组件，否则 `router.refresh()` 会开始重建它。
>
> **`cache()` 键（服务器去重（dedup））：** React 的 `cache(fn)` 按
> **参数引用同一性**去重，而不是按深度相等。接受每个调用方新建对象的
> 辅助函数（例如 `serverApiHeaders()`）不会跨 layout↔page 去重。让数据
> 获取辅助函数不带参数，并在其中通过 `cache()` 包裹的
> `currentAccount()`/`getSessionToken()` 解析认证。
> 见 `app/chat/chat-server-fetches.ts`。

### URL 状态是可分享选择的唯一事实来源

如果用户可以收藏书签或刷新视图并应保持相同的选择，就用 URL。示例：选中的
任务/成员/计算机、标签键、过滤器。用 `searchValue()` 这类小辅助函数归一化
查询串取值，而不是在 JSX 里反复处理 `string | string[] | undefined`。

### 本地状态仅用于瞬态交互

为导航后应复位的 UI 机制使用本地 `useState`：对话框开关状态、草稿文本、
临时错误文本、拖拽状态，或乐观的按钮禁用状态。

### 持久偏好必须水合（hydration）安全

对存在 `localStorage` 的偏好，先渲染确定性的默认值，挂载后再读取存储值。
这可以防止"服务器渲染宽度 X 但客户端渲染宽度 Y"这一类水合 bug。

### 路由局部 provider 允许，但必须保持局部

当同一路由下的多个兄弟组件需要同一份稳定的派生数据时，使用路由局部
context。让 provider 就近放在 `app/<route>/` 下，除非另一条路由确实需要，
否则不要把它提升为全局 provider。

---

## 何时添加全局状态

仅当以下全部为真时才添加全局 store：

1. 该状态仅限客户端。
2. 多个不相关路由需要读或写它。
3. 它无法用 URL 状态或持久偏好表示。
4. 服务器所有权对该交互是错误的或太慢。

如果将来引入全局 store，先在这里记录它的所有权、持久化和重置规则，再广泛
使用。

---

## 错误 vs 正确

### 错误

把服务器组件里的 `tasks` 拷贝进客户端全局 store，在本地修改它，然后指望
`revalidatePath("/tasks")` 最终修好漂移。

### 正确

让任务保持服务器所有，变更走服务器 actions 或 API 辅助函数，调用
`revalidatePath("/tasks")`，本地状态只用于对话框或 pending 提示。

---

## 场景（scenario）：有界游标（cursor）消费与共享浏览器实时

### 1. 作用域 / 触发

- 触发：新增一个游标分页列表消费者、挂载实时订阅者、切换活跃服务器/账户作用域，或投影 `task.*` 浏览器事件。

### 2. 签名

- 通用遍历：`fetchAllCursorPages<T>(fetchPage, {maxPages?}) -> Promise<T[]>`。
- 任务遍历：`fetchAllTaskPages<T>(fetchPage, options?) -> Promise<T[]>`，使用 `limit=200`。
- 传输所有者：`RealtimeTransportOwner`。
- Provider：`RealtimeProvider({serverId})`，由 `app/(app)/layout.tsx` 挂载（应用外壳布局；自 07-24 fast-path 工作以来 ProductShell 只含主体）。
- 订阅 hook：`useRealtimeSubscription(callback)`。
- 任务失效事件：`smallkhoj:tasks-invalidated`。

### 3. 契约

- 需要完整任务集合的前端要跟随 `nextCursor` 直到 null；不得默默把第一个
  有界页当作完整集合。
- 遍历有有限的页数上界，对游标做 URL 编码，拒绝重复游标，并保持类型化的
  条目形状而不用 `any`。
- 一个已认证账户/活跃服务器作用域拥有一个物理 SSE 获取。订阅者共享传输和
  高水位（high-water）状态。
- 作用域切换会递增世代（generation）、停止/中止旧传输、清空高水位标记，并
  忽略失效（stale）回调。最后一个订阅者取消订阅/卸载时关闭物理流。
- 任务事件投影为任务数据失效。`TaskBoard` 重新获取每个有界任务页，并重新
  应用频道/创建者/受理人/状态过滤器。无关事件不引起任务重新获取。
- `RealtimeRefresh` 仍可为被显式接受的非任务事件刷新某条路由；不得把每个
  事件都变成未指明的整页刷新。
- 本契约不主张每个服务器渲染的任务摘要（summary）/列表/详情区域都变成
  客户端实时。大范围的服务器/客户端拆分需要单独的架构任务。
- SSE 断连自动重连并带封顶指数退避：
  `delayMs = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000)`
  （在 `connectRealtimeEvents`，`lib/realtime-events.ts`），且每次成功连接后
  `attempt` 归零。不要为传输添加手动"重连"UI 或无上限重试循环。
- 新增一种实时事件类型需要对每个 `RealtimeRefresh` 的 `eventTypes` 列表做
  逐页审计。教训：`member.created` 上线时没有在 `/members` 订阅，导致
  花名册（roster）更新默默漏掉该路由。新事件类型落地时，grep 所有
  `<RealtimeRefresh eventTypes={...}>` 消费者，并逐条有意更新每个受影响的
  路由。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| `nextCursor` 为 null/缺失 | 停止并返回已累积的条目。 |
| 游标重复 | 抛出 `Cursor pagination repeated cursor`；绝不循环。 |
| 页数超过上界 | 抛出有界遍历错误。 |
| 同一作用域挂载第二个订阅者 | 复用既有的物理传输。 |
| 认证/服务器作用域变化 | 中止旧世代；存在订阅者时至多启动一个新传输。 |
| 旧世代的失效事件到达 | 忽略它。 |
| `task.*` 事件到达 | 发出定向的任务失效，并按所有者的高水位决策只重新获取一次任务页。 |

### 5. 好/基线/坏案例

- 好：一个有 205 条的 runtime 先返回 200 条加一个游标，再返回 5 条；`/tasks` 渲染第 204 条并报告完整的初始集合。
- 好：TaskBoard、任务记忆（memory）、chat 和路由刷新订阅者共享一条已建立的后端 SSE socket。
- 基线：没有订阅者挂载；所有者保留作用域元数据但不打开传输。
- 坏：每个 `RealtimeRefresh` 或特性组件直接调用 `connectRealtimeEvents`。
- 坏：只 `apiGet('/api/v1/tasks')` 一次，或没有重复游标/页上界防护的递归翻页循环。

### 6. 必需测试

- 单元：三页合并、null 终止、游标编码、重复游标、页上界、非法上界。
- 静态消费者清单：每个全量任务消费者都导入/使用共享的任务遍历，且只有 provider 创建物理传输。
- 所有者生命周期：多订阅者/一次工厂调用、作用域中止、失效回调拒绝、最后取消订阅、dispose。
- 投影：任务事件定向到任务失效；无关事件被忽略或走其显式路由投影。
- 运行时/UI：带 200+ 任务的真实 PostgreSQL/API、`./twd` 尾部条目断言、一条稳定的 ESTABLISHED SSE socket、一次 marker 应用。

### 7. 错误 vs 正确

#### 错误

```tsx
useEffect(() => connectRealtimeEvents(...), []) // repeated in every leaf
const { tasks } = await apiGet('/api/v1/tasks') // silently first page only
```

#### 正确

```tsx
<RealtimeProvider serverId={session.server.id}>{children}</RealtimeProvider>
const tasks = await fetchAllTaskPages((path) => apiGet(path, emptyPage))
```

---

## 场景：领域 × 作用域未读（unread）活动层

### 1. 作用域 / 触发

- 触发：为任何领域添加未读/"unseen" 指示器、把新领域接入通知，或改动共享的浏览器实时未读计数器（任务 `07-30-realtime-activity-indicators`、`07-30-background-notifications`）。

### 2. 签名

- Store：`frontend/lib/activity-unread-state.ts` — `ActivityUnreadStore`、`markActivityUnread`、`clearActivityUnreadMarked`、`resetActivityUnreadHighWaterMarked`、`activityUnreadKeysForEvent`、`activityUnreadSeqForEvent`、`activityUnreadClearKeysForPath`。
- Chat 领域键派生：`frontend/lib/chat-unread-state.ts` — `chatScopeKeys`、`chatEntityKeys`、`chatReadCursorRequestForEntity`。
- 当前视图注册表：`frontend/lib/current-chat-view.ts` — `setCurrentChatView`、`currentChatChannelId`。
- 通知映射：`frontend/lib/background-notifications.ts` — `planNotificationForEvent`、`offerThrottledNotification`、`flushThrottledNotifications`；偏好位于 `frontend/lib/notification-preferences.ts`。
- 展示原语：`EventBadge`（`components/inkframe-object-ui.tsx`）、`ActivityDot` / `ActivityCountBadge` / `ActivityIndicator`（`components/activity-indicator.tsx`），由 `hooks/use-activity-indicator.ts` 供数。

### 3. 契约

- 未读状态是一个 领域 × 作用域 的两级键 store，持久化在
  `smallkhoj.activity.unread.v1`：实体键 `chat:{channel|dm}:id|name:<v>`，
  加上聚合键 `task:all` 与 `activity:all`。新领域意味着在这个 store 里新增
  一个前缀——绝不是另建一个平行 store。
- 计数器由 SSE 事件递增（tracker 在 `components/activity-unread-tracker.tsx`）。
  聊天键去重使用频道内 `messageSeq` 高水位（`activityUnreadSeqForEvent`），
  而不是全局事件 `seq`：全局 seq 是跨作用域的数据库身份，按每键做全局 seq
  高水位会让兄弟频道里合法的新消息互相吞掉。聚合键
  （`task:all`/`activity:all`）保留全局 `seq`。
- 进入路由只清空聚合键（`activityUnreadClearKeysForPath`：`/tasks` →
  `task:all`，`/daemon` → `activity:all`）。chat 领域绝不按路由整体清空——
  chat 按实体键清空，并配合服务器读游标校准
  （`chatReadCursorRequestForEntity`）。
- "当前正在查看"由 `current-chat-view` 注册表按 `scope.id` 判定
  （`currentChatChannelId() === event.scope.id`），而不是按名字匹配：DM 的
  `scope.name` 是内部 `dm:{idA}-{idB}` 形式，永远不等于可路由的
  `/chat/<handle>` 名字。名字比较只对频道有效。
- SSE 追赶（重连/epoch 变化）使本地聊天高水位标记失效
  （`resetActivityUnreadHighWaterMarked`）：失效的水位线会默默吞掉重放的
  事件；宁可重新计数、让实体进入时的清除 + 读游标校准去吸收多算，也好过
  少算。
- 展示原语是无状态的：`EventBadge` / `ActivityIndicator` 只接收展示 props
  （`hasUnread`/`count`），绝不订阅事件；订阅放在 hook 里。任何要集成未读
  指示器的新领域都必须复用这一层及其原语——禁止另建第二套未读 store/
  事件系统。
- 通知侧（`background-notifications.ts`）：当相关路由可见且文档聚焦时不发
  通知；重放事件通过共享的实时 epoch/seq 高水位决策丢弃
  （`decision.action === "drop"`）；同作用域通知在
  `NOTIFICATION_THROTTLE_WINDOW_MS = 30_000` 内折叠为一条；被拒绝的
  `Notification.permission` 静默降级（tracker 在规划前返回，无错误、不骚扰）；
  点击经规划的 `href` 映射导航——DM/提及 → `/chat/<name>`，任务 →
  `/tasks?task=<id>`，记忆 → 按作用域 `/chat/<name>` | `/tasks?task=<id>` |
  `/daemon`。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 同一消息在同一聊天键上重放 | `seq <= highWater` 跳过递增；计数不变。 |
| 频道 A 全局 seq 更高时，频道 B 有新消息 | 聊天键使用 `messageSeq`，因此该事件计数。 |
| 用户进入 `/tasks` | `task:all` 清空；聊天键不动。 |
| 用户查看自己打开着的那个 DM | `currentChatChannelId() === scope.id` → 不递增（名字匹配会失败）。 |
| SSE 追赶重放聊天事件 | 先重置聊天键高水位；重放重新计数。 |
| 路由可见 + 文档聚焦 | 该事件没有系统通知。 |
| 30 秒内同作用域的第二条通知 | `queued`；稍后作为一条折叠的"N 条新"通知刷出。 |
| `Notification.permission !== "granted"` | tracker 静默退出；不浮出错误。 |

### 5. 好/基线/坏案例

- 好：`tasks` 领域通过在 `activityUnreadKeysForEvent` 里增加 `task:all` 递增、并在栏里放一个 `ActivityIndicator` 落地——零个新 store。
- 好：聊天徽标（badge）经 `localStorage` 在重载后存活，并与服务器 `unreadCount` 对账（本地与服务器取最大）。
- 基线：通知权限被拒；未读徽标仍工作，通知静默关闭。
- 坏：某特性自建带自己 change 事件的 `localStorage` 未读计数器。
- 坏：聊天去重以全局事件 `seq` 为键，或用 DM 的 `scope.name` 与路由段比较来判定"正在查看"。

### 6. 必需测试

- 单元：多键递进去重、追赶时高水位重置、按路径清空投影、自己消息的抑制（suppress）、DM id 当前视图抑制。
- 单元：通知规划矩阵（可见+聚焦、频道仅提及、自己的事件、节流 offer/flush）。
- 跨标签页：store 的 change 事件（`smallkhoj:activity-unread`）更新已挂载的消费者（AppRail）而无需重挂载。

### 7. 错误 vs 正确

#### 错误

```ts
localStorage.setItem("myfeature.unread", String(n)) // parallel store
if (event.scope.name === routeSegment) return []   // DM never matches
```

#### 正确

```ts
markActivityUnread(storage, window, activityUnreadKeysForEvent(event, {
  pathname, currentMemberIds, currentChatChannelId: currentChatChannelId(), chatScopeKeys,
}))
```
