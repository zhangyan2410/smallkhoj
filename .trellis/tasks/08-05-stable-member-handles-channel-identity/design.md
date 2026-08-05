# Stable member Names and Channel identity — Technical Design

## 1. 设计结论

本任务把「账号归属」「成员身份」「Channel 内称呼」拆成三个稳定层次：

1. **Account / home Server**：一个 Account 只拥有一个自动创建的 home
   Server；加入别人的 Server 只增加 Human 的 `ServerMembership`，不复制身份。
2. **Member identity**：Human 和 Agent 都有一个不可变的产品 Name；数据库与协议
   字段叫 `handle`，稳定关联仍使用 Member UUID。
3. **Channel reference projection**：`@name` 不是全局 ID，而是当前 Channel 名单的
   投影。无冲突时使用 `@ean`，有跨来源冲突时，所有同名成员都使用
   `@ean-s7k2m`。

Agent Description 是 Agent-only 的能力说明。它只进入首次 Channel 成员名单快照，
不参与名字解析、权限、路由或后续轻量成员变化通知。

这是一次明确的 clean-reset 变更：不迁移旧 Account/Server/Member/Message 数据，
不保留 `@displayName` 别名，也不保留任意创建 Server 的旧产品能力。

## 2. 不变量与边界

- 产品 UI 只说「名字 / Name」；`handle` 只出现在代码、数据库和协议文档。
- Account 恰好有一个 home Server 和一个 Human Member identity。
- Human 加入其他 Server 时复用同一个 Human Member ID；不创建 Server-local Human
  副本或别名。
- Agent 的 origin Server 永不改变；Agent 不能加入任何 foreign Server。
- `displayName` 只属于 Human Account，是可选前端装饰；Agent、daemon 和 Agent API
  永远看不到它。
- Message 的 `sender_id` 和 `mentions[]` 继续保存 Member UUID；正文一经发送永不
  改写。
- Channel 的当前名单是称呼解析范围；Server 名单不能替代 Channel 名单。
- 完整成员名单和 Description 只在 runtime 每次首次进入该 Channel 上下文时自动
  发送一次；后续只发送轻量 join/leave/reference 变化。
- 成员变化事件是 **上下文更新**，不是聊天任务，不进入 message freshness，也不
  要求 Agent 回一条确认消息。
- 从 Channel 移除 Agent 只改变该 Channel membership，不停止全局 runtime、不删除
  Agent、不释放 Name。

## 3. 数据模型

### 3.1 `servers`

新增：

- `server_handle VARCHAR(5) NOT NULL UNIQUE`
- 格式固定为 `s` + 4 个小写 Crockford Base32 字符：
  `^s[0-9abcdefghjkmnpqrstvwxyz]{4}$`。
- 例：`s7k2m`。代码空间为 32^4；生成使用加密安全随机数、唯一约束和有限重试。
- `server_handle` 无 PATCH/API 修改入口。产品没有 hard-delete Server；未来若增加
  Account 删除，也必须保留/软删除 Server 行，因此 serverHandle 不会释放。

保留 `Server.name` 作为可变的人类展示值。home Server 创建时取
`Account.displayName ?? Human.handle`；本任务 signup 不收集 displayName，所以初始
值就是 Human Name。`Server.name` 不参与任何引用、查找或唯一性。

### 3.2 `accounts`

clean-reset 后把现有含混字段改成明确语义：

- `auth_subject VARCHAR(...) NOT NULL UNIQUE`：Better Auth 外部用户的内部稳定键；
  不作为产品 Name 暴露。
- `display_name VARCHAR(255) NULL`：Human-only 前端装饰。
- `home_server_id UUID NOT NULL UNIQUE REFERENCES servers(id) ON DELETE RESTRICT`。

删除/停止使用产品语义含混的 `Account.name`、`Account.server_id`、
`Account.member_id`。Human identity 改由 `Member.account_id` 的 one-to-one 关系反向
定位，避免 Account↔Member 必填循环外键。活动 Server 仍由请求中的 Server 选择 + `ServerMembership`
授权决定；`home_server_id` 只表示归属，不表示当前浏览位置。

