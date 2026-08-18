# 稳定的成员身份与频道上下文契约（contract）

## 1. 作用域（Scope）/ 触发条件

只要代码创建、序列化、解析、提及（mention）、加入、移除或为人类（Human）或
Agent 打墓碑（tombstone），或某个 runtime 接收频道（Channel）成员上下文，
就适用本契约。这些路径横跨 PostgreSQL、公共与 Agent API、daemon 投递以及
浏览器投影；某一层里的一个兼容别名会在其他所有层悄悄重新引入可变身份语义。

产品把这个不可变值称为**名字（Name）**。代码和数据库字段称之为 `handle`。
`displayName` 仅是可选的人类账户（Account）呈现；它绝不是 Agent 字段、查找键、
提及目标或面向 Agent 的值。

## 2. 签名

### 领域函数

```python
normalize_handle(raw: object) -> HandleValue       # NFC handle + NFKC/casefold key
normalize_description(raw: object) -> str | None   # Agent-only, trimmed, <= 200
parse_member_reference(token: object) -> ParsedMemberReference
generate_server_handle() -> str                    # s + 4 Crockford Base32 chars
```

### 数据库身份

```text
Server.server_handle: immutable, unique, ^s[0-9abcdefghjkmnpqrstvwxyz]{4}$
Account.auth_subject: immutable, unique
Account.home_server_id: required, unique
Account.display_name: optional Human presentation
Member.origin_server_id: required, immutable
Member.account_id: required for Human, NULL for Agent
Member.handle / handle_key: required, immutable
Member.description: Agent-only, optional, <= 200 Unicode code points
Member.deleted_at: Agent tombstone marker
Channel.membership_revision: monotonic integer
Message.mentions: Member UUID[]
```

### 公共与 Agent API

```text
GET    /api/v1/auth/name-preview?name=<Name>
GET    /api/v1/members/agents/name-availability?name=<Name>
POST   /api/v1/members/agents
PATCH  /api/v1/members/{memberId}
DELETE /api/v1/members/{agentId}
POST   /api/v1/channels/{channelId}/members
DELETE /api/v1/channels/{channelId}/members/{memberId}
GET    /api/v1/channels/{channelId}/members
POST   /api/v1/channels/{channelName}/messages
GET    /internal/agent-api/channel-members
POST   /api/v1/servers                              # always 410
```

所有生产环境的频道成员关系（membership）变更都调用
`services.channel_membership.add_channel_member()`、
`remove_channel_member()` 或 `remove_agent_from_all_channels()`。

Agent API 大小写与认领契约（06-02 任务 `06-02-P0-backend-core-api`）：

- agent API 服务两类 JSON 大小写不同的客户端家族：daemon 的 Slock CLI 发送
  snake_case（`task_numbers`、`task_number`、`message_ids`），而 Web/JS 客户端
  发送 camelCase（`taskNumbers`、`taskNumber`、`messageIds`）。
  `POST /internal/agent-api/tasks/claim` 和 `/tasks/update-status` 必须同时
  接受两种拼法——`taskNumber` / `task_number` / `number`，在没有标量时由
  列表形式（`task_numbers` / `taskNumbers`、`message_ids` / `messageIds`）
  取第一个元素。丢弃一种拼法会悄悄破坏一个在线客户端家族。
- 任务认领是一把乐观锁：认领查询在调用者的服务器作用域内过滤
  `Task.assignee_id IS NULL AND Task.status = 'todo'`，无匹配时返回 404
  `No unclaimed task found`。绝不要在那个原子 WHERE 过滤之外用"先读后写"
  的方式实现认领；并发的认领者绝不能同时获胜。

## 3. 契约

### 名字与引用契约

- 修剪后的 NFC 名字存入 `Member.handle`；其 NFKC + 大小写折叠的查找键存入
  `Member.handle_key`。
- 名字由 1–32 个 Unicode `L*`/`Nd` 字符组成，可含可选的内部 ASCII 连字符。
  以保留后缀 `-s<four Crockford chars>` 语法结尾的名字会被拒绝，以保证限定
  引用仍可解析。
- 一台来源服务器（Server）只有一个活跃的人类/Agent 名字命名空间。人类名字
  永久保留。Agent 名字只有在打墓碑后才能复用，且复用会插入新的 Member UUID。
- 当前频道成员关系就是引用作用域。唯一的名字投影为 `@name`；同名冲突中的
  每个成员投影为 `@name-serverHandle`。
