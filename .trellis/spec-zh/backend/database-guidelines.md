# 数据库规范

> 本项目的数据库模式与约定。

---

## 概述

<!--
在此文档化本项目的数据库约定。

需要回答的问题：
- 使用什么 ORM/查询库？
- 迁移（Migration）如何管理？
- 表/列的命名约定是什么？
- 如何处理事务？
-->

（由团队填写）

---

## 查询模式

<!-- 查询应如何编写？批量操作？ -->

（由团队填写）

### 只读标记观察

在浏览器/API/数据库/事件（Event）状态之间调试 real-test 标记时使用此模式。

**规则**：
- 只使用 `SELECT`。
- 观察期间不得执行 `UPDATE`、`DELETE`、`INSERT`、`TRUNCATE` 或 DDL。
- 跟随正在运行的后端所使用的 `DATABASE_URL`。`dev.sh` 默认使用主机端口
  `5432`；替换用的隔离端口必须显式配置并记录在案。不要把 `55432`
  当作项目级测试端口。
- 把结果中的 ID 复制到后续查询里；不要修补行数据来让证据通过。

**标记查询**：

```sql
SELECT m.id, m.short_id, c.name AS channel, m.content, m.created_at
FROM messages m
JOIN channels c ON c.id = m.channel_id
WHERE m.content LIKE '%REAL_marker_here%'
ORDER BY m.created_at DESC
LIMIT 5;
```

```sql
SELECT e.seq, e.event_type, e.message_id, e.payload->>'content' AS content
FROM event_records e
WHERE e.payload::text LIKE '%REAL_marker_here%'
ORDER BY e.seq DESC
LIMIT 10;
```

```sql
SELECT t.id, t.task_number, t.title, t.status, t.created_at
FROM tasks t
WHERE t.title LIKE '%REAL_marker_here%' OR t.description LIKE '%REAL_marker_here%'
ORDER BY t.created_at DESC
LIMIT 5;
```

---

## 迁移

## 场景（Scenario）：Alembic Schema 权威与存量库纳入

### 1. 作用域（Scope）/触发条件
- 触发条件：任何表/列/索引/约束（constraint）/扩展/标识列（identity）变更、应用启动流程变更，或纳入在 Alembic 之前创建的数据库。
- Alembic revision 文件是唯一可部署的 schema 写入方。ORM 元数据负责映射 schema；`models/seed.py` 只执行幂等（idempotent）的数据种子/回填（backfill）。

### 2. 签名
- 全新/已知数据库：`cd backend && uv run alembic upgrade head`。
- 只读存量库指纹：`DATABASE_URL=<explicit-url> uv run python -m scripts.legacy_schema_preflight`。
- 兼容的存量库纳入：先 `uv run alembic stamp 77b8b147f689`，再 `uv run alembic upgrade head`。
- 当前链路：`77b8b147f689 -> 0002_messages_seq -> 0003_messages_seq_auto -> 0004_template_tenancy -> 0005_llm_run_lease -> 0006_stable_member_identity`。
- 运行时防护：`services.schema_readiness.assert_schema_at_head(db)`。
- 隔离的迁移测试环境：`SMALLKHOJ_MIGRATION_TEST_ADMIN_URL` 与 `SMALLKHOJ_MIGRATION_TEST_DATABASE_URL`。

### 3. 契约（Contract）
- Docker/本地生产环境在 uvicorn 之前执行 `alembic upgrade head`。直接运行 uvicorn 时执行只读的精确 head 检查，并拒绝缺失/落后/未知的 revision。
- FastAPI lifespan 与运行时种子代码不得调用 `Base.metadata.create_all`，也不得执行 schema DDL。
- 存量库指纹读取必需的表、版本状态，以及识别历史 0001 所需的完整结构
  定义：列类型/可空性/默认值/标识列；索引的表/键顺序/唯一性/访问方法/
  谓词；主键、唯一、检查与外键的列/目标/删除动作。仅对象名匹配永远
  不构成兼容性证据。它绝不自动 stamp，并拒绝在本来没有版本管理的数据库
  中已存在的基线（baseline）之后对象。
- SQL 定义归一化只允许在带引号的语义 token 之外去除无害的大小写、引号、
  限定、空白、括号与文本转型噪声。字符串字面量内容与大小写敏感的带引号
  标识符仍然逐字节有效；例如 `'open'` 与 `'OPEN'` 是不同的默认值。
- 基线成员资格检查只有当完整顶层谓词是预期的单列 `IN (...)` 或 PostgreSQL
  `= ANY (ARRAY[...])` 形式时才兼容。即使列与字面量集合其余部分都匹配，
  布尔取反或包裹（例如 `(role IN (...)) = FALSE` 这类写法）
  也不兼容。
- 存量库指纹与历史 `0001` 比对，而不是与最终态 `Base.metadata` 比对。每个后续 revision 必须把自己新增的列/索引/约束登记进 preflight 的基线后排除集合；同时仅存在于基线的对象（如 `uq_task_run_templates_slug`）在 stamp 之前仍是必需项。
- 唯一合法的存量库 stamp 目标是基线 `77b8b147f689`；禁止 `stamp head`。
- `messages.seq` 通过 `0002_messages_seq`（`BY DEFAULT` 加原子化的历史高水位（high-water mark）对齐）与 `0003_messages_seq_auto`（最终对齐加 `ALWAYS`）完成过渡。生产写入方必须省略 `seq`。
- `0004_template_tenancy` 把仓库已知的内置（builtin）模板归类为 `server_id NULL`，从合法创建者 Member 回填 `server/user` 行，用 builtin 与 `(server_id, slug)` 部分唯一索引替换全局 slug 唯一性，并强制 `ck_task_run_templates_tenant_scope`。
- 把 `0004` 降级到 `0003` 时先检查跨租户的重复 slug。这样的行在 `0004`
  下合法，但无法用 `0003` 的全局唯一约束表示，因此该迁移会在任何 DDL 之前
  抛出 `TEMPLATE_TENANCY_DOWNGRADE_SLUG_COLLISION`。它绝不删除、合并或
  静默重命名模板。

### 4. 校验与错误矩阵
- 应用启动时缺少 `alembic_version` -> 拒绝启动并指明迁移/preflight 命令。
- 当前 revision 与检出代码的唯一 head 不一致 -> 拒绝启动；不要创建缺失对象。
- 存量库指纹缺少必需对象、包含同名定义不匹配、已包含基线后/标识列/版本
  状态，或使用不支持的检查形状 -> 不兼容；零写入。
- 带引号的默认值或索引谓词字面量仅在大小写/内容上不同 -> 定义不匹配；
  成员资格检查带任何外层布尔运算符 -> 检查不匹配。两种情况都不得创建
  或 stamp `alembic_version`。
- 迁移锁/DDL/约束失败 -> 部署在 uvicorn 之前停止。
- 含义不明确的存量模板（未知 builtin，或没有合法创建者 Member 的非 builtin）-> `0004` 事务性失败；revision 停留在 `0003`，`server_id` 与部分索引保持缺失，运维人员必须先显式归类该行再重试。
- `0004 -> 0003` 期间出现跨 Server 重复模板 slug -> 在 DDL 之前失败；
  revision 停留在 `0004`，`server_id` 与租户索引保持存在。运维人员显式
  重命名或合并冲突后，重试降级即可恢复全局 `uq_task_run_templates_slug`
  约束。
- 缺少迁移测试 URL -> 本地可选套件可以跳过；必跑的发布命令提供显式隔离 URL 且不允许跳过。

### 5. 正例/基准/反例
- 正例：空的一次性 PostgreSQL -> 执行真实 revision -> head -> 应用启动。
- 正例：兼容的未版本化存量 schema -> 只读 preflight -> 运维确认的基线 stamp -> upgrade head。
- 正例：两个分属不同 Server 的人工模板使用同一 slug；同一 Server 内部重复则失败。
- 正例：运维人员显式解决跨 Server 重复 slug，随后降级在不丢失模板的前提下
  恢复 `0003` 全局 slug 约束。
- 基准：已版本化的数据库执行普通升级与精确 head 就绪检查。
- 反例：把 `Base.metadata.create_all` 当作启动兜底或迁移证明。
- 反例：`alembic stamp head`、指纹失败时自动 stamp，或对共享数据库执行破坏性测试。
- 反例：为了让迁移继续而静默隐藏、删除或猜测含义不明确存量模板的 Server。
- 反例：让降级在删除租户索引之后才发现重复 slug，或任意挑选一个
  租户行保留。

### 6. 必备测试
- 对空库到 head、基线到 head、以及存量库 preflight/基线 stamp/head 路径执行真实 revision。
- 断言缺失对象与同名定义漂移（drift）被拒绝且 `alembic_version` 保持缺失。
  定义漂移覆盖包括列、索引、主键/唯一/检查约束与外键。
- 断言兼容定义中无害的 PostgreSQL 格式化被接受，而大小写已变化的带引号
  字面量以及布尔取反/包裹的 `IN`/`= ANY` 检查被只读拒绝。
- 播种历史消息 seq 1/2/3，然后断言首个隐式值大于 3。
- 播种显式过渡值 100，执行最终对账并断言下一个隐式值大于 100。
- 提交并发的隐式插入并断言唯一性；测试所有生产写入方都省略 `seq`。
- 断言启动种子源码中没有 `create_all` 或 schema DDL。
- 用可判定的 builtin/人工行执行 `0003 -> 0004`，然后断言归类、部分索引、租户检查与作用域内唯一性。再执行一个含义不明确的用例并断言完整的 DDL/revision 回滚（rollback）。
- 用合法的跨 Server 重复 slug 执行 `0004 -> 0003`，断言稳定的失败码与不变的
  revision/列/索引状态；随后显式解决重复，断言降级成功且全局唯一性恢复。

### 7. 错误与正确对照
#### 错误
```text
uvicorn startup -> create_all/handwritten ALTER -> stamp head -> schema appears current
```

#### 正确
```text
deployment -> alembic upgrade head -> read-only exact-head guard -> data-only seed -> runtime
legacy -> read-only fingerprint -> explicit baseline stamp -> upgrade head
```

```text
wrong: ambiguous template -> stamp head / guess tenant
correct: ambiguous template -> transactional STOP -> operator classification -> rerun 0004
```

## 场景：带墓碑（Tombstone）审计与本地 Blob 补偿的破坏性写入

### 1. 作用域/触发条件
- 触发条件：删除被 ActivityLog/EventRecord 引用的实体、删除拥有本地文件系统
  blob 的数据库行，或删除 Agent/Member/Channel 这类父对象（其级联或辅助
  逻辑会移除 `FileEntry` 行）。

### 2. 签名
- Task API：`DELETE /api/v1/tasks/{task_id}` -> `{deleted, taskId, taskNumber}`。
- File API：`DELETE /api/v1/files/{file_id}` -> `{deleted, fileId, storageCleanup: "deleted" | "quarantined"}`。
- 父对象 API：`DELETE /api/v1/members/{agent_id}` 与
  `DELETE /api/v1/channels/{channel_id}` 返回已删除文件数以及
  `storageCleanup: "deleted" | "quarantined"`。
- 持久 UI 事件：`task.deleted`、`file.deleted`；runtime 投递分类为 false。

### 3. 契约
- 在 DELETE 或回滚使 ORM 状态过期之前，先捕获原始的 UUID/数字/名称/频道字段。
- 先删除 saved/dependent/entity 行；再写入删除类 ActivityLog/EventRecord，并把被删实体的外键置为 `NULL`。
- 旧 ID 只保留在 `details.tombstone` / `payload.tombstone` 以及 `payload.taskId` 这类顶层 JSON 路由字段中。
- 先提交再向浏览器发布。回滚后实体、依赖与审计记录保持互相一致。
- 本地文件删除采用先隔离后删除：把 blob 原子移动到 `UPLOAD_ROOT/.deleted` 之下，提交数据库删除，然后清除。数据库失败会恢复原始路径；清除失败返回 `storageCleanup="quarantined"`，绝不声称文件系统原子性。
- 父对象删除在 DML 之前枚举完整的 `FileEntry` 集合，包括成员上传级联、
  已删除 Channel/DM 文件以及已删除消息的附件。它在数据库删除之前隔离整批
  文件；隔离准备或提交失败时恢复每一个已移动的 blob，提交之后清除每一个
  隔离项。这些文件的 SavedItem 引用会被显式删除；不能仅仅因为
  `SavedItem.item_id` 没有文件外键就让它们变成无类型孤儿。

### 4. 校验与错误矩阵
- 非管理员删除 -> `403`，不改动实体/审计/存储。
- 缺失或异 Server 的 ID -> `404`，不泄露存在性。
- 不安全/缺失的文件路径 -> 在数据库改动之前失败。
- 隔离之后数据库提交失败 -> 回滚并恢复原始 blob；不返回成功响应。
- 提交之后隔离清除失败 -> 数据库保持已删除，响应报告 `quarantined`。
- 父对象删除批次中后续文件无法隔离 -> 恢复先前文件且不做任何数据库改动。
- 父对象删除提交失败 -> 回滚所有行/审计并恢复每一个原始 blob 路径。

### 5. 正例/基准/反例
- 正例：Task 依赖级联，旧的可空引用变为 NULL，新墓碑事件 `task_id=NULL`，随后已提交事件发布。
- 正例：文件 blob 在元数据删除之前被隔离，并在清除成功后消失。
- 正例：删除 Agent 或 Channel 时，用与显式文件删除相同的补偿边界移除每一个
  受影响的 FileEntry/SavedItem 和 blob。
- 基准：提交后清除失败；blob 只留在不再对外提供的隔离区，且响应如实报告。
- 反例：先删 Task，再插入带 `task_id=<deleted UUID>` 的 ActivityLog/EventRecord。
- 反例：提交后 unlink blob 并总是返回成功，不报告清理失败。
- 反例：依赖 `files.uploaded_by ON DELETE CASCADE` 或辅助层的 `DELETE FROM
  files`，却把 `storage_path` 留在磁盘上。

### 6. 必备测试
- 用真实 PostgreSQL 跑已认证路由测试：owner/管理员成功、成员被拒、缺失/异作用域、强制提交回滚。
- 断言 Task、assignment/run 与 saved-item 状态；旧外键 `SET NULL`；新的 Activity/Event 墓碑 JSON 带外键 NULL。
- 断言文件 saved-item 移除、内存 `file_id SET NULL`、blob 清除、隔离兜底与数据库失败恢复。
- 断言事件发布在独立连接上观察到已提交状态。
- 断言 daemon runtime 白名单拒绝带点号与旧版的删除事件名。
- 真实 PostgreSQL 父对象删除测试覆盖 Agent 级联、Channel 辅助删除、
  提交回滚/恢复、部分批次隔离补偿、SavedItem 清理，以及如实的提交后
  隔离报告。

### 7. 错误与正确对照
#### 错误
```python
await db.execute(delete(Task).where(Task.id == task.id))
await _record_activity(..., task_id=task.id)  # FK violation / rollback
```

#### 正确
```python
tombstone = {"taskId": str(task.id), "taskNumber": task.task_number, "title": task.title}
await db.execute(delete(Task).where(Task.id == task.id))
await _record_activity(..., details={"taskId": tombstone["taskId"], "tombstone": tombstone}, task_id=None)
await db.commit()
await publish_committed_events()
```

## 场景：Server 账号成员资格基础

### 1. 作用域/触发条件
- 触发条件：新增或修改人类账号、Server/工作区、频道隐私、Computer 接入（onboarding）或 Agent 创建流程。
- 只要公共人类 API 路由需要读取或改动 Server 拥有的数据，就使用本场景。

### 2. 签名
- 表：
  - `server_memberships(server_id, account_id, member_id, role, status)`。
  - `server_invites(server_id, token_hash, role, channel_id, expires_at, revoked_at, accepted_at, accepted_account_id)`。
- 服务模块：`services.server_membership`。
- 活动 Server 解析器：`resolve_active_server_context(db, account, requested_server_id=None)`。
- 公共 API 包装：`routers.public_api._resolve_active_server_context(db, request)`。
- Actor 解析器：`routers.public_api._resolve_human_actor(...) -> Member`。
- Bootstrap owner 串行化：每一个默认 Server 的 owner 选举入口都会调用
  `services/account_bootstrap.py` 的 `pg_advisory_xact_lock(hashtextextended(:auth_subject, 0))`，获取同一把
  PostgreSQL 事务级 advisory 锁，并持有到提交或
  回滚为止。