`accounts.home_server_id UNIQUE` 保证一个 Server 不能成为两个 Account 的 home
Server。bootstrap 事务负责保证 home membership 为唯一 owner；数据库再用 active
owner partial unique index防止同一 Server 出现两个 active owner。为下述跨表复合
外键，`accounts` 额外声明 candidate key `UNIQUE(id, home_server_id)`。

### 3.3 `members`

目标字段：

- `origin_server_id UUID NOT NULL REFERENCES servers(id) ON DELETE RESTRICT`
- `account_id UUID NULL`：Human 必填且唯一，Agent 必须为 NULL。
- `type VARCHAR(10) NOT NULL CHECK (type IN ('human', 'agent'))`
- `handle VARCHAR(32) NOT NULL`
- `handle_key VARCHAR(128) NOT NULL`
- `description TEXT NULL`
- `deleted_at TIMESTAMPTZ NULL`
- 现有 avatar/status/skills/config/computer/backend/runtime 关联按本节规则保留。

`origin_server_id` 替代含混的 `Member.server_id`：

- Human：永远等于 Account.home Server。
- Agent：永远等于创建 Agent 的 Server。
- 它不是「当前 Server membership」。所有 active Server 授权必须查
  `server_memberships.server_id`。

Human/Agent 归属尽可能由数据库而不只是 service 保证：

```sql
CHECK (
  (type = 'human' AND account_id IS NOT NULL)
  OR (type = 'agent' AND account_id IS NULL)
)
UNIQUE (account_id) WHERE account_id IS NOT NULL
UNIQUE (account_id, id)
FOREIGN KEY (account_id, origin_server_id)
  REFERENCES accounts(id, home_server_id) ON DELETE RESTRICT
```

因此一个 Account 至多对应一个 Human Member，Human 的 origin 必然等于该
Account.home Server，Agent 不可能伪装成 Account identity。bootstrap 单事务和
一致性测试再保证每个 committed Account **至少**有一个 Human Member。

数据库约束：

```sql
CHECK (char_length(handle) BETWEEN 1 AND 32)
CHECK (type = 'agent' OR description IS NULL)
CHECK (description IS NULL OR char_length(description) <= 200)

CREATE UNIQUE INDEX uq_members_origin_active_name
ON members(origin_server_id, handle_key)
WHERE type = 'human' OR (type = 'agent' AND deleted_at IS NULL);
```

这个 partial unique index同时表达三条产品规则：

- 一个 origin Server 内，Human 与所有未删除 Agent 共用一个 Name 空间。
- Human 即使以后软删除，Name 仍永久占用。
- 只有真正 `deleted_at IS NOT NULL` 的 Agent 释放 Name；offline/disabled 不释放。

Agent 删除不再 hard-delete Member，也不再删除历史 Message/Task。删除事务会：

- 设置 `deleted_at` 与 `status='deleted'`；
- 删除所有 `ChannelMember` 与 `AgentWorkspace` 活跃关系；
- 撤销 Agent API key/credential；
- 清空 Computer/runtime binding、permissions/config、skills、Description 等可继承状态；
- 保留 Member ID、handle、origin Server 与历史 FK 归因；
- 写 tombstone audit/event。

重新注册同名 Agent 必须 INSERT 新 Member 行，绝不 UPDATE/复活 tombstone。旧任务可
继续显示「已删除的 @name」并保留旧 Member ID；新 Agent 不继承任何旧状态。

### 3.4 `server_memberships`

`ServerMembership.member_id` 对 Human 永远指向 `Member.account_id ==
ServerMembership.account_id` 的同一 identity。接受邀请
不再调用 `_create_human_member_for_account` 创建副本；它只新增：

```text
(foreign_server_id, account_id, same_human_member.id, role, active)
```

写入服务强制：

- membership member 必须是该 Account 的 Human identity；
- Agent ID 不能出现在 `ServerMembership`；
- home Server membership 为 owner；foreign Server 只能由 invite/join 流程加入；
- 一个 Server 至多一个 active owner。

数据库新增复合外键：

```sql
FOREIGN KEY (account_id, member_id)
  REFERENCES members(account_id, id) ON DELETE CASCADE
```

因为 Agent 的 `account_id` 必须为 NULL，它不能满足这个外键；direct/legacy writer
也不能把 Agent 塞进 `ServerMembership`。service 仍负责 role/home-vs-foreign 语义。

