# Agent Delegation Control Plane

## Goal

让当前 supervisor agent 不直接承担大块实现，而是通过一个本地 Slock-like control plane 给 Claude/Kimi/DeepSeek/Codex worker 派任务、收状态、做 review 和集成。

## What I Already Know

- Codex 内部 sub-agent 通道可用，适合短期并行实现与 review。
- 外部 agent 更适合通过本地 backend/daemon 的 Slock CLI 协议协作，而不是由 supervisor 读取 Claude stdout。
- `aaa-daemon` 当前能启动 Claude runtime，并生成 `.slock/slock` wrapper；worker 与系统通信的长期方向应是 `slock` CLI -> local proxy -> local FastAPI backend。
- 远端 `70d415e` 已合入本地，修复了 PostgreSQL 实测下的 P0 后端 bug。
- 本机 `localhost:5432` 被已有 PostgreSQL/SSH 转发占用；验证时使用临时 `pgvector/pgvector:pg16` 容器映射到 `localhost:55432`。
- 2026-06-03 再次验证：`127.0.0.1:5432` 返回 `role "smallkhoj" does not exist`，说明它仍不是可靠的项目 DB 入口；测试继续使用 `55432`。
- `aaa-daemon --server http://127.0.0.1:8000 --ws none --runtime none` 已能把 `.slock/slock` wrapper 指到本地 FastAPI backend。
- `slock message check` 通过 proxy 映射到 `/internal/agent-api/events?since=latest`；第一次调用推进游标，后续只返回增量消息。
- Backend 已新增持久化 `Computer`、`AgentWorkspace`、`ActivityLog`，并 seed 一台本地 Mac computer 与 aaa/deepseek workspace。
- Worker 可经 `.slock/slock` wrapper 读取 server 中的 computers/workspaces、profile 和 channel members。
- Backend 已新增持久化 `FileEntry`、`Reminder`，并实现 worker-facing reminder/attachment API。
- Backend 已支持基于 `Message.parent_id` 的第一版 Threads/replies：worker 可用 `#channel:<shortId>` 或 body `threadId/parentId` 回复线程。
- Backend 已支持 `/internal/agent-api/events` 的 SSE stream 模式，用于 daemon/worker 近实时接收消息事件。
- FastAPI agent auth 已升级为 `api_keys.token_hash` 校验，支持 agent token 和同机 machine token。
- Backend 启动时会运行 reminder firing scheduler：到点提醒会标记 fired、写入 activity，并在绑定 channel 时发出提醒消息。
- Frontend `/daemon` 已从 mock store 改为真实 API 聚合控制台，展示 computers/workspaces、tasks、reminders、files、activity 和最近消息。
- Backend 已新增 machine-token daemon lifecycle API：daemon 可用 computer token 注册/更新 computer 和 agent workspaces，并同步 agent profile 绑定。
- `aaa-daemon` 已新增显式 `--register-daemon` 开关；本地 backend 模式可用 `SLOCK_AGENT_TOKEN=sk_machine_local` 自动注册 daemon computer/workspace lifecycle。
- Backend 已新增 supervisor-facing public write API，允许 control plane 直接创建/更新任务、发消息、调整 agent permissions/actions、创建/取消 reminders。
- Frontend `/daemon` 已新增最小可操作控制区：派发任务、review/改派任务、发送 supervisor message、调整 agent control、安排 reminders。
- Backend 已补齐 daemon-facing `message search`、`message react`、`channel join/leave`，并统一 `dm:@handle` 解析，修复 DM 发送后可读/可搜/可解析的闭环。
- Backend `/internal/agent-api/events` 已从纯 message stream 扩展为兼容旧 message cursor 的 mixed event stream，可额外推送 task、reaction、channel membership、workspace、reminder activity-derived events。
- Backend 已新增 append-only `event_records` 表，activity-producing actions 会同步写入带全局单调 `eventSeq` 的事件记录；`/events` 使用 `eventLogCursor` replay 非消息事件，同时保留 `activityCursor` 兼容别名。
- Message events 已纳入同一 `event_records` 表：agent send、supervisor send、reminder-fired message 都会生成 `message_received` event，同时保留旧 `Message.seq` 作为 freshness cursor。
- `aaa-daemon` 的本地 proxy 已能区分消息事件与非消息事件：非消息事件会以自身 event type 进入 buffer 并送往 runtime，且不会参与 `pending_messages` freshness hold。
- Backend 已补齐真实 `slock profile update --avatar-file` 与 `slock integration list|login` 对应 endpoint；avatar 作为 FileEntry 存储，integration 状态存在 member config，并写入 event log。

