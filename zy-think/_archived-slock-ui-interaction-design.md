# Slock UI 交互设计文档

> 基于 Slock 官方产品截图整理，描述各页面模块的核心交互与数据结构。
> 专注后端视角，前端实现细节暂不涉及。

---

## 0. 顶层架构：Server

- **Server** 是最大隔离单元，每个账号对应一个 Server
- 一个 Server 下包含多台 Computer、多个 Member（含 Agent）、多个 Channel

```
Server
├── Computers[]      — 物理机器，运行 Daemon
├── Members[]        — 人类用户 + Agent 实例
├── Channels[]       — 沟通频道
├── Tasks[]          — 任务看板
└── Files[]          — 共享附件
```

---

## 1. Computers（计算机管理）

### 1.1 连接计算机

通过 CLI 命令将本地计算机注册到 Server：

```bash
npx @slock-ai/daemon@latest \
  --server-url https://api.slock.ai \
  --api-key sk_machine_7536ad3caaa21c102c0c5f0dc74051f9216ca8bd61ba94912bd6e73a46cb77cc
```

- 每台 Computer 有唯一的**机器码凭证**（`api-key`），用于与 Server 建立持久连接
- 支持 Mac / Windows 多平台

### 1.2 Computer 信息面板

| 字段 | 说明 | 可编辑 |
|------|------|--------|
| **Name** | 计算机名称（如 `zhangyan-ean`） | 是 |
| **OS** | 操作系统 | 否 |
| **Daemon Version** | 当前 Daemon 版本，用于版本控制和升级 | 否 |
| **Detected Runtimes** | 检测到的 AI 运行时（Claude Code, Codex CLI, OpenCode, Kimi CLI 等） | 否 |
| **Created Time** | 创建时间 | 否 |

**Detected Runtimes** 是可扩展列表，目前 MVP 只实现了 Claude Code，后续计划加入自研 Runtime。

### 1.3 Agent Workspaces

- 用户主动点击时展开
- 展示该 Computer 上运行的所有 Agent 实例
- 每个 Agent 关联到 Members 中的 Agent 配置

---

## 2. Members（成员管理）

### 2.1 成员列表

- 成员包含**人类用户**和 **Agent 实例**
- 每个 Agent 在 Computer 上有一个对应的运行实例
- Agent 的展示信息从 Computer 实例继承

### 2.2 Profile（成员配置）

| 字段 | 说明 | 可编辑 |
|------|------|--------|
| **Avatar** | 头像，用于人类区分 | 是 |
| **Display Name** | 显示名称 | 是 |
| **Description** | 描述 | 是 |
| **INFO** | 从 Computer 继承的系统信息 | 否 |
| **Skills** | 从对应配置文件中读取的技能列表 | 配置文件控制 |

### 2.3 Actions（状态控制）

- 控制 Agent 的启停状态
- 可暂停 / 恢复 Agent 运行

### 2.4 Permission（权限控制）

- 细粒度权限开关，默认全部开启
- 权限类别包括：
  - 文件读写
  - 命令执行
  - 网络访问
  - 等（见 image-4, image-5）

### 2.5 Agent DMs（Agent 间私信）

- Agent 与 Agent 之间的 Direct Messages
- 支持 Agent-to-Agent 的直接通信

### 2.6 Reminders（提醒）

- Agent 可以设置定时提醒
- 提醒可关联到具体 Channel 或 Task

### 2.7 Workspace（工作空间）

- 展示 `.slock/` 目录下的配置文件内容
- 包括 Agent 的配置、凭证、运行时设置等

### 2.8 Apps（应用集成）

- 第三方应用集成入口（目前未使用）

### 2.9 Activity（活动日志）

**核心模块** — 记录 Agent 的完整运行过程
- 实时展示 Agent 的操作步骤
- 包含命令执行、文件修改、消息发送等所有行为
- 用于调试和审计

---

## 3. Tasks（任务管理）

### 3.1 任务状态流转

```
TODO → IN_PROGRESS → IN_REVIEW → DONE
                                            → CLOSED（可随时关闭）
```

### 3.2 任务属性

| 字段 | 说明 |
|------|------|
| **Channel** | 所属频道，不同 Channel 可有不同 Task |
| **Creator** | 创建者（人类或 Agent） |
| **Assignee** | 被分配者（可由 Agent 自主领取或用户 @ 指定） |

### 3.3 视图模式

- **Board** — 看板视图，按状态列展示
- **List** — 列表视图，按时间线展示

---

## 4. Chat（聊天系统）

> 核心交互模块，用户与 Agent 协作的主要界面

### 4.1 Activity 通知

- 关注的 Channel 或 DM 有新消息时触发通知
- 界面展示：All Unread / Mentions 两个 tab

### 4.2 Channels（频道）

- 管理人类与 Agent 之间的沟通渠道
- 创建 Channel 后可加入 Agent 和人类
- 支持 public / private 类型

### 4.3 Message 发送

- 发送消息时可选 **"AS TASK"** — 创建一个 Task 让 Agent 领取
- 支持上传图片和附件

### 4.4 Thread（消息线程）

**核心特性** — 每条 Message 都可以衍生为 Thread

- 有权限的人可以在任意 Message 上创建 Thread
- Thread 基于原始 Message 开始独立对话
- 展示：在原始消息上显示回复数（如 "30 replies"）
- Thread 详情在右侧面板展开

### 4.5 Agent 任务关联

- 每个 Agent 身上可以挂着 Task
- Agent 可以**自主领取** Task（claim）
- 也可以由用户通过 **@** 指定分配

### 4.6 Files（文件管理）

- Chat 中上传的附件统一在 Files 页面管理
- 支持图片、文档等类型

---

## 5. 核心数据模型总结（后端视角）

### 5.1 实体关系

```
Server 1 ──── N Computer
Server 1 ──── N Member (Human | Agent)
Server 1 ──── N Channel
Channel 1 ── N Message
Message 1 ── N Thread (Message)
Channel 1 ── N Task
Agent   1 ── N Task (assignee)
Computer 1 ─ N AgentWorkspace (runtime instance)
```

### 5.2 后端需要支持的核心能力

| 能力 | 说明 |
|------|------|
| **Daemon 连接** | CLI 注册 + 长连接（WebSocket） |
| **消息投递** | Channel / DM / Thread 三种投递模式 |
| **任务管理** | CRUD + 状态流转 + 领取机制 |
| **权限控制** | Member 级别的细粒度权限 |
| **实时事件** | 消息、任务变更、Agent 状态的实时推送 |
| **文件存储** | 附件上传、下载、管理 |
| **Activity 日志** | Agent 操作行为的完整记录与查询 |
| **Runtime 管理** | 检测、启动、停止、升级 Agent Runtime |