### 3. 契约
- `Server` 是产品级的团队/工作区边界。不要为同一作用域引入另一个工作区抽象。
- 现有 `Account.server_id` 与 `Account.member_id` 保留为兼容镜像；新授权必须使用 `server_memberships`。
- 人类公共 API 路由必须从当前账号成员资格解析活动 Server，而不是 `select(Server).limit(1)`。
- Actor 输入在活动 Server 内一次性归一化。省略、精确 display、`@display`、viewer UUID 都解析到同一个规范 Member UUID；授权比较 UUID，且 actor 查找绝不创建 Member。
- 安装引导注册在检查是否存在活动 owner 之前先获取事务级 advisory 锁。一个并发胜者成为 owner，后续注册成功的成为成员。显式创建新 Server 仍遵循单独的按 Server owner 规则。
- `X-Server-Id` 只有在当前账号对该 Server 拥有活动成员资格时才能选择该活动 Server。
- 初始 Computer/Agent 管理路径要求 owner/admin 角色。
- Computer 身份当前按 Server 划分作用域。daemon 连接按 `server_id + machine_id` 解析或创建 `Computer`；同一物理 `machine_id` 挂在两个 Server 下会产生两行 `computers`。
- 除非产品/架构变更引入全局机器身份与按 Server 绑定层，否则不要把 `machine_id` 当作全局物理设备标识。
- 私有频道与 DM 频道要求 `channel_members` 成员资格才能读写可见。
- Alembic revision 创建成员资格/邀请 schema；revision 守卫通过后，仅数据的运行时种子可以从 `accounts.server_id` / `accounts.member_id` 幂等回填既有账号。

### 4. 校验与错误矩阵
- 账号选择一个没有活动成员资格的 Server -> `403`。
- 人类 Server 路由缺少会话 -> `401`。
- 非 owner/admin 创建 Agent 或 Computer 连接命令 -> `403`。
- 非成员读写私有频道 -> `403`。
- 用另一个 Server 的 Computer 创建 Agent -> `404`。
- 同一 daemon `machine_id` 用两个不同 Server 的 ticket 连接 -> 两行 Server 本地 `Computer`，而不是一行全局记录。
- 部署迁移后既有账号缺少成员资格 -> 启动回填应创建一条。
- 外来 actor 别名/UUID -> `403`；大小写不敏感的歧义别名 -> `400`；未知/跨 Server 引用 -> 不泄露信息的 `404`。
- 并发首次注册 -> 都可能成功，但已提交的引导作用域恰好包含一个 owner。回滚释放锁且不留下 Account/Member/Membership 孤儿。

### 5. 正例/基准/反例
- 正例：登录创建或复用 Account，并确保存在一条活动 `server_memberships` 行。
- 正例：频道消息读写解析 `context.server` 并在返回内容前检查私有频道成员资格。
- 正例：Agent 创建同时校验 owner/admin 角色与所选 Server 的 Computer 归属。
- 正例：daemon 连接只在 ConnectTicket 的 Server 作用域内复用 Computer。
- 正例：每一个合法的自身别名都在授权前解析到成员资格对应的 Member UUID。
- 正例：两个独立的首次注册事务提交一个 owner 和一个成员；回滚/重试仍可产生第一个 owner。
- 基准：兼容字段继续指向主 Server/成员，直到 UI 完整支持切换。
- 反例：在已认证的人类路由里写 `server = await _get_server(db)`。
- 反例：不检查 `server_memberships` 就接受 `X-Server-Id`。
- 反例：仅凭 `machine_id` 判定 Computer 属于当前活动 Server。
- 反例：用原始文本比较来授权 `actor`、`sender` 或 `creator`，或从不可信 actor 输入自动创建 Member。
- 反例：用应用层 `SELECT` 再 `INSERT` 选 owner，而没有跨进程的 PostgreSQL 串行化原语。

### 6. 必备测试
- 针对 `server_memberships` 与 `server_invites` 的元数据测试。
- 针对既有 `accounts.server_id` 与 `accounts.member_id` 的种子 DDL/回填测试。
- 活动 Server 解析器拒绝非成员的 Server 选择。
- 私有频道访问拒绝非成员。
- Computer/Agent 作用域校验拒绝跨 Server 绑定 Computer。
- 静态或路由层测试证明迁移后的人类路由调用活动 Server 解析而不是 `_get_server()`。
- Actor 矩阵覆盖省略/display/handle/UUID 自身形态、每一种外来形态、歧义、未知输入与跨 Server UUID，且无创建副作用。
- 真实 PostgreSQL 测试使用独立事务、复现引导竞态、检查已提交角色，并覆盖回滚/重试/无孤儿状态。

### 7. 错误与正确对照
#### 错误
```text
human route -> _get_server() -> first Server -> query channels/messages/computers
```

#### 正确
```text
human route -> current account token -> server_memberships -> active Server context -> scoped query
```

```text
wrong: raw actor string / stale owner read -> authorize or insert
correct: scoped canonical Member UUID / pg advisory xact lock -> authorize or assign role
```

## 场景：外部集成网关基础

### 1. 作用域/触发条件
- 触发条件：新增 Feishu、Jira 或任何需要接收、路由、去重（dedup）、审计或回写外部事件的外部工作系统适配器。
- 在实现具体 provider 适配器之前使用本场景。适配器应经由集成网关基础进入，而不是另写临时的 route/event/mapping 表。

### 2. 签名
- Connector 表：`external_connectors(server_id, provider, name, status, config, secret_ref, encrypted_config, last_error_code, last_error_reason)`。
- Route 表：`external_routes(connector_id, source_selector, channel_id, task_template_id, default_assignee_id, runtime_rule, writeback_policy, status)`。
- Event 表：`external_events(connector_id, provider, dedup_key, event_type, status, normalized, route_id, session_id, channel_id, message_id, task_id, task_run_id, failure_code, failure_reason)`。
- Session 表：`external_sessions(connector_id, external_scope_type, external_scope_id, channel_id, thread_root_message_id, task_id, member_id, status)`。
- Mapping 表：`external_mappings(connector_id, local_type, local_id, external_type, external_id, external_url)`。
- 服务模块：`services.integration_gateway`。

### 3. 契约
- 外部适配器可以归一化输入、认领/记录事件、解析 route/session、关联本地记录并创建 mapping。
- 外部适配器不得直接执行 runtime/provider 工作。runtime 执行留在 TaskRun 与 daemon/runtime 服务之后。
- 去重由数据库通过 `(connector_id, dedup_key)` 上的 `uq_external_events_connector_dedup` 实现。
- 外部会话按 `(connector_id, external_scope_type, external_scope_id)` 唯一。
- `backend/models/slock.py` 的 ORM 声明与有序的 Alembic revision 必须在同一次 schema 变更中一起更新；绝不把网关 DDL 加进 `backend/models/seed.py`。
- Connector 密钥与凭据形态的载荷（payload）键不得经由事件 `normalized` 载荷或通用序列化器泄露。

### 4. 校验与错误矩阵
- 重复的外部事件 -> 返回既有事件作为重复结果；不再创建 task/channel/TaskRun。
- 未知路由 -> 记录 `dropped` 或 `failed`，附 `EXTERNAL_ROUTE_NOT_FOUND` 与可读原因。
- 已禁用路由 -> 返回禁用路由结果；不创建本地工作。
- 非法或敏感载荷字段 -> 在存储/序列化之前清理凭据形态的键。
- 回写失败 -> 保留本地 TaskRun 结果，并把外部事件标记为 `writeback_failed`，附 provider 可读的失败详情。

### 5. 正例/基准/反例
- 正例：Feishu 长连接消息认领 `external_events`，解析一条 `external_routes` 行，关联 channel/task/TaskRun id，之后把 Feishu 回复/卡片 id 映射进 `external_mappings`。
- 正例：Jira REST 回写映射 `task_run -> jira comment` 并记录评论失败，同时不删除本地运行输出。
- 基准：connector 存在但没有活动路由；进入事件可审计但不创建工作。
- 反例：Feishu 或 Jira 路由器在没有外部事件行与去重键的情况下直接创建任务。
- 反例：把 provider 原始 access token 存进 `external_events.normalized`。
- 反例：在 provider 适配器内部执行 model/runtime 工作，而不是关联 TaskRun 状态。

### 6. 必备测试
- 断言全部五张网关表存在于 `Base.metadata`。
- 断言 Alembic 迁移链把干净数据库升级到全部五张网关表与关键索引（Alembic 是唯一的 schema 写入者，不存在启动 DDL 路径）。
- 断言 `claim_external_event` 创建一个事件，重复认领返回既有事件。
- 断言路由缺失/禁用结果暴露失败码与原因。
- 断言 session 与 mapping 辅助函数可从本地和外部两侧查询。
- 断言序列化器遮蔽 connector 密钥与凭据形态的 config/payload 键。
- 断言集成网关服务不导入 daemon/runtime 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
Feishu handler -> parse message -> create TaskRun -> call runtime/daemon directly -> reply
```

#### 正确
```text
Feishu handler -> claim external_event -> resolve external_route/session -> create/link SmallKhoj channel/task/TaskRun state -> existing TaskRun/daemon path executes -> external_mapping/write-back records outcome
```

## 场景：Jira REST 出站回写

### 1. 作用域/触发条件
- 触发条件：新增或修改 Jira Cloud 出站 REST 操作，用于 issue 查询、评论回写或 Jira 对象映射。
- 在 7-15 发布路径中使用本场景，此时 Jira 是持久的外部工作记录目标。Jira webhook 摄取是另一个未来场景。

### 2. 签名
- 服务模块：`services.jira_rest`。
- 配置解析器：`resolve_jira_config(connector, credentials={email, apiToken})`。
- Issue 查询：`GET {siteUrl}/rest/api/3/issue/{issueIdOrKey}`。
- 评论回写：`POST {siteUrl}/rest/api/3/issue/{issueIdOrKey}/comment`。
- 评论体：JSON 键 `body` 下的 Jira Atlassian Document Format 文档。
- 映射辅助：
  - `map_jira_issue(... local_type, local_id, issue_key, issue_url)`。
  - `map_jira_comment(... local_type, local_id, comment_id, comment_url)`。

### 3. 契约
- Jira 凭据是运行时输入或密钥管理器输出。不要提交真实 Jira email/API token 值。
- `ExternalConnector.config` 可以存储非机密的 `siteUrl`；token 不得存入 `ExternalEvent.normalized` 或 mapping。
- Jira Cloud REST 使用 Basic 认证，`email:apiToken` 编码进 `Authorization` 头。
- 纯文本 TaskRun 输出必须先转换为最小 ADF 再回写评论。
- 成功的 issue/评论关联必须使用 `external_mappings`；不要新增 Jira 专用映射表。
- Jira 服务不得导入 daemon/runtime 执行辅助模块。它只读写 Jira 并记录外部映射。

### 4. 校验与错误矩阵
- 缺少 `siteUrl` -> `JIRA_CONFIG_MISSING_SITE_URL`。
- 非 HTTPS 或格式非法的 `siteUrl` -> `JIRA_CONFIG_INVALID_SITE_URL`。
- 缺少 email/API token -> `JIRA_CREDENTIALS_MISSING`。
- Jira 401/403 -> `JIRA_AUTH_FAILED`。
- Jira 404 -> `JIRA_ISSUE_NOT_FOUND`。
- Jira issue 查询 5xx/其他 -> `JIRA_API_FAILED`。
- Jira 评论 5xx/其他 -> `JIRA_COMMENT_FAILED`。
- Jira 评论响应缺少 id -> `JIRA_COMMENT_FAILED`。

### 5. 正例/基准/反例
- 正例：`fetch_jira_issue` 归一化 key、id、summary、status、description 文本与浏览器 URL，供 TaskRun 上下文使用。
- 正例：`append_jira_comment` 发布 ADF 并通过集成网关映射 `task_run -> jira comment`。
- 基准：issue 查询成功但后续评论回写失败；本地 TaskRun 输出仍是事实源。
- 反例：把 Jira API token 存进 connector 配置快照（snapshot）、事件 normalized 载荷或测试夹具。
- 反例：在服务之外手工拼 JSON 写 Jira 评论，绕过 ADF 转换测试。
- 反例：在评论/证据回写还不稳定时就在 REST MVP 里更新 Jira 工作流状态。

### 6. 必备测试
- 配置校验：缺失/非法 site URL 与缺失凭据。
- 伪 HTTP 测试：issue 查询 URL、方法、认证头与归一化后的 issue 形状。
- 伪 HTTP 测试：评论 POST URL、ADF 体与返回的评论 URL。
- 失败码测试：认证、未找到与 provider 错误。
- 映射测试证明 issue/评论映射是 `ExternalMapping` 行。
- 边界测试证明 `services.jira_rest` 不导入 runtime/daemon 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
TaskRun completion -> Jira adapter writes comment -> stores jira_comment_id in task.data
```

#### 正确
```text
TaskRun completion -> services.jira_rest.append_jira_comment -> services.integration_gateway.create_external_mapping(local task_run -> jira comment)
```

## 场景：Feishu 长连接消息边界

### 1. 作用域/触发条件
- 触发条件：新增 Feishu/Lark 消息事件、长连接 worker 或 bot 命令处理器。
- 在连接生产 `lark-oapi` worker 或增加更多 Feishu 命令形态之前使用本场景。

### 2. 签名
- 服务模块：`services.feishu_adapter`。
- 归一化事件类型：`FeishuInboundMessage`。
- 首个支持的命令：可选的 bot 提及加 `分析 <JIRA-KEY>`。
- 网关事件认领：
  - `provider="feishu"`。
  - `dedup_key="feishu:{event_id or message_id}"`。
- 路由来源形状：
  - `chatId`
  - `chatType`
  - `command`
- 会话作用域：
  - Feishu `thread_id` 存在时为 `thread`。
  - 否则为 `chat`。

### 3. 契约
- 原始 SDK 事件必须先归一化，业务逻辑才能读取。
- 群消息默认与工作无关。只有通过提及/名字显式指向 bot，或会话为 direct/p2p 时，才进入 SmallKhoj。
- Feishu 适配器必须在创建被接受的工作之前认领一行 `external_events`。
- 重复、未知命令、未指向 bot 的群消息、无路由与禁用路由的结果都不得创建 channel/task 内容。
- 被接受的结果可以暴露解析后的命令数据供后续编排使用，但不得直接执行 runtime/model 工作。
- 生产长连接 worker 应当是调用该适配器的传输包装；它不应拥有 route、去重或 TaskRun 语义。

### 4. 校验与错误矩阵
- 未指向 bot 的群消息 -> `FEISHU_UNADDRESSED_GROUP`。
- 不支持的文本 -> `FEISHU_COMMAND_UNKNOWN`。
- 重复事件/消息 id -> 集成网关认领返回重复结果。
- 无匹配路由 -> `FEISHU_ROUTE_NOT_FOUND`。
- 禁用路由 -> `FEISHU_ROUTE_DISABLED`。
- 匹配路由 -> 创建/复用外部会话，并把事件关联到 route/session/channel 上下文。

### 5. 正例/基准/反例
- 正例：在 bot 被提及的群里 `@SmallKhoj 分析 JIRA-123` 认领事件、解析路由、创建/复用会话，并为下一片编排返回 `jira_analysis` 命令。
- 正例：p2p 会话中的 `分析 JIRA-123` 不要求提及 bot。
- 基准：未知命令以 dropped 记录审计，可通过外部事件状态查看。
- 反例：把每条群消息都摄取进 SmallKhoj 频道。
- 反例：让 Feishu SDK 回调直接创建 TaskRun 记录并发送 daemon 命令。
- 反例：把未指向 bot 的群消息正文存为本地 channel/task 内容。

