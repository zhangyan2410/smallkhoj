# 记忆（memory）契约（contract）

> 服务器所有的频道/任务/线程（thread）/agent 记忆、提案（proposal）审计、带作用域（scope）的 runtime 上下文清单（manifest），以及 agent CLI/API 契约。

---

## 场景（scenario）：服务器所有的带作用域记忆

### 1. 作用域 / 触发

- 触发：新增或修改共享记忆、任务交接、提案评审、runtime 记忆上下文，或面向 Agent 的 `aura memory ...` 命令。
- 这是一个跨层契约：数据库行 -> 后端服务 -> 公共/agent API -> daemon 本地代理 -> runtime 提示上下文 -> 前端频道记忆 / 任务恢复 UI。
- 频道与任务记忆是控制面产品原语。Agent 私有文件和未来的本地投影不是共享频道/任务事实的规范来源。

### 2. 签名

- 数据库表：
  - `memory_entries(server_id, scope_type, scope_id, path, title, entry_kind, content_text, blob_key, file_id, mime_type, size_bytes, content_sha256, version, source_message_id, source_channel_id, source_thread_id, source_task_id, source_path, author_member_id, visibility, metadata, created_at, updated_at, deleted_at)`
  - `memory_proposals(server_id, scope_type, scope_id, path, base_entry_id, base_sha256, proposed_content_text, proposed_blob_key, author_member_id, reason, status, reviewer_member_id, review_note, metadata, created_at, updated_at, resolved_at)`