## Requirements

- Supervisor 能创建任务、查看任务、分配/认领任务、更新任务状态。
- Worker CLI 发送的 snake_case task payload 必须被 FastAPI backend 接受。
- Worker 能通过 daemon-facing `/internal/agent-api/*` endpoint 进行消息和任务协作。
- Backend 能表达 Server -> Computers -> Agent Workspaces，并暴露 agent activity/heartbeat。
- Worker 能通过现有 `slock reminder ...` 和 `slock attachment ...` CLI 管理 reminders/files。
- Worker-facing 写接口必须执行 `member.config.permissions`，让 supervisor 可通过权限配置限制 agent 行为。
- Worker 能在线程内回复，并通过 daemon-facing API 列出线程、读取线程详情。
- Worker/daemon 可通过 SSE 接收 `message_received` 和 heartbeat，而不依赖读取 worker stdout。
- Worker/daemon 可通过同一个协议事件流接收 task/reaction/channel/workspace/reminder 控制事件，而不依赖 supervisor 读取 worker stdout。
- Worker/daemon 请求必须携带有效 bearer token；local seed 提供 `sk_agent_aaa_local`、`sk_agent_deepseek_local`、`sk_machine_local`。
- Reminder 不应只存储；到点后必须能触发为 channel message，重复提醒必须重新排程。
- Supervisor 不依赖 worker stdout；stdout 只作为进程托管/调试 fallback。
- 状态必须落地到 Trellis，便于模型切换或次日继续。

## Acceptance Criteria