### 6. 必备测试
- 从 Feishu 风格载荷到 `FeishuInboundMessage` 的原始事件归一化。
- 群指向过滤：p2p、被提及群、未指向群。
- `分析 JIRA-123` 的命令解析器。
- 重复/未知/无路由/丢弃结果。
- 匹配路由创建会话并关联事件上下文。
- 边界测试证明 Feishu 适配器不导入 runtime/daemon 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
lark-oapi callback -> parse text -> create TaskRun -> send daemon command
```

#### 正确
```text
lark-oapi callback -> normalize -> services.feishu_adapter.dispatch_feishu_message -> integration gateway event/session/route -> later orchestration creates TaskRun
```

## 场景：Feishu 出站回复边界

### 1. 作用域/触发条件
- 触发条件：为源自 Feishu 消息的外部工作，把接受/结果/失败回复发回 Feishu/Lark。
- 在把生产长连接回调或 TaskRun 完成回复接到 Feishu 之前使用本场景。

### 2. 签名
- 服务模块：`services.feishu_replies`。
- 配置类型：`FeishuReplyConfig(base_url, access_token)`。
- 发送操作：`send_feishu_text_reply(db, http_client, config, server_id, connector_id, chat_id, text, local_type, local_id, source_message_id=None)`。
- 映射：发送成功会创建 `ExternalMapping(provider="feishu", external_type="message")`。

### 3. 契约
- Feishu 回复 access token 是运行时输入或未来密钥管理器输出。不要存进 connector 配置、事件 normalized 载荷、mapping、task 数据或 task 工件。
- 文本回复使用 Feishu 开放平台 IM v1，`msg_type="text"`，`content={"text": ...}` 为 JSON 字符串。
- 会话级发送使用 `/open-apis/im/v1/messages?receive_id_type=chat_id`，`receive_id=<chat_id>`。
- 源消息回复使用 `/open-apis/im/v1/messages/{message_id}/reply`。
- 服务通过 `external_mappings` 记录 Feishu 回复消息 id；首个发布版本不要新增 provider 专用回复表。
- 该服务不得执行 daemon/runtime 工作，也不得拥有长连接接收循环。

### 4. 校验与错误矩阵
- 缺少 base URL -> `FEISHU_REPLY_CONFIG_MISSING_BASE_URL`。
- 缺少 access token -> `FEISHU_REPLY_CREDENTIALS_MISSING`。
- 缺少 chat id -> `FEISHU_REPLY_CHAT_MISSING`。
- 缺失/空白文本 -> `FEISHU_REPLY_TEXT_MISSING`。
- 非 2xx HTTP 或非零 Feishu `code` -> `FEISHU_REPLY_API_FAILED`。
- 成功响应缺少 `data.message_id` -> `FEISHU_REPLY_RESPONSE_MISSING_MESSAGE_ID`。

### 5. 正例/基准/反例
- 正例：被接受的 Feishu 任务请求发送简洁的文本确认，并把 Feishu 回复消息 id 映射到本地 event/task/run。
- 正例：TaskRun 结果之后可以用同一服务回复到源消息/话题，并映射 `task_run -> feishu message`。
- 基准：出站凭据未接线；调用方应记录结构化回写失败，而不回滚本地 TaskRun 状态。
- 反例：把 Feishu tenant access token 存进 `ExternalConnector.config`。
- 反例：在外部事件去重/路由决定尚未持久之前，由入站适配器直接回复。
- 反例：对话题回复失败语义不明就盲目改用会话级重发，冒重复/泄漏回复之险。

### 6. 必备测试
- 会话级文本发送请求形状。
- 源消息回复请求形状。
- 缺失 config/token/chat/text 的校验。
- Feishu API 失败与缺少 message id 的失败。
- 通过 `ExternalMapping` 的成功映射。
- 边界测试证明不导入 daemon/runtime 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
Feishu inbound adapter -> direct HTTP reply -> no mapping / no event status
```

#### 正确
```text
Feishu inbound adapter -> durable gateway/orchestration decision -> services.feishu_replies.send_feishu_text_reply -> external_mapping(feishu message)
```

## 场景：Feishu 回复编排

### 1. 作用域/触发条件
- 触发条件：把持久化的 Feishu 接受结果或源自 Feishu 的 TaskRun 终态转成用户可见的 Feishu 回复。
- 在网关去重/路由/关联成功之后使用本场景。它不是长连接接收循环。

### 2. 签名
- 服务模块：`services.feishu_reply_orchestration`。
- 接受回复操作：`send_feishu_accepted_reply(db, feishu_outcome, release_result, http_client, config)`。
- 终态回复操作：`send_task_run_feishu_terminal_reply(db, task_run, http_client, config, output_text=None)`。
- 运行时依赖：`services.integration_runtime.build_feishu_reply_dependencies()`。
- 路由响应字段：`feishuReply`。

### 3. 契约
- 接受回复只在 `FeishuDispatchOutcome(status="accepted")` 与 release-loop 本地状态创建之后运行。
- 终态回复只对 `completed`、`failed` 或 `cancelled` 的 TaskRun 运行。
- Feishu 来源上下文取自关联的 `ExternalEvent.normalized` 字段 `chatId` 与 `messageId`，或等价的源消息 id。
- 终态回复通过 `ExternalMapping(local_type="task_run", provider="feishu", external_type="message")` 实现幂等。
- 完成回复优先使用 `TaskRun.output_message_id` 的内容。
- 失败/取消回复在可用时使用 `TaskRun.failure_reason`。
- Feishu 回复失败以结构化结果返回，不得回滚本地 TaskRun 或 Jira 状态。
- 端点创建的 Feishu HTTP client 必须在终态回复处理之后关闭。

### 4. 校验与错误矩阵
- 非接受结果调用接受回复 -> `FEISHU_REPLY_UNSUPPORTED_OUTCOME`。
- 非终态状态调用终态回复 -> `FEISHU_REPLY_UNSUPPORTED_TASK_RUN_STATUS`。
- 缺少关联事件或 `chatId` -> `FEISHU_REPLY_NO_SOURCE_CONTEXT`。
- 已存在 task-run 的 Feishu 消息映射 -> `FEISHU_REPLY_ALREADY_SENT`。
- Feishu 发送失败 -> `FEISHU_REPLY_SEND_FAILED`。
- 发送成功 -> `FEISHU_REPLY_SENT` 并创建 Feishu 消息映射。

### 5. 正例/基准/反例
- 正例：被接受的 `jira_analysis` 命令在源 Feishu 消息中回复简洁的 TaskRun 已创建确认。
- 正例：完成的源自 Feishu 的 TaskRun 回复 agent 输出并映射 `task_run -> feishu message`。
- 正例：Jira 回写可以失败而 Feishu 回复仍报告自己的结果；两者都不应抹掉本地 TaskRun 状态。
- 基准：Feishu token 未配置；端点在提交 TaskRun 状态的同时返回结构化的 failed/skipped Feishu 回复结果。
- 反例：终态生命周期端点不检查既有映射就创建 Feishu 回复。
- 反例：让 Feishu 回复成败决定 TaskRun 生命周期是否提交。

### 6. 必备测试
- 接受回复发送确认并映射 `external_event -> feishu message`。
- 完成 TaskRun 回复使用输出消息内容。
- 失败/取消 TaskRun 回复使用失败原因或兜底文本。
- 既有 Feishu 终态映射跳过重复发送。
- 缺少来源上下文时跳过。
- Feishu 发送失败返回结构化失败。
- Agent 生命周期端点传递 Feishu 运行时依赖、返回 `feishuReply` 并关闭自有 client。
- 边界测试证明不导入 daemon/runtime 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
TaskRun completed -> Feishu reply -> exception aborts lifecycle commit
```

#### 正确
```text
TaskRun completed -> local lifecycle update -> Jira writeBack outcome + Feishu feishuReply outcome -> commit local state
```

## 场景：Feishu 原始事件循环处理器

### 1. 作用域/触发条件
- 触发条件：新增 Feishu/Lark 长连接 worker 收到原始消息事件载荷后调用的服务边界。
- 在实现生产 worker 传输代码之前使用本场景，使 SDK 回调保持轻薄、业务流程可测试。

### 2. 签名
- 服务模块：`services.feishu_event_loop`。
- 入口操作：`process_feishu_raw_event(db, raw_event, server_id, feishu_connector_id, jira_connector, creator_id, jira_http_client, jira_credentials, feishu_http_client, feishu_reply_config, bot_open_id=None, bot_name=None)`。
- 结构化结果：`FeishuEventLoopOutcome(status, reason_code, reason, dispatch_outcome, release_result, accepted_reply, failure_code, failure_reason)`。

### 3. 契约
- 原始 Feishu 载荷必须先经 `services.feishu_adapter.normalize_feishu_message` 归一化，分发或业务逻辑才能读取消息字段。
- 网关分发必须经 `services.feishu_adapter.dispatch_feishu_message`；本处理器不得复制 route、去重、命令或指向判定逻辑。
- 只有 `FeishuDispatchOutcome(status="accepted")` 可以启动 `services.release_loop.start_feishu_jira_analysis`。
- 重复、未知命令、未指向群、无路由与禁用路由结果是透传结果，不得创建本地 Message/Task/TaskRun 工作。
- 事件被认领后出现 `ReleaseLoopError`，必须通过 `services.integration_gateway.mark_external_event_failed` 把外部事件标记为 `failed`。
- 接受回复失败报告为 `accepted_reply_failed`，但不得回滚本地 release-loop 状态。
- 生产长连接 worker 只应解析运行时依赖并调用本服务。它不应拥有 normalize/dispatch/release-loop/accepted-reply 语义。
- 该处理器不得直接执行 provider/runtime 工作；TaskRun 执行仍留在既有 TaskRun/daemon 路径之后。

### 4. 校验与错误矩阵
- 分发结果非 accepted -> 返回分发状态与 `FEISHU_EVENT_LOOP_DISPATCH_PASSTHROUGH`。
- release-loop 启动失败 -> 把关联外部事件标记为 failed，并返回 `FEISHU_EVENT_LOOP_RELEASE_FAILED` 附 release-loop 码/原因。
- 接受回复发送失败 -> 返回 `FEISHU_EVENT_LOOP_ACCEPTED_REPLY_FAILED`，保留 `release_result`。
- 分发接受 + release-loop + 接受回复全部成功 -> 返回 `FEISHU_EVENT_LOOP_ACCEPTED`。

### 5. 正例/基准/反例
- 正例：长连接 worker 收到原始事件，调用 `process_feishu_raw_event`，并为日志/指标记录结构化结果。
- 正例：重复的 Feishu 消息直接返回，不做 Jira 查询、不创建 TaskRun、不发 Feishu 接受回复。
- 基准：本地 Message/Task/TaskRun 已创建但 Feishu 接受回复凭据缺失；本地状态仍是事实源，结果暴露回复失败。
- 反例：SDK 回调在服务之外内联调用 Jira REST、创建 TaskRun 状态或发送 Feishu 回复。
- 反例：通过再启动一轮 release-loop 来重试接受回复失败。

### 6. 必备测试
- 被接受的原始事件完成归一化、分发、启动 release-loop 并发送接受回复。
- 重复/丢弃透传不启动 release-loop 工作。
- release-loop 失败把关联外部事件标记为 failed。
- 接受回复失败保留 `release_result`。
- 边界测试证明处理器不导入 daemon/runtime 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
lark-oapi worker -> parse raw message -> Jira lookup -> create TaskRun -> Feishu reply
```

#### 正确
```text
lark-oapi worker -> services.feishu_event_loop.process_feishu_raw_event -> adapter/gateway -> release_loop -> reply orchestration
```

## 场景：Feishu Worker 运行时边界

### 1. 作用域/触发条件
- 触发条件：让 Feishu/Lark 长连接入口可以从运行时设置、worker 进程或注入的传输启动部署。
- 在原始事件循环已存在之后、接线真实 SDK 回调或进程管理器钩子之前使用本场景。

### 2. 签名
- 运行时模块：`services.feishu_worker_runtime`。
- 设置项：`feishu_worker_enabled`、`feishu_worker_connector_id`、`feishu_worker_jira_connector_id`、`feishu_worker_creator_id`、`feishu_worker_bot_open_id`、`feishu_worker_bot_name`、`feishu_worker_app_id`、`feishu_worker_app_secret`。
- 配置解析器：`resolve_feishu_worker_config(configured_settings=settings)`。
- Connector 解析器：`load_feishu_worker_connectors(db, config)`。
- 依赖构建器：`build_feishu_worker_dependencies(configured_settings=settings)`。
- 事件处理器：`handle_feishu_worker_raw_event(db, raw_event, config, connectors, dependencies, close_dependencies=False)`。
- 测试传输：`FakeFeishuEventTransport` 加 `run_feishu_event_transport`。

### 3. 契约
- worker 设置必须有安全的空默认值。已提交的示例只能包含空占位符。
- Feishu app secret、Jira API token、Feishu access token 与 SDK 凭据必须来自运行时设置或未来的密钥管理器，绝不来自 connector 配置、事件 normalized 载荷、task 数据、mapping 或 `.trellis`。
- worker 运行时在处理事件之前校验配置的 connector id 与 app 凭据。
- Feishu connector 行必须满足 `provider="feishu"` 且 `status="active"`。
- Jira connector 行必须满足 `provider="jira"` 且 `status="active"`。
- Jira 凭据经运行时依赖注入解析；凭据缺失是结构化的 worker 失败，发生在原始事件循环被调用之前。
- 运行时事件处理必须委托给 `services.feishu_event_loop.process_feishu_raw_event`；它不得解析 Feishu 命令、解析路由、构造 Jira REST 请求、创建 TaskRun 或拼回复文本。
- SDK/WebSocket 传输必须留在注入的传输边界之后。单元测试必须能不导入 Feishu SDK、不建立网络连接地喂入原始事件。
- 处理器持有依赖时，自有的 HTTP client 无论成败都必须关闭。
- worker 运行时不得直接执行 daemon/runtime/model 工作。

### 4. 校验与错误矩阵
- 缺少 Feishu connector id -> `FEISHU_WORKER_CONFIG_MISSING_CONNECTOR_ID`。
- 缺少 Jira connector id -> `FEISHU_WORKER_CONFIG_MISSING_JIRA_CONNECTOR_ID`。
- 缺少 creator id -> `FEISHU_WORKER_CONFIG_MISSING_CREATOR_ID`。
- 非法 UUID -> `FEISHU_WORKER_CONFIG_INVALID_UUID`。
- 缺少 app id/secret -> `FEISHU_WORKER_CONFIG_MISSING_APP_CREDENTIALS`。
- 缺少 connector 行 -> `FEISHU_WORKER_CONNECTOR_NOT_FOUND`。
- connector provider 不匹配 -> `FEISHU_WORKER_CONNECTOR_PROVIDER_MISMATCH`。
- connector 已禁用 -> `FEISHU_WORKER_CONNECTOR_DISABLED`。
- 缺少 Jira 凭据 -> `FEISHU_WORKER_JIRA_CREDENTIALS_MISSING`。
- 原始事件循环异常 -> `FEISHU_WORKER_EVENT_LOOP_FAILED`。
- 事件移交成功 -> `FEISHU_WORKER_EVENT_PROCESSED`。

### 5. 正例/基准/反例
- 正例：worker 进程加载运行时设置，解析活动的 Feishu/Jira connector 行，从 SDK 传输收到一个原始 Feishu 事件，并调用一次原始事件循环。
- 正例：本地测试用 `FakeFeishuEventTransport` 证明事件移交与依赖清理，不需要真实 Feishu 凭据。
- 基准：worker 设置不完整；启动/健康检查可以报告稳定的配置失败，且不创建本地工作。
- 反例：把 Feishu app secret 存进 `ExternalConnector.config`。
- 反例：SDK 回调自己解析 `分析 JIRA-123` 或直接调用 Jira/TaskRun 服务。
- 反例：事件循环失败后遗留按事件创建的 HTTP client 不关闭。