### 3.5 `channels` / `channel_members`

`channels` 新增：

- `membership_revision BIGINT NOT NULL DEFAULT 0`

每次真正发生 ChannelMember add/remove 时，在锁住该 Channel 的同一事务内加一。
重复 add 不发事件、不加 revision；要求严格删除而目标已不存在时返回 404。

ChannelMember 写入的 scope 规则：

- Human：必须有该 Channel 所属 Server 的 active `ServerMembership`。
- Agent：必须 `origin_server_id == channel.server_id` 且未删除。
- 所有生产写入路径都必须经过统一 membership service；测试 fixture 可直接建行。

现有 `mark_channel_read` 不能再把 cursor upsert 当作无事件的任意 membership insert：
public Channel 的第一次 read通过统一 service完成一次真实 join；private/DM 只能更新
已经存在的 membership cursor，缺失时按权限错误处理，不能隐式加入。

### 3.6 `messages`

保留：

- `sender_id UUID -> members.id`
- `mentions UUID[]`
- 原始 `content TEXT`

新增消息请求可带 additive 的 `mentionMemberIds: UUID[]`，用于记录自动补全选择的
稳定目标。后端仍以当前 Channel 名单和正文 token 做最终校验：只有仍在 Channel、
且其当前 canonical reference 确实出现在正文中的 ID 才进入 `mentions[]`。

后端再解析所有手写 token：唯一匹配的 bare/qualified token 加入 mentions；未知或
歧义 token 留在正文、mention nobody、请求照常成功。`mentions[]` 去重；正文不改写。

## 4. Name 规范化与共用验证

### 4.1 后端权威模块

新增一个无路由依赖的 domain 模块（建议
`backend/services/member_identity.py`），所有 signup、Agent create、mention lookup、
profile serialization 和测试都复用：

- `normalize_handle(raw) -> HandleValue(handle, handle_key)`
- `validate_handle_syntax(raw)`
- `normalize_description(raw) -> str | None`
- `generate_server_handle()`
- `parse_member_reference(token)`

算法：

1. trim 外围空白后做 NFC，保存为 `handle`。
2. 按 Unicode code point 计数，必须 1–32；前端用 `Array.from` 对齐。
3. 每个字符只能是 Unicode category `L*`、`Nd` 或 ASCII `-`。
4. `-` 不能首尾；空白、`@`、`_`、`.`、emoji、其他标点和残余 combining mark
   均拒绝。
5. 拒绝结尾匹配 `-s[0-9abcdefghjkmnpqrstvwxyz]{4}` 的名字。
6. lookup key = `unicodedata.normalize('NFKC', handle).casefold()`。

PostgreSQL unique index负责最终并发裁决。应用只捕获这个命名索引的
`IntegrityError`，rollback 后返回 Name unavailable；不能用先 SELECT 后 INSERT 当成
正确性保证。

### 4.2 前端镜像与契约 fixture

新增 `frontend/lib/member-name.ts` 做即时语法反馈和 NFC preview，但不自行宣称最终
可用。后端模块是权威，前端只在本地语法通过后调用 availability API。

后端与前端共享一份数据 fixture（valid/invalid/canonical/key cases），至少覆盖：

- `张翰`、`研发-1`、ASCII 大小写、全角兼容字符；
- 首尾连字符、空格、emoji、underscore、dot；
- reserved suffix；
- NFC/NFKC/case-fold collision。

这样避免 Python 与 JavaScript 的 Unicode 行为静默漂移；不能依赖两个互不相关的
正则。

### 4.3 Availability API

- signup Name check：只验证并返回 canonical preview。新 Account 会拥有全新的 home
  namespace，所以合法 Name 不做全局占用检查。
- Agent Name check：在 active home Server 内检查 Human + 未删除 Agent 的
  `handle_key`；deleted Agent tombstone 不占用。
- 响应使用稳定 reason code + 本地化 UI 文案，例如
  `{valid, available, canonicalName, canonicalReference, reasonCode}`。
- submit 始终重新校验并依赖数据库唯一约束；availability 结果不是 reservation。

## 5. Server-qualified Channel reference

新增后端 projection service（建议
`backend/services/channel_member_references.py`）：