- [x] `GET /internal/agent-api/tasks` 返回频道任务列表。
- [x] `POST /internal/agent-api/tasks` 支持创建单个或批量任务。
- [x] `POST /internal/agent-api/tasks/claim` 兼容 `task_numbers` / `task_number` / `taskNumber`。
- [x] `POST /internal/agent-api/tasks/update-status` 兼容 `task_number` / `taskNumber`。
- [x] `POST /internal/agent-api/tasks/{id}/claim` 可按 id 认领任务。
- [x] `PATCH /internal/agent-api/tasks/{id}` 可更新状态、标题、描述、assignee、data。
- [x] 已用真实 PostgreSQL + FastAPI HTTP 请求验证 server/tasks/history/send/claim/update。
- [x] `GET /internal/agent-api/events?since=latest` 兼容 daemon `message check`，并维护每个 agent 的 `eventCursor`。
- [x] `aaa-daemon` 支持 `--ws none`，可跳过官方 Slock websocket。
- [x] 已用 `.slock/slock` wrapper 经本地 daemon proxy 验证 server info、message check、message send、task create/list/claim/update。
- [x] Backend 模型包含 `computers`、`agent_workspaces`、`activity_logs`。
- [x] `GET /api/v1/computers` 和 `GET /api/v1/activity` 返回 frontend-facing 数据。
- [x] `GET /internal/agent-api/server` 返回 computers/workspaces。
- [x] `GET /internal/agent-api/profile`、`GET /channel-members`、`GET /resolve-channel` 可供 slock CLI 使用。
- [x] `POST /internal/agent-api/activity` 和 `POST /heartbeat` 可记录 agent 运行状态与 activity。
- [x] 已用真实 PostgreSQL + `.slock/slock` wrapper 验证 server/profile/channel-members/resolve-channel 和 activity/heartbeat。
- [x] Backend 模型包含 `files` 和 `reminders`。
- [x] `GET/POST/PATCH/DELETE /internal/agent-api/reminders` 支持 worker 创建、列出、更新、取消提醒。
- [x] `POST /internal/agent-api/upload`、`GET /attachments/{id}`、`GET /attachments/{id}/download` 支持 worker 上传、查看、下载附件。
- [x] `GET /api/v1/files` 和 `GET /api/v1/reminders` 返回 frontend-facing 数据。
- [x] 已用真实 PostgreSQL + `.slock/slock` wrapper 验证 reminder create/list 和 attachment upload/view/download。
- [x] `sendMessage`、`createTask`、`claimTask`、`updateTask`、`createReminder`、`updateReminder`、`fileWrite`、`updateProfile` 权限在 worker-facing 写接口生效。
- [x] 已用真实 PostgreSQL 验证允许的 task create 返回 200，关闭 `sendMessage` 后 message send 返回 403。
- [x] `POST /internal/agent-api/send` 支持 `#channel:<shortId>` target 后缀和 body `threadId` / `parentId` 创建 thread reply。
- [x] `GET /internal/agent-api/threads` 可列出有回复的 root messages。
- [x] `GET /internal/agent-api/threads/{id}` 可按 UUID 或 short id 返回 root + replies。
- [x] `POST /internal/agent-api/threads/unfollow` 可兼容 daemon JSON-RPC `thread.unfollow` 映射。
- [x] `/events` 和 `/history` 返回 `parentId` / `threadId`，便于 worker 保持线程上下文。
- [x] `GET /internal/agent-api/events?stream=true` 或 `Accept: text/event-stream` 返回 SSE stream。
- [x] SSE stream 发送 `ready`、`message_received`、`heartbeat` event，并复用 JSON `/events` 的 message event shape。
- [x] SSE stream 不推进 `eventCursor`；JSON `/events?since=latest` 仍保持原有 cursor 行为。
- [x] `api_keys` 包含 `token_hash`，seed/backfill 会写入本地 agent/machine token。
- [x] `resolve_agent` 校验 Bearer token hash；agent token 只能访问自身 `X-Agent-Id`，machine token 可访问同一 computer 下的 agent。
- [x] `create_tables()` 对旧库执行 `ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64)`。
- [x] FastAPI lifespan 启动 reminder scheduler，并在 shutdown 时取消后台 task。
- [x] 到期 pending reminder 会变为 `fired`，设置 `firedAt`，写入 `reminder_fired` activity。
- [x] 带 `channelId` 的到期 reminder 会生成一条普通 channel/thread message，因此 SSE/轮询都能收到。
- [x] 带 `repeat.intervalSeconds` 或 `cadence` 的 reminder firing 后会保持 `pending` 并更新下一次 `fireAt`。
- [x] `GET /api/v1/computers`、`/activity`、`/tasks`、`/reminders`、`/files`、`/channels/:name/messages` 已接入 frontend `/daemon` dashboard。
- [x] Frontend 控制台在 backend 不可用时保留空态/等待状态，不阻塞页面渲染。
- [x] 旧 Next custom WS server 缺失的 `daemon-auth`/`daemon-store` 兼容模块已补齐，避免 frontend build 被历史 MVP 入口阻断。
- [x] `resolve_machine` 校验 computer 类型 API key hash，并拒绝错误 token 或不匹配的 `X-Computer-Id`。
- [x] `POST /internal/agent-api/daemon/register` 可用 machine token 更新 computer metadata、detected runtimes，并 upsert agent workspaces。
- [x] `POST /internal/agent-api/daemon/heartbeat` 可用 machine token 更新 computer heartbeat 和 workspace runtime 状态。
- [x] daemon workspace upsert 会同步 agent `config.computerId/workspaceId/backend`，并写入 `workspace_registered` / `workspace_updated` / `workspace_heartbeat` activity。
- [x] `aaa-daemon start --register-daemon` 启动后会调用 backend daemon lifecycle API；默认不启用，避免对官方 Slock 或测试 fake upstream 发送未知 registration 请求。
- [x] `POST /api/v1/tasks` 和 `PATCH /api/v1/tasks/{id|taskNumber}` 可供 supervisor 创建、分配、review、更新任务。
- [x] `POST /api/v1/channels/{channel}/messages` 可供 supervisor 写入普通消息或 thread reply。
- [x] `PATCH /api/v1/members/{id|handle}` 可供 supervisor 更新 agent status、permissions、actions 和 backend config。
- [x] `POST /api/v1/reminders` 和 `PATCH /api/v1/reminders/{id}` 可供 supervisor 创建、更新、取消 agent reminder。
- [x] Frontend `/daemon` 的 Dispatch 与 Agent Control 表单调用真实 supervisor API，并修复 `detectedRuntimes` object 渲染。
- [x] `GET /internal/agent-api/search` 支持按可见 channel/DM 搜索消息，兼容 CLI `slock message search`。
- [x] `POST/DELETE /internal/agent-api/messages/{id|shortId}/reactions` 支持 worker 添加/移除 reaction，并返回聚合计数。
- [x] `POST /internal/agent-api/channels/{channel}/join|leave` 支持 CLI/JSON-RPC channel membership 操作并写入 activity。
- [x] `dm:@handle` 目标在 send/history/search/channel-members/resolve-channel/reminder 相关路径中统一解析为同一个 DM channel。
- [x] `/internal/agent-api/events?since=latest` 维护 `eventCursor` 和 `activityCursor`，旧 message seq cursor 兼容不变，新增 activity-derived events 不破坏 daemon freshness。
- [x] JSON `/events` 可返回 `task_created`、`task_claimed`、`task_updated`、`message_reaction_added/removed`、`channel_member_joined/left`、workspace/reminder event。
- [x] SSE `/events?stream=true` 使用 activity event type 作为 SSE event 名，worker 可实时收到非消息事件。
- [x] `event_records.seq` 提供非消息事件的 append-only 全局 cursor；JSON/SSE events 返回 `eventSeq`、`eventLogCursor`、`eventId`。
- [x] `/events?since=latest` 第二次拉取不会重复返回已推进 `eventLogCursor` 的非消息事件。
- [x] `message_received` events 也由 `event_records` replay，payload 同时包含全局 `eventSeq/eventLogCursor` 和旧消息 `seq/messageSeq`。
- [x] Agent message、supervisor message、reminder-fired message 都能通过同一 `/events` event log 被 worker 拉取。
- [x] `aaa-daemon` proxy 将 `/events` 中的非消息事件按 `task_created` 等原始类型缓存和 emit；只有 `message_received` 事件推进 message seq freshness。
- [x] 非消息事件会格式化为 Claude runtime 可读的文本信封，包含 `event=`、`eventSeq=`、`task=`、`status=`、`actor=` 等字段。
- [x] 非消息事件不会触发 `pending_messages` hold，worker 收到任务事件后仍可通过 `slock message send` 汇报状态。
- [x] `POST /internal/agent-api/profile/avatar` 支持 worker 上传 avatar 文件，更新 `member.avatarUrl`，并返回 avatar attachment 元数据。
- [x] `GET /internal/agent-api/integrations` 返回可用和已连接 integration；`POST /internal/agent-api/integrations/login` 记录 provider/scopes 连接状态。
- [x] `integration_connected` 与 `member_profile_updated` 会写入 append-only event log，便于 worker/runtime 通过同一事件流感知 profile/integration 变更。