### 6. 必备测试
- worker 运行时的安全默认设置。
- 缺失配置与非法 connector 的结果。
- 活动 Feishu/Jira connector 解析。
- 事件处理器把全部所需依赖传入 `process_feishu_raw_event`。
- 缺少 Jira 凭据时跳过原始事件处理。
- 成功与失败时清理自有 client。
- 伪传输不导入 SDK 即可喂入原始事件。
- 边界测试证明不导入 daemon/runtime 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
Feishu SDK callback -> parse command -> Jira lookup -> create TaskRun -> send reply
```

#### 正确
```text
Feishu SDK callback -> worker runtime dependency wrapper -> process_feishu_raw_event -> existing service boundaries
```

## 场景：Feishu Channel SDK 传输边界

### 1. 作用域/触发条件
- 触发条件：把可部署的 Feishu/Lark Channel SDK 长连接回调接进 worker 运行时。
- 在 `services.feishu_worker_runtime` 已存在之后、加入进程管理器、FastAPI lifespan 钩子或真实 Feishu 冒烟之前使用本场景。

### 2. 签名
- 传输模块：`services.feishu_channel_transport`。
- 依赖：`lark-channel-sdk`，导入路径 `lark_channel`。
- 惰性 channel 工厂：`create_feishu_channel(config)`。
- SDK 转换器：`sdk_message_to_raw_event(message, config)`。
- 传输类：`FeishuChannelSDKTransport(channel, config, connectors, db_factory, dependencies_factory)`。
- worker 入口：`run_feishu_channel_worker(db_factory, configured_settings=settings, channel_factory=create_feishu_channel, dependencies_factory=build_feishu_worker_dependencies)`。

### 3. 契约
- SDK 导入必须保留在 channel 工厂内部惰性执行，使非传输的后端导入与测试不依赖可用的 SDK 导入路径。
- SDK 适配器只负责 Channel 构造、消息回调注册、连接与断开。
- SDK 回调消息必须转换成 `services.feishu_adapter.normalize_feishu_message` 接受的原始 Feishu 事件形状。
- 转换器应在可用时保留事件 id、消息 id、chat id/类型、发送者 open id、正文文本、mentions、thread/root/parent id 与创建时间。
- 传输回调必须以 close-owned 依赖调用 `services.feishu_worker_runtime.handle_feishu_worker_raw_event`。
- 当 `db_factory()` 返回 `models.async_session()` 这类异步上下文管理器时，传输回调必须为每条进入的消息开启并关闭一个 DB 会话。直接传入伪 DB 对象可继续用于单元测试。
- 传输代码不得解析 Feishu 命令、解析路由、构造 Jira REST 请求、创建 TaskRun 或拼 Feishu 回复文本。
- 单元测试必须使用伪 channel 对象，且不得打开真实 Feishu 网络连接。
- worker 入口的配置/connector 失败必须在创建或连接 channel 之前返回结构化启动结果。

### 4. 校验与错误矩阵
- SDK 导入缺失 -> `FEISHU_CHANNEL_TRANSPORT_SDK_MISSING`。
- 运行时配置失败 -> `FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED`。
- connector 解析失败 -> `FEISHU_CHANNEL_TRANSPORT_CONNECTOR_FAILED`。
- channel 连接/创建失败 -> `FEISHU_CHANNEL_TRANSPORT_START_FAILED`。
- channel 启动成功 -> `FEISHU_CHANNEL_TRANSPORT_STARTED`。

### 5. 正例/基准/反例
- 正例：`lark_channel.FeishuChannel` 收到消息，适配器恰好转发一个原始事件进 worker 运行时。
- 正例：测试注入伪 channel，其 `on("message", handler)` 回调无需 SDK 凭据即可触发。
- 基准：部署缺少 connector id；worker 启动返回结构化配置失败，绝不创建 channel。
- 反例：在模块导入时导入 `lark_channel`，在可选传输依赖不可用时弄坏全部后端测试。
- 反例：SDK 回调自己解析 `分析 JIRA-123` 或直接调用 Jira/TaskRun 服务。
- 反例：传输适配器把 connector/配置错误藏进无法用于健康检查的泛化异常字符串。

### 6. 必备测试
- SDK 消息转换喂给既有 Feishu 归一化器。
- 传输注册消息处理器并把原始事件转发进 worker 运行时。
- connect/disconnect 调用委托给底层 channel 对象。
- 覆盖 channel 工厂的惰性导入行为。
- worker 入口不连接即返回配置/connector 失败。
- 消息回调在 `handle_feishu_worker_raw_event` 前后进入并退出异步 DB 上下文。
- 边界测试证明不导入 daemon/runtime 或 Jira/TaskRun 业务辅助模块。

### 7. 错误与正确对照
#### 错误
```text
FeishuChannel.on("message") -> parse command -> fetch Jira -> create TaskRun
```

#### 正确
```text
FeishuChannel.on("message") -> sdk_message_to_raw_event -> handle_feishu_worker_raw_event -> existing raw event loop
```

## 场景：首发 Integration Bootstrap CLI

### 1. 作用域/触发条件
- 触发条件：为真实的 7-15 Feishu/Jira live-run 准备 connector/route 行与 worker 环境变量指引。
- 当运维人员需要稳定的 Feishu/Jira connector ID 与一条 Feishu `jira_analysis` 路由、又不想手工改数据库时使用本场景。

### 2. 签名
- 服务模块：`services.integration_bootstrap`。
- CLI 模块：`integration_bootstrap_cli`，在 `backend/` 下以 `python -m integration_bootstrap_cli` 运行。
- 请求字段：`server_id`、`channel_id`、`creator_id`、`assignee_id`、`feishu_chat_id`、`feishu_chat_type`、`feishu_app_id`、`feishu_bot_open_id`、`feishu_bot_name`、`jira_site_url`。
- Connector upsert 键：
  - Feishu connector：`(server_id, provider="feishu", name)`。
  - Jira connector：`(server_id, provider="jira", name)`。
- Route upsert 键：`(server_id, connector_id, name)`。
- Feishu 路由选择器：`{"chatId": ..., "chatType": ..., "command": "jira_analysis"}`。
- TaskRun 数据库兼容性：`task_assignments.assignment_mode` 必须在 `models/slock.py` 与所属 Alembic 基线/后续 revision 两处都允许 `external_feishu`。

### 3. 契约
- bootstrap 要求既有的 `Server`、`Channel`、创建者 `Member` 与受理人 `Member` 行。它不得静默创建产品身份记录。
- 被引用的频道与成员必须属于所选 server。
- 只有在必需引用校验通过后，bootstrap 才可以创建/更新 `ExternalConnector`、`ExternalRoute` 与 `ChannelMember` 行。
- bootstrap 对相同 connector 与 route 名称幂等；重复运行更新非机密配置与路由目标，而不是创建重复行。
- 持久化的 connector 配置可以包含 Feishu app ID、bot open ID、bot 名称与 Jira site URL。
- 持久化的 connector 配置不得包含 Feishu app secret、Feishu access token、Jira API token、腾讯云凭据或 daemon 连接 token。
- CLI 输出必须包含 `services.feishu_worker_runtime.resolve_feishu_worker_config` 期望的环境变量名，机密值用占位符。
- CLI 不得暴露 `--feishu-app-secret`、`--jira-api-token` 这类机密值旗标。

### 4. 校验与错误矩阵
- 缺少 server/channel/creator/assignee -> `BOOTSTRAP_REFERENCE_NOT_FOUND`，不写 connector 或 route。
- 频道或成员属于另一个 server -> `BOOTSTRAP_REFERENCE_SCOPE_MISMATCH`，不写 connector 或 route。
- 既有的已禁用首发 connector/route -> 重新启用并更新，因为运维人员显式要求 bootstrap。
- bootstrap 之后运行时 Feishu/Jira 凭据缺失 -> 属于 worker/runtime 配置错误，不是 bootstrap 错误。
- 旧 `task_assignments` 模式约束的既有数据库 -> 由 Alembic 迁移链 drop/重建 `ck_task_assignments_mode`，`external_feishu` 才能持久化。

### 5. 正例/基准/反例
- 正例：bootstrap 创建活动的 Feishu/Jira connector 行，创建匹配 `@SmallKhoj 分析 JIRA-123` 的路由，确保 creator/assignee 是频道成员，并打印 worker 环境变量指引。
- 正例：用相同名称跑两次 bootstrap 不会创建重复的 connector/route 行。
- 基准：bootstrap 在没有真实 app secret 时也能成功；secret 只在启动 worker 前写进运行时环境。
- 反例：用 SQL 控制台手改来创建 connector ID，因为这样 live-run 路径就无法在服务器上复现。
- 反例：把 `appSecret` 或 `apiToken` 存进 `ExternalConnector.config`。
- 反例：改 `release_loop.py` 使用新的 assignment 模式，却不更新 ORM 约束、Alembic 迁移链与回归测试。

### 6. 必备测试
- bootstrap 从既有引用创建 Feishu/Jira connector 与一条 Feishu 路由。
- bootstrap 复用既有 connector/route 行并原地更新。
- 缺失引用在写入部分 connector/route 之前失败。
- 序列化的 bootstrap 输出包含必需的 worker 环境变量键与机密占位符。
- CLI 解析器拒绝机密旗标。
- ORM 与 Alembic 迁移测试（见 `test_alembic_migrations_postgres.py`）断言 `external_feishu` 存在于 `ck_task_assignments_mode`。

### 7. 错误与正确对照
#### 错误
```text
Manual DB rows -> copy connector IDs from psql history -> run worker with secrets stored in connector config
```

#### 正确
```text
python -m integration_bootstrap_cli -> non-secret connector/route rows + env guidance -> secrets only in runtime env -> Feishu worker launch
```

## 场景：Feishu Worker 进程 CLI

### 1. 作用域/触发条件
- 触发条件：让 Feishu Channel SDK worker 可以作为长驻后端进程从部署/运行时环境启动。
- 在 integration bootstrap 已创建 connector/route 行之后、加入进程守护、Docker Compose 服务定义或真实 Feishu 冒烟之前使用本场景。

### 2. 签名
- CLI 模块：`feishu_worker_cli`，在 `backend/` 下以 `python -m feishu_worker_cli` 运行。
- CLI 旗标：仅 `--pretty`。
- 进程运行器：`run_worker_process(worker_runner=run_feishu_channel_worker, wait=_wait_forever, emit=print, pretty=False)`。
- 被委托的 worker：`services.feishu_channel_transport.run_feishu_channel_worker(db_factory=lambda: async_session())`。
- 启动 JSON 字段：`status`、`reasonCode`、`reason`。

### 3. 契约
- CLI 只能是进程包装。它不得解析 Feishu 消息、解析路由、调用 Jira REST、创建 TaskRun 或发送 Feishu 回复。
- CLI 必须通过 `config.Settings` 使用既有 settings/env 加载，通过 `models.async_session` 使用既有 DB 会话接线。
- CLI 启动成功打印一行结构化 JSON，随后保持进程存活直到被中断。
- CLI 启动失败打印结构化 JSON 并以非零码退出。
- CLI 关闭时，若 worker 返回了 transport，必须调用 `transport.disconnect()`。
- CLI 不得暴露 `--feishu-app-secret`、`--jira-api-token` 或 Feishu access token 这类机密旗标。
- 测试必须注入 worker 与 wait 可调用对象，从而不需要真实 Feishu 连接或无限等待。

### 4. 校验与错误矩阵
- worker 结果 `status="started"` -> 打印 JSON、等待、关闭时断开、退出 `0`。
- worker 结果未启动 -> 打印 JSON、退出 `2`。
- worker 运行器抛异常 -> `FEISHU_WORKER_CLI_FAILED`，退出 `1`。
- disconnect 抛异常 -> `FEISHU_WORKER_CLI_DISCONNECT_FAILED`，退出 `1`。
- 启动后运维 Ctrl-C -> 断开并退出 `0`。
- 机密形态的 CLI 旗标 -> 在任何 worker 启动之前被 argparse 拒绝。

### 5. 正例/基准/反例
- 正例：部署把 bootstrap ID 与机密写入环境变量，然后运行 `python -m feishu_worker_cli`；CLI 启动既有 Channel SDK 传输并等待。
- 正例：启动配置失败以适合日志/进程守护的一行 JSON 呈现。
- 基准：SDK 缺失或 connector 被禁用；被委托的 worker 返回结构化失败，CLI 以非零码退出且不重试循环。
- 反例：在 CLI 里复制 `resolve_feishu_worker_config` 或 `load_feishu_worker_connectors` 的逻辑。
- 反例：加 `--app-secret` 便利旗标，让机密经 shell 历史泄漏。
- 反例：吞掉 Ctrl-C 而不断开 transport。

### 6. 必备测试
- 成功路径打印 JSON、等待并断开。
- 启动失败打印 JSON 且不等待。
- KeyboardInterrupt 路径断开并干净退出。
- disconnect 失败报告结构化 JSON。
- 解析器拒绝机密旗标。
- CLI `--help` 加载时不打开 DB 或 Feishu 网络连接。

### 7. 错误与正确对照
#### 错误
```text
python -m feishu_worker_cli --app-secret xxx -> CLI parses messages and creates TaskRuns
```

#### 正确
```text
env/.env secrets -> python -m feishu_worker_cli -> run_feishu_channel_worker -> existing worker/runtime/event-loop services
```

## 场景：首发 Live-Run Preflight CLI

### 1. 作用域/触发条件
- 触发条件：在启动 Feishu 长连接 worker 或在真实场景使用真实 Feishu/Jira 凭据之前，校验发布 live-run 配置。
- 在 `integration_bootstrap_cli` 之后、`feishu_worker_cli` 之前使用本场景。

### 2. 签名
- 服务模块：`services.live_run_preflight`。
- CLI 模块：`live_run_preflight_cli`，在 `backend/` 下以 `python -m live_run_preflight_cli` 运行。
- 请求字段：`feishu_chat_id`、`feishu_chat_type`、`command`。
- CLI 旗标：`--feishu-chat-id`、`--feishu-chat-type`、`--command`、`--pretty`。
- 报告形状：顶层 `ready: bool` 加 `checks[]`，每项含 `name`、`status`、`reasonCode`、`reason` 与可选的 `details`。

### 3. 契约
- preflight 是只读且零网络的。它不得调用 Feishu、Jira、腾讯云、daemon 或 runtime provider。
- worker 设置必须经 `resolve_feishu_worker_config` 校验。
- connector 存在性/provider/状态必须经 `load_feishu_worker_connectors` 校验。
- 路由就绪必须经 `resolve_external_route` 以 `{chatId, chatType, command}` 校验。
- Jira 凭据只通过 `resolve_jira_writeback_credentials` 检查存在性；preflight 不得拿它去实测 Jira。
- preflight 必须校验匹配的路由带有 `channel_id` 与 `default_assignee_id`，因为 release loop 在创建 TaskRun 之前二者缺一不可。
- CLI 不得暴露 `--jira-api-token`、`--feishu-app-secret`、tenant access token、daemon token 或云凭据这类机密旗标。

### 4. 校验与错误矩阵
- worker 配置缺失/非法 -> `ready=false` 与 worker 配置原因码，无需 DB 查询。
- connector 缺失/provider 不对/被禁用 -> `ready=false` 与 worker connector 原因码。
- connector 非机密配置非法 -> `LIVE_RUN_PREFLIGHT_CONNECTOR_CONFIG_INVALID` 或 Jira 配置码。
- Jira 凭据缺失 -> `LIVE_RUN_PREFLIGHT_JIRA_CREDENTIALS_MISSING`。
- 路由缺失/禁用 -> 网关路由原因码。
- 路由匹配但缺少 channel 或默认受理人 -> `LIVE_RUN_PREFLIGHT_ROUTE_TARGET_MISSING`。
- 全部检查通过 -> 顶层 `ready=true`，CLI 退出 `0`。
- preflight 完成但未就绪 -> CLI 退出 `2`。
- 意外异常 -> CLI 退出 `1`。

### 5. 正例/基准/反例
- 正例：bootstrap 与环境配置完成后，preflight 报告 worker 配置、connector、connector 配置、Jira 凭据与 Feishu 路由全部通过。
- 基准：Jira API token 缺失；preflight 报告未就绪而不尝试调用 Jira API。
- 基准：Feishu 路由存在但没有受理人；preflight 在真实消息触发失败的 release loop 之前拦下。
- 反例：先启动 `feishu_worker_cli`，等真实 Feishu 消息到达才发现路由/凭据失败。
- 反例：加 `--jira-api-token` 便利旗标，让机密经 shell 历史泄漏。
- 反例：在 preflight 里做真实 Jira issue 查询。

### 6. 必备测试
- 就绪的 preflight 覆盖 worker 配置、connector、路由与凭据存在性，且零网络调用。
- worker 配置缺失时在 DB 之前停止。
- 路由缺失/禁用返回 `ready=false`。
- 路由无 channel/受理人返回 `ready=false`。
- Jira 凭据缺失返回 `ready=false`。
- CLI help 无 DB/网络访问即可加载，解析器拒绝机密形态旗标。

### 7. 错误与正确对照
#### 错误
```text
python -m feishu_worker_cli -> live message arrives -> fails because route has no assignee
```

#### 正确
```text
integration_bootstrap_cli -> live_run_preflight_cli -> feishu_worker_cli -> live message
```

## 场景：首发 Lighthouse 主机探测 CLI

### 1. 作用域/触发条件
- 触发条件：在安装软件包、创建 swap、开放端口或启动生产 compose 栈之前，校验首台腾讯云 Lighthouse、隧道或替换主机。
- 当主机本身尚未被证明就绪时，在生产部署 preflight 之前使用本场景。

### 2. 签名
- CLI 模块：`scripts/lighthouse_host_probe.py`，在仓库根目录以 `python3 scripts/lighthouse_host_probe.py` 运行。
- 可选旗标：
  - `--json`：输出机器可读的主机证据。
  - `--strict-warnings`：存在警告时返回码 `2`。

### 3. 契约
- 默认模式必须只读，不得安装软件包、创建 swap、修改防火墙规则、启动服务或访问腾讯云 API。
- 该命令必须检查主机包管理器访问、sudo 可用性、CPU、内存、swap、磁盘、Docker、Docker Compose、本地端口 80/443 与防火墙工具。
- 该命令可以输出建议的 bootstrap 命令，但每条建议命令都必须标注为未执行。
- Ubuntu/Debian 建议可以包含 Docker 官方 apt 仓库设置、2 GiB swapfile 与 UFW `80/tcp` / `443/tcp` 放行规则。
- 该命令不得要求或打印 `.env.prod` 机密。

### 4. 校验与错误矩阵
- CPU 少于 2 核 -> 警告。
- 内存少于 1.5 GiB -> 失败；少于 2 GiB -> 警告。
- swap 少于 2 GiB 或未知 -> 警告。
- 磁盘可用少于 8 GiB -> 失败；少于 12 GiB -> 警告。
- Docker 命令缺失、Docker daemon 不可用或 Docker Compose 不可用 -> 失败。
- 端口 80 或 443 已在本地接受 TCP 连接 -> 失败。
- 包管理器、sudo 或防火墙工具缺失 -> 警告，因为腾讯云镜像与安全组各有差异。

### 5. 正例/基准/反例
- 正例：首次 SSH 会话先运行 `python3 scripts/lighthouse_host_probe.py --json`，并在改动主机前保存 JSON。
- 正例：2 vCPU / 2 GiB 且无 swap 的主机在 live-run 测试前输出 swapfile 建议。
- 基准：macOS/本地开发主机报告包管理器/sudo/防火墙警告，但仍输出有用的 Docker/资源证据。
- 反例：先跑安装命令再记录主机基线，事后才发现内存、swap、磁盘或端口才是真正阻塞点。
- 反例：让探测命令依赖腾讯云凭据或已提交的部署 env 文件。

### 6. 必备测试
- 单元测试覆盖资源分类、运行时依赖分类、建议命令生成与警告/失败退出语义。
- CLI 冒烟：主机探测在当前机器上运行并输出 JSON。

### 7. 错误与正确对照
#### 错误
```text
ssh lighthouse
curl install docker ...
# no baseline, no swap/disk/port evidence
```

#### 正确
```text
python3 scripts/lighthouse_host_probe.py --json
# review warnings and suggested commands before any host mutation
```

## 场景：首发腾讯云 CLI 探查

### 1. 作用域/触发条件
- 触发条件：在 SSH 主机探测与部署之前，探查腾讯云 Lighthouse 实例元数据、地域、公网 IP、OS、状态、登录密钥 ID 或防火墙相邻信息。
- 当控制台 UI 被登录态阻塞，或需要可复现证据而非手工控制台截图时使用本场景。

### 2. 签名
- CLI 二进制：`tccli`。
- 本机推荐安装路径：`/Volumes/ORICO/smallkhoj-tools/tccli-venv/bin/tccli`。
- 配置命令：
  - `tccli configure --profile smallkhoj-release`
- 只读探查命令：
  - `tccli lighthouse DescribeRegions --profile smallkhoj-release`
  - `tccli lighthouse DescribeInstances --profile smallkhoj-release --region <region> --Limit 20`
- 可选网络代理：
  - `--https-proxy http://127.0.0.1:7897`