- 作用域类型：`agent`、`channel`、`task`、`thread`。
- 公共/UI API：
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}`
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `PUT /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/search`
  - `POST /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals`
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals?status=open|accepted|rejected|superseded`
  - `POST /api/v1/memory/proposals/{proposalId}/accept`
  - `POST /api/v1/memory/proposals/{proposalId}/reject`
  - `DELETE /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
  - `GET /api/v1/channels/{channelName}/memory`
  - `GET /api/v1/tasks/{taskId}/memory`
- Agent API 在 `/internal/agent-api/memory/...` 下镜像带作用域的记忆路由，并新增：
  - `POST /internal/agent-api/memory/context-manifest`
  - `POST /internal/agent-api/tasks/{taskId}/memory/summary`
  - `POST /internal/agent-api/tasks/{taskId}/memory/promote`
- Agent CLI：
  - 受管 runtime 命令：`aura memory read|search|context|write|propose|proposals|accept-proposal|reject-proposal|delete`
  - 受管 runtime 任务记忆命令：`aura task summary|promote`
  - `slock` 与 `raft` 只作为兼容别名解析同样的命令；新的提示、清单与 runtime 事件（event）不得宣传它们
- daemon JSON-RPC 转发：
  - `daemon/memory.read`
  - `daemon/memory.search`
  - `daemon/memory.context`
  - `daemon/memory.write`
  - `daemon/memory.propose`
  - `daemon/memory.proposals`
  - `daemon/memory.proposal.accept`
  - `daemon/memory.proposal.reject`
  - `daemon/memory.delete`
  - `daemon/task.memory.summary`
  - `daemon/task.memory.promote`

### 3. 契约

- 记忆条目是带路径式键的扁平数据库记录。首个切片不要添加持久的空目录语义。
- `content_sha256` 与 `version` 由服务器管理。API/CLI 调用方可以传 `baseSha256` 做 CAS，但应当让 agent 收到可执行的冲突指令，而不是被迫去推敲哈希。
- `deleted_at` 表示软删除。列表/搜索必须排除已删除条目；审计响应可以序列化 `deletedAt`。
- 大型二进制输出应由 `file_id`、`blob_key`、`mime_type`、`size_bytes` 以及摘要（summary）文本/元数据表示。不要把原始图片/视频字节存入 `content_text`。
- 公共/UI 记忆路由同时要求公共 API 认证和当前账户/会话查看者（viewer）。它们必须把该查看者传入 `resolve_memory_scope(...)`。
- Agent 记忆路由必须把已认证的 agent 成员传给同一个作用域解析器。
- 私有频道记忆只对频道成员可见。公共频道可读不等于写权限。
- 变更要求 `ensure_scope_writable(...)` 语义：频道成员关系（membership）/写能力、任务创建者/受理人，或由服务层实现的显式能力。
- 任务记忆继承任务可见性，但任务作用域的上下文清单不得盲目纳入关联的频道记忆。列出频道片段（snippet）之前，先用当前查看者重新解析关联频道作用域；如果该检查返回 `403`，就省略频道片段并保留被允许的任务片段。
- runtime 上下文清单是有选择性的：
  - 包含片段、path/title/kind、作用域，以及 read-more 提示
  - 不包含作用域内的每一个条目
  - 不把原始完整 `contentText` 插入提示
  - 默认跳过 DM 作用域，除非后续 spec 显式改变这一点
  - 以裸 `aura memory ...` 形式输出面向 Agent 的 read-more 提示；`slock` 与 `raft` 仍是兼容别名，不得在新清单中宣传
- `memory.*` 浏览器/公共事件是缓存/UI 唤醒信号。除非被显式加入 `event-delivery-contracts.md` 中的 runtime 投递允许清单，它们不是 runtime 可行动的。
- FUSE/macFUSE/WinFsp 本地投影是后续叠建于这些 API 之上的读/写投影，不是事实来源。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 未知的 `scopeType` | 在转发到不受支持的后端路径之前 HTTP 400/CLI 失败。 |
| 私有频道非成员读取记忆 | HTTP 403；不泄露路径/标题/内容。 |
| 任务可见的非成员为私有频道任务请求任务上下文清单 | 可以返回任务片段；省略关联的私有频道片段。 |
| 公共频道非成员尝试写/提案/评审/删除 | 除非存在显式写能力，HTTP 403。 |
| `baseSha256` 与当前条目不匹配 | HTTP 409 `MEMORY_CONFLICT`，附重读/合并/提案指令。 |
| 接受基线已变化的提案 | HTTP 409 或对提案安全的解决方式；绝不默默覆盖。 |
| 删除成功 | 条目获得 `deleted_at`，版本递增，列表/搜索省略它，并发出 `memory.deleted`。 |
| DM runtime 投递 | 默认不自动请求记忆上下文清单。 |
| 频道/线程/任务 runtime 投递 | daemon 可以获取有选择性的上下文清单，并只前置片段/read-more 上下文。 |
| 记忆事件到达 daemon 事件流 | 除非被显式归类为 runtime 工作，它保持为对 runtime 不可行动的噪音。 |

### 5. 好/基线/坏案例

- 好：一个任务写入 `brief.md`、`plan.md`、`progress.md`、`evidence.md`、`final-summary.md`；持久结论晋升（promotion）到频道记忆或提请评审。
- 好：频道记忆 UI 把持久频道知识、任务产出、晋升和待审提案分组展示。
- 好：任务恢复 UI 展示恢复信号、任务分解、产出/证据、产物预览，以及来源/哈希/版本。
- 基线：`aura memory write --scope task --id <taskId> --path progress.md` 经 daemon 代理写入，且写门禁启用。
- 基线：`aura memory context --scope channel --id <channelId> --query "runtime session"` 返回有选择性的片段加 read-more 命令。
- 坏：仅因为任务对查看者可见，就在解析任务清单时读取私有频道记忆。
- 坏：把整个频道 `MEMORY.md` 注入每个 runtime 提示。
- 坏：把 `memory.created`、`memory.updated` 或 `memory.proposal.*` 当作 runtime 工作。
- 坏：把 agent 工作区的 `MEMORY.md` 拷贝进频道记忆而不做来源、评审或权限检查。

### 6. 必需测试

- 后端模型/服务测试：
  - 创建/更新/列出/读取/搜索带作用域条目
  - `baseSha256` 的 CAS 冲突
  - 软删除排除与审计序列化
  - 提案创建/接受/拒绝以及基线变化处理
  - 公共/私有频道读取权限
  - 变更权限与公共读取可见性分离
  - 任务上下文清单对任务可见的非成员省略私有频道片段
- 公共 API 测试：
  - 公共/UI 路由把当前账户查看者传入 `resolve_memory_scope`
  - 显式伪造记忆行动者被拒绝
  - 频道/任务别名返回与通用路由相同的带作用域条目
- Agent/daemon 测试：
  - CLI 命令映射到带作用域记忆端点
  - 写命令保持在显式写门禁之后
  - JSON-RPC 转发覆盖读/搜索/上下文/写/提案/提案评审/删除/任务摘要/任务晋升
  - `memory.*` 事件不是 runtime 可行动的
  - DM 作用域跳过自动记忆上下文；频道/线程/任务作用域可以请求有选择性的清单
- 前端/浏览器测试：
  - 频道记忆展示频道知识、任务产出、晋升和提案
  - 任务恢复展示 brief/plan/progress/output 信号与任务分解
  - 图片/视频/文件产物通过类型化查看器渲染，而不是埋在 markdown 里
  - 当 UI 依赖持久记忆时，用 `./twd` 的真实 UI 冒烟必须把可见 DOM 与 API 记忆行交叉核对

### 7. 错误 vs 正确

#### 错误

```typescript
// Do not blindly attach channel memory to every task prompt.
const channelEntries = await listMemoryEntries(db, server, {
  scope: { type: "channel", id: task.channelId },
})
prompt += channelEntries.map((entry) => entry.contentText).join("\n\n")
```

#### 正确

```typescript
// Resolve every scope through the current viewer and use a selective manifest.
const manifest = await fetchMemoryContextManifest({
  sessionScope: { type: "task", id: taskId },
  query: currentPrompt,
})
prompt = formatRuntimeIncomingMessageWithMemoryContext(message, manifest)
```

#### 错误

```bash
# Raw full channel memory in every runtime turn.
aura memory read --scope channel --id "$CHANNEL_ID" --path MEMORY.md >> prompt.txt
```

#### 正确

```bash
# Selective snippets plus read-more instructions.
aura memory context --scope channel --id "$CHANNEL_ID" --query "$CURRENT_TASK"
```
