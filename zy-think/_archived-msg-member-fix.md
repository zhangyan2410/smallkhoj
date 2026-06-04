# Message / Channel / Member / Task 设计 — 修正清单

> 日期：2026-06-04
> 状态：**已定稿**
> 与 event-design-fix.md 配合阅读

---

## 总览

| # | 主题 | 文档描述 | 修正 | 优先级 |
|---|------|---------|------|--------|
| 1 | Member 表 agent 字段 | agent 特有字段全在 config JSONB | 拆 `computer_id`（FK）和 `backend`（VARCHAR）为显式列 | P1 |
| 2 | 权限 enforcement | 文档有权限粒度表和 enforcement 语义 | 不做服务器端 enforcement。权限是配置数据，daemon 同步，agent 自限。默认全开 | P2 |
| 3 | Thread 独立表 | 文档定义 Thread 接口（id, replyCount, participants, lastReplyAt） | **不加 threads 表**。Thread 是虚拟的，从 messages 的 parent_id 推导 | P1 |
| 4 | DMChannel 独立结构 | 文档有 `DMChannel extends Channel` 带 participants 字段 | **不加 DMChannel**。DM 是 `kind='dm'` 的 channel，2 个 ChannelMember | P1 |
| 5 | ChannelMember 扩展 | 文档有 role（admin/member/guest）、muted、lastReadSeq | 只加 `last_read_seq`（未读计数基础）。role 和 muted P2 再加 | P1 |
| 6 | Message mentions | 文档有 `mentions?: string[]`，但当前靠文本解析 | 加 `mentions UUID[]` 列。服务端解析 `@xxx` 模式写入。thread reply 推给 @mention 的人 | P1 |
| 7 | Agent 消息投递 | 文档 §3.3 描述 ack + 批量投递 | **逐条投递**。daemon 监听 agent 状态（idle/busy），idle 时逐条注入，busy 时排队。紧急时发 STOP 信号 | P1 |
| 8 | contentType 字段 | 文档有 `contentType: 'text' \| 'markdown' \| 'code' \| 'rich'` | **删掉 contentType**。所有 content 统一是 markdown（markdown 是纯文本超集）。前端永远按 markdown 渲染。code 用 markdown 代码块 | P1 |
| 9 | Task 状态机 | 文档有完整状态机但代码无校验 | 加 `VALID_TRANSITIONS` 校验。closed 是终态不可改。agent 只能操作自己认领的任务 | P1 |
| 10 | Task unclaim | 文档有但代码没实现 | 加 `POST /tasks/unclaim`。agent 释放任务，清空 assignee_id，status → todo | P1 |
| 11 | Task 完成证据 | 文档无 | **行为规范**：agent 完成→task thread 发证据（前端任务：截图/录屏 via webdriver；后端任务：文字摘要+测试结果）→ status → in_review | P1 |
| 12 | Task 开始前计划 | 文档无 | **行为规范**：agent claim 后先在 task thread 发执行计划，人类可提前纠正方向，再开始执行 | P1 |
| 13 | Task 录屏/截图 | 文档无 | P2 实现。agent 通过项目 webdriver 录制浏览器操作视频或截图，作为前端任务的 review 证据。后端任务用文字摘要 | P2 |
| 14 | Symphony 启发：stall 检测 | 文档无 | daemon 监测 agent 无输出超时（如 5 分钟）→ 自动终止 → 释放任务。防止 agent 卡死 | P1 |
| 15 | Symphony 启发：启动 reconciliation | 文档无 | 后端启动时扫描 status=running 的 workspace → 检查 daemon 是否在线 → 孤儿 workspace 标记 stopped | P1 |
| 16 | 消息编辑/删除 | 文档有 | **不做删除**（append-only）。编辑 P2 再看。Saved/bookmark 功能 P2（`saved_messages` 表） | P2 |

---

## 修正 1：Member 表拆列

### 当前文档（detail-spec §1.3）

AgentMember 有 `computerId`、`workspaceId`、`backend` 等字段在 config 里。

### 修正