1. 只查询指定 Channel 的 active ChannelMember + Member + origin Server。
2. 按 `handle_key` 分组。
3. 组大小为 1：`reference = '@' + handle`。
4. 组大小大于 1：组内每个成员都用
   `reference = '@' + handle + '-' + origin_server.server_handle`。

普通 Name 不能使用 reserved suffix，因此 parser 可以从右侧识别 serverHandle；但
实际解析仍应对照当前 roster 的 precomputed reference map，不能仅靠切字符串后扩大
到 Server 全局搜索。

定义两种序列化投影：

### Human-facing projection

```json
{
  "memberId": "uuid",
  "kind": "human|agent",
  "handle": "ean",
  "reference": "@ean-s7k2m",
  "displayName": "optional-human-only",
  "originServerName": "only useful as secondary collision UI",
  "description": "agent-only optional"
}
```

`originServerName` 和 Human displayName 只帮助人类看建议项；都不参与 token/lookup。

### Agent-facing projection

```json
{
  "memberId": "uuid",
  "kind": "human|agent",
  "handle": "ean",
  "reference": "@ean-s7k2m",
  "description": "agent-only optional",
  "status": "optional existing field"
}
```

Agent-facing serializer绝不 join/返回 Account.displayName 或 Server presentation name。

## 6. Mention 与历史消息契约

- public API 与 agent API 删除各自的 ASCII `MENTION_RE`/displayName resolver，统一调用
  Channel-scoped parser。
- tokenizer 使用与 Name 相同的 Unicode character rules，并能把
  `@张翰-s7k2m` 当作一个 token。
- lookup 使用 normalized `handle_key`；qualified lookup同时匹配当前 roster 中的
  `serverHandle`。
- bare token 只在当前 roster 恰好一个匹配时解析；歧义/未知不报错、不通知。
- notification targeting 使用持久化 `Message.mentions` UUID，不再用 lowercased
  displayName substring 或 bare-prefix 猜测。
- Message 内容、历史 `@token`、历史 qualified token 永不动态改写。
- Agent runtime replay保留 authored content；当前成员快照/变化只告诉 Agent 下一条
  新消息应该使用什么 reference。
- sender/mention 历史归因依赖 Member UUID；Agent tombstone serializer显示 deleted
  状态但仍保留旧 handle。

## 7. 统一 Channel membership service

新增唯一生产写入口（建议 `backend/services/channel_membership.py`），覆盖：

- public/admin add/remove；
- Agent self join/leave；
- Agent tombstone deletion：按 Channel UUID稳定排序锁住其全部 membership，逐 Channel
  生成 compact leave/reference update，再清 runtime/identity active state；
- Channel create 的 creator/initial members；
- DM membership；
- invite/private membership；
- integration bootstrap；
- public Channel 首次读取产生的 lazy membership。

每次 mutation：

1. `SELECT Channel ... FOR UPDATE`，读取 before roster projection。
2. 做 actor authorization 和 Human/Agent scope validation。
3. add/remove ChannelMember，flush。
4. `membership_revision += 1`，读取 after projection。
5. 计算 changed member 和所有 reference diff。
6. 在同一事务写 `EventRecord`（以及需要的 ActivityLog）。
7. commit 后才 publish browser/daemon wake-up。

沿用 canonical event types：

- `channel.member_joined`
- `channel.member_left`

轻量 payload：

```json
{
  "channelId": "uuid",
  "rosterRevision": 12,
  "member": {
    "memberId": "uuid",
    "kind": "human|agent",
    "reference": "@ean-s7k2m"
  },
  "referenceUpdates": [
    {"memberId": "uuid", "reference": "@ean-s9p4x"}
  ],
  "removedAgentId": "uuid-or-absent"
}
```

leave payload 中 `member.reference` 是离开前最后有效 reference；
`referenceUpdates` 只列仍在 Channel 且 reference 改变的成员。payload 不含
Description、displayName、Server presentation name 或无关成员。

## 8. Runtime 成员上下文

### 8.1 首次 Channel 成员名单快照

daemon 的共享 runtime delivery 层维护：

```text
(agentId, runtimeLaunchGeneration, channelId)
  -> {initialized, rosterRevision, memberId -> kind/reference}
```

