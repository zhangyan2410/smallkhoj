---
topics: [architecture, slock, smallkhoj]
doc_kind: architecture
created: 2026-06-07
updated: 2026-06-19
---

# SmallKhoj / Slock 当前全局架构

> 更新日期：2026-06-07
> 用途：归档当前系统全局架构、已完成能力和待办缺口。

---

## 1. 系统分层

```text
Frontend (Next.js)
  -> Public API (/api/v1)
      -> FastAPI control plane
          -> PostgreSQL models
          -> EventRecord append-only stream
          -> DaemonControlHub
              -> daemon websocket / polling control
                  -> local aaa-daemon
                      -> runtime drivers
                          -> Claude Code now
                          -> Codex/Kimi/OpenCode/custom later

Daemon / Agent
  -> Agent API (/internal/agent-api)
      -> machine token auth
      -> agent-scoped auth via X-Agent-Id
```

Frontend 面向人类用户。FastAPI backend 是主要 control plane。daemon 是本地执行和 runtime bridge。runtime 是具体 agent CLI 或后续自研执行器。

---

## 2. 核心域模型

```text
Server
  id, name

Computer
  server_id, name, machine_id, status
  active_daemon_id, daemon_lease_expires_at
  detected_runtimes

Member
  server_id, type human|agent
  display_name, status, config
  computer_id, backend

AgentWorkspace
  computer_id, agent_id
  runtime, runtime_command, runtime_model
  status, session_id, cwd, pid

Channel
  server_id, name, type public|private|dm

Message
  channel_id, sender_id, parent_id
  content markdown, mentions, seq

Task
  channel_id, message_id
  task_number, status, creator_id, assignee_id

EventRecord
  server_id, event_type, seq
  actor_id/channel_id/task_id/message_id

ActivityLog
  server_id, agent_id, type, details
```

---

## 3. Computer 连接架构

当前连接流程已经从长期 machine token 命令改为一次性 connect ticket。

```text
1. User enters computer name
2. Frontend -> POST /api/v1/computers/connect-command
3. Backend creates ConnectTicket(sk_connect_..., TTL 300s)
4. Frontend displays local daemon command
5. daemon starts with SLOCK_CONNECT_TOKEN
6. daemon -> POST /internal/agent-api/daemon/connect
7. Backend validates ticket
8. Backend creates/reuses Computer by machineId
9. Backend issues sk_machine_...
10. daemon uses machine token for register/heartbeat
```

Important invariants:

- Connect command does not create a Computer.
- Browser never receives a machine token in the new flow.
- daemon-generated `machineId` maps to one Computer per Server.
- A live Computer can have one active daemon lease.
- Offline or lease-expired Computer can reconnect.
- Agent creation is a separate Members action.

---

## 4. Agent 创建和 runtime 启动

```text
Frontend Members page
  -> POST /api/v1/members/agents
      -> create Member(type='agent')
      -> create AgentWorkspace(status='pending_start')
      -> DaemonControlHub.push(start_runtime)

daemon
  -> receives control command
  -> starts runtime driver
  -> reports workspace in /daemon/heartbeat
```

Runtime command envelope:

```json
{
  "type": "control",
  "controlType": "start_runtime",
  "agentId": "...",
  "workspaceId": "...",
  "command": {
    "type": "start_runtime",
    "agentId": "...",
    "workspaceId": "...",
    "config": {
      "runtime": "claude_code",
      "workspaceId": "...",
      "backend": "..."
    }
  }
}
```

Current runtime support:

- Claude Code: implemented.
- `runtime=none`: daemon connects without auto-starting runtime.
- Codex/Kimi/OpenCode/Antigravity/custom runtime: planned.

---

## 5. Message / Task / Event flow

```text
Human sends message or task
  -> Public API writes Message/Task
  -> EventRecord appended
  -> push_latest_events_for_server
  -> DaemonControlHub filters by agent visibility
  -> daemon receives targetAgentId event
  -> daemon delivers to runtime
  -> runtime responds through Agent API
  -> backend writes Message/EventRecord
  -> frontend and daemon observe event stream
```

Task state:

```text
todo -> in_progress -> in_review -> done -> closed
          |               |
          v               v
         todo        in_progress
```

Thread model:

- root message has `parent_id = NULL`
- reply has `parent_id = root.id`
- no separate threads table

DM model:

- DM is a normal Channel with `type='dm'`
- two ChannelMember rows define participants

---

## 6. Current project status

Implemented or mostly implemented:

- Backend core data models and public/agent APIs
- Computer connect ticket protocol
- daemon machineId persistence and machine token lease
- daemon heartbeat/register and workspace status reporting
- daemon control hub for runtime start commands and visible event delivery
- Members page agent creation against real backend
- Computers page connect command and polling pattern
- Chat/Tasks basic backend API and event append path
- File/reminder/activity backend surface
- Claude Code runtime bridge

Still incomplete:

- Production user auth and multi-server UI
- Packaged daemon launcher
- Reconnect UI for existing offline Computer
- Full runtime lifecycle controls: stop/restart/kill/status reconciliation
- Non-Claude runtime drivers
- Frontend completeness for Threads, DM, Files, Reminders, Activity
- Permission UI and enforcement
- Channel unread/mentions/inbox accuracy
- Task review evidence and audit trail
- Redis/broadcast layer for multi-process backend
- API key management UI and rotation

---

## 7. Documentation map

- `total-design.md`：产品能力、页面和用户工作流总览。
- `slock-design-spec.md`：当前数据模型、auth、API、daemon/runtime 协议。
- `current-architecture.md`：全局架构归档入口。
- `daemon-architecture.md`：**daemon 内部架构、runtime 生命周期、排查地图**。
- `_archived-*.md`：历史草稿和旧决策记录，不作为当前实现依据。