## Current Gaps

- FastAPI auth 已有 hash 校验；尚缺 token rotation、管理 UI、权限审计日志，以及 production 级 secret 发放流程。
- 本地 `docker compose up --build backend` 在 `pip install uv` 阶段受网络影响卡住，后续应给 Docker build 配代理或优化 Dockerfile。
- `aaa-daemon` 已能切到本地 FastAPI backend 并显式注册 daemon/workspace lifecycle；已验证完整”接任务 -> 实现 -> 汇报”闭环：daemon inbox polling（无 WS 模式）从 backend 拉取事件，Claude worker 接收任务并写代码；尚缺 worker 通过 slock CLI 汇报任务状态的稳定闭环（当前需 supervisor 手动更新状态）。
- Computer/Activity 已有第一版持久化、API、machine-token registration、workspace heartbeat 和 `aaa-daemon --register-daemon` 接入；尚缺 token rotation/issuance、完整 daemon 管理入口，以及多机器权限审计。
- Files/Reminders 已有第一版持久化、API、firing scheduler、dashboard 展示和 supervisor 创建/取消入口；尚缺更完整的前端编辑体验和 production 级 scheduler coordination/backpressure。
- Threads/Replies 已有第一版 backend API；尚缺前端完整线程 UI、thread follow/unfollow 持久状态，以及 daemon CLI 显式 thread 命令。
- Realtime/SSE 已有第一版 backend stream；尚缺 websocket fanout、frontend realtime subscription，以及 production 级 backpressure/notify 优化。
- Frontend 已有第一版真实数据控制台和最小操作表单；尚缺更顺手的 agent/workspace 管理、权限审计、token 管理、integration/avatar 展示、线程化 review 和批量派工体验。
- Message search/reactions 和 channel join/leave 已有 backend API；尚缺 frontend 展示 reactions、消息搜索 UI、channel 管理 UI，以及 reaction event fanout。
- Mixed event stream 已能用 append-only event table 推送消息和非消息事件，daemon 也能把非消息事件交给 runtime；尚缺 ack/replay 策略、前端订阅、production backpressure，以及对旧库历史 messages/activity 的 backfill migration。