- `Message.sender_id` 和 `Message.mentions` 保持 UUID 归因。成员关系变化后
  绝不重写消息内容。

### 账户与服务器契约

- 一个账户在一个事务里恰好引导一个主服务器、一个人类成员和一个所有者
  `ServerMembership`。
- 可选的官方服务器自动加入：当 `OFFICIAL_SERVER_HANDLE` 指向一个已存在的
  服务器时，同一个注册事务还会为该服务器写入一条普通 `member`
  `ServerMembership`（同一个人类成员 UUID，绝不拷贝）。该钩子只在
  `bootstrap_account()`（`services/account_bootstrap.py`）的 create 分支
  运行；断点续跑绝不重复成员关系，官方账户自己的主服务器跳过自加入，空或
  未知 handle 则跳过自动加入且不让注册失败。
- 加入另一台服务器会新增一条指向同一个人类成员 UUID 的 `ServerMembership`。
  它绝不创建服务器本地的人类副本。
- Agent 拥有不可变的来源服务器，且只能加入属于它的频道。Agent 绝不能占据
  `ServerMembership`。
- 任意创建服务器已被移除：`POST /api/v1/servers` 返回 410。

### 序列化契约

- 通用成员载荷（payload）使用原始 `name`/`handle` 和带上下文的 `reference`。
- Agent 载荷可以包含 `description`；它们绝不包含 `displayName` 或
  `profile.displayName`。
- 人类 `displayName` 只能出现在显式面向人类的投影上。
  `load_agent_channel_roster()` 和每个 Agent API/runtime/CLI 投影都必须
  避免查询或序列化它。
- 通知与任务分配的目标定位信任已持久化的 Member UUID，而不是正文子串、
  ASCII 提及正则或显示标签。

### 频道上下文与事件（event）契约

- 进入某个 runtime 的频道上下文会注入一份完整的当前快照（snapshot）。
  同频道的 Agent Description 只能出现在那份快照里。
- 一次真实的添加/移除会锁定频道、把 `membership_revision` 递增一次，并写入
  一条持久化的 `channel.member_joined` 或 `channel.member_left` 事件。
- 紧凑事件载荷包含 `channelId`、`rosterRevision`、变更的
  `member { memberId, kind, reference }`，以及冲突 `referenceUpdates`。
  它们不含 Description、人类 displayName 或完整花名册（roster）。
- daemon 注册表按 Agent 启动与频道为上下文建立键，对事件 ID/修订号
  （revision）重放去重（dedup），并在修订号出现间隙时重新拉取。
- runtime 指令声明成员关系是易变的：只保留最新的工作花名册，替换被取代的
  引用，不把花名册变化固化为持久的角色/任务假设，也不仅为了确认收到更新
  而回复。
- 被移除的 Agent 可能收到那条精确的最终离开事件。daemon 随后清空该频道的
  上下文、排队消息和作用域会话；该频道后续所有发送/读取/事件投递一律
  失败关闭（fail-closed），其他频道不受影响。
- DM 频道的持久名字是内部复合名
  `dm:{min(memberId)}-{max(memberId)}`；DM 的 `message.*` 事件 `scope.name`
  携带该内部名字（经 `_display_channel`），绝不是对方的 handle。因此任何
  基于消息事件的客户端"当前正在查看"过滤都必须按 `scope.id` 匹配（chat
  页面把活跃会话 id 注册在 `frontend/lib/current-chat-view.ts`）；路由名
  匹配只对公共频道有效。按名字匹配 DM 导致了在 `c55e02f` 修复的累积
  未读（unread）徽标（badge）bug。

### 干净重置迁移契约

- 迁移 `0006_stable_member_identity` 只在身份表为空时升级或降级。非空身份
  数据抛出 `IDENTITY_CLEAN_RESET_REQUIRED`。
- 不要添加保留旧 `Member.server_id/display_name` 或
  `Account.name/server_id/member_id` 模型的 ORM 别名、迁移回填、种子期修补
  或测试。

### 行动者身份归一化契约（07-22 auth-tenancy INV-A3）

- 查看者（viewer）可以按端点契约以显示名、`@handle`、规范 Member UUID 或
  省略/默认值标识自己。所有合法的自我表示必须解析到同一个规范查看者
  Member UUID（INV-A3）。
- 身份归一化恰好在 API 边界发生一次，并在授权之前产出规范 Member UUID。
  下游一切（授权、通知、任务分配、事件归因）只消费该 UUID——绝不消费原始
  正文字符串或提及正则。