它位于 Claude/Codex/OpenCode/Pi driver 之上，因此所有 runtime 使用同一语义。

第一次有某个 Channel 的 runtime-visible 事件到达时：

1. daemon 调用现有 Agent-authenticated Channel members API 获取权威快照；
2. API 返回 `channelId`, `rosterRevision`, current members；Agent 项可含 Description；
3. daemon 把快照与第一条真实 inbound work 合并成同一个 provider prompt，避免为了
   snapshot 单独多占一回合；
4. 如果首个事件本身是该 Agent 被加入 Channel，快照已经包含最终状态，daemon 不再
   重复投递同一 compact join；
5. registry 标记 initialized。普通消息不再附带名单或 Description。

runtime restart/new launch、被移除后重新加入，都建立新的 generation，因此会重新
收到一次 snapshot。显式运行 `aura channel members` 是用户/Agent 主动查询，不算自动
重复注入。

### 8.2 后续轻量变化

daemon 将 `channel.member_joined/left` 明确分类为 **runtime context update**：

- 可以进入 runtime prompt，但不是 actionable chat work；
- 不进入 pending-message freshness；
- 不触发 self-message echo；
- 不含 Description；
- 根据 `rosterRevision` 丢弃重复/旧事件。

如果 revision 出现缺口，daemon 内部重新读取当前名单，和本地 registry 计算一个
不含 Description 的 compact reconciliation；它不把第二份完整名单/Description
重新塞给 Agent。

### 8.3 Prompt contract

所有 managed runtime 的稳定提示词加入同义指导：

- Channel 成员信息可能频繁变化；把最新 snapshot + update 当作当前工作名单即可。
- 收到成员更新时替换已经失效的称呼；不要仅为确认更新而发聊天回复或开始任务。
- 不要把临时 membership 推断成长久职责、权限、身份或任务分工。
- 不确定时运行 `aura channel members --channel <target>`。
- Agent 只用消息中给出的 canonical reference；永远不要寻找 Human displayName。

自动 envelope 使用清晰事件标签，例如：

```text
[event=channel.members.snapshot channel=#general channelId=... revision=11]
[event=channel.member_joined channel=#general channelId=... revision=12]
```

### 8.4 `aura channel members`

CLI/API 返回当前 Channel 的 `rosterRevision` 与 Agent-safe projection。CLI 人类可读
输出以 `reference` 为主，保留 Member ID/kind；只对 Agent 行显示 Description。
命令不得退化为 Server member discovery。

## 9. 移除 Agent 的最后通知与 delivery cutoff

owner/admin 调用现有 DELETE route；route 改为统一 membership service：

1. 事务内生成 `channel.member_left` EventRecord，并在 payload 放
   `removedAgentId`。
2. 删除 ChannelMember、递增 revision、commit。
3. commit 后向 remaining Agents 正常广播 compact leave/reference update。
4. event visibility 对 `removedAgentId` 有一个窄特例：即使 membership 已删除，该
   Agent 仍可收到这一条最终 notice；其他历史/future Channel event 不获得该特例。
5. daemon 收到自己的 removal notice 后清除该 Channel context，并丢弃尚未提交给
   provider 的该 Channel queued messages/context updates。
6. 已经执行中的 provider turn不做不可移植的强制中断，但 Agent send endpoint会再次
   检查当前 ChannelMember，commit 后的发送立即 403；所以 active turn也不能再向该
   Channel 写消息。
7. 后端此后不会把新 Channel events扩展给该 Agent；重新加入时作为新 entry重新收到
   snapshot。

一次成功 mutation只 INSERT 一个 durable logical leave EventRecord；重复 DELETE在
membership 已不存在时返回 404，不能生成第二个 event。daemon 在交给 provider 前按
`(agentId, eventId, rosterRevision)` 去重；同进程 reconnect沿用 event cursor和 recent
event memory，新 runtime generation按 live/latest 起点且该 Agent已不在 Channel，
不会重放旧 final notice。这里不宣称底层网络只有一次传输，而是保证同一 logical
event至多形成一个 runtime turn。

最终 notice 只说明「你已不在此 Channel」，不带 Description 或完整名单。这个流程
不 stop/restart runtime，也不影响其他 Channels。