## Verification Notes

- Backend syntax check:
  `cd backend && uv run python -m py_compile routers/agent_api.py`
- Test DB:
  `docker run -d --name smallkhoj-test-db -e POSTGRES_USER=smallkhoj -e POSTGRES_PASSWORD=smallkhoj -e POSTGRES_DB=smallkhoj -p 55432:5432 pgvector/pgvector:pg16`
- Backend:
  `DATABASE_URL=postgresql+asyncpg://smallkhoj:smallkhoj@127.0.0.1:55432/smallkhoj uv run uvicorn main:app --host 127.0.0.1 --port 8000`
- Verified endpoints:
  `/internal/agent-api/server`, `/history`, `/send`, `/tasks`, `/tasks/claim`, `/tasks/update-status`, `/tasks/{id}`, `/tasks/{id}/claim`.
- Daemon build:
  `cd agent/daemon/aaa-daemon && npm run build`
- Local daemon mode:
  `node dist/cmd/main.js start --foreground --runtime none --server http://127.0.0.1:8000 --ws none --agent-id aaaa0000-0000-0000-0000-000000000001 --proxy-port 3457`
- Verified wrapper commands:
  `.slock/slock server info`, `.slock/slock message check`, `.slock/slock message send --target "#all" ...`, `.slock/slock task create --channel "#all" --title ...`, `.slock/slock task claim --channel "#all" --number 2`, `.slock/slock task update --channel "#all" --number 2 --status done`.
- Computer/activity verification:
  `GET /api/v1/computers`, `GET /api/v1/activity`, `GET /internal/agent-api/profile`, `GET /internal/agent-api/channel-members?channel=%23all`, `GET /internal/agent-api/resolve-channel?channel=%23all`, `POST /internal/agent-api/activity`, `POST /internal/agent-api/heartbeat`.
- Seed verification:
  Fresh temporary PostgreSQL on `55432` creates and returns seeded computers/workspaces; `seed()` also backfills the extended baseline when a database already has a server.
- Files/reminders verification:
  `POST /internal/agent-api/reminders`, `GET /internal/agent-api/reminders`, `PATCH /internal/agent-api/reminders/{id}`, `DELETE /internal/agent-api/reminders/{id}`, `POST /internal/agent-api/upload`, `GET /internal/agent-api/attachments/{id}`, `GET /internal/agent-api/attachments/{id}/download`, `GET /api/v1/files`, `GET /api/v1/reminders`.
- Wrapper verification:
  `.slock/slock reminder create --title ... --delay-seconds ... --channel "#all"`, `.slock/slock reminder list`, `.slock/slock attachment upload --channel "#all" --path ...`, `.slock/slock attachment view --id ...`, `.slock/slock attachment download --id ...`.
- Permission verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; `POST /internal/agent-api/tasks` with `Authorization: Bearer local-test` and `X-Agent-Id: aaaa0000-0000-0000-0000-000000000001` returned `200`, then temporarily setting `member.config.permissions.sendMessage=false` made `POST /internal/agent-api/send` return `403 Permission denied: sendMessage`.
- Threads/replies verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; `POST /internal/agent-api/send` created root message in `#all`; `POST /internal/agent-api/send` to `#all:<shortId>` created reply with `parentId` and `threadId`; `GET /internal/agent-api/threads?channel=%23all` returned one thread with `replyCount=1`; `GET /internal/agent-api/threads/{shortId}` returned root and reply; `GET /internal/agent-api/history?channel=%23all` returned reply `parentId/threadId`; `POST /internal/agent-api/threads/unfollow` returned `ok=true`.
- Activity detail verification:
  After flushing message before activity creation, `POST /internal/agent-api/send` followed by `GET /internal/agent-api/activity?limit=1` returned a non-null `details.messageId` matching the sent message id.