### 3. 契约
- 把 `tccli` 安装在仓库之外；不要把它 vendor 进项目文件。
- 腾讯云 `SecretId` 与 `SecretKey` 只存放在本地 `tccli` profile、环境变量或 CI 机密中。绝不提交凭据，也绝不内联进被跟踪的命令。
- 发布工作使用 `smallkhoj-release` 这类命名 profile，而不是依赖语义不明的默认 profile。
- `DescribeInstances` 是只读的，可在任何 SSH/服务器改动之前使用。
- `DescribeInstances` 输出在审查过机密后可作为发布证据。它包含 `InstanceId`、`Zone`、`CPU`、`Memory`、`OsName`、`Platform`、`PrivateAddresses`、`PublicAddresses`、`InternetAccessible`、`LoginSettings.KeyIds`、`InstanceState`、`CreatedTime`、`ExpiredTime` 等字段。
- 如需 VPN 才能联网，`tccli` 主机调用使用 `--https-proxy http://127.0.0.1:7897`。Docker build 容器仍使用 `host.docker.internal:7897`。

### 4. 校验与错误矩阵
- `tccli` 缺失 -> 安装到外部工具目录，例如 `/Volumes/ORICO/smallkhoj-tools/tccli-venv`。
- 凭据缺失 -> `tccli` 无法调用 Lighthouse API；在仓库外配置本地 profile，或使用显式环境/CI 机密。
- 地域错误 -> `DescribeInstances` 找不到目标实例；运行 `DescribeRegions` 并尝试 `ap-guangzhou`、`ap-shanghai`、`ap-beijing`、`ap-hongkong` 等可能地域。
- 浏览器控制台仍停在登录页 -> 凭据就绪后改用 CLI 探查，或让运维在浏览器完成登录。
- 通过本地代理安装 `tccli` 时出现 SSL/代理证书错误 -> 仅在安装到外部 venv 时使用 pip `--trusted-host pypi.org --trusted-host files.pythonhosted.org`。

### 5. 正例/基准/反例
- 正例：运维配置 `tccli --profile smallkhoj-release`，运行 `DescribeInstances`，记录公网 IP/OS/状态，再开始 SSH 演练/主机探测。
- 正例：直连网络不稳时使用 `tccli lighthouse DescribeInstances --https-proxy http://127.0.0.1:7897`。
- 基准：没有可用凭据；保持浏览器登录页打开，等待运维登录或凭据配置。
- 反例：提交 `SecretId`、`SecretKey` 或生成的凭据文件。
- 反例：在可以产出 CLI 证据时，把浏览器登录态当作实例元数据的唯一来源。

### 6. 必备测试
- 外部 `tccli` 安装本身无需单元测试。
- 部署文档不得展示真实凭据，且必须保持 `SecretId`/`SecretKey` 只作为本地 profile 输入。
- 人工证据应包含 `tccli lighthouse DescribeInstances ...` 输出，分享前先审查敏感值。

### 7. 错误与正确对照
#### 错误
```text
tccli lighthouse DescribeInstances --secretId AKID... --secretKey ... > docs/server.json
```

#### 正确
```text
tccli configure --profile smallkhoj-release
tccli lighthouse DescribeInstances --profile smallkhoj-release --region ap-guangzhou --Limit 20
```

## 场景：首发部署打包 CLI

### 1. 作用域/触发条件
- 触发条件：准备上传到腾讯云 Lighthouse 或其他发布主机的最小无机密文件集。
- 当不应把整个仓库复制到服务器、却又必须运行主机探测、部署 preflight、compose、Caddy 与部署后冒烟时使用本场景。

### 2. 签名
- CLI 模块：`scripts/make_deployment_bundle.py`，在仓库根目录以 `python3 scripts/make_deployment_bundle.py --output <bundle.tar.gz>` 运行。
- 可选旗标：
  - `--root <repo-root>`
  - `--prefix <tar-top-level-dir>`

### 3. 契约
- 打包必须包含：
  - `docker-compose.prod.yml`
  - `deploy/caddy/Dockerfile`
  - `deploy/caddy/Caddyfile`
  - `docs/initial-release-production-deployment.md`
  - `scripts/create_prod_env_template.py`
  - `scripts/initial_release_deploy_preflight.py`
  - `scripts/lighthouse_host_probe.py`
  - `scripts/post_deploy_smoke.py`
  - `scripts/remote_deploy_evidence.py`
  - `scripts/validate_release_worker_env.py`
  - `scripts/update_prod_env_from_stdin.py`
  - 生成的 `README.deploy-bundle.md`
  - 生成的 `manifest.json`
- 打包不得包含 `.env*`、`.git`、`.trellis`、`node_modules`、`.next`、`__pycache__`、本地数据库、日志、截图、任务证据或机密。
- manifest 条目必须包含相对路径、大小与 SHA-256 哈希。顶层 manifest 必须包含生成时间与可用时的当前 git commit。
- tar 成员必须位于同一个相对顶层前缀之下。不允许绝对路径或 `..` 路径成分。
- 生成的 README 必须展示服务器侧顺序：主机探测 -> env/preflight -> compose up -> 部署后冒烟。
- 当 Feishu/Jira 运行时值来自仓库外的 `release-worker.env` 修补时，README 必须把 `validate_release_worker_env.py` 放在 `update_prod_env_from_stdin.py` 之前。校验器/更新器只能打印键名与就绪标签，绝不打印已配置的值。

### 4. 校验与错误矩阵
- 必需的纳入文件缺失 -> 打包生成失败。
- 纳入路径是绝对路径、含 `..` 或使用被排除的路径段 -> 失败。
- 文件名以 `.env` 开头 -> 失败。
- 必需文件是符号链接 -> 失败。

### 5. 正例/基准/反例
- 正例：本地机器运行 `python3 scripts/make_deployment_bundle.py --output /tmp/smallkhoj-deploy-bundle.tar.gz`，上传 tar 包，再从 `smallkhoj-deploy/` 运行脚本。
- 正例：manifest 哈希让运维可以证明上传了哪些部署脚本。
- 反例：上传整个仓库，连带 `.env.prod`、任务归档、日志、浏览器证据或构建产物。
- 反例：只手工拷贝一个脚本，到服务器上才发现 compose、Caddyfile 或文档缺失。

### 6. 必备测试
- 单元测试在不做不安全解包的前提下检查 tar 包内容。
- 单元测试验证 manifest 哈希与 tar 成员字节一致。
- 单元测试验证 README 命令顺序与 env/机密排除。
- CLI 冒烟在 `/tmp` 下生成打包并列出成员。

### 7. 错误与正确对照
#### 错误
```text
scp -r smallkhoj lighthouse:/opt/smallkhoj
# includes unrelated worktrees, caches, evidence, and maybe env files
```

#### 正确
```text
python3 scripts/make_deployment_bundle.py --output /tmp/smallkhoj-deploy-bundle.tar.gz
scp /tmp/smallkhoj-deploy-bundle.tar.gz lighthouse:/opt/
```

## 场景：首发远程部署证据 CLI

### 1. 作用域/触发条件
- 触发条件：从运行中的首发部署主机采集无 SSH 机密证据。
- 在远程 compose 部署之后，或记录 Lighthouse 适配性/容量证据时使用本场景。

### 2. 签名
- CLI 模块：`scripts/remote_deploy_evidence.py`。
- 必需旗标：
  - `--host <server-ip-or-hostname>`
- 常用旗标：
  - `--user ubuntu`
  - `--identity-file <ssh-key>`
  - `--remote-dir <deploy-parent-dir>`
  - `--bundle-prefix <unpacked-bundle-dir>`
  - `--remote-env-file .env.prod`
  - `--public-base-url http://<server-ip>`
  - `--allow-http`
  - `--output <evidence.json>`

### 3. 契约
- 采集器不得读取或打印 `.env.prod`；它可以向部署 preflight 与 Docker Compose 命令传递 `--env-file .env.prod`。
- 提供 `--remote-env-file` 时，Docker Compose 证据命令必须包含 `--env-file <file>`，让生产插值在不暴露值的情况下成功。
- 证据应包含主机探测、部署 preflight、compose services/ps/日志尾部、`docker stats --no-stream`、`docker ps`、`docker system df`、内存快照、磁盘快照、内存占用最高进程与可选的公网冒烟。
- 已有运行中的部署可能让主机/运行时 preflight 返回非零，因为端口 80/443 已被 Caddy 占用。当公网冒烟为绿时，把这一点视为部署后证据的预期情况。

### 4. 校验与错误矩阵
- SSH 访问缺失 -> 命令结果捕获 SSH 失败。
- 远程打包缺失 -> 远程命令返回 `cd` 或文件缺失失败。
- compose 命令缺少 `--env-file` -> `POSTGRES_PASSWORD` 这类必需机密的插值失败；这是采集器 bug，不是部署资源发现。
- 公网冒烟失败 -> 先检查同一证据载荷中的 Caddy/backend/frontend 日志，再重启服务。

### 5. 正例/基准/反例
- 正例：证据 JSON 记录全部命令输出，公网冒烟为绿，同时 preflight 端口检查把 80/443 标记为被运行中的代理占用。
- 基准：公网 URL 尚未就绪；只采集 SSH 主机/compose/docker 证据。
- 反例：用 `cat .env.prod`、`printenv` 或内联机密参数采集证据。

### 6. 必备测试
- 单元测试验证命令计划绝不包含 `cat .env.prod` 或 `printenv`。
- 单元测试验证只要配置了 `remote_env_file`，compose 命令就包含 `--env-file <file>`。
- 单元测试验证无机密计划中包含 `docker stats --no-stream` 与内存占用最高进程命令。

### 7. 错误与正确对照
#### 错误
```text
ssh lighthouse 'cd smallkhoj-deploy && cat .env.prod && docker compose ps'
```

#### 正确
```text
python3 scripts/remote_deploy_evidence.py \
  --host <server-ip> \
  --user ubuntu \
  --identity-file ~/.ssh/<key> \
  --remote-dir /home/ubuntu/smallkhoj-deploy \
  --bundle-prefix smallkhoj-deploy \
  --remote-env-file .env.prod \
  --public-base-url http://<server-ip> \
  --allow-http \
  --output /tmp/smallkhoj-remote-deploy-evidence.json
```

## 场景：首发 Worker 发布上线（Rollout）CLI

### 1. 作用域/触发条件
- 触发条件：把填好的仓库外 `release-worker.env` 应用到已部署的首发主机，并校验 Feishu/Jira worker 就绪。
- 在 integration bootstrap 已产出 connector ID、运维已在仓库外填好 Feishu/Jira 机密之后使用本场景。

### 2. 签名
- CLI 模块：`scripts/release_worker_rollout.py`。
- 安全演练：
  - `python3 scripts/release_worker_rollout.py --dry-run --json --host <server-ip> --identity-file <key> --env-file <release-worker.env> --feishu-chat-id <chat-id>`
- 应用路径：
  - 追加 `--apply`
- worker 启动：
  - 仅在 live-run preflight 成功之后追加 `--start-worker`。

### 3. 契约
- CLI 必须在改动远程之前先校验本地 release-worker env 文件。
- env 值必须经 stdin 管道传给远程更新器，绝不嵌入 SSH 命令参数。
- CLI 在 env 变更之后必须只重启 `backend`，然后在 backend 容器内运行 `live_run_preflight_cli`。
- `--start-worker` 必须依赖 `--apply`；dry-run 模式绝不启动 worker。
- worker 启动步骤在命令计划中只能出现在 live-run preflight 步骤之后。
- JSON/dry-run 输出可以包含文件路径、标签与命令，但不得包含 env 文件内容或 `KEY=value` 机密对。

### 4. 校验与错误矩阵
- release-worker env 值缺失或仍是占位符 -> 校验器失败，不执行任何远程改动。
- SSH/env 更新器失败 -> 在 backend 重启之前停止。
- backend 重启失败 -> 在 live-run preflight 之前停止。
- live-run preflight 失败 -> 在 worker 启动之前停止。
- `--start-worker` 不带 `--apply` -> 退出码 `2`。

### 5. 正例/基准/反例
- 正例：先跑 dry-run JSON 检查标签/命令，再跑 `--apply`，确认 preflight 就绪后才加 `--start-worker`。
- 基准：还没有外部机密；dry-run 计划仍可按预期的 env 文件路径检查。
- 反例：在 live-run preflight 就绪之前运行 `docker compose --profile feishu-worker up -d feishu-worker`。
- 反例：把 Feishu/Jira 机密放进命令参数，或提交 `release-worker.env`。

### 6. 必备测试
- 单元测试验证命令计划顺序与默认省略 worker 启动。
- 单元测试验证 `--start-worker` 必须显式给出且与纯 dry-run 执行不兼容。
- 单元测试验证 dry-run JSON 不含 env 值或 `KEY=value` 机密对。

### 7. 错误与正确对照
#### 错误
```text
ssh lighthouse 'cd deploy && FEISHU_WORKER_APP_SECRET=... docker compose --profile feishu-worker up -d feishu-worker'
```

#### 正确
```text
python3 scripts/release_worker_rollout.py \
  --dry-run \
  --json \
  --host <server-ip> \
  --identity-file ~/.ssh/<key> \
  --env-file /Volumes/ORICO/smallkhoj-secrets/release-worker.env \
  --feishu-chat-id <chat-id>
```

## 场景：首发生产 Env 模板 CLI

### 1. 作用域/触发条件
- 触发条件：创建或修改首发部署的服务器侧 `.env.prod` 配置路径。
- 在修改部署 env 要求、必需占位符或打包内容之前使用本场景。

### 2. 签名
- CLI 模块：`scripts/create_prod_env_template.py`。
- 可选旗标：
  - `--output <path>`：把模板写入文件而不是 stdout。
  - `--force`：覆盖已存在的输出文件。