- 查看者绝不能通过任何被接受的表示、大小写/归一化别名或歧义重复来扮演
  另一个成员：所有合法自我别名解析到查看者；所有外来别名被拒绝。

## 4. 校验与错误矩阵

| 条件 | 必需结果 |
| --- | --- |
| 名字缺失、格式错误、过长或带保留后缀 | 400，附稳定的名字原因码 |
| 来源服务器活跃名字冲突 | 409；以数据库的最终唯一约束为准 |
| PATCH 尝试 `name`、`handle` 或 `displayName` | 400 `NAME_IMMUTABLE` |
| Agent 自我资料尝试改名字、Description 或 displayName | 403 |
| 人类载荷提供 Description | 400 |
| Agent 加入外部服务器频道 | 400 |
| 人类缺少某频道的活跃服务器成员关系 | 403 |
| 严格频道移除命中不存在的成员关系 | 404 且无事件/修订号变化 |
| 非所有者/管理员变更成员 | 403 |
| 非所有者/管理员创建频道（`POST /channels`） | 403 `Server owner/admin role required` |
| 额外创建服务器 | 410 |
| 身份迁移遇到已有身分行 | 以 `IDENTITY_CLEAN_RESET_REQUIRED` 失败 |
| 未知或歧义的手动 `@` 记号（token） | 作为普通文本发送成功；不提及任何人 |
| 查看者省略身份，或发送显示名 / `@handle` / 自己的 UUID | 四种形式都解析到同一个规范查看者 UUID；请求以该成员身份继续 |
| 查看者以任何形式或大小写别名提供另一成员的名字/handle/UUID | 作为外来别名拒绝；不把任何东西归因到该成员 |
| 两个 runtime 并发对同一任务调用 `tasks/claim` | 经 `assignee_id IS NULL` 乐观锁恰好一个认领获胜；失败者得到 404 `No unclaimed task found` |
| Agent API 任务请求只用 snake_case 或只用 camelCase 键 | claim/update-status 路径同时接受两种拼法 |

## 5. 好 / 基线 / 坏案例

- 好：`张翰` 以 NFC 存储、按 Member UUID 选中，并以 `@张翰` 发送。
- 好：来自不同来源服务器的两个人类 `ean` 共享一个频道，分别投影为
  `@ean-s7k2m` 和 `@ean-s91qx`。
- 好：删除 Agent `@open2` 会给旧 UUID 打墓碑、保留历史文件/消息/任务，并
  允许新插入的 Agent UUID 复用 `open2`。
- 基线：冲突消失；新消息使用剩下的裸引用，历史文本保持不变。
- 坏：对完整服务器花名册或 `displayName` 解析 `@name`。
- 坏：硬删除 Agent 成员并级联抹掉历史归因。
- 坏：每次成员关系更新都发送完整花名册或 Description。

## 6. 必需测试

- 单元：Unicode 归一化、保留后缀、Description 上限、引用解析/投影、紧凑
  载荷字段排除。
- PostgreSQL：干净 head 迁移、非空重置拒绝、人类/Agent 名字唯一性、跨来源
  重复、打墓碑后以新 UUID 复用、复合 Account/Member/ServerMembership 约束、
  并发引导。
- API：不可变名字、仅 Agent 的 Description、410 服务器创建、外部 Agent
  拒绝、频道作用域提及 UUID、所有者/管理员移除、失效（stale）404、墓碑
  历史归因。
- daemon：快照一次、Description 一次、紧凑 join/leave、重放去重、修订号
  间隙对账、零工具/零可见回复的更新回合、最终离开投递、移除后的队列/访问
  切断。
- 发布门禁（gate）：对显式隔离的 PostgreSQL URL 运行迁移套件；跳过的迁移
  套件不算通过。
- 认证/身份：一个自我身份矩阵（省略 / 显示名 / `@handle` / UUID）把每种
  形式解析到同一个查看者 UUID，并以每种形式拒绝另一成员；一个并发
  `tasks/claim` 竞争证明恰好有一个获胜者。

## 7. 错误 vs 正确

### 错误

```python
# Mutable presentation text becomes protocol identity.
target = next(member for member in server_members if member.display_name == token)
db.add(ChannelMember(channel_id=channel.id, member_id=target.id))
```

### 正确

```python
# Resolve within the current Channel and mutate through the event/revision boundary.
target_ids = await resolve_channel_mentions(db, channel_id=channel.id, content=content)
await add_channel_member(
    db,
    channel_id=channel.id,
    member_id=target_member_id,
    actor_id=actor.id,
)
```