- SSE verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; opened `GET /internal/agent-api/events?since=latest&stream=true&intervalSeconds=0.25&heartbeatSeconds=2` with `Accept: text/event-stream`; sent a new message to `#all`; stream emitted `ready`, `message_received` with content `sse stream smoke`, and heartbeat frames. A subsequent JSON `GET /internal/agent-api/events?since=latest` still returned `count=0,nextCursor=3`.
- Auth verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; `GET /internal/agent-api/profile` returned `200 @aaa` for `Bearer sk_agent_aaa_local` and `Bearer sk_machine_local`; returned `401 Invalid agent token` for `Bearer wrong_token` and for mismatched `Bearer sk_agent_deepseek_local` with `X-Agent-Id` aaa.
- Reminder scheduler verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; created `POST /internal/agent-api/reminders` with `delaySeconds=1,channel=#all`; after scheduler tick, `GET /internal/agent-api/reminders?status=fired` returned the reminder with `status=fired,firedAt`, `GET /history?channel=%23all` showed `Reminder: scheduler smoke`, and `GET /activity?limit=5` included `type=reminder_fired`. Created another reminder with `repeat.intervalSeconds=30`; after firing, `GET /reminders?status=pending` showed it rescheduled with a later `fireAt` and `data.lastStatus=fired`.
- Regression checks:
  `cd backend && uv run python -m py_compile models/seed.py routers/agent_api.py`; `cd backend && uv run python -m py_compile routers/agent_api.py`; `cd backend && uv run python -m py_compile models/slock.py models/seed.py routers/auth.py routers/agent_api.py`; `cd backend && uv run python -m py_compile main.py services/reminder_scheduler.py models/slock.py routers/agent_api.py`; `cd backend && uv run python -m py_compile services/reminder_scheduler.py main.py`; `cd backend && uv run python -m py_compile models/slock.py models/__init__.py routers/agent_api.py`; `cd agent/daemon/aaa-daemon && npm run build`; `cd agent/daemon/aaa-daemon && npm test` (33/33 passing).
- Message search/reactions/channel membership verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; `POST /internal/agent-api/send` from aaa to `dm:@deepseek` returned message seq `5`; `GET /internal/agent-api/history?channel=dm:%40deepseek` found that DM message; `GET /internal/agent-api/search?q=...&channel=dm:%40deepseek` found the same message; `POST /internal/agent-api/messages/{shortId}/reactions` added `+1` with count `1`; `DELETE /internal/agent-api/messages/{shortId}/reactions` removed it with count `0`; `POST /internal/agent-api/channels/%23mac/leave` returned `left=true`; `POST /internal/agent-api/channels/%23mac/join` returned `joined=true`.
- Mixed event stream verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; initialized `GET /internal/agent-api/events?since=latest`, then created a task, sent a message, added/removed reaction, left/joined `#mac`; subsequent `GET /internal/agent-api/events?since=latest` returned `count=6`, `nextCursor=3`, a non-empty `activityCursor`, and event types `task_created`, `message_received`, `message_reaction_added`, `message_reaction_removed`, `channel_member_left`, `channel_member_joined`. SSE smoke opened `/events?since=latest&stream=true&intervalSeconds=0.25`, triggered a reaction, and observed frames `ready` then `message_reaction_added`.
- Append-only event record verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; `create_all` created `event_records`; initialized `/events?since=latest` with `eventLogCursor=0`; created task, message, reaction, channel leave/join; next `/events?since=latest` returned `count=5`, message `nextCursor=3`, `eventLogCursor=4`, `activityCursor=4`, non-message `eventSeqs=[1,2,3,4]`, and event types `task_created`, `message_received`, `message_reaction_added`, `channel_member_left`, `channel_member_joined`; immediate repeat `/events?since=latest` returned `count=0`. SSE smoke observed `ready` with `eventLogCursor=4`, then `task_created` with `eventSeq=5,eventLogCursor=5`. `cd agent/daemon/aaa-daemon && npm test` still passed 33/33.
- Unified message event table verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; initialized `/events?since=latest`; sent one agent message through `/internal/agent-api/send`, one supervisor message through `/api/v1/channels/all/messages`, and one channel-bound reminder with `delaySeconds=1`; after scheduler fired, `/events?since=latest` returned `count=4`, `eventLogCursor=4`, `nextCursor=5`, message event seqs `[3,4,5]`, and `message_received` contents for agent, supervisor, and reminder messages; immediate repeat returned `count=0`. SSE smoke then sent another agent message and observed `message_received` with `eventSeq=5`, message `seq=6`, and `eventLogCursor=5`. `cd agent/daemon/aaa-daemon && npm test` passed 33/33.
- aaa-daemon non-message runtime event verification:
  `cd agent/daemon/aaa-daemon && npm test` passed 35/35 after adding coverage that `task_created` events are buffered as `task_created`, emit `event_received` without `message_received`, do not block `slock message send`, and format into runtime envelopes with event/task/status/actor metadata.