实现时必须改写现有 event visibility 的判定顺序：channel-scoped event不能因为
`record.actor_id == agent.id` 或普通 `targetAgentId` shortcut绕过当前 ChannelMember
检查。targeted event仍保持 exclusive，但若它属于 Channel，接收者必须仍在该
Channel；唯一 bypass 是 event type为 `channel.member_left` 且 payload 的
`removedAgentId` 精确等于接收 Agent。

## 10. Signup 与 one-home-Server bootstrap

### 10.1 Signup 状态机

Sign Up 显示必填「名字 / Name」、email、password；Sign In 不显示 Name。

顺序：

```text
validate Name locally + backend preview
  -> Better Auth signUp
  -> auth bridge bootstrap transaction
       Account(auth_subject)
       Server(name, server_handle)
       Human Member(handle, handle_key, origin_server_id)
       Account.home_server_id + Human Member.account_id
       owner ServerMembership
       application session
  -> enter app
```

bridge 以 Better Auth external user为幂等键：

- 事务成功但响应丢失时，retry 找到同一 Account/Member，确认传入 Name 与已存 handle
  一致，然后只重发 application session。
- Better Auth 成功但 bootstrap 失败时，页面进入可重试的 Name setup 状态；已有
  Better Auth session 不能绕过该状态进入 `(app)`。
- retry 不再次创建 Better Auth user。
- Sign In 后若检测到 Better Auth user 没有 SmallKhoj bootstrap，也进入同一 setup。
- invitation `returnTo` 在 bootstrap 成功后恢复，再接受 foreign Server membership。

删除旧 shared-default-Server/owner-election bootstrap 语义和额外
`POST /api/v1/servers` 创建能力。Server switcher只保留 home + joined Servers 与切换，
不显示 Create Server。

### 10.2 displayName

Signup 不收集 displayName。以后若保留资料编辑，它只 PATCH Account.displayName；
不会修改 Member.handle。其他 Server 通过 Account/Member 关系可选地读取当前展示值，
无需复制字段；所有功能在它缺失时使用 handle。

## 11. Agent create/edit 与 Description

Agent create request：

```json
{
  "name": "canonical product Name input",
  "description": "optional plain text",
  "computerId": "...",
  "runtime": "...",
  "runtimeProvider": "...",
  "provider": "..."
}
```

后端把 `name` 规范化后写 `Member.handle/handle_key`；API 技术响应同时给 raw
`handle` 与 `reference`，现有产品 `name` 可在过渡中等于 raw handle。创建后任何
PATCH 都不能改 handle。

Description：

- trim；全空白写 NULL；按 Unicode code point 最多 200；保留换行；
- serializer/render 当纯文本，绝不 Markdown/HTML；
- create 可写；后续只有 origin Server owner/admin 可改；
- Human PATCH 带 Description 返回 400；Human serializer省略它；
- Agent 自己的 `updateProfile` 明确拒绝 `description`，也不能改 handle/displayName；
- Agent 删除时清空 Description；同名新 Agent 从 NULL 开始。

Create Agent 最小布局：

```text
desktop: Name | Computer
         Description (span 2)
         Runtime | Provider

narrow:  Name
         Computer
         Description
         Runtime
         Provider
```

使用现有 Input/Select/Textarea/Button/Dialog 和 SmallKhoj ink/sand tokens；不增加
Model、More、新 Cancel 或参考图的整套视觉。Description label 标 optional，显示
本地化 `0/200`，中文 placeholder 为 `例如：擅长后端排障和数据库迁移`。

## 12. Composer `@` / `#` suggestions

### 12.1 数据源

- `@`：当前 Channel members human-facing projection。
- `#`：当前 active Server 已有可见 non-DM Channel list（public + 已加入 private）。
- 不增加跨 Server Channel 查询或同名解析。

### 12.2 输入与选择

- 根据当前 caret 前的 active token识别 `@`/`#`，而不是扫描整条消息后任意弹窗。
- compositionstart 到 compositionend 期间不提交 suggestion、不抢 Enter；继续保留现有
  IME Enter guard。
- `@` filter 只按 handle/reference；Human displayName 不参与搜索。
- 选择 member 后插入当前 canonical reference + separator，并把 Member ID 放进
  composer 的 `selectedMentionIds`；发送为 `mentionMemberIds`。