```sql
ALTER TABLE members ADD COLUMN computer_id UUID REFERENCES computers(id) ON DELETE SET NULL;
ALTER TABLE members ADD COLUMN backend VARCHAR(40);
-- 人类 member 这两列是 NULL
```

- `workspaceId` 从 config 删除（从 AgentWorkspace 表反查 `WHERE agent_id = ?`）
- `permissions`/`actions` 保留在 config JSONB（配置数据，不需要列）

### 影响代码

- `models/slock.py`：Member 加两列
- `models/seed.py`：用新列替代 config 里的 computerId/backend
- `agent_api.py`：`resolve_agent` 从 `member.computer_id` 读取而不是 `config.computerId`

---

## 修正 2：权限 — 配置数据，不做 enforcement

### 当前文档（detail-spec §4）

详细权限粒度表（15 个权限项），人类按角色分配，有 enforcement 语义。

### 修正

- 权限存在 `member.config.permissions` JSONB，默认全开
- **服务器不检查权限**
- 人类在 UI 改 agent 权限 → 写入 config → daemon 注册/heartbeat 时读回 → agent 遵守
- 人类没有权限限制（单用户场景）
- P2 再考虑 enforcement（中间件/decorator 统一做）

---

## 修正 3：Thread 不加表

### 当前文档（detail-spec §1.6）

```typescript
interface Thread {
  id: string;
  rootMessageId: string;
  replyCount: number;
  lastReplyAt?: string;
  participants: string[];
}
```

### 修正

Thread 是虚拟的，从 messages 推导：

```sql
-- thread 信息
SELECT parent.id AS root_id,
       COUNT(reply.id) AS reply_count,
       MAX(reply.created_at) AS last_reply_at,
       ARRAY_AGG(DISTINCT reply.sender_id) AS participants
FROM messages reply
JOIN messages parent ON reply.parent_id = parent.id
WHERE parent.id = ?;

-- thread 回复列表
SELECT * FROM messages WHERE parent_id = ? ORDER BY created_at;
```

加索引：
```sql
CREATE INDEX idx_messages_parent ON messages(parent_id) WHERE parent_id IS NOT NULL;
```

不加 threads 表的理由：
- Thread 不是独立实体，是消息的视图
- 加表意味着每次发回复要额外写入 threads 表
- 查询可以靠索引优化

---

## 修正 4：DM 不加独立结构

### 当前文档（detail-spec §1.5）

```typescript
interface DMChannel extends Channel {
  type: 'dm';
  participants: [string, string];
}
```

### 修正

DM 是 `kind='dm'` 的 Channel，两个 ChannelMember。
- Channel name：`dm:{min(uuid1,uuid2)}-{max(uuid1,uuid2)}`（不暴露给用户）
- 解析 `dm:@peer_name` → 查 member → 拼 channel name → 找/建 channel
- participants 从 `channel_members` 表推导

不需要 DMChannel 独立接口。

---

## 修正 5：ChannelMember 只加 last_read_seq

### 当前文档（detail-spec §1.5）

```typescript
interface ChannelMember {
  memberId: string;
  joinedAt: string;
  role: ChannelRole;      // admin | member | guest
  lastReadSeq?: number;
  muted: boolean;
}
```

### 修正

```sql
ALTER TABLE channel_members ADD COLUMN last_read_seq BIGINT DEFAULT 0;
```

只加 `last_read_seq`（未读计数基础：`unread = max(messages.seq) - last_read_seq`）。

`role` 和 `muted` P2 再加。

---

## 修正 6：Message mentions 列

### 当前文档（detail-spec §1.6）

`mentions?: string[]` — member ID 列表。

### 修正

```sql
ALTER TABLE messages ADD COLUMN mentions UUID[] DEFAULT '{}';
```

服务端发消息时解析 `@xxx` 模式：
1. 正则匹配 `@(\w[\w.-]*)` 
2. 查 `members.display_name` 匹配
3. 写入 `mentions` 列
4. thread reply 推送时，recipients = thread 参与者 ∪ mentions 里的人

---

## 修正 7：Agent 消息投递 — 逐条 + 状态感知

### 当前文档（detail-spec §3.3）