### 3. 契约
- 模板不得包含真实机密值。
- 模板必须包含部署 preflight 检查的全部运维 env 键。
- 必需值必须保持占位符形状，使 `initial_release_deploy_preflight.py --env-file .env.prod` 在运维替换之前一直失败。
- 该命令必须拒绝覆盖已存在的输出文件，除非提供 `--force`。
- 部署打包可以包含生成器脚本，但不得包含生成的 `.env.prod`。

### 4. 校验与错误矩阵
- 已存在输出文件且无 `--force` -> 退出码 `2`。
- 生成的必需占位符交给 env preflight -> `env.required` 失败。
- 真实填好的必需值交给 env preflight -> `env.required` 通过。

### 5. 正例/基准/反例
- 正例：服务器运维运行 `python3 scripts/create_prod_env_template.py --output .env.prod`，编辑值，再运行部署 preflight。
- 基准：运维把模板打印到 stdout 检查必需键，不写文件。
- 反例：提交 `.env.prod`，或把真实 Jira/Feishu/LLM token 加进模板。
- 反例：把占位符改成碰巧能通过 preflight 的非占位符文本。

### 6. 必备测试
- 单元测试覆盖模板必需键、无明显线上机密标记、拒绝覆盖与强制覆盖。
- 部署 preflight 测试覆盖占位符必需值在不泄漏值的情况下失败。

### 7. 错误与正确对照
#### 错误
```text
POSTGRES_PASSWORD=secret123
```

#### 正确
```text
POSTGRES_PASSWORD=<set-outside-repo>
```

## 场景：首发生产镜像传输 CLI

### 1. 作用域/触发条件
- 触发条件：准备首次腾讯云 Lighthouse 部署，backend/frontend/Caddy 镜像应在主机外构建并直接装载到服务器，不依赖镜像仓库。
- 当目标主机太小无法构建应用镜像或镜像仓库尚未就绪时，在 `lighthouse_ssh_deploy_probe.py --compose-up --use-loaded-images` 之前使用本场景。

### 2. 签名
- CLI 模块：`scripts/production_image_transfer.py`。
- 必需旗标：
  - `--host <ssh-host-or-ip>`
- 可选旗标：
  - `--user <ssh-user>`
  - `--port <ssh-port>`
  - `--identity-file <path>`
  - `--remote-dir <path>`
  - `--output-archive <path>`
  - `--backend-image <tag>`
  - `--frontend-image <tag>`
  - `--caddy-image <tag>`
  - `--skip-build`
  - `--skip-daemon-build`
  - `--platform <docker-platform>`
  - `--use-vpn-proxy`
  - `--proxy-url <url>`
  - `--next-public-api-base-url <url>`
  - `--next-public-ws-base-url <url>`
  - `--dry-run`
  - `--json`

### 3. 契约
- 默认镜像 tag 是 `smallkhoj-backend:local-release`、`smallkhoj-frontend:local-release` 与 `smallkhoj-caddy:local-release`。
- 默认模式必须在本地构建 backend、frontend 与 Caddy 镜像；`--skip-build` 必须省略构建步骤，同时保留 `docker save`、`scp` 与远程 `docker load`。
- `--platform` 必须把同一个 Docker 构建目标平台传给 backend、frontend 与 Caddy 构建。只有在已知本地 Docker 默认架构与目标主机一致时才可省略。
- CLI 必须把全部三个应用镜像保存进一个 Docker 归档，把归档上传到远程目录，并运行 `docker load -i <remote-archive>`。
- `--output-archive` 是本地路径，可以指向 `/Volumes/ORICO/...`；`--remote-dir` 是服务器路径，应保持普通主机目录，例如 `/opt/smallkhoj`。
- `--use-vpn-proxy` 必须为 `HTTP_PROXY`、`HTTPS_PROXY`、`http_proxy`、`https_proxy` 添加 Docker build args，默认使用 `http://host.docker.internal:7897`，因为代理是从构建容器内部访问的。
- frontend 构建把 `NEXT_PUBLIC_API_BASE_URL` 与 `NEXT_PUBLIC_WS_BASE_URL` 作为 build args 传入；同源发布模式默认二者为空。生产公钥材料绝不作为 build arg。
- 调用方必须在进程环境中导出 `PUBLIC_API_KEY`。CLI 只传递 `--secret id=public_api_key,env=PUBLIC_API_KEY`；其命令计划与 JSON 绝不包含该值或 `NEXT_PUBLIC_API_KEY=...` 赋值。
- CLI 不得读取、上传或打印 `.env.prod` 或凭据形态的环境值。`--dry-run` 计划允许缺少 `PUBLIC_API_KEY`，但真实的 frontend Docker 构建会因缺少 BuildKit secret 而失败关闭（fail-closed）。
- 使用本 CLI 之后，`.env.prod` 必须把 `SMALLKHOJ_BACKEND_IMAGE`、`SMALLKHOJ_FRONTEND_IMAGE`、`SMALLKHOJ_CADDY_IMAGE` 指向已装载的 tag，compose 启动必须避免拉取这些本地 tag。

### 4. 校验与错误矩阵
- 缺少 `--host` -> CLI 解析器失败。
- 本地 Docker build/save 失败 -> 停止并返回该命令退出码。
- Apple Silicon 的 `linux/arm64` 镜像装载到 `linux/amd64` 主机 -> 容器启动因架构不匹配失败；构建前先选定 `--platform`。
- SCP 失败 -> 在远程 `docker load` 之前停止并返回 SCP 退出码。
- 远程 `docker load` 失败 -> 返回 SSH 命令退出码。
- 用已装载的本地 tag 运行 `lighthouse_ssh_deploy_probe.py --compose-up` 但不带 `--use-loaded-images` -> 有拉取不存在仓库 tag 的风险；视为运维操作错误。

### 5. 正例/基准/反例
- 正例：确认 Lighthouse 主机是 x86_64 后，本地先运行 `production_image_transfer.py --platform linux/amd64 --use-vpn-proxy --dry-run`，再真实执行，把 `.env.prod` 镜像 tag 改成已装载的 local-release tag，并以 `--use-loaded-images` 启动 compose。
- 正例：镜像已在本地构建，运维用 `--skip-build` 跳过重建，只传输当前归档。
- 正例：本地归档用 `--output-archive` 写到 `/Volumes/ORICO/...`，SSH 上传仍以 `--remote-dir` 指向 `/opt/smallkhoj`。
- 基准：镜像仓库已就绪；跳过本 CLI，使用仓库镜像 tag 加常规 pull/build 启动路径。
- 反例：在名义上 4 vCPU / 4 GB 的 Lighthouse 主机（客户机可见内存 3.32 GiB）上构建 Next.js，而不是传输预构建的 `linux/amd64` 镜像。
- 反例：在 `amd64` Lighthouse 主机上复用 Apple Silicon 的 `linux/arm64` 本地冒烟镜像。
- 反例：设置 `--remote-dir /Volumes/ORICO/...`；该路径只在本地存在，服务器上通常没有。
- 反例：在本地 `docker load` 之后又对 `smallkhoj-*:local-release` tag 运行 `docker compose pull backend frontend`。

### 6. 必备测试
- 单元测试覆盖默认命令计划、SSH identity/port 旗标、`--skip-build`、目标平台 build args、VPN 代理 build args、无机密命令载荷与已装载镜像的 compose 兼容性。

### 7. 错误与正确对照
#### 错误
```text
ssh host
docker build -t smallkhoj-frontend:latest ./frontend
# server swaps or runs out of disk/memory during Next build
```

#### 正确
```text
python3 scripts/production_image_transfer.py --host <ip> --user ubuntu --platform linux/amd64 --use-vpn-proxy
python3 scripts/lighthouse_ssh_deploy_probe.py --host <ip> --user ubuntu --remote-env-file .env.prod --compose-up --use-loaded-images
```

## 场景：首发 SSH 部署探测 Runner

### 1. 作用域/触发条件
- 触发条件：从本地机器校验首台腾讯云 Lighthouse 或替换 SSH 主机，无需逐条手工复制部署命令。
- 在本地生产 compose 冒烟通过之后、对真实部署主机做出超出上传/解包/探测的改动之前使用本场景。

### 2. 签名
- CLI 模块：`scripts/lighthouse_ssh_deploy_probe.py`。
- 必需旗标：
  - `--host <ssh-host-or-ip>`
- 可选旗标：
  - `--user <ssh-user>`
  - `--port <ssh-port>`
  - `--identity-file <path>`
  - `--remote-dir <path>`
  - `--local-bundle <path>`
  - `--bundle-prefix <name>`
  - `--remote-env-file <path>`
  - `--runtime-preflight`
  - `--compose-up`
  - `--use-loaded-images`
  - `--public-base-url <url>`
  - `--allow-http`
  - `--dry-run`
  - `--json`

### 3. 契约
- 默认模式必须在本地创建无机密打包，用 `scp` 上传，远程解包，运行 `lighthouse_host_probe.py --json`，并运行仓库/配置部署 preflight。
- runner 不得创建、上传或打印 `.env.prod` 或任何机密值。
- `--runtime-preflight` 需要 `--remote-env-file`。
- `--compose-up` 需要 `--remote-env-file` 且必须显式给出；默认探测不得启动容器。
- `--use-loaded-images` 只影响显式的 compose 启动：它会拉取 `db`，但不得拉取 backend/frontend 或构建 Caddy，因为这些镜像应当已由 `production_image_transfer.py` 提供。
- `--public-base-url` 在远程步骤之后运行本地 `post_deploy_smoke.py`。
- `--dry-run` 与 `--json` 必须在不执行 SSH/SCP/本地命令的情况下暴露命令计划。

### 4. 校验与错误矩阵
- 缺少 `--host` -> CLI 解析器失败。
- `--runtime-preflight` 不带 `--remote-env-file` -> 退出码 `2`。
- `--compose-up` 不带 `--remote-env-file` -> 退出码 `2`。
- 任何本地、`scp` 或 `ssh` 步骤返回非零 -> 停止并返回该码。
- 公网冒烟失败 -> 返回部署后冒烟退出码。

### 5. 正例/基准/反例
- 正例：`--dry-run` 首先按顺序打印创建打包、SSH mkdir、SCP 上传、远程解包、主机探测与仓库 preflight。
- 正例：runtime preflight 只在服务器上存在 `.env.prod` 且提供 `--remote-env-file` 之后加入。
- 正例：本地镜像传输之后接 `--compose-up --use-loaded-images`，服务器只拉取 `db` 并使用已装载的应用镜像。
- 基准：公网 URL 未就绪；runner 仍执行打包上传、主机探测与仓库 preflight。
- 反例：从本地仓库上传 `.env.prod`，或在命令计划中打印机密值。
- 反例：在 `lighthouse_host_probe.py` 记录 CPU/内存/swap/磁盘/Docker/端口证据之前，就在全新主机上启动 compose。
- 反例：在 `docker load` 装载 backend/frontend local-release tag 之后再拉取它们。

### 6. 必备测试
- 单元测试覆盖默认命令计划、SSH identity/port 旗标、runtime preflight、显式 compose 启动、已装载镜像启动、缺失 env 校验与可选公网冒烟。
- 首次真实使用主机前应人工检查 CLI dry-run。

### 7. 错误与正确对照
#### 错误
```text
scp -r . ubuntu@host:/opt/smallkhoj
ssh ubuntu@host 'docker compose up -d'
```

#### 正确
```text
python3 scripts/lighthouse_ssh_deploy_probe.py --host <ip> --user ubuntu --dry-run
python3 scripts/lighthouse_ssh_deploy_probe.py --host <ip> --user ubuntu
```

## 场景：首发远程部署证据采集器

### 1. 作用域/触发条件
- 触发条件：远程 Lighthouse 探测、preflight、compose 启动或公网冒烟失败，运维需要从本地机器获得一份无机密证据包。
- 在 `lighthouse_ssh_deploy_probe.py` 已把部署包上传/解包到远程主机之后使用本场景。

### 2. 签名
- CLI 模块：`scripts/remote_deploy_evidence.py`。
- 必需旗标：
  - `--host <ssh-host-or-ip>`
- 可选旗标：
  - `--user <ssh-user>`
  - `--port <ssh-port>`
  - `--identity-file <path>`
  - `--remote-dir <path>`
  - `--bundle-prefix <name>`
  - `--remote-env-file <path>`
  - `--public-base-url <url>`
  - `--allow-http`
  - `--output <json-path>`
  - `--dry-run`
  - `--json`

### 3. 契约
- 采集器必须在解包后的部署打包目录中运行远程命令。
- 默认证据必须包含主机探测、仓库 preflight、compose services、compose ps、核心服务近期日志、Docker ps、Docker system 磁盘占用、内存快照与磁盘快照。
- `--remote-env-file` 可以追加 runtime preflight，但采集器不得打印、cat、上传或复制 `.env.prod`。
- `--public-base-url` 可以追加本地部署后冒烟输出。
- 本地证据输出必须是 JSON，包含命令标签、命令字符串、返回码、stdout 与 stderr。
- `--dry-run` 与 `--json` 必须在不执行 SSH/本地命令的情况下暴露命令计划。

### 4. 校验与错误矩阵
- 缺少 `--host` -> CLI 解析器失败。
- SSH 命令失败 -> 捕获非零返回码结果；最终退出码非零。
- 公网冒烟失败 -> 捕获非零结果；最终退出码非零。
- 输出路径不可写 -> 命令因文件写入错误以非零退出。

### 5. 正例/基准/反例
- 正例：远程 compose 启动失败后，用一条证据采集命令得到带标签命令输出的 JSON 工件。
- 基准：还没有 env 文件；采集器仍收集主机探测、仓库 preflight、compose service/ps/日志与主机快照。
- 反例：作为证据采集的一部分运行 `cat .env.prod`、`printenv` 或上传 env 文件。
- 反例：只依赖 `docker compose logs`，漏掉主机内存/磁盘/Docker daemon 证据。

### 6. 必备测试
- 单元测试覆盖默认命令计划、SSH identity/port 旗标、可选 runtime preflight、可选公网冒烟与 JSON 结果形状。
- 首次真实使用主机前应人工检查 dry-run。

### 7. 错误与正确对照
#### 错误
```text
ssh host 'cat .env.prod && docker compose logs'
```

#### 正确
```text
python3 scripts/remote_deploy_evidence.py --host <ip> --user ubuntu --remote-dir /opt/smallkhoj --output /tmp/evidence.json
```

## 场景：首发生产部署 Preflight CLI

### 1. 作用域/触发条件
- 触发条件：修改生产 compose、Caddy 路由、frontend standalone 镜像输出、部署 env 要求或发布主机就绪检查。
- 在腾讯云 Lighthouse、隧道主机或任何发布候选机上启动生产栈之前使用本场景。

### 2. 签名
- CLI 模块：`scripts/initial_release_deploy_preflight.py`，在仓库根目录以 `python3 scripts/initial_release_deploy_preflight.py` 运行。
- 可选旗标：
  - `--env-file <path>`：检查部署 env 而不打印机密值。
  - `--runtime`：检查当前主机 Docker、内存、磁盘与端口。
  - `--json`：输出机器可读的发布证据。
  - `--strict-warnings`：存在警告时返回码 `2`。

### 3. 契约
- 默认模式必须离线且无机密：只检查被仓库跟踪的文件。
- env 文件模式必须检查必需的运维键，且不打印机密或镜像名的值。
- env 文件模式必须让仍使用占位符形状值（如 `<set-outside-repo>`、`<registry>/...:<tag>`、`TODO...`、`CHANGE_ME...`、`REPLACE_ME...`）的必需键失败。
- runtime 模式不得启动生产容器，也不得访问腾讯云、Feishu、Jira 或 LLM provider。
- 仓库检查必须覆盖 `docker-compose.prod.yml`、`deploy/caddy/Dockerfile`、`deploy/caddy/Caddyfile`、`frontend/next.config.mjs` 与 `frontend/Dockerfile`。
- 生产 compose 必须从 `./deploy/caddy` 构建 Caddy 镜像，把 Caddy 配置烘焙进镜像，而不是依赖对 `/etc/caddy/Caddyfile` 的文件级 bind mount。
- 生产 compose 可以让 Caddy 主机端口可覆盖以供本地冒烟，但默认必须保持主机 `80`、`443` 映射到容器 `80`、`443`。
- 生产 frontend 镜像就绪要求 `output: "standalone"`，以及复制 `/app/.next/standalone` 并启动 `server.js` 的 Dockerfile。
- Caddy 就绪要求 `/api/*`、`/internal/*`、`/docs`、`/openapi.json` 路由到 `backend:8000`，默认路由为 `frontend:3000`。
- runtime 就绪要求 Docker 命令可用、Docker daemon 响应、Docker Compose 响应、内存/磁盘阈值达标，且端口 80/443 未在本地接受 TCP 连接。