- 选择 Channel 后只插入现有 `#channel-name` 文本。
- 手工文本继续允许发送；解析失败无 warning/阻塞。

### 12.3 Suggestion row

- Human：primary 为 canonical reference；displayName 仅可选 secondary decoration。
- Agent：primary 为 canonical reference；Description 可作最多两行 secondary text。
- 冲突 Human：primary 必须是 qualified reference；origin Server presentation name
  只作 secondary hint，serverHandle 仍是权威。

### 12.4 交互/视觉

新增一个可复用的 product primitive（而不是在 route 页面手写一套样式），使用
Base UI portal/floating 能力逃离 composer/scroll overflow：

- `role=combobox/listbox/option`、`aria-activedescendant`；
- ArrowUp/Down、Enter/Tab、Esc；mouse/touch；
- selected state、滚动 active item into view；
- loading/empty/error；窄屏不越界；
- square 2px ink border、sand surface、现有 focus/selected tokens；无新圆角、软阴影、
  glass 或独立配色。

现有 `useChatDraft`/`scopeKey` dirty changes必须原样保留；suggestion state增量组合在
当前 composer 上，不能回退或覆盖草稿持久化。

## 13. Channel member panel 的移除入口

- server component/loader 把当前 `ServerMembership.role` 投影成
  `canManageChannelMembers`；客户端不能根据名字猜权限。
- 未授权用户完全不渲染 remove trigger；后端继续 owner/admin enforcement。
- 授权用户在每个 active Agent row看到始终可见的小型「移除 / Remove」操作，不再
  只在 hover 时出现。
- 复用并小幅扩展 `DestructiveActionDialog` 的 trigger slot，使 member row可以使用
  紧凑 Button，同时保持统一 pending/retry/success/error 状态。
- Dialog 标题/正文同时写清 Agent canonical Name 和 Channel 名称。
- 2xx 后从本地 member projection移除该行、清理相应 selectedMentionIds、刷新成员与
  suggestion 数据；realtime event继续作为 server-owned reconciliation。
- 403、404/stale membership、网络/后端失败都显示本地化可见错误，不能只 console。
- 对 DM 也只删除当前 membership；以后再次打开/创建同一 Agent DM 可通过现有 DM
  flow重新加入，不删除历史。

## 14. API/serialization 清理

- Member technical API：`handle` 为不带 `@` 的 raw Name；`reference` 为当前上下文
  可用的带 `@` token。不要再让 `handle` 有时含 `@`、有时不含。
- compatibility `name` 在前端迁移期间等于 `handle`，之后可收敛；它不再来自
  displayName。
- Agent serialization 不出现 `displayName`；Human Agent-facing serialization 也不
  出现 displayName。
- Human-facing Human serialization可选 `displayName`，缺失时 UI 用 handle。
- 所有 `Member.origin_server_id` 与 active tenant checks 分开审计；不能继续用
  `Member.server_id == activeServer` 排除 foreign Human。
- Agent read/write、daemon event expansion、message send均过滤 `deleted_at IS NULL`。
- profile/server/member discovery不得把 Server 全名单误当成 Channel roster。

## 15. Migration、clean reset 与 rollback

新增 `0006_stable_member_identity`（实际 revision id以当前 head `0005` 为父）：

1. upgrade 开头检查 Account/Server/Member/Channel/Message 等产品身份数据为空；非空时
   以稳定错误 `IDENTITY_CLEAN_RESET_REQUIRED` 失败，绝不猜测迁移。
2. 在空表上完成字段 rename/drop/add、FK/check/index/partial unique、Channel revision。
   其中必须显式删除旧 `uq_members_server_display_name`，避免 mutable displayName
   uniqueness残留在新 identity schema。
3. 同步 ORM metadata 与 `legacy_schema_preflight.py` 的 post-baseline object registry。
4. runtime seed保持 data-only，不写 DDL、不创建 demo Server/Account/Member。
5. migration tests走真实 PostgreSQL empty-to-head；downgrade 只允许空 identity tables。

部署顺序：

```text
stop frontend/backend/daemon
  -> drop/recreate disposable application database (local or cloud)
  -> alembic upgrade head
  -> start backend
  -> start frontend
  -> reconnect freshly built daemon
  -> create fresh test Account/Computer/Agent/Channel data
```