- Profile/integration backend verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; `GET /internal/agent-api/integrations` returned available providers; `POST /internal/agent-api/integrations/login` with `github` and scopes `repo,read:user` persisted a connected integration; `POST /internal/agent-api/profile/avatar` with a multipart PNG updated `profile.avatarUrl` and returned avatar FileEntry metadata; `GET /internal/agent-api/events?eventLogCursor=0` returned `integration_connected` and `member_profile_updated` with `eventSeq` values. `cd backend && uv run python -m py_compile routers/agent_api.py models/seed.py` passed, and `cd agent/daemon/aaa-daemon && npm test` passed 35/35.
- Frontend dashboard verification:
  `cd frontend && npm run lint`; `cd frontend && npm run build`; browser opened `http://127.0.0.1:3000/daemon` and verified `Slock Control Plane` plus backend status rendered.
- Supervisor API verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; `POST /api/v1/tasks` created task `#2` assigned to aaa; `PATCH /api/v1/tasks/2` changed it to `in_review` and reassigned deepseek; `POST /api/v1/channels/all/messages` created message seq `3`; `PATCH /api/v1/members/aaa` changed status/actions/permissions; `POST /api/v1/reminders` created a pending reminder; `PATCH /api/v1/reminders/{id}` cancelled it; activity included `supervisor_task_created`, `supervisor_task_updated`, `supervisor_message_sent`, `supervisor_member_updated`, and `supervisor_reminder_created`.
- Frontend control verification:
  `cd frontend && npm run lint`; `cd frontend && npm run build`; browser opened fresh tab to `http://127.0.0.1:3000/daemon` with `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8001`; DOM verified title, Dispatch controls, Agent Control controls, supervisor task content, and object-shaped `detectedRuntimes` rendered as `claude_code / available`.
- Daemon machine lifecycle verification:
  Fresh temporary PostgreSQL on `55432` plus backend on `8001`; `POST /internal/agent-api/daemon/register` with `Bearer sk_machine_local` and matching `X-Computer-Id` returned `200`, updated computer name/runtime metadata, and returned workspace `running` with session id. `POST /internal/agent-api/daemon/heartbeat` updated workspace to `idle`; `GET /api/v1/computers` reflected runtime status/session id; `GET /internal/agent-api/profile` for `sk_agent_aaa_local` reflected `computerId/workspaceId`; `GET /api/v1/activity?limit=5` included `workspace_updated` and `workspace_heartbeat`; bad machine token returned `401`, mismatched `X-Computer-Id` returned `403`.
- aaa-daemon registration verification:
  `cd agent/daemon/aaa-daemon && npm test` passed 33/33 after making registration explicit. Fresh temporary PostgreSQL on `55432` plus backend on `8001`; ran `SLOCK_AGENT_TOKEN=sk_machine_local node dist/cmd/main.js start --foreground --runtime none --server http://127.0.0.1:8001 --ws none --agent-id aaaa0000-0000-0000-0000-000000000001 --proxy-port 3458 --workspace /Users/code/project/smallkhoj --pid-file /tmp/smallkhoj-aaa-daemon-test.pid --register-daemon`; `GET /api/v1/computers` showed computer `Mac-mini.local`, detected runtime `daemon/idle`, and a new `daemon` workspace for `@aaa`; `GET /api/v1/activity?limit=3` included `workspace_registered @aaa workspace registered on Mac-mini.local`.