### 4. 校验与错误矩阵
- 生产 compose/Caddy/frontend 配置文件缺失 -> 检查失败。
- compose 服务或路由契约缺失 -> 检查失败。
- 缺少 `output: "standalone"` -> `repo.frontend.standalone` 失败。
- 必需 env 键缺失 -> `env.required` 失败。
- 必需 env 键仍是占位符值 -> `env.required` 失败，只列键名，不列值。
- 仅 IP/本地站点地址、CORS 不匹配或 frontend 公网 URL 覆盖 -> 警告，除非启用严格警告。
- Docker 命令/daemon/compose 不可用 -> runtime 检查失败。
- 主机内存低于 1.5 GiB 或磁盘低于 8 GiB -> runtime 检查失败。
- 主机内存低于 2 GiB 或磁盘低于 12 GiB -> 警告。
- 端口 80 或 443 已在本地接受 TCP 连接 -> runtime 检查失败。

### 5. 正例/基准/反例
- 正例：本地 CI 运行 `python3 scripts/initial_release_deploy_preflight.py --json` 并把 JSON 报告与发布证据一起保存。
- 正例：部署主机在 Compose 之前运行 `python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --runtime --json`；首次引导可以启动 `db`，而已有生产的更新只用应用服务集。
- 正例：本地生产冒烟设置 `SMALLKHOJ_HTTP_PORT=18080` 与 `SMALLKHOJ_HTTPS_PORT=18443`，而真实主机上的 Compose 默认仍使用公共端口。
- 基准：仅 IP 冒烟使用 `SMALLKHOJ_SITE_ADDRESS=:80`；env preflight 警告但不失败，除非使用 `--strict-warnings`。
- 反例：不先检查端口 80/443 是否已被其他服务占用就启动 Caddy。
- 反例：为本地冒烟把生产默认改成高端口，而不是用 env 覆盖。
- 反例：当生产 Dockerfile 依赖 `.next/standalone` 时，只依赖 `next build`。
- 反例：在 preflight 输出中打印 `POSTGRES_PASSWORD`、Jira API token、Feishu app secret 或 LLM key。
- 反例：把 `<set-outside-repo>` 或 `<registry>/smallkhoj-backend:<tag>` 当作合法的生产 env 值。

### 6. 必备测试
- 单元测试覆盖通过的仓库配置、缺失 standalone 输出、缺失 env 值与警告退出语义。
- 单元测试覆盖占位符 env 值在不泄漏值的情况下失败。
- CLI 冒烟：默认 preflight 对当前仓库通过。
- runtime 冒烟：runtime preflight 在当前机器上运行并报告 Docker/资源/端口状态。

### 7. 错误与正确对照
#### 错误
```text
docker compose --env-file .env.prod up -d
# then discover Caddy routes, frontend image output, or ports are wrong
```

#### 正确
```text
python3 scripts/initial_release_deploy_preflight.py --env-file .env.prod --runtime --json
  docker compose --env-file .env.prod -f docker-compose.prod.yml up -d \
    --force-recreate --no-deps --no-build --pull never backend frontend caddy
```

## 场景：首发部署后冒烟 CLI

### 1. 作用域/触发条件
- 触发条件：Caddy/frontend/backend 容器运行后，通过公网 base URL 校验已启动的生产栈。
- 在主机探测与生产部署 preflight 通过之后使用本场景。对既有生产数据库，
  前置更新只含应用服务；`db` 只在显式记录的首次引导中纳入。

### 2. 签名
- CLI 模块：`scripts/post_deploy_smoke.py`，在仓库根目录以
  `python3 scripts/post_deploy_smoke.py --base-url <url>
  --daemon-package-version <published-package-version>` 运行（或设置
  `DAEMON_RELEASE_VERSION`）。
- 可选旗标：
  - `--json`：输出机器可读的公网 URL 证据。
  - `--allow-http`：对仅 IP 或隧道冒烟允许 HTTP 且不警告。
  - `--timeout <seconds>`：单次网络操作超时。
  - `--strict-warnings`：存在警告时返回码 `2`。

### 3. 契约
- 该命令必须只读，且不需要认证、app 机密、Jira/Feishu 凭据、机器 token 或部署 env 文件。
- 必需检查：URL scheme、DNS 解析、TCP 连接、frontend 首页、
  `/api/health`、`/docs`、`/openapi.json`、选定的 Daemon 包 URL，以及
  `/internal/agent-api/ws` 的未认证 daemon WebSocket 升级探测。
- daemon WebSocket 探测不得发送真实机器 token。`401` 或 `403` 算通过，因为它证明路由到达 backend 且认证仍然生效。没有凭据时 `101 Switching Protocols` 算失败。
- 默认期望 HTTPS。HTTP 必须警告，除非使用 `--allow-http`。
- 如果 DNS、TCP 或 TLS 前置条件失败，端点检查应快速失败，不等待反复的 HTTP 超时。
- 输出不得包含原始响应体。

### 4. 校验与错误矩阵
- base URL 非法 -> URL 解析检查失败。
- HTTP base URL 且未加 `--allow-http` -> 警告。
- DNS 失败 -> `dns.resolve` 失败，被跳过的端点检查标记为失败。
- TCP 失败 -> `tcp.connect` 失败，被跳过的端点检查标记为失败。
- HTTPS 上 TLS 握手失败 -> `tls.handshake` 失败，被跳过的端点检查标记为失败。
- frontend 首页非 2xx/3xx HTML -> `http.frontend` 失败。
- `/api/health` 非 2xx JSON 或无 `status: "ok"` -> `http.health` 失败。
- `/docs` 非 2xx/3xx -> `http.docs` 失败。
- `/openapi.json` 非 2xx JSON 或缺少 OpenAPI 形状的键 -> `http.openapi` 失败。
- `/internal/agent-api/ws` 无 token 升级返回 `401` 或 `403` -> `ws.daemonAuth` 通过。
- `/internal/agent-api/ws` 无 token 升级返回 `101` -> `POST_DEPLOY_SMOKE_DAEMON_WS_ACCEPTED_WITHOUT_AUTH` 失败。
- `/internal/agent-api/ws` 无 token 升级返回 `404`、`502`、畸形状态或无响应 -> daemon WebSocket 路由检查失败。

### 5. 正例/基准/反例
- 正例：`python3 scripts/post_deploy_smoke.py --base-url https://smallkhoj.example.com --daemon-package-version <published-package-version> --json` 在 DNS、TLS、frontend、backend 健康、docs、OpenAPI、包与 WebSocket 检查全部通过后返回就绪。
- 基准：`python3 scripts/post_deploy_smoke.py --base-url http://<server-ip> --daemon-package-version <published-package-version> --allow-http --json` 在 ICP/域名/HTTPS 未就绪时验证仅 IP 的 HTTP 冒烟。
- 正例：daemon WebSocket 冒烟对未认证升级收到 `403`，证明 Caddy `/internal/*` 到达 backend 且认证仍然生效。
- 反例：只依赖 `curl /`，漏掉坏掉的 `/api/*` 或 `/openapi.json` Caddy 路由。
- 反例：在冒烟中用真实机器 token 打开 daemon WebSocket；daemon 校验属于 daemon 重连/live-run 门禁。
- 反例：把无 token daemon WebSocket 冒烟得到 `101 Switching Protocols` 当作健康。

### 6. 必备测试
- 单元测试覆盖本地伪部署冒烟成功。
- 单元测试覆盖 HTTP 警告行为、健康失败、daemon WebSocket 无认证拒绝、daemon WebSocket 无认证被接受的失败，以及 JSON/退出语义。
- 对本地拒绝端口的 CLI 冒烟应快速失败，不反复等待端点超时。

### 7. 错误与正确对照
#### 错误
```text
curl -I https://domain/
# frontend works, but /api/health is silently broken
```

#### 正确
```text
python3 scripts/post_deploy_smoke.py --base-url https://domain --daemon-package-version <published-package-version> --json
```

## 场景：首发 Feishu-Jira-TaskRun 循环

### 1. 作用域/触发条件
- 触发条件：把被接受的 Feishu `jira_analysis` 命令接到 Jira issue 查询、本地 task/run 创建或 Jira 评论回写。
- 用于发布编排。更低层的适配器仍在 `services.feishu_adapter`、`services.jira_rest` 与 `services.integration_gateway`。

### 2. 签名
- 编排模块：`services.release_loop`。
- 启动操作：`start_feishu_jira_analysis(db, feishu_outcome, jira_http_client, jira_connector, jira_credentials, creator_id, task_number_allocator=...)`。
- 回写操作：`write_back_task_run_to_jira(db, jira_http_client, jira_connector, jira_credentials, issue_key, task_run, task, output_text=None)`。
- 本地记录：
  - `Message` 记录 Feishu 来源请求。
  - `Task` 把 Jira 来源元数据存进 `data`。
  - `TaskRun` 由 `create_task_assignment_and_run` 创建。

### 3. 契约
- 只有 `FeishuDispatchOutcome(status="accepted", command.kind="jira_analysis")` 可以启动本循环。
- Jira 查询必须用 `services.jira_rest.fetch_jira_issue`。
- TaskRun 创建必须用 `services.task_runs.create_task_assignment_and_run`。
- 外部事件关联必须用 `services.integration_gateway.link_external_event`。
- Jira issue/评论映射必须用 `services.jira_rest.map_jira_issue` / `map_jira_comment`。
- 编排服务创建 TaskRun 状态，但不得直接执行 daemon/runtime/provider 工作。
- Jira 查询/回写失败必须包装成 release-loop 失败码，同时保留原始 Jira 原因码。

### 4. 校验与错误矩阵
- Feishu 结果非 accepted -> `RELEASE_LOOP_FEISHU_OUTCOME_NOT_ACCEPTED`。
- 不支持的命令 -> `RELEASE_LOOP_UNSUPPORTED_COMMAND`。
- 被接受的路由没有 channel -> `RELEASE_LOOP_ROUTE_CHANNEL_MISSING`。
- 被接受的路由没有受理人 -> `RELEASE_LOOP_ASSIGNEE_MISSING`。
- Jira 查询失败 -> `RELEASE_LOOP_JIRA_LOOKUP_FAILED` 附 `cause_code`。
- Jira 评论失败 -> `RELEASE_LOOP_JIRA_WRITEBACK_FAILED` 附 `cause_code`。

### 5. 正例/基准/反例
- 正例：被接受的 `@SmallKhoj 分析 JIRA-123` 创建频道消息、task、TaskRun、Jira issue 映射，并把外部事件关联到本地 id。
- 正例：完成的 TaskRun 输出追加 Jira 评论并映射 `task_run -> jira comment`。
- 基准：Jira 回写失败；本地 TaskRun 输出仍可用，调用方收到结构化失败。
- 反例：发布编排直接调用 daemon 控制或 runtime provider。
- 反例：把 Jira/Feishu 状态只存进 `Task.data` 而不用外部映射。
- 反例：把本服务当成生产 Feishu 长连接 worker；它是业务编排边界。