这不是可保数据的 rollback。回退旧版本必须恢复旧应用镜像/commit **和** reset 前的
旧数据库 snapshot/volume；不能让旧代码读取新 schema，也不能对含新数据的 0006 做
假装无损 downgrade。

实际清理 local/cloud 数据和启动真实 stack 前先告知用户；运行时选择、端口、认证和
数据库必须先执行 `smallkhoj-real-test` context collector。

## 16. 验证矩阵

### Database/backend

- 0006 fresh upgrade/head/downgrade-empty；非空库 fail closed。
- Name conformance fixtures、NFC/NFKC/casefold、reserved suffix、中文。
- 并发同 origin Agent create：一个成功、一个命名索引冲突；跨 home Server同名成功。
- Human + active Agent 共用 namespace；Agent tombstone释放；Human tombstone不释放。
- Agent delete保留 old Member ID/messages/tasks；同名 create得到全新 ID/空配置。
- signup bootstrap 一事务、幂等 retry、一 Account一 home Server；额外 Server route消失。
- invite复用同一 Human Member ID；Agent foreign Server/Channel路径全部拒绝。
- Description Agent-only、200 字、owner/admin edit、Agent self-edit拒绝。
- Channel projection bare/qualified；join/leave revision 和 referenceUpdates准确、无
  Description。
- removed Agent只看最后 leave notice，之后看不到/发不出该 Channel 消息。
- Unicode/manual/structured mention解析及 UUID persistence；ambiguous/unknown不 mention。

### Daemon/CLI

- Claude/Codex/OpenCode/Pi共享 snapshot-once registry。
- 首条 inbound work只附一次当前 Channel snapshot；普通消息不重复 Description。
- join/leave 是非-message context update；revision dedupe/reconciliation。
- prompt 明确“变化可能频繁、记住最新即可、不回复确认、不形成长期职责假设”。
- `aura channel members` 输出 reference/Member ID/kind/Agent Description，无 Human
  displayName。
- removal 清 context/queued Channel work，其他 Channel/runtime不受影响。

### Frontend

- Signup/Sign In 条件字段、retry bootstrap、invite returnTo。
- Name live validation/preview/availability 双语。
- Create Agent exact desktop/narrow layout、Description 0/200 与 payload；两处共享入口。
- Agent profile edit Description权限；Human profile无 Description。
- `@/#` current-scope suggestions、qualified display、keyboard/mouse/touch/portal/scroll、
  Chinese IME、empty/loading/error、narrow viewport。
- unauthorized remove action absent；authorized action visible；confirm/403/404/failure/2xx
  UI状态；成功后 member list和 suggestions立即更新。

### Real acceptance

使用新 backend/frontend/daemon 与 clean DB，按
`smallkhoj-real-test` + `project-webdriver-cli` 执行 `./twd`：

- zh-CN 默认与 en 切换；signup Name；创建含中文 Name/Description 的 Agent；
- 两个同名跨来源 Human 在同 Channel时 suggestions/runtime都显示 qualified token；
- `@张翰` 与 `#channel` IME/键盘/触摸行为；
- Agent 首次进入只收一次完整名单，后续 join/leave只有轻量通知；
- owner/admin移除 Agent后 UI立即消失、Agent停止该 Channel投递、其他 Channel仍可用；
- DOM、截图、API/DB/EventRecord 和 `smallkhoj-trace` 使用同一 REAL marker交叉证明。

开始真实环境验收前通知用户，由用户参与最终 provider/runtime 行为验收。

## 17. 取舍

- 不增加独立 alias/display-name mention 系统；一个 immutable Name足够。
- 不增加全局 Human Name唯一性；serverHandle只在具体 Channel冲突时出现。
- 不把 Channel reference写回 Member表；它是 roster-dependent projection。
- 不把完整 roster/Description塞入每条消息或每次成员变化。
- 不新增 Redis、全局前端 store或 Channel typed-link 持久化。
- 不动态改写历史消息，也不为 unresolved manual mention增加新协议。
- 不以强制中断 provider turn实现移除；使用数据库授权、event visibility和 daemon queue
  cutoff形成可移植边界。