描述了 ack + 批量投递 + 离线拉取。

### 修正

**逐条投递**，daemon 监听 agent 状态：

```
daemon 收到 SSE event（新消息）
  ↓
判断 agent 当前状态（通过 stream-json）
  ↓
idle     → 立即注入这条消息（完整内容）
busy     → 排队等待
urgent   → 发 [STOP] 信号，agent 在下一个自然停顿点停止
  ↓
agent 回到 idle → 逐条注入队列里的消息
```

agent 状态模型（daemon 从 stream-json 推导）：

| 状态 | 信号 | 处理 |
|------|------|------|
| idle | 等待 stdin 输入 | 立即注入 |
| thinking | `type: "thinking"` | 不打断 |
| tool_executing | `type: "tool_use"` + 等 `tool_result` | 不打断 |
| responding | `type: "text"` | 不打断 |

**不做 ack**（与 event-design-fix.md 一致，P2 再考虑）。

---

## DDL 变更汇总

```sql
-- Member
ALTER TABLE members ADD COLUMN computer_id UUID REFERENCES computers(id) ON DELETE SET NULL;
ALTER TABLE members ADD COLUMN backend VARCHAR(40);

-- ChannelMember
ALTER TABLE channel_members ADD COLUMN last_read_seq BIGINT DEFAULT 0;

-- Message
ALTER TABLE messages ADD COLUMN mentions UUID[] DEFAULT '{}';

-- Thread 查询优化
CREATE INDEX idx_messages_parent ON messages(parent_id) WHERE parent_id IS NOT NULL;

-- Task: 不需要改表结构，改动全在代码层
```

---

## 修正 9-10：Task 状态机 + unclaim

### 状态转换校验

```python
VALID_TRANSITIONS = {
    "todo": {"in_progress", "closed"},
    "in_progress": {"in_review", "todo"},       # todo = unclaim
    "in_review": {"done", "in_progress"},         # in_progress = reject
    "done": {"closed"},
    "closed": set(),                              # 终态，不可变更
}
```

**closed 是终态，不能再改成任何状态。**

### 权限规则

| 操作 | agent（assignee） | agent（非 assignee） | 人类 |
|------|:--:|:--:|:--:|
| claim | 可以 | 可以（没人认的） | 可以 |
| unclaim | 可以（自己的） | 不行 | 可以 |
| 改状态 | 自己的：in_progress → in_review | 不行 | 任意状态 |
| 关闭 | 不行 | 不行 | 可以（任意 → closed） |
| 改标题/描述 | 不行 | 不行 | 可以 |

### 代码改动

- `update_task_status`：加 `VALID_TRANSITIONS` 校验 + 权限检查
- 新增 `POST /tasks/unclaim`：清空 assignee_id，status → todo

---

## 修正 11-13：Task 行为规范 + 录屏

### 开始前计划（行为规范）

agent claim 任务后，**先在 task thread 发执行计划**，再开始工作：

```
agent claim task
  → task thread 发计划：
    "计划：
     1. 读 event-design-fix.md
     2. 修改 agent_api.py 的序列化函数
     3. 加 EventType enum
     4. 跑测试"
  → 人类看到，方向不对可 early stop
  → agent 开始执行
```

### 完成证据（行为规范）

agent 完成任务时，**在 task thread 发证据**，然后 status → in_review：

- **前端任务**：截图或录屏（通过项目 webdriver 操作浏览器）
- **后端任务**：文字摘要 + 测试结果 + PR 链接

### 录屏/截图（P2 实现）

- agent 通过项目 `twd.py` webdriver 录制浏览器操作
- 生成视频文件或截图
- 作为 FileEntry 附件关联到 task 的 thread 消息
- 人类 review 时查看

---

## 修正 14-15：Symphony 启发

### Stall 检测

daemon 监测 agent 无输出超时（如 5 分钟）→ 自动终止 → 释放任务。

### 启动 reconciliation

后端启动时扫描 `AgentWorkspace.status = 'running'` → 检查 daemon 是否在线（heartbeat）→ 孤儿 workspace 标记 `stopped`，关联 task 回退到 `todo`。