### 6. 必备测试
- 拒绝非法 Feishu 结果。
- 被接受的命令创建 message/task/run 并关联外部事件 id。
- 创建 Jira issue/评论映射。
- Jira 查询/回写失败暴露 release-loop 与原因码。
- 边界测试证明不直接导入 daemon/runtime 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
Feishu accepted command -> Jira lookup -> daemon command -> Jira comment
```

#### 正确
```text
Feishu accepted command -> Jira lookup -> Message/Task/TaskRun state -> daemon runtime later executes TaskRun -> release_loop write-back maps Jira comment
```

## 场景：TaskRun 终态外部回写钩子

### 1. 作用域/触发条件
- 触发条件：把 TaskRun 终态生命周期更新接到 Feishu/Jira/外部回写。
- 当 runtime 通过面向 daemon 的 TaskRun 生命周期 API 上报 `completed`、`failed` 或 `cancelled` 时使用本场景。

### 2. 签名
- 服务模块：`services.task_run_writeback`。
- 钩子操作：`handle_terminal_task_run_writeback(db, task_run, output_text=None, dependencies=None)`。
- 路由集成：`routers.agent_api.update_task_run_lifecycle_endpoint`。
- 依赖对象：`TaskRunWritebackDependencies(jira_http_client, jira_credentials_resolver)`。

### 3. 契约
- 只有终态 TaskRun 状态可以触发外部回写。
- 本地 TaskRun 生命周期更新保持权威。provider 回写失败不得回滚或抹掉本地 TaskRun 状态/输出证据。
- 用 `external_mappings` 实现幂等。一条 `task_run -> jira comment` 映射表示该 run 已回写过。
- 通过关联的 `external_events` 行与 task 的 `task -> jira issue` 映射发现 Jira issue 上下文。
- Jira 凭据必须来自运行时注入或密钥解析器。不要在已提交的 connector 配置中读取或存储 API token。
- 路由代码可以调用钩子，但 provider 专属的请求构造属于服务模块。
- 若存在 `TaskRun.output_message_id` 且未显式传入输出文本，则加载输出消息内容用作 Jira 评论。
- 钩子不得导入 daemon/runtime 执行辅助模块，也不得启动 provider 工作。

### 4. 校验与错误矩阵
- 非终态状态 -> `TASK_RUN_WRITEBACK_NON_TERMINAL`，不进入回写查询链。
- 已存在 Jira 评论映射 -> `TASK_RUN_WRITEBACK_ALREADY_WRITTEN`。
- 缺少关联事件/task/Jira issue 映射 -> `TASK_RUN_WRITEBACK_NO_JIRA_ISSUE`。
- 缺少 Jira connector -> `TASK_RUN_WRITEBACK_NO_JIRA_CONNECTOR`。
- 缺少 Jira HTTP client -> `TASK_RUN_WRITEBACK_NO_JIRA_HTTP_CLIENT`。
- 缺少 Jira 凭据解析器或解析结果 -> `TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS`。
- Jira 追加失败 -> `TASK_RUN_WRITEBACK_JIRA_FAILED`，关联外部事件变为 `writeback_failed`。
- 追加成功 -> `TASK_RUN_WRITEBACK_WRITTEN`、`task_run -> jira comment` 映射，关联外部事件变为 `completed`。

### 5. 正例/基准/反例
- 正例：完成的源自 Feishu 的 Jira 分析 run 加载输出消息内容，追加一条 Jira 评论，映射该评论，并把外部事件标记为 completed。
- 正例：同一完成 run 的重复生命周期上报看到既有评论映射后跳过，不创建重复 Jira 评论。
- 基准：生产机密接线未就绪；钩子返回结构化的凭据缺失结果，同时 TaskRun 更新照常提交。
- 反例：在生命周期路由里直接调用 Jira。
- 反例：把 `Task.data` 当作唯一的 Jira 回写标记。
- 反例：因为 Jira 暂不可用而让 TaskRun 完成失败。

### 6. 必备测试
- 非终态跳过。
- 用伪 Jira HTTP client 的终态成功。
- 未显式传输出文本时使用输出消息内容。
- 既有评论映射跳过重复回写。
- 缺少凭据返回结构化跳过。
- Jira 失败把关联外部事件标记为 `writeback_failed`。
- 生命周期端点对终态调用钩子，且钩子报告失败时仍提交。
- 边界测试证明钩子服务不导入 daemon/runtime 执行辅助模块。

### 7. 错误与正确对照
#### 错误
```text
TaskRun lifecycle endpoint -> append Jira comment inline -> fail request on Jira outage
```

#### 正确
```text
TaskRun lifecycle endpoint -> update local TaskRun -> services.task_run_writeback handles provider side effect -> commit local state with writeBack outcome
```

## 场景：Jira 回写运行时依赖桥

### 1. 作用域/触发条件
- 触发条件：在完整密钥管理器就绪之前，让 TaskRun 终态回写钩子可用于单实例发布部署。
- 用于 backend 设置、基于 env 的 Jira 凭据，以及接入 `services.task_run_writeback` 的 HTTP client 接线。

### 2. 签名
- 设置项：`config.Settings.jira_email`、`config.Settings.jira_api_token`。
- 运行时模块：`services.integration_runtime`。
- 依赖构建器：`build_task_run_writeback_dependencies(configured_settings=settings)`。
- 凭据解析器：`resolve_jira_writeback_credentials(connector, configured_settings=settings)`。
- 清理辅助：`close_task_run_writeback_dependencies(dependencies)`。

### 3. 契约
- Jira `siteUrl` 仍是非机密的 `ExternalConnector.config` 数据。
- Jira email/API token 来自运行时设置或未来的密钥解析器，不来自 connector 配置、外部事件、task 数据或 mapping。
- Jira 凭据缺失或不完整时，解析器返回 `None`，让回写钩子可以发出 `TASK_RUN_WRITEBACK_NO_JIRA_CREDENTIALS`。
- 生产依赖构建器使用 `httpx.AsyncClient(trust_env=False)`，避免意外的代理/环境耦合。
- 创建按请求回写 HTTP client 的端点代码，必须在钩子返回或抛出之后关闭它。
- 这座桥是发布阶段单实例机制，不是最终的租户感知密钥管理器。

### 4. 校验与错误矩阵
- `JIRA_EMAIL` 与 `JIRA_API_TOKEN` 都为空 -> 解析器返回 `None`。
- 只有一项 Jira 凭据 -> 解析器返回 `None`。
- 两项凭据齐全 -> 解析器返回去除首尾空格的 `{email, apiToken}`。
- 依赖构建器返回带 Jira HTTP client 与凭据解析器的 `TaskRunWritebackDependencies` 对象。
- 端点终态生命周期路径把依赖传入回写钩子并关闭自有 HTTP client。

### 5. 正例/基准/反例
- 正例：部署设置 `JIRA_EMAIL` 与 `JIRA_API_TOKEN`；TaskRun 完成可以经由既有映射驱动钩子追加 Jira 评论。
- 基准：部署未设置 Jira 凭据；TaskRun 完成仍在本地提交，并返回结构化的凭据缺失 writeBack 结果。
- 反例：把 Jira API token 存进 `external_connectors.config` 或 `.trellis` 任务工件。
- 反例：在发布路径上依赖系统代理 env 变量决定 Jira 回写行为。

### 6. 必备测试
- 设置项暴露安全的空默认值。
- 解析器对不完整凭据返回 `None`，对完整设置返回归一化凭据。
- 依赖构建器暴露 client + resolver 且可关闭。
- 生命周期端点把依赖传入 `handle_terminal_task_run_writeback` 并关闭自有 client。

### 7. 错误与正确对照
#### 错误
```text
ExternalConnector.config = {"siteUrl": "...", "apiToken": "..."}
```

#### 正确
```text
ExternalConnector.config = {"siteUrl": "..."}
JIRA_EMAIL / JIRA_API_TOKEN -> services.integration_runtime -> TaskRunWritebackDependencies
```

## 场景：Member 表上的 Computer 绑定列

### 1. 作用域/触发条件
- 触发条件：P1 统一 Member 模型把 agent 的 computer/runtime 绑定存进显式数据库列，同时保持旧配置载荷可读。

### 2. 签名
- `members.computer_id UUID REFERENCES computers(id) ON DELETE SET NULL`
- `members.backend VARCHAR(40)`
- 兼容配置键：`config.computerId`、`config.workspaceId`、`config.backend`
- 绑定表：`agent_workspaces(agent_id, computer_id, runtime, updated_at)`

### 3. 契约
- 显式列是查询/认证路径的事实源。
- 序列化器仍为 agent 输出 `computerId`、`workspaceId` 与 `backend`。
- 面向本地既有数据库的加列经 Alembic 迁移链落地（`alembic upgrade head`），绝不走启动 DDL。
- 迁移不得创建演示 server、member、computer、channel、message、task、API key 或活动日志。
- 迁移只可以把既有行从兼容配置键回填进显式列。

### 4. 校验与错误矩阵
- 旧数据库缺少 `members.computer_id` -> 由 Alembic 迁移补上。
- 旧数据库缺少 `members.backend` -> 由 Alembic 迁移补上。
- 既有行只有 `config.computerId` -> 当 UUID 引用真实 computer 时，由迁移回填 `members.computer_id`。
- 既有行只有 `config.backend` -> 由迁移回填 `members.backend`。

### 5. 正例/基准/反例
- 正例：agent API 认证经 `members.computer_id` 校验机器 token，序列化器返回 `computerId`、`workspaceId` 与 `backend`。
- 基准：只有配置绑定的旧行继续经兜底路径序列化与认证。
- 反例：只写 `config.workspaceId` 而不写 `agent_workspaces` 行，因为查询/认证路径无法可靠 join 或过滤。

### 6. 必备测试
- 断言数据库启动后存在 `members.computer_id` 与 `members.backend`。
- 断言启动不插入 `aaa`、`deepseek` 这类演示 agent。
- 断言 `/api/v1/members`、`/api/v1/computers`、`/internal/agent-api/profile` 与 `/internal/agent-api/channel-members` 返回 agent 绑定字段。
- 断言经 `members.computer_id` 绑定的 agent 可以通过机器 token 认证。

### 7. 错误与正确对照
#### 错误
只通过 `member.config` 读写 agent 的 computer 绑定。

#### 正确
先写 `members.computer_id` 与 `members.backend`，同时为旧客户端保持 `config.computerId`、`config.workspaceId` 与 `config.backend` 同步。

---

## 场景：按频道分配任务号

### 1. 作用域/触发条件
- 触发条件：公共与 agent 任务创建在唯一键 `tasks_channel_id_task_number_key` 之下以 `max(task_number) + 1` 分配 `tasks.task_number`。
- 每当代码在没有数据库序列的情况下创建 task 或其他频道作用域的类序列记录时使用本场景。

### 2. 签名
- 数据库唯一键：`UNIQUE (channel_id, task_number)`。
- 公共 API：`POST /api/v1/tasks`。
- 内部 API：任何写入 `Task(task_number=...)` 的 agent 任务创建路径。

### 3. 契约
- 把 `max(task_number) + 1` 只当作乐观分配。
- `tasks_channel_id_task_number_key` 出现 `IntegrityError` 时，回滚失败事务，重新计算下一个号，并在有界次数内重试。
- `AsyncSession.rollback()` 之后，不要读取先前加载 ORM 实例的属性，例如 `server.id`、`channel.name`、`creator.display_name`。回滚会使 ORM 状态过期；直接属性访问可能在 `greenlet_spawn` 之外触发异步惰性 I/O。
- 在重试循环之前缓存原始 ID/展示值，或在回滚后先重新加载 ORM 实例，再传给会读取属性的辅助函数。

### 4. 校验与错误矩阵
- 缺少 `title` -> `400 Missing title`。
- JSON 体畸形 -> `400 Invalid JSON body`。
- `messageId` 非法 -> `400 Invalid messageId`。
- 源消息不在任务频道内 -> `404 Source message not found in task channel`。
- 并发创建时 `(channel_id, task_number)` 重复 -> 重试，随后某个更晚的号成功时返回正常 `200` 响应。
- 达到重试上限后仍重复键 -> 重新抛出数据库错误，让调用方看到真实的运维故障。

### 5. 正例/基准/反例
- 正例：对同一频道并发 5 次 `POST /api/v1/tasks` 返回唯一且连续的任务号，无 500 响应。
- 基准：单次任务创建仍只插入一次、记录活动、提交、刷新 task 并发布最新事件。
- 反例：用 `max + 1` 创建 #N 号任务，不捕获 `IntegrityError`，让某个 worker 在另一个 worker 先建了 #N 时收到 `500 Internal Server Error`。
- 反例：调用 `await db.rollback()` 之后又在 `_record_activity` 里使用先前加载 ORM 对象的过期属性。

### 6. 必备测试
- API 并发冒烟：对同一频道并行 4-5 次 `POST /api/v1/tasks`，断言全部状态码为 200 且任务号互不相同。
- API 畸形 JSON 冒烟：向 `POST /api/v1/tasks` 发送非法 JSON，断言 `400 Invalid JSON body`。
- 活动/事件断言：重试创建之后，断言 task 存在且一条 `task.created` 事件/活动行引用最终 task id 与任务号。

### 7. 错误与正确对照
#### 错误
分配 `task_number = await _next_task_number(...)`，flush 一次，然后指望唯一约束永不冲突。

#### 正确
乐观分配，只捕获任务号唯一约束，回滚，重新加载或使用缓存的原始值，重新计算，并以较小的有界上限重试。

---

## 场景：有界序列化与稳定的任务/话题游标（Cursor）

### 1. 作用域/触发条件
- 触发条件：修改列表/搜索/历史序列化器、任务/话题排序、游标字段、端点过滤器，或假设拿到完整集合的前端消费者。

### 2. 签名
- 预取哨兵：`routers.serialization_prefetch.UNSET`。
- 分页上下文：`MessageSerializationContext`、`TaskSerializationContext`、`MemberSerializationContext`。
- 任务顺序：`(task_number ASC, channel_id ASC, id ASC)`。
- 话题顺序：SQL 限定根消息有回复后为 `(created_at DESC, id DESC)`。
- 游标编解码：base64url JSON，`v=1`，绑定 `endpoint`、`serverId`、归一化过滤器与完整位置元组。
- 任务 limit：`limit` 默认 50，约束在 `1..200`；响应附加 `nextCursor`。

### 3. 契约
- 列表工作只能按页数增长，不能按返回行数增长。关系/工作区/表情回应/回复数/TaskRun 数据每页加载一次，序列化器从不可变映射投影。
- `UNSET` 表示未提供上下文。提供的映射未命中或显式 `None` 都是权威结果，不得触发兜底 SQL。
- 公共与 agent 响应的键/空值/默认值保持不变，只允许新增分页信封（envelope）字段。
- SQL `ORDER BY`、游标位置字段与 seek 谓词使用同一元组/方向。`id` 是最终唯一决胜键。
- `task_number` 是频道作用域的，绝不能作为唯一的服务器级游标字段。
- 话题根在 seek/排序/limit 之前先与回复 join/限定；limit 之后再用 Python 过滤是禁止的。
- 游标的端点、Server、过滤器、版本、类型、时区、UUID 与长度不匹配都返回同一个不泄露信息的 `400 {"detail":"Invalid pagination cursor"}`。
- seek 游标是行位置令牌：删除边界行不会使续页失效。边界之前插入的行不会流入后续页。

### 4. 校验与错误矩阵
- 游标 JSON/base64/类型/版本缺失或非法 -> `400 Invalid pagination cursor`。
- 来自其他端点或 Server 的游标 -> 同样的 400；不泄露外部作用域细节。
- 游标搭配不同的 status/channel 过滤器复用 -> 同样的 400。
- 任务跨频道平局 -> 先按频道 UUID 再按任务 UUID 排序；每个任务只返回一次。
- 话题时间戳相同 -> 按消息 UUID 降序排序/seek。
- 没有合格的带回复根消息 -> 空页且 `nextCursor: null`。

### 5. 正例/基准/反例
- 正例：50 行与 100 行请求的语句数保持相等或低于具名常量上限，同时规范 JSON 快照一致。
- 正例：在两页之间删除边界 task/话题后，其余合格行恰好遍历一次。
- 基准：序列化器在列表之外以 `_context=UNSET` 调用；其文档化的单行兜底可以查询关系。
- 反例：用 `None` 同时表示「未预取」与「已知缺失」，或先 `limit * 3` 再用 Python 做回复过滤。
- 反例：游标只含 `task_number` 或 `created_at`，或前端在最初 50/200 行后停止。

### 6. 必备测试
- 用真实 PostgreSQL/ASGI 对公共与 agent 的 messages/search/history/tasks/members 做代表性 50/100 行全请求计数。
- 对空页、缺失关系、表情回应、TaskRun 与嵌套 Member 形状做精确规范快照。
- 对提供的缺失预取值做零 SQL 会话断言。
- PostgreSQL 任务/话题遍历覆盖平局、删除、边界前插入、完整无重复遍历、过滤器不匹配、版本不匹配、外部 Server 与跨频道游标复用。
- 前端测试必须证明每一个必需消费者都带重复游标与页边界防护地跟随 `nextCursor`。

### 7. 错误与正确对照
#### 错误
```python
for task in tasks:
    await db.execute(select(Channel).where(Channel.id == task.channel_id))
cursor = {"taskNumber": task.task_number}
```

#### 正确
```python
context = await load_task_serialization_context(db, tasks)
items = [await serialize(db, task, _context=context) for task in tasks]
cursor = encode_task_cursor(task_number=last.task_number,
                            position_channel_id=last.channel_id,
                            task_id=last.id, ...)
```

## 场景：上传资源信封与补偿

### 1. 作用域/触发条件
- 触发条件：公共文件、agent 附件或头像的 multipart 摄取；上传上限；Caddy body 上限；本地持久存储；或 FileEntry 事务变更。

### 2. 签名
- 入口：`POST /api/v1/files`、`POST /internal/agent-api/upload`、`POST /internal/agent-api/profile/avatar`。
- 共享服务：`services.upload_storage.stage_upload`、`StagedUpload.promote/cleanup`、`rollback_and_cleanup_upload`、`close_upload`。
- 环境变量：`UPLOAD_MAX_BYTES`、`UPLOAD_READ_CHUNK_BYTES`、`UPLOAD_CLEANUP_TIMEOUT_SECONDS`，以及 Caddy `SMALLKHOJ_UPLOAD_REQUEST_BODY_MAX`。
- 默认应用上限/读取块：50 MiB / 64 KiB。

### 3. 契约
- Caddy 请求体拒绝、Starlette multipart 落盘、应用读取/暂存与最终持久存储是各自独立的资源边界，必须分别报告。
- 每条路由使用同一个应用上限，除非显式给出经过评审的产品专属更低上限。
- 应用一次最多读取一个配置块，写进同目录的隐藏 `.uploading` 暂存文件。它不把完整请求体累积进字节数组。
- 恰好等于上限的输入被接受；超出一个字节返回稳定的 413。Content-Length 不被信任为唯一防线。
- 持久 blob 只有在校验与数据库 flush 之后，才用同一文件系统内的原子 `os.replace` 暴露。提交成功是唯一已提交的终态。
- 读/写/fsync/flush/promote/commit 失败与取消都会在有界等待内回滚并清除暂存/最终残留。每条路径都关闭解析器持有的 `UploadFile`。
- 不要声称应用分块能在 Starlette 解析/落盘 multipart 数据之前拒绝网络入口流量。

### 4. 校验与错误矩阵
- 公共文件/头像/附件为空 -> 该路由稳定的 400 详情；无行/blob。
- 请求体超过应用上限 -> 413；关闭句柄；无行/暂存/最终文件。
- 频道/消息/MIME 元数据非法 -> 持久提交之前 4xx；上传句柄仍然关闭。
- 读取中断或取消 -> 清理后重新抛出原始异常。
- 本地写/fsync/promote 失败 -> 回滚/清理；无已提交行。
- promote 之后数据库 flush/commit 失败 -> 回滚并 unlink 已提升 blob。
- 超过 Caddy body 上限 -> 代理在 backend 之前返回 413；把该证据与应用 413 区分开。

### 5. 正例/基准/反例
- 正例：迁移后的 PostgreSQL 接受恰好等于上限的一个 multipart 文件并拒绝下一个，留下一行 FileEntry、一个持久 blob、零个 `.uploading` 文件。
- 正例：三条路由强制提交失败后零行零 blob。
- 基准：Starlette 先把大的 multipart 部分落盘到临时磁盘，路由代码之后才应用 50 MiB 上限；文档同时说明两个边界。
- 反例：`content = await file.read()`、`chunks.append` 加 `b''.join(chunks)`，或直接写最终对外提供路径。
- 反例：先提交 FileEntry，再试图尽力而为地存储，而不补偿缺失/不完整文件。

### 6. 必备测试
- 每条路由：恰好上限、超一字节、多块输入、误导/缺失 content length、空输入、非法元数据、读取中断、取消、写/fsync 失败、数据库 flush/commit 失败与句柄关闭。
- 文件系统断言：每条非提交终态路径上都没有隐藏暂存或已提升残留。
- 真实迁移 PostgreSQL/ASGI 的成功与 413 用例，附行/blob 计数。
- 精确跟踪的 Caddy 镜像/配置探测：低于入口上限到达 backend；高于上限在 Caddy 返回 413。

### 7. 错误与正确对照
#### 错误
```python
content = await upload.read()
path.write_bytes(content)
db.add(FileEntry(storage_path=str(path)))
await db.commit()
```

#### 正确
```python
staged = await stage_upload(upload, final_path=path, max_bytes=limit, ...)
try:
    db.add(FileEntry(size=staged.size, storage_path=str(path), ...))
    await db.flush()
    staged.promote()
    await db.commit()
except BaseException:
    await rollback_and_cleanup_upload(db, staged)
    raise
finally:
    await close_upload(upload)
```

---

## 命名约定

<!-- 表名、列名、索引名 -->

（由团队填写）

---

## 常见错误

<!-- 团队犯过的数据库相关错误 -->

（由团队填写）

