# Runtime Slock 集成

> 本文件覆盖受管 Claude、Codex、OpenCode 与 Pi 的 runtime 身份、Slock CLI、本地代理、提供方（provider）与 connect-token 的集成。事件（event）可见性、活动（activity）/事件分离以及 runtime 令牌安全规则位于 `event-delivery-contracts.md`；在改动 `ActivityLog`、`EventRecord`、daemon WS/SSE/轮询或 runtime 交付分类之前，先阅读该文件。

## 场景（scenario）：Runtime Agent 使用 PATH 上的短 aura 命令

### 1. 作用域（scope）/ 触发

- 触发：任何点名面向 agent 的协作 CLI 的受管 runtime 提示词（prompt）、预热、环境、
  包装器（wrapper）或活动预览。
- 本场景对命令名具有权威性。本文件其他位置的旧 `slock`/`raft` 表述描述的是
  内部名称或兼容历史；不得把这类表述
  复制进新的 runtime 提示词。

### 2. 签名

- 面向 agent 的命令：`aura <domain> <action> ...`。
- runtime 本地可执行别名：`.slock/aura`、`.slock/aura.cmd` 以及
  `.slock/aura.ps1`。
- 仅兼容别名：`.slock/slock*` 与 `.slock/raft*`。
- 内部实现名保持 `.slock`、`SLOCK_*` 与
  `dist/slock-cli.js`；重命名这些存储/环境/API 接缝不在本作用域内。

### 3. 契约（contract）

- 每个受管 runtime 都会把生成的 workspace `.slock` 目录
  前置到子进程 `PATH`。该 runtime 本地路径必须胜过任何同名的宿主/全局
  `aura` 可执行文件；包级全局 `aura` 入口是 daemon 命令，
  不是 agent 协作 CLI。
- 受管 runtime 首次启动不得依赖预装的全局 `aura`、`slock` 或 `raft`，
  不得依赖已存在的 workspace，也不得依赖用户 HOME 下已有的协作 CLI
  状态。daemon 包一旦运行，就会创建 workspace 包装器
  并注入完整的 runtime 本地身份。
- Claude、Codex、Codex ACP、OpenCode 与 Pi 的提示词只使用裸
  `aura ...` 协作命令。提示词不得暴露、推荐或回退到
  生成的绝对 `.slock/{slock,raft,aura}` 路径。
- 启动预热对执行提供方预热的 runtime 调用 `aura server info`。
  这是有意通过它验证 PATH 契约，
  而不是用绝对包装器路径绕过。Pi 保持惰性，不在 daemon 启动时
  消耗一次合成提供方回合（turn）；其首启 PATH 契约
  在第一次真实回合之前的子环境边界上验证。
- `slock` 与 `raft` 包装器保留用于兼容旧会话与导入，
  但新的 runtime 行为和测试不宣传它们。
- 活动命令预览反映实际的提供方工具输入。它们保留代理密钥脱敏，
  但不得把长包装器路径改写成看起来不同的短命令。
  正确的短预览来自执行裸 `aura`，
  而不是来自显示层替换。
- 本次迁移中的提示词改动是机械性的：命令 token 与 PATH 说明改变；
  任务、安全、凭据、路由与通信
  语义保持不变。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 存在 runtime 本地 `.slock/aura` 且已注入 PATH | 裸 `aura server info` 解析到 workspace 包装器。 |
| 同时存在宿主/全局 `aura` | runtime 本地包装器胜出，因为 `.slock` 位于 PATH 最前。 |
| OpenCode 子进程启动 | 它获得与其他受管 runtime 相同的 PATH/SLOCK_HOME 身份边界。 |
| 提供方上报 `aura message send ...` 工具输入 | 活动在密钥脱敏后显示该确切的语义命令。 |
| 提供方上报旧的绝对包装器路径 | 活动不得伪装成执行了另一个命令；测试/runtime 提示词必须暴露该上游回归。 |

### 5. 所需测试

- 包装器：生成的 POSIX/cmd/PowerShell `aura` 别名指向 agent CLI，
  且 runtime 本地包装器目录是 PATH 的第一个组成部分。
- 干净首启：创建临时 HOME 与空 workspace，在 PATH 靠后位置
  放一个故意错误的宿主 `aura`，证明 Claude、
  Codex/Codex ACP、OpenCode 与 Pi 的子环境都执行新生成的
  workspace 包装器而不是宿主命令。
- 提示词：每个受管 runtime 只宣传 `aura`，且不含
  生成的绝对包装器路径或 `slock`/`raft` 命令示例。
- OpenCode：子环境一致地设置 `SLOCK_HOME`、runtime 身份字段与 PATH，
  同时移除代理密钥环境变量。
- 预热：daemon 集成证明每个非惰性预热提示词都要求 `aura server info`，
  且从不内插 `runtime.wrapper.bashWrapper`；
  Pi 覆盖保留其惰性启动例外，并通过 `buildPiRuntimeEnv` 验证
  相同的 PATH 解析。
- 活动：代理内部细节保持脱敏，短 `aura` 命令保持不变；
  不存在包装器路径折叠断言。

## 场景：Claude Runtime 使用 Slock CLI 而非 MCP 进行聊天

### 环境说明

本实现是在以下环境开发并验证的：

- 操作系统：Windows
- 手动命令 shell：PowerShell 与 Git CMD
- runtime：Node.js v22.14.0
- Claude Code CLI：`claude` 安装在 `%APPDATA%\npm` 下；Windows shim 委托到 `node_modules\@anthropic-ai\claude-code\bin\claude.exe`
- 路径分隔符：`;`
- 包装器优先级目标：`.slock` 目录必须位于 `PATH` 最前

测试期间观察到的 Windows 特有行为：

- PowerShell 可能让 `claude mcp add ... -- <server args>` 的 flags 被外层 Claude 命令解析。带服务器 flags 的手动 MCP add 命令请使用 Git CMD 或 `cmd /c "..."`。
- Windows 上 Node `spawn('claude')` 可能解析不到 npm shim。需要真实 Claude 可执行文件的测试应解析底层 `claude.exe` 路径，或有意使用 shell 执行。
- Windows 上 Node `spawnSync('slock.cmd')` 需要 `shell: true`。伪 runtime 测试用这一点匹配 Claude 的 Bash 工具触达命令 shim 的方式。
- 被派生的 Windows 进程使用的临时目录在退出后可能短暂保持锁定。测试应仅对临时目录容忍清理重试/失败。

未来的环境支持必须验证：

- macOS/Linux bash 包装器执行与可执行位行为。
- 若 Claude 运行在 WSL 下，Windows 路径与 Linux 路径之间的 WSL 路径转换。
- `slock`、`slock.cmd` 与 `slock.ps1` 的 PATH 分隔符与命令解析。
- Claude CLI 位置以及 npm shim 是否会被 `spawn` 解析。
- `claude mcp add ... -- <server args>` 的 shell 引号处理。

### 1. 作用域 / 触发

- 触发：Claude Code 的 daemon/runtime 集成、本地 HTTP 代理、生成的 `slock` 包装器与 MCP 兼容桥。
- 这是基础设施与跨边界契约：Claude Code 进程 -> `slock` CLI 包装器 -> 本地代理 -> Slock API，MCP 仅用于 runtime 兼容动作。

### 2. 签名

- CLI 入口：`slock message check|send|read|search|resolve|react`, `slock channel members|join|leave`, `slock thread read|summary|unfollow`, `slock server info`, `slock task list|create|claim|unclaim|update`, `slock profile show|get|update`, `slock integration list|login`, `slock reminder list|schedule|create|snooze|update|cancel|delete|log`, `slock attachment view|download|upload`
- daemon runtime 标志：
  - `aaa-daemon start --runtime none`（默认）
  - `aaa-daemon start --runtime claude`
  - `aaa-daemon start --import-slock-runtime <runtimeDir>`
  - `aaa-daemon start --runtime-command <command>`
  - `aaa-daemon start --runtime-command-arg <arg>`（可重复）
  - `aaa-daemon start --runtime-model <model>`
  - `aaa-daemon start --runtime-provider <providerName>`
  - `aaa-daemon start --runtime-resume-session-id <id>`
  - `aaa-daemon start --runtime-restart-on-crash`
  - `aaa-daemon start --runtime-stall-timeout-ms <ms>`
- daemon attach 入口：
  - `aaa-daemon attach --target <proxyUrl>`
  - 本地 HTTP 端点：`POST /internal/daemon/jsonrpc`
- 包装器输出：`.slock/slock`、`.slock/slock.cmd`、`.slock/slock.ps1`
- Claude 系统提示词文件：`.slock/claude-system-prompt.md`，在每次受管 Claude 启动前立即重写
- 令牌文件：`~/.slock/agent-proxy-tokens/{agentId}/{launchId}.token`
- MCP 入口：`chat-bridge.js --agent-id <id> --server-url <url> --auth-token <token> --runtime claude --runtime-actions-only`
- MCP 工具：`runtime_profile_migration_done({ migration_key?: string })`
- 现有 runtime 导入入口：`aaa-daemon smoke --import-slock-runtime <runtimeDir>`
- daemon 控制端点：
  - `POST /internal/agent-api/daemon/register`
  - `POST /internal/agent-api/daemon/heartbeat`
  - `GET /internal/agent-api/events?since=latest`
  - `WS /internal/agent-api/ws`
- runtime 控制命令信封（envelope）：
  - 原始/控制事件：`{type:"control", command:{type:"start_runtime"|"stop_runtime"|"restart_runtime"|"cancel_turn", agentId, workspaceId?, config?}}`
  - JSON-RPC 控制通知：`{jsonrpc:"2.0", method:"daemon.command.start_runtime"|"daemon.command.stop_runtime"|"daemon.command.restart_runtime"|"daemon.command.cancel_turn", params:{agent_id|agentId, workspace_id|workspaceId?, config?}}`
  - `config.runtime`：当前为 `claude_code`
  - `config.runtimeCommand?: string`
  - `config.runtimeCommandArgs?: string[]`
  - `config.runtimeModel?: string`
  - `config.runtimeProvider?: string`
  - `config.workspacePath?: string`
  - `config.workspaceId?: string`

### 3. 契约

- `slock` 包装器必须设置：
  - `SLOCK_AGENT_PROXY_URL`
  - `SLOCK_AGENT_PROXY_TOKEN_FILE`
  - `SLOCK_AGENT_ACTIVE_CAPABILITIES`
  - `SLOCK_AGENT_ID`
  - `SLOCK_SERVER_URL`
  - `SLOCK_CURRENT_WORKSPACE_PATH`
- POSIX `.slock/slock` 必须在 `exec` 之前以紧邻的命令作用域赋值传递这些变量，而不是独立的 `export SLOCK_*` 行。独立的 export 行容易被 shell 跟踪、包装器检查或 runtime 活动预览当作噪声输出暴露，并可能泄露本地代理令牌文件路径。
- 现有 runtime 导入必须同时向后兼容旧的独立 `export KEY='value'` 包装器与新的命令作用域 `KEY='value' \` 包装器。
- `slock` CLI 必须用从 `SLOCK_AGENT_PROXY_TOKEN_FILE` 读取的 `Authorization: Bearer {sap_token}` 为本地代理请求认证。
- 代理路径改写必须保留查询字符串：
  - `/internal/agent/{agentId}/receive?limit=10` -> `/internal/agent-api/events?limit=10&since=latest`
  - `/internal/agent/{agentId}/history?channel=%23general` -> `/internal/agent-api/history?channel=%23general`
- Claude runtime 环境必须把包装器目录前置到 `PATH`，但不得把代理密钥环境变量直接暴露给 Claude：
  - 设置 `FORCE_COLOR=0`
  - 将 `SLOCK_HOME` 设置为生成的 workspace `.slock` 目录
  - 设置 `SLOCK_AGENT_ID`
  - 将 `SLOCK_AGENT_LAUNCH_ID` 设置为代理令牌文件所用的 launch id
  - 设置 `SLOCK_SERVER_URL`
  - 设置 `SLOCK_CURRENT_WORKSPACE_PATH`
  - 将生成的 `.slock` 包装器目录前置到 `PATH`
  - 移除 `SLOCK_AGENT_TOKEN`
  - 移除 `SLOCK_AGENT_PROXY_URL`
  - 移除 `SLOCK_AGENT_PROXY_TOKEN`
  - 移除 `SLOCK_AGENT_PROXY_TOKEN_FILE`
  - 移除 `SLOCK_AGENT_ACTIVE_CAPABILITIES`
- Claude runtime 参数必须使用 Claude Code 进程 flags 而不是 settings JSON 来处理权限与提示词注入：
  - 包含 `--allow-dangerously-skip-permissions`
  - 包含 `--dangerously-skip-permissions`
  - 包含 `--permission-mode bypassPermissions`
  - 包含 `--output-format stream-json`
  - 包含 `--input-format stream-json`
  - 包含 `--disallowed-tools EnterPlanMode,ExitPlanMode,ScheduleWakeup,CronCreate,CronList,CronDelete`
  - 包含 `--append-system-prompt-file .slock/claude-system-prompt.md`
  - 不要为受管 Slock 提示词使用内联 `--system-prompt`
- Claude runtime 的 stdin/stdout 必须使用 stream-json JSONL 协议：
  - daemon 每行向 stdin 写入一个 JSON 对象
  - 用户消息输入形状为 `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]},"session_id":"..."}`；在 Claude 报告 session id 之前省略 `session_id`
  - daemon 把 stdout JSON 行解析为 runtime 事件，同时保留原始行诊断
  - 存在时从 `system` / 会话初始化类事件捕获 `session_id`
  - 以 `--runtime-resume-session-id` 启动时，向 Claude 传递 `--resume <id>`，并在 Claude 报告更新的 session id 之前为用户消息载荷（payload）使用该 session id
  - 将带 `tool_use` 块的 `assistant` 事件视为忙碌
  - 将带 `tool_result` 块的匹配 `user` 事件视为工具完成证据
  - 将 `result` 事件视为回合边界，排队的用户消息可在该边界冲刷
  - daemon 来源的消息投递：
  - WebSocket `message_received` / `message` 事件被规范化为带括号的文本信封，例如 `[target=dm:@zy-ean channel=<uuid> msg=12345678 time=... sender=@zy-ean type=human] @zy-ean: message`。
  - runtime 提示词必须声明 `target=` 是唯一可复用的回复目标。`channel=` / `channelId` 只是机器元数据，不得用作 `slock message send --target`。
  - 后端 `message.created` 事件载荷必须为 runtime 提示词包含可安全回复的 `target`/`channel` 字符串，外加供机器查找的 `channelId`。公开/私有频道目标使用 `#name`；DM 目标使用接收方 runtime 视角的发送方对端句柄，例如人类发给 agent 的 DM 使用 `target:"dm:@zy-ean"`。thread 目标追加根短 id，例如 `dm:@zy-ean:a1b2c3d4`。裸频道 UUID 可作为 API 回退目标，但不得作为主要的 runtime 提示词目标。
  - 事件重放必须为存储载荷缺少这些字段的历史 `message.created` 行回填（backfill）可安全回复的 `target`/`channel`。轮询、SSE 与 daemon WebSocket 展开必须从 `event_records.message_id` -> 消息/频道/根 thread 加上接收 agent 的 DM 对端推导目标，使重连的 daemon 不会把旧的 DM thread 消息重放为无目标的顶层 DM。
  - 后端事件记录使用点号分隔的规范事件名，如 `message.created`、`task.created`、`task.claimed`、`task.updated`、`message.reaction_added`、`channel.member_joined` 与 `thread.summary_requested`，同时为旧消费者返回 `legacyType`。
- 后端 daemon WebSocket 投递按计算机作用域。`WS /internal/agent-api/ws` 用机器令牌认证，为每个连接维护一个游标（cursor）`eventLogCursor`，按该计算机上每个能看到该事件的 agent 展开 `EventRecord` 行，并在发送前把 `agentId` 与 `targetAgentId` 都设为接收 agent 的 id。不要复用 `EventRecord.actor_id` 作为投递目标。自回显抑制、活动/事件分离与非可行动事件过滤规则见 `event-delivery-contracts.md`。
  - 后端 daemon WebSocket 推送必须在创建 `EventRecord` 的数据库提交之后运行。若没有 WS 对端连接，事件保留在 `event_records` 中，作为重连/SSE/轮询回退。
  - daemon WebSocket 重连 URL 一旦收到过消息/任务事件，就必须包含 `eventLogCursor=<last delivered event seq>`，使重连不会把旧聊天重放进 runtime。
  - 无游标、`eventLogCursor=0` 或游标无效的 daemon WebSocket 连接是从当前最大 `EventRecord.seq` 开始的实时订阅。它不得在 daemon 重启时把历史聊天重放进 Claude 或其他 runtime。历史上下文由 agent 在需要时用 read/check/search 命令显式拉取。
  - daemon 代理/runtime 代码必须把点号分隔的 `message.*` 事件当作旧版 `message_received` 处理收件箱缓冲、新鲜度跟踪与 runtime 投递。当点号分隔的消息事件带 `payload.message` 时，先展开该嵌套消息再缓冲。
  - daemon 代理/runtime 代码必须同时接受蛇形命名的任务事件（`task_created`）与点号分隔的任务事件（`task.created`），并作为非消息 runtime 事件投递，且不影响待处理消息的新鲜度状态。
  - 从聊天消息创建的任务必须保留来源关联（`Task.message_id`、事件 `messageId` 与 `payload.source`），并留在来源频道/DM 中。`assigneeId` / `targetAgentId` 是同时控制事件投递与认领资格的指派元数据。设置了 `targetAgentId` 时，无论频道成员关系如何，事件都直接投递给该 agent，且只有该 agent 可以认领任务。未设置 `targetAgentId` 时，事件遵循常规频道可见性规则，任何频道成员都可以认领任务。
  - 被指派的 `task.created` / `task_created` 事件对被指派且可见的 agent 是可行动的 runtime 工作，而不是被动通知。runtime 格式化与提示词必须告诉模型认领/开始任务、完成工作、回复来源目标/thread，并在就绪时把任务移到 `in_review`。
  - agent 的任务状态转换有意比主管转换更窄：被指派到任务的 agent 可以通过认领/开始把它从 `todo -> in_progress`，提交工作时 `in_progress -> in_review`，取消认领时 `in_progress -> todo`。agent 不得设置 `done`；由人类/主管审批拥有。
  - daemon 代理/runtime 代码必须接受 `thread.summary_requested` 等 thread 事件，并作为非消息 runtime 事件投递。定向 thread 事件必须保留 `targetAgentId`，使只有被选中的 runtime 收到请求。
  - agent 作用域的代理 `/events` 与 SSE 响应必须在规范化之前为缓冲/发出的事件标注注册 `agentId`，除非上游事件已包含 `agentId`/`agent_id`。多 runtime 投递依赖这个标记来避免把一个 agent 的收件箱条目发给另一个 runtime。
  - 代理 `/internal/agent-api/events` 与 SSE 事件使用同一事件缓冲，并走同一 `message_received` 投递路径
  - runtime 投递调用 `ClaudeRuntimeDriver.sendUserMessage()`；若 Claude 忙碌，由 runtime 队列负责延迟到安全的回合边界
- WebSocket 管理器必须：
  - 在连接与心跳（heartbeat）时发送活动载荷（`{type:"activity",status,at}`）
  - 用 `{type:"ack",message_id?,seq?,at}` 确认可识别的消息事件
  - 同时支持原始事件载荷与 JSON-RPC `daemon/message.received` 通知
  - 支持 JSON-RPC 点号分隔通知：`message.*` 映射到消息投递，`task.*` 映射到 runtime 投递的通用事件路径
  - 支持原始 `control` 事件与 JSON-RPC `daemon.command.*` / `control.*` 通知；对 JSON-RPC 方法，命令类型来自方法后缀，且必须在分发前保留。
  - WS 连接期间停止收件箱轮询，仅在 WS 断开且 daemon 拥有具体 `agentId` 时重启旧版 agent 作用域收件箱轮询。
- 代理新鲜度必须扣留失效（stale）发送：
  - 发送到 `/internal/agent-api/send` 时，若提供了 `seenUpToSeq` 则检查它，否则检查 `readUpToSeq`
  - 当待处理消息事件的 seq 大于 `seenUpToSeq` 时，返回 HTTP 409 与 `{state:"held",reason:"pending_messages",seenUpToSeq,pendingCount,pending}`
  - `message.check`、`/events` JSON 响应与 `/history` 响应推进 `readUpToSeq`；SSE 事件会被缓冲，但自身不标记已读
- attach/客户端 JSON-RPC 必须使用 daemon 端点，而不是 agent API 根：
  - attach 逐行向 `/internal/daemon/jsonrpc` 提交一个 JSON-RPC 对象
  - attach 的 stdout 只能包含 JSON-RPC 帧；状态/日志文本走 stderr
  - `ClientHandler` 通过本地代理转发 daemon Slock 方法，携带 `Authorization: Bearer {sap_token}`，绝不用代理 URL 当令牌
  - 转发的 daemon 方法包括消息、任务、频道、thread、资料、集成、提醒、附件与知识的读/搜索操作
- runtime 生命周期：
  - daemon 按 `agentId` 管理 runtime 实例；不要为动态 agent 使用单一全局 `ClaudeRuntimeDriver`。
  - 创建 agent 成员时，若 API 请求显式设置 `autoStart:false` 或 `startRuntime:false`，可以只注册其 `AgentWorkspace` 而不立即启动 runtime。此时存储 `runtimeDesiredStatus:"stopped"`，保持 workspace `status:"stopped"`，且不向 daemon 推送 `start_runtime` 命令。对既有调用方默认仍是自动启动。
  - 每个 runtime 有自己的代理注册、生成的 `.slock` 包装器目录、令牌文件、workspace 路径、捕获的 session id、重启定时器、停滞看门狗（watchdog）与生命周期状态。
  - 动态 `start_runtime` 命令可能通过 `/daemon/register`、`/daemon/heartbeat`、轮询 `/events` 或 `/ws` 到达；所有传输必须分发同一个解析后的命令对象。
  - 动态 runtime workspace 必须隔离。若命令省略 `workspacePath`，在 daemon workspace 根下使用按 Server、按 Computer、按 workspace 的路径：`<daemon workspace root>/.slock-runtimes/<serverId>/<computerId-or-machineId>/<workspaceId>`。若后端未提供 `workspaceId`，回退用 agent id 作为路径最后一段。绝不在来自不同 Server 或不同 Computer 的动态 agent 之间共享 daemon 根 `.slock` 包装器。
  - 活跃 runtime 的心跳/注册 workspace 载荷使用 `status:"running"`，并在已知时包含 `workspaceId`、`runtime`、`runtimeCommand`、`runtimeModel`、`sessionId`、`cwd` 与 `pid`。
  - 在 daemon 注册/心跳时，`workspaces` 数组是该 daemon 进程当前管理的 runtime 的权威列表。同一计算机上任何之前为 `running`、`active` 或 `idle` 但不在载荷中的 workspace 必须视为失效，并重新武装（re-arm）为 `pending_start`，使下一个控制响应可以再次发送 `start_runtime`。
- daemon 与旧版 agent 心跳端点更新 `computers.last_heartbeat_at`、`computers.status`、`agent_workspaces.status`、`agent_workspaces.session_id` 与 `agent_workspaces.pid` 等当前状态字段，但不得创建高频 `ActivityLog(kind="workspace_heartbeat")`、心跳类 `ActivityLog(kind="custom")` 或 `EventRecord(event_type="workspace.heartbeat")` 行。workspace 首次注册或显式更新时的注册/更新事件仍然有效。心跳/活动遥测绝不能作为工作投递给 runtime。
  - 显式停止上报 `status:"stopped"`；意外退出在 runtime 记录被移除前上报 `status:"exited"`，使后端状态不会虚假地保持运行。
  - 派生 CLI 包装器或提供方 shim 的 runtime 驱动必须终止整个 runtime 进程树，而不仅是直接子进程。在 POSIX 上，把基于包装器的 runtime 放入独立进程组启动，并向进程组发送生命周期停止信号。若 runtime 忽略优雅（graceful）`SIGTERM`，则为同一进程组调度有界的 `SIGKILL` 回退。否则停止 Claude/Codex 包装器可能只杀死 shim，而真正的提供方子进程继续消耗 token 并输出 stdout。
  - daemon 在 `SessionManager` 中记录捕获的 Claude session id
  - runtime 跟踪事件覆盖启动、流事件、会话捕获、消息发送、退出、错误、重启调度与停滞检测
  - `--runtime-restart-on-crash` 在 Claude 意外退出后启用一次重启，可用时恢复最后已知的 session id
  - `--runtime-stall-timeout-ms` 启用可选看门狗；它只在配置阈值内没有任何 runtime 进展时终止忙碌的 runtime
- 仅当显式设置 `--runtime claude` 时，daemon 才启动 Claude runtime。默认 daemon 启动不得派生模型进程。
- `aaa-daemon start --ws auto` 从 `--server` 推导后端控制 WebSocket 为 `/internal/agent-api/ws`，`http -> ws`、`https -> wss`。用 `--ws none` 禁用 WebSocket 并依赖注册/心跳/轮询回退。
- `--runtime-command-arg` 提供的 runtime 命令参数放在 daemon 管理的 Claude 参数之前。这支持 `node fake-claude.mjs ...managed args...` 之类的测试。
- MCP stdout 只能包含 MCP JSON-RPC 帧。日志必须走 stderr 或日志文件。
- `claude-mcp-config.json --auth-token` 是聊天桥机器令牌，不是 agent-api 凭据。不要把它当作对 `https://api.slock.ai` 的 `/internal/agent-api/*` 调用的上游令牌；服务器会以 `invalid_principal` 拒绝该路径。
- 导入一个已在运行的 Slock runtime 时，优先使用 `.slock/slock.cmd` 的受管本地代理：
  - 解析 `SLOCK_AGENT_PROXY_URL`
  - 解析 `SLOCK_AGENT_PROXY_TOKEN_FILE`
  - 从该文件读取 `sap_*` 令牌
  - 仅将 MCP 配置令牌保留为 `mcpCredential`，不作为直接 agent-api 令牌
- 链式只读冒烟适用于本地验证：aaa CLI -> aaa 本地代理 -> 原始 Slock 本地代理 -> Slock API。这在不发消息、也不需要原始 `sk_agent_*` 凭据的情况下验证真实通信。
- `aaa-daemon start --import-slock-runtime <runtimeDir> --runtime claude` 必须在代理注册之前加载导入的 runtime 凭据，然后为受管 Claude 进程生成 aaa 包装器。Claude 进程必须调用 aaa 包装器，而不是直接调用原始 runtime 包装器。
- 只读 CLI 命令必须保持仅 GET：
  - `message search --query <q> [--channel <target>] [--limit <n>]` -> `/search?q=...`
  - `message resolve <id>` -> `/messages/{id}/resolve`；仅精确证明该 id 存在且可见，不是上下文导航命令
  - `channel members --channel <target>` -> `/channel-members?channel=...`
  - `thread read --thread-id <id>` -> `/threads/{id}`
  - `profile show|get [--handle <handle>]` -> `/profile` 或 `/profile/{handle}`
  - `integration list` -> `/integrations`
  - `reminder list` -> `/reminders`
  - `reminder log <id>` -> `/reminders/{id}/log`
- 可写 CLI 命令在发起本地代理请求之前必须要求显式 opt-in：
  - `SLOCK_ALLOW_WRITES=1` 或 `AAA_DAEMON_ALLOW_WRITES=1`
  - 可选目标守卫：`SLOCK_WRITE_TARGET_ALLOWLIST` 或 `AAA_DAEMON_WRITE_TARGET_ALLOWLIST`
- `thread summary --thread-id <id> --summary <text>` 可写，映射到 `POST /threads/{id}/summary`，body 为 `{summary}`。
- `thread unfollow --target <target>` 可写，映射到 `POST /threads/unfollow`，body 为 `{threadId}`。
- `task unclaim --id <id>` 映射到 `POST /tasks/{id}/unclaim`；`task unclaim --channel <target> --number <n>` 映射到 `POST /tasks/update-status`，body 为 `{channel, task_number, status:"todo"}`。
- `reminder snooze <id> --delay-seconds <n>` 或 `--fire-at <iso>` 可写，映射到 `PATCH /reminders/{id}`，body 为 `{delaySeconds}` 或 `{fireAt}`。
- 附件上传通过 `/resolve-channel` 解析 `--channel`，然后把 multipart 表单数据（`file`、`channelId`、可选 `mimeType`）转发给 `/upload`。

## 场景：Runtime 提示词命令对齐

### 1. 作用域 / 触发

- 触发：添加或暴露受管 runtime 可从 Claude 系统提示词调用的 Slock CLI 命令。
- 这是跨层契约：提示词文本、生成的 CLI 解析器、本地代理改写、daemon JSON-RPC 转发、后端 agent API 与测试必须一致，然后才能把命令写进给 worker 的文档。

### 2. 签名

- `GET /internal/agent/{agentId}/messages/{messageRef}/resolve` -> 后端 `GET /internal/agent-api/messages/{messageRef}/resolve`
- `POST /internal/agent/{agentId}/threads/unfollow` body `{threadId}`
- `POST /internal/agent/{agentId}/tasks/{taskId}/unclaim`
- `POST /internal/agent/{agentId}/tasks/update-status` body `{channel, task_number, status:"todo"}`
- `PATCH /internal/agent/{agentId}/reminders/{reminderId}` body `{delaySeconds? | fireAt?}`
- `GET /internal/agent/{agentId}/reminders/{reminderId}/log`
- daemon JSON-RPC 方法：`daemon/message.resolve`、`daemon/task.unclaim`、`daemon/reminder.snooze`、`daemon/reminder.log`

### 3. 契约

- `message resolve` 只读且仅精确。对可见消息它返回 `{ok:true, resolved:true, message, messageId, shortId}`，对缺失或不可见的引用必须失败关闭（fail-closed）。
- runtime 提示词指引必须把 `message resolve` 呈现为对被引用 id 的证明。历史上下文仍来自 `message search` 与 `message read`。
- `thread unfollow`、`task unclaim` 与 `reminder snooze` 可写，必须先通过本地写门才发起代理请求。
- `profile show` 是 `profile get` 的别名；两者都必须保持只读。
- `reminder snooze` 在 `fireAt` 或 `delaySeconds` 变化时通过设置 `status:"pending"` 重新武装未取消的提醒。
- 在 CLI、代理、daemon 方法转发、后端端点与测试全部存在之前，不要在 runtime 提示词中暴露命令。把动作准备这类仅设计期的能力挡在提示词之外。

### 4. 校验与错误矩阵

- 缺失消息 id -> CLI `MISSING_MESSAGE_ID`；daemon 转发拒绝空的 `/messages//resolve`。
- 解析到不可见消息 -> 后端 HTTP 403。
- 缺失 thread id -> CLI `MISSING_THREAD_ID`。
- 缺失任务 id 且无频道/编号对 -> CLI `MISSING_TASK_ID`。
- 缺失提醒 id -> CLI `MISSING_REMINDER_ID`。
- 无 `delaySeconds` 或 `fireAt` 的 snooze -> CLI `MISSING_AT`。
- log 端点中的提醒 UUID 无效 -> 后端 HTTP 400。
- 提醒不属于当前 agent/server -> 后端 HTTP 404。

### 5. 良好/基准/反例案例

- 良好：`slock message resolve abc12345` 返回规范消息行，然后仅在需要周边上下文时使用 `slock message read --around abc12345`。
- 基准：`slock task unclaim --channel "#general" --number 3` 把一个已指派的进行中任务转回 `todo`。
- 反例：提示词在缺乏完整动作卡产品契约的情况下宣传 `slock action prepare`；worker 可能依赖一个人类尚未接受的工作流。

### 6. 所需测试

- CLI 解析器覆盖断言新命令映射到预期的本地代理方法/路径/body 与写安全。
- 代理改写覆盖断言 `/messages/{id}/resolve` 到达 `/internal/agent-api/messages/{id}/resolve`。
- ClientHandler 覆盖断言 JSON-RPC 方法以正确路径转发，且缺失标识符尽早失败。
- runtime 提示词覆盖断言已实现命令被列出，且 `slock action prepare` 等未实现命令不存在。
- 后端编译或单元覆盖必须包含新端点的导入/签名有效性；后端夹具可用时，集成测试应覆盖可见性与所有权检查。

### 7. 错误 vs 正确

#### 错误

```text
Tell Claude it can call `slock action prepare` because the proxy can rewrite an action path.
```

#### 正确

```text
Only list commands whose CLI parse path, daemon forwarding path, backend endpoint, safety behavior, and tests all exist.
```

## 场景：Codex Runtime 使用调用式驱动，而非长生命周期 stdin

### 1. 作用域 / 触发

- 触发：面向 Slock workspace 的 daemon 受管 Codex runtime。
- Codex 与 Claude Code stream-json 的形状不同。把它当作基于回合的 CLI 调用式 runtime：一个 `codex exec --json` 或 `codex exec resume --json` 进程处理一条投递的 Slock 事件，输出 JSONL，然后退出。
- 供研究而非盲目照抄的参考实现：Clowder AI 的 `CodexAgentService`、`codex-event-transform` 与调用跟踪。可移植的经验是调用生命周期、MCP/配置注入、上下文记账、诊断与事件规范化。

### 2. 签名

- 首回合：
  - `codex exec --json --sandbox danger-full-access --skip-git-repo-check [--model <model>] [--config <key=value>...] -- -`
  - 提示词 body 通过 stdin 传递，绝不用 argv。
- 恢复回合：
  - `codex exec resume --json --skip-git-repo-check [--model <model>] [--config <key=value>...] <thread_id> -`
  - `thread_id` 从 `thread.started.thread_id` 捕获。
- runtime 驱动：
  - `CodexRuntimeDriver.sendUserMessage(text)` 在空闲时恰好启动一个子进程。
  - 额外消息排队，直到正在运行的子进程退出。
  - `sessionId` 指 Codex `thread_id`，不是 Claude `session_id`。
- 可选 MCP 配置注入：
  - 暴露 runtime 专属工具时，使用按调用的 `--config mcp_servers.<name>.*=...` 条目。
  - 不要为 daemon 受管会话改动全局 `~/.codex/config.toml`。

### 3. 契约

- 提示词/上下文注入：
  - 受支持时首选的稳定指令通道是按调用的配置，例如 `--config developer_instructions=<toml-string>`。
  - 若当前 Codex CLI 版本无法把 daemon 指令作为配置携带，则把 Slock 系统块前插到 stdin，并在 runtime 状态中记录该能力缺口。
  - Slock 提示词前缀应尽可能跨回合稳定以提升缓存命中；可变的事件载荷放在清晰的 `Current Slock Event` 分隔符之后。
- 进程安全：
  - 提示词文本、聊天历史、凭据与任务上下文不得出现在进程 argv 中。
  - OAuth 模式可能需要真实 Codex home 以刷新登录；API key/自定义提供方模式应支持隔离的 `HOME` / `USERPROFILE`，避免失效 OAuth 干扰。
  - daemon 受管配置必须按调用或按 runtime workspace；绝不覆盖用户全局 Codex 配置。
- workspace 隔离：
  - 每个频道/runtime agent 需要独立的 workspace 路径与生成的 `.slock` 包装器。
  - 频道也可以有共享项目空间，但 runtime 进程 `cwd` 必须标识该 agent 自己的 workspace/会话根。
- Slock 通信：
  - 用户可见的聊天/任务/附件写入仍通过生成的 `slock` CLI 包装器，除非产品显式增加单独的 MCP 写契约。
  - `codex exec` 的 stdout/stderr 只是 daemon 遥测。它们不是 Slock 回复。
- 事件规范化：
  - `thread.started` -> 会话捕获。
  - `command_execution` / `mcp_tool_call` 的 `item.started` -> 工具使用活动。
  - `agent_message` 的 `item.completed` -> 助手文本遥测。
  - `command_execution` / `mcp_tool_call` 的 `item.completed` -> 工具结果遥测。
  - 存在时 `turn.completed.usage` -> token/缓存/上下文记账。
  - 原始 JSONL 必须在脱敏敏感 token 后归档或可跟踪。
- TaskRun 完成可观测性：
  - runtime 活动保持为 ActivityLog/跟踪遥测；不要为 TaskRun 行建立单独的 runtime 活动表。
  - daemon 拥有的 TaskRun 生命周期报告可以在既有 TaskRun 上更新 `tokenUsage`、`contextUsage`、`toolUsageSummary` 与 `outputMessageId`。
  - 缺少输出/token/上下文/工具证据的已完成运行必须由 API 序列化器分类，使 `/control/integration` 能展示简明的人类可读门禁结果。
  - `tokenUsage.totalTokens` 可以包含 `cacheReadInputTokens`，因为它是计费/用量证据。
  - `contextUsage.knownTokens` 与 `contextUsage.occupancyRatio` 不得回退到含缓存的总量。若没有 runtime 用量事件直接报告活跃上下文，用 `inputTokens + outputTokens` 作为回退的已知 token 值，再除以 `contextWindow`。
  - `contextWindow` 可能通过提供方专属的 `modelUsage.{model}.contextWindow` 到达；优先使用非 `total` 的按模型条目，而不是聚合 `total`。
- daemon 启动 / 租约（lease）预检：
  - daemon WebSocket URL 必须包含 `daemonId`；只有当 daemon id 匹配活跃租约或旧租约已过期时，后端 WS 活动/ack 才可以续订计算机租约。
  - 省略 `--workspace` 的打包 daemon 启动使用稳定的默认 daemon workspace 根 `~/.smallkhoj/daemon/workspaces` 或 `SMALLKHOJ_DAEMON_WORKSPACE_ROOT` / `SMALLKHOJ_DAEMON_HOME/workspaces`。开发或自定义启动可以传 `--workspace`，但该根下的 runtime 路径仍必须包含 server 与 computer 段。
  - runtime 预热必须调用生成的项目包装器路径，例如 `{workspace}/.slock/slock server info`，而不是 `PATH` 上的全局 `slock` 二进制。
- 生命周期：
  - 忙碌意味着有子进程在运行。
  - 排队的 Slock 事件必须只在子进程终态退出或语义完成后冲刷。
  - 退出码 `0` 为成功；非零退出需要先做诊断分类，再决定重试、呈现错误还是抑制已知的无害 CLI 怪癖。

### 4. 校验与错误矩阵

- 找不到 CLI -> 呈现 `runtimeCommandDetectionError()` 警告并让 runtime 启动失败；不要静默回退到另一个 runtime。
- 首个成功回合没有 `thread.started.thread_id` -> runtime 仍可用于一次性工作，但标记会话连续性降级。
- 结构化事件之前出现畸形 stdout JSON -> 视为文本遥测；结构化事件之后仅保留为原始诊断。
- 有排队消息时子进程退出 -> 恰好冲刷下一条消息一次。
- 子进程停滞超过配置超时 -> 发出活性警告，然后按 daemon 停滞策略终止。
- 因 session id 无效/缺失导致 resume 失败 -> 分类为会话连续性失败，仅在控制面策略允许时才开新会话。
- MCP 服务器配置无法解析 -> 仅当 Slock CLI 通信仍可用时才继续并去掉该 MCP 服务器；否则失败关闭。
- 旧租约属于另一个 daemon 且未过期时出现冲突的 daemon WS 活动 -> 不要延长旧租约；把接管（takeover）留给租约到期或显式替换策略。
- 预热时生成的 Slock 包装器缺失或被全局 CLI 遮蔽 -> 以包装器/预检诊断失败或降级；不要在未证明 Slock 连通性的情况下上报 runtime 就绪。
- TaskRun 完成有 token 用量与上下文窗口但只有含缓存的总量 -> 保持 `totalTokens` 可见，但从非缓存活跃 token 分类上下文占用；不要仅凭缓存读发出上下文风险警告。

### 5. 良好/基准/反例案例

- 良好：一条 DM 事件启动 `codex exec --json`，捕获 `thread.started.thread_id`，Codex 使用 `slock message send`，daemon 记录用量与最终退出，然后下一条 DM 恢复同一 thread id。
- 基准：Codex 输出命令/工具 JSONL 与最终答案但没有 token 用量；daemon 仍记录 session id 与流事件，用量省略。
- 反例：daemon 把完整 Slock 事件 body 作为命令行参数传递；其他本地进程可以通过进程列表检查它。
- 反例：daemon 改写 `~/.codex/config.toml` 以加入 MCP 或开发者指令；并发的用户 Codex 会话继承了错误的 agent 身份。
- 反例：TaskRun 上下文压力显示 174%，因为 `cacheReadInputTokens` 被加进了 `knownTokens`；这把计费/缓存复用与当前上下文占用混为一谈。
- 反例：一个新启动的 daemon 在 WS 活动中没有正确的 `daemonId`，持续续订旧 daemon 租约，阻止真正的 runtime workspace 接管。

### 6. 所需测试

- 单元：构建首回合参数与 resume 参数，断言提示词仅走 stdin 且 thread id 位置与 `codex exec resume --help` 一致。
- 单元：解析 `thread.started`、`item.started`、`item.completed`、`turn.completed`、畸形 JSON 与 stderr 诊断。
- 单元：队列行为一次只发送一个子进程，并在每次退出后恰好冲刷一条排队消息。
- 集成：伪 Codex CLI 在 `PATH` 中收到生成的 Slock 包装器、隔离的 workspace `cwd`，且没有代理密钥环境变量。
- 集成：daemon 重启后的 resume session id 被下一回合复用。
- 回归：daemon 受管 runtime 启动不创建或修改全局 Codex 配置文件。
- 回归：生成的 POSIX 包装器不含独立的 `export SLOCK_AGENT_PROXY_URL` 或 `export SLOCK_AGENT_PROXY_TOKEN_FILE` 行，同时导入路径仍能解析命令作用域的单引号赋值。

### 7. 错误 vs 正确

#### 错误

- 把 Codex 建模为可以通过 stdin 安全接收任意未来消息的常驻（resident）进程。
- 把 Slock 提示词、事件载荷或消息历史放进 argv。
- 把 Codex stdout 文本当作已投递聊天。
- 为每个频道 agent 使用一个全局 workspace/会话。

#### 正确

- 把 Codex 建模为带显式会话恢复的按回合调用式驱动。
- 通过 stdin 传递提示词，daemon 拥有的配置按调用/runtime workspace 存放。
- 把 JSONL 规范化为 daemon 遥测，并要求用 `slock message send` 发出可见回复。
- 为每个加入的 agent/频道上下文保持独立的 runtime workspace 与 session id。

## 场景：Codex ACP 常驻 Runtime 调研

### 1. 作用域 / 触发

- 触发：评估 Codex 作为常驻 runtime，以降低 `codex exec resume` 的每回合启动开销。
- 触发：从一个可能本身通过 `npx --package` 安装或启动的 Daemon 启动常驻 ACP runtime。
- ACP 是与 `codex exec/resume` 分开的 runtime 路径。在 ACP 于本地 daemon 测试中证明启动、会话恢复/加载、提示词、取消、事件翻译与清理之前，不要替换稳定的 exec 驱动。
- 参考实现：Neutree Agent Platform 的 `agents/codex` 使用 `codex-acp` 加上一个 ACP 桥，每个活跃会话一个子进程并做 LRU 逐出。

### 2. 签名

- 包来源：
  - `@zed-industries/codex-acp` 提供 `codex-acp`。
  - `@agentclientprotocol/sdk` 提供 `ClientSideConnection`、`ndJsonStream` 与 ACP 类型。
- MVP 决策：默认 Codex ACP 启动使用 `@zed-industries/codex-acp@0.16.0`，但 daemon runtime 命令保持可配置，以便日后切换到 `@agentclientprotocol/codex-acp` 或某个 fork。
- 产品命名：外部 API 与 UI 把该 runtime 暴露为 `codex`；`codex_acp` 是实现细节与历史别名。显式 `codex_cli` 仅保留为 daemon/调试回退。
- MVP 冒烟：
  - `npm run smoke:codex-acp -- --npm-package @zed-industries/codex-acp@0.16.0 --prompt "<text>"`
  - `npm run smoke:codex-acp -- --command codex-acp --prompt "<text>"`
- 桥 API：
  - `CodexAcpBridge.start()`
  - `CodexAcpBridge.createSession({cwd?, mcpServers?}) -> sessionId`
  - `CodexAcpBridge.loadSession(sessionId, {cwd?, mcpServers?}) -> sessionId`
  - `CodexAcpBridge.prompt(sessionId, text) -> PromptResponse`
  - `CodexAcpBridge.cancel(sessionId)`
  - `CodexAcpBridge.stop()`
- 子环境边界：
  - `buildCodexRuntimeEnv(options, baseEnv) -> NodeJS.ProcessEnv`
  - `CodexAcpBridgeOptions.env?: NodeJS.ProcessEnv`
  - 外层 npm 启动器选择器 `npm_config_package` 与 `NPM_CONFIG_PACKAGE` 不是子 runtime 配置。

### 3. 契约

- ACP 子进程是 runtime 会话载体，不是单回合 CLI。
- daemon 可以为每个活跃 Codex 会话缓存一个 ACP 子进程，然后在产品策略定义后按 TTL/数量逐出空闲会话。
- `session/update` 通知是 runtime 遥测。至少翻译：
  - `agent_message_chunk` -> 消息增量遥测。
  - `agent_thought_chunk` -> `thought_delta` -> runtime `thinking` 内容块。诊断警告/错误文本不是思考证据，必须作为 `runtime_warning` / `runtime_error` 活动发出，而不是标记为 Thinking。
  - `tool_call` -> 工具使用遥测。
  - `tool_call_update` 终态 -> 工具结果遥测。
  - `usage_update` -> token/上下文记账；保留 `used` 与 `size`，使 TaskRun 摘要在有窗口时能计算上下文占用。
- `session/new` 创建新的 runtime 会话；`session/load` 恢复既有 runtime 会话。加载失败必须呈现为会话连续性错误，不得静默转换为新会话。
- MCP 服务器传给 ACP `session/new` / `session/load`，因此 Slock/会话令牌这类会话作用域 header 应放在那里，而不是全局 Codex 配置。
- 通过 `npx` 等包装器启动时，进程清理必须终止进程组，否则冒烟可能完成回合但留下存活的 ACP 子进程。
- `buildCodexRuntimeEnv` 必须移除小写与大写的外层 npm 包选择器，同时保留无关的 npm registry/proxy/cache/TLS 设置。ACP 包由显式子 argv 选择，绝不是被继承的外层启动器选项。
- 提供了 `CodexAcpBridgeOptions.env` 时，它就是调用方拥有的完整子环境。`CodexAcpBridge.start()` 不得把 `process.env` 合并回它，因为省略正是调用方撤销仅启动器 key 的方式。只有省略 `options.env` 时才为独立冒烟用途回退到 `process.env`。
- Codex ACP 预热结果的就绪是显式的：只有 `type:"result", subtype:"success"` 可以完成结果门。错误、已取消或结构不完整的结果不会就绪；独立的进程退出事件拥有数字退出码。成功的 `session/new` / `session/load` 仍是独立的正向就绪信号。
- ACP 进程意外退出与稍后的 ACP 桥/驱动关闭是两个独立的因果观察。进程退出的 `runtime_error` 拥有 `status:"exited"`、`phase`、`exitCode`、`signal` 与捕获的 `stderr`；稍后的驱动 `runtime_error` 拥有 `source:"driver"`、自己的 `phase` 以及 `ACP connection closed` 之类的桥错误。不要改写较早的行，也不要要求两个原因出现在同一条 `ActivityLog` 中。

### 4. 校验与错误矩阵

- `codex-acp` 命令缺失 -> 冒烟在 daemon runtime 选择改变之前失败。
- ACP initialize 失败 -> runtime 状态 `failed_start`，无 session id。
- `session/new` 失败 -> 没有活跃 runtime 会话；报告 agent 可见的启动错误。
- `session/load` 失败 -> 除非显式恢复策略允许，否则不要创建新会话。
- prompt 返回 `stopReason:"cancelled"` -> 调用状态 `cancelled`。
- prompt 进行中子进程退出 -> 拒绝该 prompt 并把调用标记为失败，使后端不会永远保持 `agent`/忙碌。
- 停止/逐出必须在 POSIX 上杀死 `npx` 进程组，在 Windows 上杀死直接子进程。
- daemon 继承 `npm_config_package=<daemon.tgz>` -> 在嵌套 `npx -y @zed-industries/codex-acp@...` 之前移除它；不要让嵌套启动器再次选中 Daemon tarball。
- 显式桥环境省略了 `process.env` 中存在的 key -> 该 key 在子进程中保持缺失；省略不会从父进程回填。
- ACP 发出无 `exitCode` 的 `result:error`，随后子进程退出 `127` -> 绝不报告 `running`；保留稍后的退出码并把 workspace 报告为 `exited`。
- 子进程退出 `127`，随后桥发出 `ACP connection closed` -> 按事件顺序持久化两条 `runtime_error` 活动；进程行保留退出/stderr 证据，驱动行保留桥错误。

### 5. 良好/基准/反例案例

- 良好：`@zed-industries/codex-acp@0.16.0` 通过 `npx` 启动，创建 ACP 会话，流式输出 `agent_message_chunk` 增量，发出 `usage_update`，返回 `stopReason:"end_turn"`，并在 `stop()` 后干净退出。
- 良好：公共 daemon runtime `codex` 启动受管 ACP 子进程，创建或加载会话，在回合进行中排队 prompt，把 ACP 更新映射为 daemon 兼容的 `assistant` / `usage` / `result` 事件，并以 `runtime:"codex"`、`sessionId`、`pid` 与 `status` 报告心跳 workspace 状态。
- 良好：从自托管 tgz 启动的 Daemon 移除其外层包选择器，保留 `npm_config_registry`，嵌套 npx 初始化显式请求的 ACP 包。
- 基准：伪 ACP 服务器演练 initialize/会话/prompt/update/取消，不需要模型凭据。
- 基准：独立 ACP 冒烟省略 `options.env`，有意继承冒烟进程环境。
- 反例：只用 ACP 做 prompt，却把 Slock/MCP 会话 header 留在全局 `.codex/config.toml`；并发会话可能泄露身份或丢失按会话认证。
- 反例：只杀死 `npx` 包装器而让 `codex-acp` 继续运行。
- 反例：先净化复制出的 env，再以 `{ ...process.env, ...sanitizedEnv }` 派生；被删除的 key 不在第二个对象中，因此会从第一个对象重新出现。
- 反例：在第一条活动行上断言 `exitCode`、`stderr` 与稍后的 `ACP connection closed` 描述；这些观察有不同的发出者与时机。

### 6. 所需测试

- 单元/集成：伪 ACP 子进程覆盖 initialize、`session/new`、`session/load`、`session/prompt`、`session/update` 与进程停止。
- 单元：`buildCodexRuntimeEnv` 移除两种大小写的包选择器，并保留无关的 npm registry 设置。
- 进程集成：设置外层包选择器，提供省略它的显式子环境，断言 ACP 桥子进程两者都看不到。
- daemon 集成：ACP 子进程在会话创建前以 `127` 退出时产生 `starting -> exited`，绝不 `running`，且不发出运行中 agent 心跳。
- daemon 集成：同一 exit-127 场景分别断言一条进程退出 `runtime_error`，带 `status:"exited"`、`phase:"starting"`、`exitCode:127` 与 stderr，以及稍后一条描述 `ACP connection closed` 的 `source:"driver"` 活动。
- 冒烟：真实 `@zed-industries/codex-acp` 通过 npx 启动并在本地完成一次 prompt。
- 打包冒烟：构建/解包 Daemon tgz，把该 tgz 设为外层选择器，导入打包的 runtime/桥，并证明真实 ACP initialize 通过嵌套 npx 成功。
- 未来 runtime 集成：daemon 心跳包含 ACP `sessionId`、`pid`、`busy`、排队数与最后事件时间。
- 未来 MCP 集成：会话作用域的 Slock MCP header 对 ACP 会话可见，且不全局持久化。

### 7. 错误 vs 正确

#### 错误

```text
Treat `codex-acp` as a global singleton for all agents and all channel workspaces.
```

```typescript
// Reintroduces keys deliberately removed by sanitizedEnv.
env: { ...process.env, ...sanitizedEnv }
```

#### 正确

```text
Keep ACP session identity scoped to one daemon-managed agent/workspace runtime, then add TTL/count eviction once reuse is proven.
```

```typescript
// Explicit env is authoritative; fallback only when no env was supplied.
env: { ...(options.env ?? process.env) }
```

#### 错误

```text
process exit 127 + later ACP close -> rewrite one ActivityLog with both causes
```

#### 正确

```text
process exit -> runtime_error(status=exited, exitCode=127, stderr=...)
ACP bridge close -> runtime_error(source=driver, error="ACP connection closed")
```

## 场景：Runtime 专属流事件使用共享活动契约

### 1. 作用域 / 触发

- 触发：改动为 Agent 活动时间线提供数据的 Claude stream-json、Codex ACP、OpenCode
  Server/SSE 或 Pi 流事件规范化。
- 活动保持为可观测性遥测。该翻译不得创建 `EventRecord`，也不得把
  runtime 自身的状态当工作投回。

### 2. 签名

- 翻译器：
  `translateRuntimeStreamActivity(runtime, event) -> RuntimeStreamActivitySignal[]`。
- Codex 来源标记：`stream_event.acpUpdate`，例如
  `agent_thought_chunk`、`agent_message_chunk`、`tool_call` 或
  `tool_call_update`。
- OpenCode 来源标记：`stream_event.opencodeEvent`，例如
  `message.part.delta` 或 `message.part.updated`。
- 共享活动种类保持为 `runtime_working`、`runtime_thinking`、
  `runtime_output`、`runtime_idle`、`runtime_warning` 与 `runtime_error`。

### 3. 契约

- 所有提供方都保持既定的 Claude Code 可观测产品
  语义：接受的入站工作变为 Working；助手分析、旁白与转录预览变为
  Thinking；真实工具执行变为描述为 `Ran <tool>` 的 Output；
  提供方完成变为 Idle。
- 每条 Thinking 行都包含有界、可读的 `details.thought`。每条
  `Ran <tool>` Output 都包含脱敏的 `details.commandPreview`。活动明细
  保持为有界摘要，绝不是完整的提供方转录。
- Codex ACP `agent_thought_chunk` 与 `agent_message_chunk` 是助手分析/旁白的
  提供方线路变体，因此规范化为同一 Thinking 产品状态。
  两者都不得合成 `Generated output`。
- OpenCode 按消息 id 记录消息角色。用户撰写的文本部分与投递的
  `[event=...]` 信封被过滤；助手文本与显式的
  推理/思考部分规范化为 Thinking。通用连接/会话 SSE 事件
  不是活动行。
- 工具开始按工具调用 id 去重，成为唯一可见的
  `Ran <tool>` Output 行。终态工具更新仍可供 TaskRun 记账与提供方完成使用，
  但在 Claude 基线（baseline）不显示它们时，不得添加 `Tool completed` 或
  `Tool failed` 行。
- 警告/错误诊断在任何普通文本分类之前保持其诊断活动种类。
  不得被误标为 Thinking/Output。
- 活动 POST 按 runtime 串行化，且不阻塞提供方流
  处理。Working、Thinking、Output 与 Idle 按观察顺序持久化，
  结果边界的 Idle 行在回合中最后。

### 4. 校验与错误矩阵

| 输入 | 预期活动行为 |
| --- | --- |
| Codex 思考/消息旁白 | 带有界 `details.thought` 的 Thinking；无 `Generated output`。 |
| OpenCode 助手推理/文本 | 带有界 `details.thought` 的 Thinking。 |
| OpenCode 用户文本或 `[event=...]` 信封 | 忽略；绝不为 Thinking/Output。 |
| 通用 OpenCode connect/session 事件 | 忽略；无活动行。 |
| 真实工具开始，包括重复的开始 id | 一条带脱敏 `details.commandPreview` 的 `Ran <tool>` 行。 |
| 终态工具更新 | 仅 TaskRun/提供方遥测；不发明第二条活动行。 |
| 诊断形状的助手文本 | 警告/错误；该文本没有 Thinking/Output 行。 |
| 延迟的 Output POST 之后的提供方 `result` | Idle 在 Output 之后持久化，并清除按回合的工具去重状态。 |

### 5. 良好/基准/反例案例

- 良好：一个 Codex 回合显示 Working -> Thinking -> Ran Bash -> Thinking -> Idle，
  在保留 ACP 协议/来源元数据的同时匹配 Claude Code 语义。
- 良好：OpenCode 的用户消息部分被过滤，助手推理为
  Thinking，bash 部分为带命令的 `Ran bash`，Idle 最后持久化。
- 基准：多个连续旁白增量合并进当前
  Thinking 状态；稍后的工具后旁白转换可以创建新的
  Thinking 行。
- 反例：把提供方助手文本映射为没有可读预览的
  通用 `Generated output` 行。
- 反例：把用户输入/会话事件当作模型活动、把每个文本增量持久化为单独一行、
  保留完整转录，或添加基线中不存在的工具完成
  行。

### 6. 所需测试

- 单元：断言 Codex 思考/消息块都以其确切的 `acpUpdate` 来源翻译为 Thinking，
  且没有 `Generated output` 信号。
- 单元：断言 OpenCode 消息角色过滤、推理/文本规范化、
  真实工具开始命令预览、被忽略的终态结果与被忽略的通用 SSE 事件，
  均使用确切的 `opencodeEvent` 来源。
- 回归：断言 Claude 纯文本兼容性仍为 Thinking，且用户
  转录文本绝不成为活动。
- daemon 集成：伪 ACP 发出消息、思考、工具开始/结果与
  result，同时伪后端延迟 Output 持久化；断言一条可读的
  Thinking 行、一条带命令预览的 `Ran <tool>` 行、没有 generated/terminal
  行，且 Idle 最后。

### 7. 错误 vs 正确

#### 错误

```text
Codex/OpenCode assistant text -> Generated output
terminal tool update -> Tool completed
```

#### 正确

```text
accepted inbound message -> Working on message
assistant reasoning/narration -> Thinking + details.thought
real tool execution -> Ran <tool> + details.commandPreview
terminal tool update -> no separate baseline Activity
provider result -> Idle persisted last
```

## 场景：Daemon 本地 Runtime 提供方选择

### 1. 作用域 / 触发

- 触发：用户可以为某个 runtime 选择本地 Claude 或 Codex 提供方/配置档案，而提供方凭据与启动细节必须保留在 daemon 机器本地。
- 这是跨层契约：daemon 本地能力探测 -> 后端能力展示/存储 -> `start_runtime` 提供方选择 -> daemon 本地 runtime 启动。

### 2. 签名

- daemon CLI：
  - `aaa-daemon start --runtime-provider <providerName>`
- daemon 本地 runtime 命令探测：
  - Claude Code 命令发现从显式环境覆盖（`SLOCK_CLAUDE_COMMAND`、`CLAUDE_COMMAND`）开始，然后是对 `claude`/`claude.cmd` 的平台感知 PATH/常见位置探测。
  - Codex 命令发现从显式环境覆盖（`SLOCK_CODEX_COMMAND`、`CODEX_COMMAND`）开始，然后是对 `codex`/`codex.cmd` 的平台感知 PATH/常见位置探测。
  - 探测代码不得包含 `/Users/<developer>/...` 之类开发者特定的绝对路径。
  - 探测代码不得自动发现或调用 `$HOME/.claude/cc-switch.ps1`、`ccs-claude` 或其他提供方切换脚本作为产品启动路径。
- 手动提供方清单：
  - 环境变量发现顺序：`SLOCK_RUNTIME_PROVIDERS_JSON`、`AAA_DAEMON_RUNTIME_PROVIDERS_JSON`、`RUNTIME_PROVIDERS_JSON`
  - JSON 形状：`[{id,name,runtime,model?,command?,commandArgs?}]`
  - `command` 与 `commandArgs` 只是显式高级 opt-in 的 daemon 本地启动数据；不得通过后端/公共心跳载荷回显。
- CC Switch 提供方清单：
  - 默认数据库发现顺序：`SLOCK_CC_SWITCH_DB`、`CC_SWITCH_DB`、`$HOME/.cc-switch/cc-switch.db`
  - 查询本地 `providers` 行，条件为 `app_type in ('claude', 'codex', 'opencode')`
  - 提供方行被解析为脱敏的公共 runtime：`app_type='claude'` -> `claude_code`；`app_type='codex'` -> `codex`；`app_type='opencode'` -> `opencode`
  - DB 路径、`settings_config`、认证载荷、提供方令牌与本地命令细节保留在 daemon 本地，绝不发送到后端/公共心跳载荷。
- 公共/后端载荷字段：
  - `Member.config.runtimeProvider?: string`
  - 序列化响应中的 `AgentWorkspace.runtimeProvider?: string`
  - `Computer.detectedRuntimes[]` 可以包含 `{type:"claude_code"|"codex", status:"available", provider, runtimeProvider, model, source:"cc-switch"}`
  - `start_runtime.command.config.runtimeProvider?: string`
- 基础 runtime 清单形状（08-03 任务 `08-03-runtime-detection-four-runtimes`；依据 `agent/daemon/aaa-daemon/src/runtime/runtime-provider.ts` 的 `detectedRuntimesForInventory()` 验证）：
  - `Computer.detectedRuntimes[]` 始终包含固定基础列表：`claude_code`、`codex`、`opencode`、`goose`，各自的 `status:"available" | "not_installed"` 完全由本地 CLI 探测（`detectClaudeCommand` / `detectCodexCommand` / `detectOpenCodeCommand` / `detectGooseCommand`）决定，外加 `pi` 恒为 `{type:"pi", status:"available", source:"bundled", version?}` —— 打包布局缺失影响启动，不影响探测到的形状。
  - 提供方条目（cc-switch / ccs-claude / manual / opencode-config）是可选追加的额外项（`provider`、`runtimeProvider`、`model`、`source`），用于提供方下拉。基础探测绝不依赖 ccswitch：没有 ccswitch 的机器仍会收到完整的基础列表。
  - `DetectedRuntime.status` 端到端包含 `not_installed`（daemon TS 联合类型 + 后端序列化透传）。daemon 自身的 `config.runtime` 不作为清单条目上报（不存在“配置了 claude_code 就只显示 claude_code”）。
- 产品写 opt-in（07-31 任务 `07-31-07-31-daemon-write-and-computer-connect`）：
  - `backend/services/daemon_control.py:runtime_start_command()` 在每个服务器管理的 `start_runtime`/`restart_runtime` 信封上设置 `config["allowWrites"] = True`；daemon 在子 runtime 环境与生成的 `.slock`/`aura`/`raft` 包装器中把它落为 `SLOCK_ALLOW_WRITES=1`。

### 3. 契约

- 规范 runtime 身份独立于提供方与模型身份。公共/runtime 家族匹配在显式别名规范化后只使用 `claude_code`、`codex`、`opencode`、`goose` 或 `pi`；`runtimeProvider`、`provider`、`runtimeModel` 与 `model` 是选择/证据元数据，绝不得用来推断或交叉匹配 runtime 家族。
- `runtimeProvider` 是提供方/配置档案名，不是 API key、shell 命令或序列化凭据。
- 后端可以存储并返回 `runtimeProvider`，但不得存储 API key、CC Switch 提供方配置、生成的 Claude settings 文件、命令参数或认证 header。
- daemon 拥有提供方探测与启动解析。若本地 CC Switch DB 不可用，`detectedRuntimes` 仍包含探测到的本地 runtime 命令，默认 runtime 启动使用这些本地命令。
- 探测到的手动与 CC Switch 提供方只作为脱敏能力上报：`type`、`status`、`provider`、`runtimeProvider`、`model` 与 `source`。不要包含可执行路径、CC Switch DB 路径、提供方配置 JSON、令牌、请求 header、提供方命令或命令参数。
- `backend` 是旧版/旧展示字段。序列化或构造 runtime 启动命令时，不得从 `backend` 推断 `runtimeProvider`。
- 创建或更新 agent 时可以显式设置 `runtimeProvider`。旧的 `backend` 值保持为旧数据，不得静默变成提供方选择。
- 若 Claude `start_runtime` 命令包含 `runtimeProvider` 并省略 `runtimeCommand`，daemon 在本地解析该提供方，并以 daemon 拥有的 Claude 参数与选定的模型/提供方元数据启动探测到的 Claude Code 命令。它不得调用 `cc-switch.ps1` 或 `ccs-claude`。
- 若 Codex `start_runtime` 命令包含 CC Switch `runtimeProvider`，daemon 记录选定的脱敏提供方身份，并使用 daemon 本地命令/配置解析启动公共 runtime `codex`。它不得通过提供方切换脚本改动全局 CC Switch 状态。
- 若 CC Switch DB 中数据足够，必须通过 daemon 本地配置生成实现严格的提供方凭据隔离。若尚未实现，不要假装脚本是产品行为；上报脱敏的提供方元数据，并在启动无法本地化时清晰失败。
- 若手动配置的 `runtimeProvider` 包含 `command` / `commandArgs`，daemon 可以将其用于本地启动解析，但心跳与后端存储仍只携带提供方 id/名称/模型/来源。
- 显式提供 `runtimeCommand` 时，它对测试/自定义启动路径优先于提供方解析。
- 提供方启动的 runtime 的 daemon workspace 注册/心跳载荷包含 `runtimeProvider`，但省略 `runtimeCommand` 与 `runtimeModel`，除非它们是在提供方启动之外显式配置的。
- 重连/重新注册目前会把 daemon 心跳中缺失的预期运行 workspace 重新武装，包括最后观察到的 `stopped`、`offline`、`exited` 或 `crashed` 状态。未来期望状态控制器可以在存在显式停止/重置控制后收窄该行为。
- 基础 runtime 可用性与提供方清单是相互独立的信号（08-03）。基础 `detectedRuntimes` 列表只凭本地 CLI 探测回答“这台机器能运行什么”；提供方条目是增量元数据。绝不要为基础列表完整而要求 ccswitch（或任何提供方来源），也绝不把提供方条目压平进基础 runtime 徽标（badge）。
- 服务器管理的 `start_runtime`/`restart_runtime` 信封始终携带 `config.allowWrites:true`（07-31）。这是 daemon CLI 失败关闭规则在后端的对称面：产品管理的 runtime 变为可写（子环境中的 `SLOCK_ALLOW_WRITES=1` + 带门禁的包装器），而未显式 opt-in 的独立 daemon CLI 仍以 `WRITES_NOT_ALLOWED` 拒绝写命令。不要通过放松一侧来“修复”另一侧。
- 子进程环境权威性（08-03 任务 `08-03-fix-codex-acp-exit-127`）：ACP 桥一旦收到显式子环境，该环境就是完整且权威的 —— 派生边界绝不能把 `process.env` 重新扩散进去。只有未提供子环境时，回退到 `process.env` 才有效。嵌套 `npx` 启动器必须剥离仅启动器使用的包选择器（`npm_config_package` / `NPM_CONFIG_PACKAGE`，小写与大写），同时保留无关的 npm 设置（registry、proxy、cache、证书）。
- ACP 就绪是失败关闭的：`result` 事件只有带显式 `subtype:"success"` 才可标记预热完成；`subtype:"error"`、`subtype:"cancelled"`、缺失 subtype 或缺失数字退出码都不得使 runtime 就绪。成功的 ACP 会话创建/加载仍是有效的就绪信号。
- 失败启动的生命周期真相：在会话就绪前非零退出的 runtime 子进程，绝不得为该启动代次发出 `running` 的 workspace 或 agent 心跳；最终 workspace 状态保持非运行（`exited`），使后端成员下线，且后续消息不得被表述为已投递给一个不复存在的 runtime。
- 打包 Pi 契约（07-28 任务 `07-28-runtime-select-guide`）：daemon 上报 `{type:"pi", status:"available", source:"bundled", version}`，Pi 保持始终可选的零安装回退。Pi 回合通过后端 MiniMax 中继运行，因此用户不需要 LLM key。每个完整 agent 运行/工具循环持有一个容量租约，并以 `ready`/`waiting`/`running`/`exhausted`/`failed` 如实呈现；长期 MiniMax 凭据只保留在后端，绝不进入浏览器响应、daemon/Pi 配置、进程参数或日志。

### 4. 校验与错误矩阵

- 未探测到 `claude` 命令 -> 将 Claude 默认能力上报为不可用或省略提供方启动，并发出清晰的本地命令探测错误，而不是笼统的 `spawn claude ENOENT`。
- 未探测到 `codex` 命令 -> 将 Codex CLI 能力上报为不可用或省略提供方启动，并发出清晰的本地命令探测错误。
- 本地没有 CC Switch DB 或 `sqlite3` 不可用 -> 不上报 CC Switch 提供方能力；保持探测到的默认 runtime 命令可用。
- 提供了 `runtimeProvider` 但本地提供方清单中找不到 -> daemon 记录脱敏警告，不启动该 runtime。
- 手动提供方 JSON 畸形或包含不支持的 runtime 值 -> 跳过这些条目；保持其他探测来源可用。
- 同时提供 `runtimeProvider` 与 `runtimeCommand` -> daemon 使用显式命令，不在本地解析提供方。
- 提供方启动退出或崩溃 -> runtime 遵循常规 runtime 退出/崩溃上报与重启策略。
- 后端只收到 `backend` -> 保留为旧版/展示数据；不要据此创建 `config.runtimeProvider`。
- daemon 心跳包含提供方 runtime -> 后端仅持久化提供方名称；命令路径/参数必须缺席于公共序列化 workspace 载荷。
- 某个探测到/runtime 的 workspace 标记为 `runtime:"codex"`、`runtimeProvider:"MiniMax"` -> 它只是 Codex 候选；包含 `Claude`、`OpenCode` 或其他 runtime 名称的提供方/模型文本不能改变该家族。
- 机器上没有 ccswitch DB / ccs-claude / 手动提供方 -> 基础 `detectedRuntimes` 仍列出每个基础 runtime；缺失的本地 CLI 上报 `not_installed`；不丢弃任何项。
- 嵌套 `npx` daemon 启动 runtime 子进程 -> 子环境不含 `npm_config_package`/`NPM_CONFIG_PACKAGE` 选择器；无关 npm 配置保留。
- 桥收到省略某 key 的显式子环境 -> 该 key 在派生时保持缺失；没有 `process.env` 合并让它复活。
- ACP 子进程发出带 `subtype:"error"`/`"cancelled"`/缺失 subtype 的 `result`，或在会话前非零退出 -> runtime 绝不就绪，不发出 `running` 心跳，生命周期以真实退出码上报 `exited`。
- 服务器管理的 `start_runtime` 信封缺少 `config.allowWrites` -> runtime 写命令以 `WRITES_NOT_ALLOWED` 失败（daemon 失败关闭语义不变）。
- 磁盘上缺失打包 Pi 布局 -> `pi` 仍上报 `{status:"available", source:"bundled"}`；实际启动清晰失败，而不是把探测置灰。

### 5. 良好/基准/反例案例

- 良好：`create_agent` 收到 `{runtimeProvider:"Kimi"}`；后端存储 `Member.config.runtimeProvider`；daemon 收到 `start_runtime.config.runtimeProvider:"Kimi"`，并在本地以选定的模型/提供方元数据启动探测到的 Claude Code 命令，不经过切换脚本。
- 良好：`SLOCK_RUNTIME_PROVIDERS_JSON` 定义了 `local-codex-krill`；daemon 心跳上报 `{type:"codex", provider:"Local Codex Krill", runtimeProvider:"local-codex-krill", source:"manual"}`，启动解析则私下使用本地命令。
- 良好：CC Switch DB 含 Codex 提供方 `krill`；daemon 心跳上报 `{type:"codex", provider:"krill", runtimeProvider:"<local-provider-id>", source:"cc-switch"}`，不暴露 `settings_config`。
- 良好：CC Switch DB 含 Claude 提供方 `Kimi`；daemon 心跳上报 `{type:"claude_code", provider:"Kimi", runtimeProvider:"<local-provider-id>", source:"cc-switch"}`，不暴露 `settings_config`，也不调用 `cc-switch.ps1`。
- 基准：机器上没有 CC Switch；daemon 只上报探测到的基础 runtime 能力，未选提供方时用探测到的本地命令启动默认 runtime。
- 基准：daemon 在 `detectedRuntimes` 中上报 `Kimi`、`Zhipu GLM` 与 `krill` 等 Codex 提供方；UI 列出提供方名称/模型，但看不到 API key、DB 路径、settings JSON 或启动器参数。
- 反例：把 `CCS_PROVIDER_DEFAULTS`、提供方令牌或提供方命令参数存到后端。
- 反例：把 `backend:"Claude"` 当作 `runtimeProvider:"Claude"`；当不存在该 CC Switch 提供方时，这会阻塞默认 Claude 启动。
- 反例：在 daemon 探测代码中发布 `/Users/lee/...` 之类开发者特定路径。
- 反例：自动发现 `$HOME/.claude/cc-switch.ps1` 或把 `ccs-claude <provider> <model>` 当产品行为启动。
- 反例：通过服务器 API 发送可执行路径、生成的 settings 路径或提供方 DB 路径。
- 反例：把 MiniMax/提供方/模型元数据当作 Claude、Codex、OpenCode 或 Pi runtime 的证明。MiniMax 是测试提供方/模型选择，不是 runtime 契约。
- 反例：把缺失 ccswitch DB 当作“未探测到 runtime”，或把提供方条目压平进基础 runtime 徽标。
- 良好：无 ccswitch 的机器上报 `claude_code`/`codex`/`opencode`/`goose`（缺失者为 `not_installed`）加打包 `pi`；创建 agent 的 runtime 列表保持完全可用。
- 良好：带 `allowWrites:true` 的产品 `start_runtime` 使子进程看到 `SLOCK_ALLOW_WRITES=1` 与带门禁的包装器，而未带该标志的手动 daemon CLI 仍失败关闭。
- 反例：在派生边界把 `process.env` 重新合并进显式子环境，让被省略的 `npm_config_package` 复活并把嵌套 `npx` 引向错误的 tarball。
- 反例：接受没有 `subtype:"success"` 的 ACP `result` 为就绪，或为已非零退出的启动代次发出 `running` 心跳。

### 6. 所需测试

- 后端单元测试：
  - runtime 规范化器保持规范家族身份，且不使用提供方/模型字段推断它。
  - `runtime_start_command` 包含显式 `runtimeProvider`，且不要求 `runtimeCommand`/`runtimeModel`。
  - 仅 `backend` 不会变成 `runtimeProvider`。
  - 缺失的预期运行 workspace 被重新武装为 `pending_start`，但 `runtimeDesiredStatus:"stopped"` 不被重新武装。
- daemon 单元/集成测试：
  - 带误导名称的 runtime workspace/提供方元数据不能交叉匹配另一个规范 runtime 家族。
  - 通过环境/PATH/平台候选探测 Claude 与 Codex 命令，不含硬编码的个人路径。
  - 证明 `$HOME/.claude/cc-switch.ps1` 不是隐式提供方探测或启动来源。
  - 把 CC Switch 的 Claude 与 Codex 提供方行解析为脱敏的公共提供方。
  - 解析手动提供方 JSON，并验证 command/args 仅用于启动，不是心跳载荷字段。
  - 选定的 Claude CC Switch 提供方解析为探测到的 Claude 命令与选定模型，而不是包装脚本。
  - daemon 注册/心跳上报提供方能力与提供方 workspace 状态，不带命令参数。
- 真实测试：
  - 创建带 `runtimeProvider:"Kimi"` 的标记 agent。
  - 验证浏览器 `/computers` 显示该提供方与运行中的 workspace。
  - 验证 API 状态显示 `runtimeProvider:"Kimi"`、`runtimeCommand:null`、`runtimeModel:null`。
  - 验证 `smallkhoj-trace` 包含 `CC Switch provider: Kimi` 与选定的模型行。
- 清单测试（08-03）：
  - daemon 单元：`detectedRuntimesForInventory()` 仅凭 CLI 探测（ccswitch 缺席）上报固定基础列表的 `available`/`not_installed`，在来源存在时追加脱敏的提供方额外项，且绝不由 `config.runtime` 派生基础条目。
  - 后端/契约：`not_installed` 在序列化后保留；Computers 徽标渲染英文品牌名加本地化状态文本，且不把提供方额外项压平进基础徽标。
- allowWrites 跨进程契约（07-31）：
  - 后端单元：`runtime_start_command()` 信封断言 `config.allowWrites is True`，同时保留既有 runtime/提供方字段。
  - daemon 动态控制集成：`allowWrites:true` 载荷使伪 runtime 看到 `SLOCK_ALLOW_WRITES=1`、带门禁的 `.slock` 包装器，且一次受控的 `message send` 到达伪上游；不带该字段的载荷返回 `WRITES_NOT_ALLOWED`。
- 子环境权威与失败关闭就绪（08-03-fix-codex-acp-exit-127）：
  - 桥/派生测试：显式子环境保持权威（被省略的 key 不会从 `process.env` 重新出现）；嵌套 npx 的 codex 子进程解析请求的 ACP 包而不是外层 daemon tgz。
  - 就绪测试：ACP `result` 仅在 `subtype:"success"` 时标记就绪；错误/已取消/不完整的结果与会话前非零退出不产生 `running` 心跳，生命周期以真实退出码呈 `exited`。

### 7. 错误 vs 正确

#### 错误

```json
{
  "backend": "Claude",
  "runtimeProvider": "Claude",
  "runtimeCommand": "/Users/lee/.local/bin/ccs-claude",
  "runtimeCommandArgs": ["Kimi", "kimi-for-coding"]
}
```

#### 正确

```json
{
  "backend": null,
  "runtimeProvider": "Kimi",
  "runtimeCommand": null,
  "runtimeModel": null
}
```

daemon 在自己的机器本地清单中把 `Kimi` 解析为本地启动器与模型。

#### 错误

```javascript
const isClaude = JSON.stringify(workspace).toLowerCase().includes('minimax');
```

#### 正确

```javascript
const isClaude = normalizeRuntimeIdentifier(workspace.runtime) === 'claude_code';
```

### 4. 校验与错误矩阵

- 缺失 `SLOCK_AGENT_PROXY_URL` -> CLI 以 JSON 错误码 `MISSING_SLOCK_AGENT_PROXY_URL` 非零退出。
- 缺失 `SLOCK_AGENT_PROXY_TOKEN_FILE` -> CLI 以 JSON 错误码 `MISSING_SLOCK_AGENT_PROXY_TOKEN_FILE` 非零退出。
- 令牌文件不可读 -> CLI 以 JSON 错误码 `TOKEN_READ_FAILED` 非零退出。
- `slock message send` 缺少 `--target` -> CLI 以 JSON 错误码 `MISSING_TARGET` 非零退出。
- 缺少发送内容 -> CLI 以 JSON 错误码 `MISSING_CONTENT` 非零退出。
- `slock message search` 缺少 `--query` -> CLI 以 JSON 错误码 `MISSING_QUERY` 非零退出。
- `slock channel members` 缺少 `--channel` -> CLI 以 JSON 错误码 `MISSING_CHANNEL` 非零退出。
- `slock thread read|summary` 缺少 `--thread-id` -> CLI 以 JSON 错误码 `MISSING_THREAD_ID` 非零退出。
- `slock thread summary` 缺少摘要文本 -> CLI 以 JSON 错误码 `MISSING_SUMMARY` 非零退出。
- 可写命令缺少写 opt-in -> CLI 以 JSON 错误码 `WRITES_NOT_ALLOWED` 非零退出。
- 目标被写允许清单拒绝 -> CLI 以 JSON 错误码 `WRITE_TARGET_NOT_ALLOWED` 非零退出。
- 本地代理令牌无效 -> 代理返回 HTTP 401 JSON 错误 `invalid_agent_proxy_token`。
- 发送时存在待处理未读（unread）消息 -> 代理返回 HTTP 409 JSON `{state:"held",reason:"pending_messages",...}`，且不调用上游发送。
- `start_runtime.config.runtime` 中不支持的动态 runtime -> daemon 记录警告，不启动 runtime。
- 控制命令缺少 `agentId` -> daemon 记录警告并忽略。
- `POST /internal/daemon/jsonrpc` 收到畸形 JSON -> 返回 JSON-RPC 解析错误。
- daemon RPC 处理器注册之前调用 `POST /internal/daemon/jsonrpc` -> 返回 HTTP 503 `daemon_rpc_unavailable`。
- 导入的 MCP `--auth-token` 被用作直接 agent-api bearer 令牌 -> 上游可能返回 `invalid_principal`；通过导入受管代理凭据或铸造自管的 `sk_agent_*` 配置档案修复。
- 对兼容桥，MCP `tools/list` 必须只列出 `runtime_profile_migration_done`。

### 5. 良好/基准/反例案例

- 良好：Claude Code 以 stdin 上的内容调用 `slock message send --target "#general"`；包装器注入代理环境；CLI 向 `/internal/agent/{agentId}/send` 提交；代理改写为 `/internal/agent-api/send`。
- 基准：`slock message check --limit 10` 映射到 `/internal/agent/{agentId}/receive?limit=10`；代理改写为 `/internal/agent-api/events?limit=10&since=latest`。
- 基准：attach 在 stdin 收到一行 JSON-RPC，提交到 `/internal/daemon/jsonrpc`，并只把 JSON-RPC 响应帧写入 stdout。
- 基准：新的 WebSocket 或 SSE 消息被缓冲；失效发送被扣留，直到 `message.check` 或历史消费把消息标记为已读。
- 基准：后端从 register/heartbeat 返回 `controlCommands`，或发出 WS/轮询控制事件；daemon 启动/停止/重启目标 agent runtime，不影响其他 runtime 记录。
- 基准：公共 UI 消息创建提交 `message.created` 事件，然后通过计算机级 daemon WS 推送给该计算机上每个可见 agent，`targetAgentId` 设为接收 runtime id。
- 基准：无游标、`eventLogCursor=0` 或游标无效的 daemon WS 初连只收到未来事件与控制命令，不收到旧 `message.created` 行。
- 基准：agent 作用域的 `message.check` 以该 `agentId` 缓冲事件，使投递路由到 1:N daemon 中匹配的 runtime。
- 基准：`aaa-daemon smoke --import-slock-runtime <runtimeDir>` 读取 `.slock/slock.cmd`，链式经过既有受管代理，且只调用 `server info`。
- 基准：`aaa-daemon start --import-slock-runtime <runtimeDir> --runtime claude` 启动受管 Claude runtime，其首次 `slock server info` 调用到达导入的受管代理。
- 反例：把 `message.send`、`message.check` 或任务操作实现为 MCP 工具。这偏离 Slock runtime 契约，并破坏 Claude Code 兼容预期。
- 反例：把 `claude-mcp-config.json --auth-token` 当作直接 `/internal/agent-api/*` 请求的 agent API key。
- 反例：在没有显式测试与安全门禁的情况下添加可写 CLI 操作，如任务认领/更新、频道加入/退出、资料更新、回应或提醒创建/更新。
- 反例：把 attach JSON-RPC 提交到本地 agent API 根；代理根是 bearer 认证的 Slock API 流量，不是 daemon 控制端点。
- 反例：对每个动态 agent 使用 daemon 全局 `workspacePath/.slock` 包装器。后来的 runtime 会覆盖早先 runtime 的包装器/令牌环境。
- 反例：缓冲 agent 作用域事件时丢弃 `agentId`。在 1:N daemon 中这会误路由或跳过 runtime 投递。
- 反例：用事件行为人当 daemon WS 投递目标。人类在 UI 写的消息必须路由到 agent 接收者，不是人类发送者。
- 反例：把 `ActivityLog` 或 runtime 状态遥测当可行动 runtime 事件。这会把 runtime 自己的活动喂给自己、制造循环并烧掉 token。
- 反例：只为 DM runtime 提示词发出 `channelId`/裸 UUID。模型倾向复用可见 header，缺少 `target=dm:@peer` 会导致回复命中 “Channel ... not found” 或落到可见 DM 之外。

### 6. 所需测试

对面向产品的 runtime/控制面改动，还要使用任务本地的真实测试 SOP 模板 `docs/real-test-sop-template.md`。涉及 daemon 或 agent 投递时，runtime 证据必须将可见浏览器状态与 API/DB 状态及 `smallkhoj-trace` 输出交叉核对。

- `rewriteAgentPath` 单元测试：
  - 为 `history`、`search`、`tasks` 与附件路径保留查询字符串
  - 未提供时为 `/receive` 添加 `since=latest`
  - 把 `/threads/{id}` 与 `/threads/{id}/summary` 改写为规范的 agent API thread 端点
- 包装器生成单元测试：
  - 创建所有平台包装器
  - 在 agent 令牌目录下写入代理令牌文件
  - 包装器包含预期的代理与 agent 环境 key
- 使用本地伪 HTTP 服务器的 CLI 集成测试：
  - `slock message send` 提交带 `target` 与 `content` 的 JSON body
  - 请求包含 `Authorization: Bearer {sap_token}`
  - `slock message check` 调用 `/internal/agent/{agentId}/receive?...`
- MCP 兼容测试：
  - SDK 客户端可以连接 `chat-bridge.js`
  - `tools/list` 只返回 `runtime_profile_migration_done`
  - `tools/call` 返回文本空操作响应
- daemon runtime E2E 测试：
  - 用伪 runtime 命令启动 `aaa-daemon start --runtime claude`
  - 伪 runtime 调用 `slock server info`
  - 伪 runtime 调用 `slock message send --target "#general" ...`
  - 断言伪 runtime 看到 `.slock` 位于 `PATH` 头部
  - 断言 `SLOCK_HOME` 指向生成的 workspace `.slock` 目录
  - 断言 `SLOCK_AGENT_LAUNCH_ID` 已设置并匹配令牌 launch id 形状
  - 断言 `.slock/claude-system-prompt.md` 存在并通过 `--append-system-prompt-file` 传入
  - 断言受管 runtime 参数不使用内联 `--system-prompt`
  - 断言伪 Slock API 收到 `/internal/agent-api/server`
  - 断言伪 Slock API 收到带 target/content body 的 `/internal/agent-api/send`
  - 对返回 `controlCommands:[start_runtime]` 的伪后端启动 `aaa-daemon start --runtime none --register-daemon`
  - 断言控制命令动态启动伪 Claude runtime
  - 断言动态 runtime 使用被命令指定的 `agentId`、隔离的 workspace 路径、包装器与后端令牌
  - 断言心跳/注册把动态 workspace 上报为 `runtime:"claude_code"` 且 `status:"running"`
  - 浏览器/API 回归：创建 agent workspace，同步为 `running`，然后以空 `workspaces` 载荷模拟 daemon 重连/注册，并断言后端为该 workspace 返回 `start_runtime` 控制命令
- Claude stream-json 单元测试：
  - 解析 system/会话初始化、assistant/tool-use、user/tool-result 与 result 事件的 stdout JSON 行
  - 断言 `sendUserMessage()` 写出预期的 JSONL stdin 形状
  - 断言捕获的 `session_id` 出现在后续用户消息上
  - 断言 resume session id 通过参数传递，并在首个 init 事件之前使用
  - 断言排队消息在忙碌时不冲刷，并在 `result` 边界冲刷
- WebSocket/消息投递测试：
  - 断言原始与 JSON-RPC WebSocket 消息事件规范化为 daemon 消息事件
  - 断言 ack 与活动载荷构造器在存在时保留消息 id/seq
  - 断言 `thread.summary_requested` 被分类为 runtime 事件并以目标/thread 上下文格式化
  - 断言 WebSocket 连接 URL 追加 `daemonId` 与事件游标
  - 断言来自冲突 daemon id 的后端 WS 活动不延长未过期的活跃租约
  - 断言前一个 daemon 租约过期后，后端 WS 活动可以接管
- TaskRun 可观测性测试：
  - 断言完成摘要可以从 `modelUsage.{model}.contextWindow` 提取 `contextWindow`
  - 断言回退上下文占用排除 `cacheReadInputTokens`，同时在 `tokenUsage` 中保留缓存读
  - 断言带 `workspaceId` 的生命周期报告在 TaskRun 上回填 runtime workspace/computer/session 字段
  - 断言原始 `control` 载荷与 JSON-RPC `daemon.command.*` 载荷分类为控制事件，并保留命令类型、agent id、workspace id 与 runtime 配置
  - 断言后端 daemon WS 把已提交的 `message.created` 记录发送给已连接的计算机对端，`agentId`/`targetAgentId` 设为接收 agent，并将其按连接事件游标推进越过不可见事件
  - 断言对既有 workspace 的 daemon 心跳更新状态，而不写 `ActivityLog(kind="workspace_heartbeat")` 或 `EventRecord(event_type="workspace.heartbeat")`。
  - 断言投递给 agent 的 DM `message.created` 事件包含 `target:"dm:@<human>"`，而 `/internal/agent-api/send` 同时接受该目标与原始 DM `channelId`
  - 断言当持久化的事件载荷在重放前被移除 `target`/`channel` 时，DM thread 的 `message.created` 事件仍返回 `target:"dm:@<human>:<rootShortId>"`
  - 实时冒烟：启动后端与 `aaa-daemon start --ws auto`，用记录 stdin 的伪 Claude runtime；提交 `POST /api/v1/channels/{name}/messages`；断言标记出现在 runtime stdin 中，而不等待轮询
- 面向用户的 agent/聊天/thread 缺陷与面向产品的 runtime/控制面改动，需要在运行中的本地应用上做一次额外的 WebDriver 验收。用 `project-webdriver-cli` skill 与 `./twd` 驱动真实浏览器走通被上报的工作流，使用唯一标记，验证可见 DOM 状态，并按相关性交叉核对 `parent_id`、`target`、`threadId`、workspace 状态、daemon id 或任务 id 等持久化/API 字段。涉及 daemon/runtime 投递时，还要交叉核对 `smallkhoj-trace` 输出。把它当作比自动化 E2E 更强的验收门禁；当 WebDriver 行为与请求的行为不一致时，即使 E2E 是绿的也要继续修复。
- 代理新鲜度/SSE 测试：
  - 断言失效发送在上游发送之前返回 HTTP 409 held 响应
  - 断言 check/读消息把 `readUpToSeq` 推进到足以让后续发送通过
  - 断言 SSE `/events` 帧被解析并缓冲为收件箱事件
  - 断定点号分隔的 SSE 与轮询 `message.*` 事件被规范化为 `message_received` 缓冲方法，且仍从嵌套或顶层消息 seq 推进消息新鲜度
  - 断言 agent 作用域的 SSE 与轮询事件把代理注册 `agentId` 保留在发出的事件与缓冲参数中
  - 断定点号分隔的 `task.*` 事件被缓冲为任务方法、投递给 runtime，且绝不作为待处理未读消息阻塞后续发送
- attach/客户端处理器测试：
  - 断言 `postDaemonRpc` 提交到 `/internal/daemon/jsonrpc`
  - 断言扩展 daemon 方法使用本地代理 bearer 认证并到达预期上游路径
  - 断言 `message.check` 在 `message.send` 之前把缓冲消息标记为已读
  - 断言知识路径被改写并通过 `/internal/agent-api/knowledge...` 转发
- Claude Code 健康检查：
  - `claude mcp get <chat-bridge-name>` 报告 `Connected`
- runtime 导入测试：
  - `importSlockRuntime` 在没有包装器时回退到 MCP 配置
  - 存在 `.slock/slock.cmd` 时 `importSlockRuntime` 优先使用包装器代理 URL/令牌文件
  - 对导入的受管代理做只读冒烟时，向导入代理发送 `Authorization: Bearer {sap_token}`，且只调用 `/internal/agent-api/server`
  - 带 `--import-slock-runtime` 与伪 Claude runtime 的 daemon 启动只调用 `slock server info` 并到达导入的受管代理
- 只读 CLI 测试：
  - 断言 `message search`、`channel members`、`profile get`、`integration list` 与 `reminder list` 路由到预期的 GET 端点
  - 断言没有任何只读 CLI 命令提交请求 body

### 7. 错误 vs 正确

#### 错误

```typescript
// Do not route chat through MCP tools.
server.registerTool('message_send', {}, async () => {
  // sends chat messages
});
```

#### 正确

```typescript
// MCP is only a compatibility bridge.
server.registerTool('runtime_profile_migration_done', {
  inputSchema: { migration_key: z.string().optional() },
}, async () => ({
  content: [{ type: 'text', text: 'Runtime profile migration is no longer required.' }],
}));
```

```bash
# Chat communication goes through slock CLI.
slock message send --target "#general" <<'SLOCKMSG'
hello
SLOCKMSG
```

## 场景：一机一 Daemon 连接模型

### 1. 作用域 / 触发

- 触发：计算机连接流程横跨浏览器 UI、公共 API、数据库身份、daemon 启动、面向 daemon 的认证、心跳租约续订与 agent workspace 创建。
- 不变量（invariant）是：只有 daemon 用一次性票据成功连接后才存在 computer 行；一个 `machineId` 在每个 server 上映射到一个 computer；一个 computer 至多有一个活跃 daemon 租约。

### 2. 签名

- `POST /api/v1/computers/connect-command`
- `POST /internal/agent-api/daemon/connect`
- `POST /internal/agent-api/daemon/register`
- `POST /internal/agent-api/daemon/heartbeat`
- `POST /api/v1/members/agents`
- `POST /api/v1/channels`
- `POST /api/v1/channels/{channel_id}/members`
- `DELETE /api/v1/channels/{channel_id}/members/{member_id}`
- `GET /api/v1/channels/{channel_id}/members`
- `POST /api/v1/dm`
- agent 发送：`POST /internal/agent-api/send`
- 能力注册表：`services.agent_permissions.AGENT_PERMISSION_CAPABILITIES`。
- runtime 门禁：`routers.agent_api._require_permission(member, capability)`。

### 3. 契约

- 公共管理端点需要 `X-Public-Key`。显式 `local-dev` 流程把规范 `PUBLIC_API_KEY` 来源默认为 `sk_public_local`；生产必须使用非开发值，且绝不能把它放进 URL。
- 受保护的 agent 操作是显式默认拒绝。只有注册表中已知且持久化值为布尔 `true` 的能力才允许；配置缺失、权限缺失/JSON null、`{}`、条目缺席、非布尔值与未知的未来能力名都拒绝。
- 新 agent 创建会持久化完整注册表形状的权限映射。省略创建字段时，把历史生效的已知能力物化为显式 `true`；部分映射把每个被省略的已知能力设为 `false`；未知/非布尔创建值返回 `400`。
- 仅数据的 runtime 种子只回填权限字段缺席或 JSON null 的旧 agent 行。显式 `{}` 是有意的全部拒绝，绝不能被回填。未来新增的能力在被显式持久化之前保持拒绝。
- `POST /api/v1/computers/connect-command` 请求：
  - `name: string`
  - `serverUrl?: string`
- `POST /api/v1/computers/connect-command` 响应：
  - `connectToken: string`，带 `sk_connect_` 前缀
  - `command: string`
  - `daemonInstall.installCommand: string`
  - `daemonInstall.downloadBaseUrl: string`
  - `expiresAt: iso datetime`
  - 不得包含 `computerId`、`apiKey` 或任何 `sk_machine_...` 令牌。
- 命令必须包含：
  - `smallkhoj-daemon connect`
  - `--token sk_connect_...`
  - `--server ...`
  - 默认不得包含 `--agent-id`、`--register-daemon` 或 `--runtime`，也不得引用 `@slock-ai/daemon`。
- 面向产品的连接/重连命令不得包含仓库检出绝对路径，如 `/Users/code/project/smallkhoj` 或 `agent/daemon/aaa-daemon`。
- `daemonInstall.installCommand` 必须感知域名。生产中应指向 `https://<public-host>/downloads/smallkhoj-daemon/install.sh` 或配置的 `DAEMON_DOWNLOAD_BASE_URL`，绝不是内部 Docker 主机名或开发者 localhost URL。
- 打包 daemon CLI 必须支持 `smallkhoj-daemon --version`；版本来自 `agent/daemon/aaa-daemon/package.json` 包元数据，是 connect/register/heartbeat 载荷中上报的值。
- 后端兼容性检查使用 `MINIMUM_DAEMON_VERSION`；daemon 以低于配置最低值的版本 connect/register/heartbeat 时，在改动 computer 状态或消耗连接票据之前返回 `426 Unsupported daemon version`。
- 连接票据存储：
  - `connect_tickets.token_hash` 存储完整连接令牌的 SHA-256。
  - `connect_tickets.key_prefix` 存储用于查找的 `token[:20]`。
  - 票据带有 `requested_name`、`expires_at`、`consumed_at` 与 `revoked_at`。
- `POST /internal/agent-api/daemon/connect` 请求：
  - Header `Authorization: Bearer sk_connect_...`
  - Body `{ daemonId?: string, machineId: string, name?: string, os?: string, daemonVersion?: string, status?: string, detectedRuntimes?: list }`
- `POST /internal/agent-api/daemon/connect` 响应：
  - `connected: true`
  - `daemonId: string`
  - `machineToken: string`，带 `sk_machine_` 前缀
  - `leaseExpiresAt: iso datetime`
  - `computer: serialized Computer`
- 数据库身份：
  - `computers.machine_id` 是 daemon 生成的持久机器 UUID。
  - 存在时按 server 唯一：`(server_id, machine_id)`。
  - Computer 名称按 server 唯一。
  - daemon 连接身份解析有顺序：先精确 `(server_id, machine_id)` 匹配；若无机器匹配，同 server 同名 `Computer` 只有其 daemon 租约不活跃时才可被收养；否则只在两种身份都不存在时创建新行。
  - 同名离线收养在返回连接响应之前，更新既有行的 `machine_id`、daemon 元数据、探测到的 runtime、机器令牌、活跃 daemon 租约、心跳与状态。
  - 成员显示名按 server 唯一。
  - 租约字段为 `active_daemon_id`、`daemon_lease_expires_at` 与 `last_heartbeat_at`。
- daemon 行为：
  - 首次启动在 `~/.slock/aaa-daemon/machine-id` 下创建 UUID `machineId`，除非 `AAA_DAEMON_MACHINE_ID_FILE` 或 `SLOCK_MACHINE_ID_FILE` 覆盖。
  - `SLOCK_CONNECT_TOKEN` 仅用于 `/daemon/connect`。
  - 返回的 `machineToken` 保存在内存中，在用户创建的 agent 存在之后用于 `/daemon/register`、`/daemon/heartbeat` 与面向 agent 的调用。
  - daemon 凭据应尽可能保留 `/daemon/connect` 响应中的 `computer.id` 与 `machineId`。默认动态 runtime cwd 生成使用 `serverId`，然后是有则用 `computerId`，再是 `machineId` 作为计算机段。这避免同一物理主机上的两个 Computer 行共享 runtime 包装器/令牌/会话文件。
  - 不带 `--workspace` 时，产品 CLI 运行使用 `~/.smallkhoj/daemon/workspaces` 作为 daemon workspace 根。`SMALLKHOJ_DAEMON_WORKSPACE_ROOT` 直接覆盖根；`SMALLKHOJ_DAEMON_HOME` 更改父目录并追加 `workspaces`。
  - 心跳间隔为 15 秒；后端租约窗口为 90 秒。
  - 没有 `agentId` 就没有 workspace 注册与收件箱轮询。
  - `smallkhoj-daemon` 等面向产品的包装器可以保留 server 作用域的 pid 锁用于诊断，但在证明自身令牌有效之前，不得自动终止既有 daemon。若同 server 锁指向活进程，包装器必须带清晰信息快速失败；失效锁可以移除。
  - `smallkhoj-daemon` 必须 `exec` 前台 daemon 进程，而不是把它当后台子进程运行并从父 shell 等待。可见进程应是接收 `SIGINT`/`SIGTERM` 的 daemon；否则包装器级信号处理会掩盖真实停止来源。
- agent 创建：
  - `POST /api/v1/members/agents` 同时创建 `Member(kind="agent")` 与绑定到所选 computer/runtime 的 `AgentWorkspace`。
  - daemon 连接不得自动创建 agent。
- 既有管理/聊天契约仍适用：
  - 频道成员 API 按 UUID 频道 id 操作。
  - `POST /api/v1/dm` 使用对端显示名并返回存储的 `dm:<uuid>-<uuid>` 频道。
  - 面向 agent 的 DM 发送以 `dm:<peer display name>` 为目标，不是存储的 DM 频道名。

### 4. 校验与错误矩阵

- 缺失公共 key -> `401 Missing API key`。
- 无效公共 key -> `401 Invalid API key`。
- 连接命令缺失 name -> `400 Missing name`。
- 无效连接令牌 -> `401 Invalid connect token`。
- 连接令牌被吊销 -> `401 Connect token revoked`。
- 连接令牌过期 -> `401 Connect token expired`。
- 连接令牌被复用 -> `409 Connect token already used`。
- daemon 缺失 `machineId` -> `400 Missing machineId`。
- 同名 computer 无精确机器匹配且无活跃 daemon 租约 -> 复用该 computer，更新 `machine_id`，并签发新机器令牌。
- 同名 computer 无精确机器匹配但有未过期活跃租约 -> `409 Computer already has an active daemon`。
- 不同的精确机器匹配出现重复 computer 名 -> `409 Computer name <name> already exists`。
- 同一 `machineId` 且其 computer 有未过期活跃租约 -> `409 Computer already has an active daemon`。
- 租约过期后的同一 `machineId` -> 复用既有 computer 并签发新机器令牌。
- 存储租约已过期时，daemon 以不同 `daemonId` 进行 `register` / `heartbeat` -> 接受并替换 `active_daemon_id`；失效 daemon id 不得在进程崩溃后阻塞恢复。
- 存储租约仍活跃时，daemon 以不同 `daemonId` 进行 `register` / `heartbeat` -> `409 Computer is leased by another daemon`。
- 成员显示名重复 -> `409 Member name <name> already exists`。
- agent 创建的 `computerId` 无效 -> `400 Invalid computerId`。
- agent 创建的 `computerId` 未知 -> `404 Computer not found`。
- 频道/成员标识符缺失保持既有 `400`/`404` 行为。
- 权限映射缺失/为空或能力缺席 -> `403 Permission denied: <capability>`。
- 未知能力，即使某行将其存为 `true` -> `403`。
- agent 创建带未知权限或非布尔值 -> `400`；部分已知映射被扩展，省略能力设为 false。

### 5. 良好/基准/反例案例

- 良好：浏览器生成连接命令；在 daemon 调用 `/daemon/connect` 之前不出现 computer 行。
- 良好：daemon 以持久 `machineId` 连接；后端创建/复用一个 computer 并返回新的 `sk_machine_...` 令牌。
- 良好：daemon 丢失/重新生成了本地 `machineId`，但在先前租约过期后以同一本地 computer 名重连；后端收养离线的同名行，而不是创建重复行或返回名称冲突。
- 良好：同一在线 `machineId` 的第二个 daemon 在心跳租约到期前被拒绝。
- 良好：computer 已存在时，`/computers` 展示既有 computer 详情与重连动作，而不是新 computer 连接表单。
- 良好：过期、被复用或无效的连接命令不能杀死健康的同 server daemon；当 server 作用域包装器锁指向活进程时，它在启动前退出。
- 良好：用户稍后在 Members 上创建 agent 并绑定到已连接的 computer。
- 良好：浏览器创建频道、按频道 id/成员 id 添加 agent、发送人类消息，并通过 `/internal/agent-api/send` 验证 agent 署名的响应。
- 良好：以 `{sendMessage: true}` 创建的 agent 把其他所有已知能力持久化为 false，不会仅因代码后来新增注册表条目就获得能力。
- 反例：从浏览器生成长期机器令牌，并在 daemon 证明能够连接之前创建 computer。
- 反例：包装器启动读取 pid 锁，向该进程发送 `SIGTERM`，然后才尝试 `/daemon/connect`；带无效一次性令牌的失效重试可能杀死健康 daemon 并使自身认证失败。
- 反例：把 `--agent-id aaaa...` 放进默认 computer 连接命令，因为 daemon 连接不得自动创建或抢占 agent workspace。
- 反例：以 `sender: agentName` 向公共 `/api/v1/channels/{channel}/messages` 提交来测试 agent 回复；那证明的是消息渲染，不是面向 agent 的认证/发送契约。
- 反例：`permissions is None -> allow`、truthy/通配权限检查，或把显式空映射转成全部允许的种子代码。

### 6. 所需测试

- API 测试：
  - `connect-command` 不创建 computer。
  - 有效令牌之后 `/daemon/connect` 创建 computer。
  - 同一离线 `machineId` 复用既有 computer。
  - 同名离线 computer 且 `machineId` 变化时复用既有 computer 并更新 `machine_id`。
  - 同名活跃 computer 且 `machineId` 变化时返回 `409`，且不消耗连接票据。
  - 同一在线 `machineId` 返回 `409`。
  - 重复 computer/成员名返回 `409`。
  - 每个注册表能力都要求显式布尔 true；缺失/null/空/未知情形拒绝。
  - 创建拒绝未知/非布尔值，并把部分映射扩展为默认 false。
- 真实 PostgreSQL 种子测试运行两次，证明缺失/null 的旧映射被物化，而显式 `{}` 保持不变。
- 过期或被复用的连接令牌返回 `401`/`409`。
- daemon 版本低于 `MINIMUM_DAEMON_VERSION` 返回 `426`，且不消耗连接票据。
- daemon 测试：
  - `machineId` 只生成一次并在重启间持久。
  - `--proxy-port 0` 在可用端口上启动。
  - 无 `--agent-id` 意味着无 workspace 载荷。
  - 心跳续订租约。
  - 打包的 `smallkhoj-daemon connect --token ... --server ...` 在仓库检出之外可用。
  - 打包的 `smallkhoj-daemon --version` 匹配构建清单/包元数据。
  - `smallkhoj-daemon` 仅把 server 作用域锁当守卫：不同 server URL 可以共存，同 server 启动在不杀死既有 daemon 的情况下退出，且 connect/start 模式 `exec` 前台 daemon 进程。
- 浏览器 E2E：
  - 生成的命令包含 `SLOCK_CONNECT_TOKEN` 且不含 `sk_machine_`。
  - daemon 连接成功前，computer 列表不显示待定 computer。
  - 已连接 computer 上线显示，待定命令隐藏。
  - 默认选中既有 computer 详情，除非正在显示待定的生成命令，否则隐藏新 computer 表单。
  - 重复 agent 名显示后端 `409` 错误。
  - DM 路由标题显示解码后的 `dm:` 文本，而不是 `dm%3A`。

### 7. 错误 vs 正确

#### 错误

```bash
npx @slock-ai/daemon@latest --server-url http://localhost:8000 --api-key sk_machine_...
```

#### 正确

```bash
smallkhoj-daemon connect --token sk_connect_... --server http://localhost:8000
```

#### 错误

```typescript
const dmChannelName = decodeURIComponent(page.url().split("/chat/").at(-1) ?? "")
await agentSend(apiKey, agentId, dmChannelName, dmReply)
```

#### 正确

```typescript
await agentSend(apiKey, agentId, "dm:zy-ean", dmReply)
```

#### 错误

```python
if member.config.get("permissions") is None:
    return  # implicit allow
```

#### 正确

```python
permissions = (member.config or {}).get("permissions")
if capability not in AGENT_PERMISSION_CAPABILITIES \
        or not isinstance(permissions, dict) \
        or permissions.get(capability) is not True:
    raise HTTPException(403, f"Permission denied: {capability}")
```

## 场景：打包 Daemon 解析其生成的 Slock CLI

### 1. 作用域 / 触发

- 触发：改动 daemon 打包、`smallkhoj-daemon` 接入（onboarding）命令、
  生成的 `.slock` 包装器或本地 `slock`/`raft` CLI 入口。
- 这是产品接入契约：daemon 可能从仓库包装器、已安装二进制
  或 npm/npx `.bin` shim/符号链接启动，但生成的 runtime 包装器
  仍必须执行包的真实 CLI 文件。

### 2. 签名

- 生成的包装器：
  - POSIX：`.slock/slock`
  - Windows CMD：`.slock/slock.cmd`
  - PowerShell：`.slock/slock.ps1`
- 包 bin：
  - `smallkhoj-daemon` -> `dist/cmd/main.js`
  - `slock` -> `dist/slock-cli.js`
  - 产品命名迁移时，`raft` 可以是兼容别名。
- runtime 辅助：
  - `defaultSlockCliPath(): string`

### 3. 契约

- `defaultSlockCliPath()` 必须解析到 daemon 包真实的
  `dist/slock-cli.js`，而不是从 npm `.bin` 符号链接父目录推断的路径，
  如 `node_modules/slock-cli.js`。
- 当 `process.argv[1]` 指向 npm/npx `.bin/smallkhoj-daemon` 符号链接时，
  路径解析必须先跟随符号链接到真实 `dist/cmd/main.js`，
  再推导同级 CLI 路径。
- 若进程入口点不是普通文件路径，例如 `node -`，
  包装器生成必须回退到模块相对的
  `dist/slock-cli.js`。
- runtime 进程环境可以对 Claude 隐藏原始代理令牌变量。
  生成的包装器仍是 `SLOCK_AGENT_PROXY_URL`、
  `SLOCK_AGENT_PROXY_TOKEN_FILE`、`SLOCK_AGENT_ID` 及相关字段的权威。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 仓库包装器从本地 `dist/cmd/main.js` 启动 daemon | 生成的包装器调用本地 `dist/slock-cli.js`。 |
| npm/npx `.bin/smallkhoj-daemon` 符号链接启动 daemon | 生成的包装器调用包 `@smallkhoj/smallkhoj-daemon/dist/slock-cli.js`。 |
| 入口点无法 realpath，例如 `node -` 冒烟 | 生成的包装器回退到模块相对的 `dist/slock-cli.js`。 |
| 生成的包装器指向 `node_modules/slock-cli.js` | 回归；agent 回复以 `MODULE_NOT_FOUND` 失败。 |
| runtime 内裸全局 `slock` 报告 `MISSING_TOKEN` | 其本身不足以证明失败；生成的 `.slock/slock` 才是受支持的回复路径。 |

### 5. 良好/基准/反例案例

- 良好：产品生成的 npx 连接命令启动 daemon，runtime 使用
  `.slock/slock message send`，包装器执行包的
  `dist/slock-cli.js`。
- 基准：本地仓库开发使用 `./smallkhoj-daemon`，它重建本地
  `agent/daemon/aaa-daemon/dist` 并生成指向该本地
  dist 的包装器。
- 反例：不解析符号链接就直接从 `process.argv[1]` 推导 CLI 路径；
  macOS/Linux 的 npm `.bin` 启动器随后会生成不存在的
  `node_modules/slock-cli.js`。

### 6. 所需测试

- 单元：模拟 npm `.bin/smallkhoj-daemon` 符号链接，断言
  `defaultSlockCliPath()` 解析到包 `dist/slock-cli.js`。
- 单元/冒烟：`writeSlockWrapper()` 应生成一条可执行命令，其
  CLI 目标存在且不含根 `node_modules/slock-cli.js`
  坏路径。
- 打包 daemon 测试必须继续覆盖仓库包装器、npx 式接入参数，
  以及通过本地代理执行生成的包装器。

### 7. 错误 vs 正确

#### 错误

```typescript
resolve(process.argv[1], "..", "..", "slock-cli.js")
```

这只在 `process.argv[1]` 已是真实 `dist/cmd/main.js` 时有效；
通过 npm/npx `.bin` 符号链接时会失败。

#### 正确

```typescript
const entrypoint = realpathSync(process.argv[1])
const candidate = resolve(entrypoint, "..", "..", "slock-cli.js")
```

验证候选路径存在，并在入口点无法 realpath 时
回退到模块相对的 CLI 路径。

## 场景：厂商 Runtime 能力边界与可靠唤醒（wakeup）

### 1. 作用域 / 触发

- 触发：改动 daemon/runtime 投递、添加厂商 CLI/ACP/app-server 适配器、引入持久排队的工作、定义忙碌/空闲语义，或提议 `wait` / Agent RPC 续接。
- 这是控制边界规则：SmallKhoj 拥有 Business Work Item 与 Dispatch Attempt；它发起/观察 Adapter Invocation。Provider Session、Provider Turn、工具循环、压缩与模型生成保持提供方拥有，除非某个 surface 发出显式证据。
- 证据来源：任务 `07-13-agent-runtime-capability-matrix` 及其版本化的 `provider-capability-matrix.md`。不要把一个 Provider/surface 的结果泛化到另一个 surface。

### 2. 签名

- 未来的持久工作状态词汇（并非声称这些表已存在）：
  - `persisted` → `queued` → `submitted` → `adapter_terminal`
  - `delivery_uncertain` 是终态安全分类，不是重试状态。
- 需要按**确切 surface/版本**保留的 runtime 能力字段：
  - `surface`、`version`、`structuredEvents`、`observableCompletionBoundary`、`inputAcknowledgement`、`busyInputBehavior`、`cancelActiveInvocation`、`sessionUsableAfterCancel`、`steerActiveInvocation`、`providerTurnIds`、`toolCallEvents`、`compactionEvents`、`suspendContinuation`。
- 探测或未来适配器诊断的证据字段：
  - `provider`、`surface`、`executionStatus`、`fixture.beforeDigest`、`fixture.afterDigest`、`providerSessionIds`、`providerTurnIds`、`terminal`、`sideEffectAssessment`、`cleanup`、`uncertainties`。
- 既有 daemon 驱动接缝保持为 `sendUserMessage(text)` / 提供方专属 prompt 操作。`result`、进程退出或 `runtime_idle` 活动是 Adapter 边界，不是语义上的 `handled` 确认。

### 3. 契约

- **可移植的可靠唤醒**：在模型上下文之外持久化可行动工作；适配器忙碌时将其排队；在稍后可观察的调用边界上，提交一条完整的新 prompt/恢复 prompt；把 Adapter 终态证据与业务语义证据分开存储。
- 持久队列/唤醒提示必须独立于模型注意力而具有权威性。`slock message check` 是追平/上下文检查，绝不是显式可行动 Work Item 的唯一正确性路径。
- `inputAcknowledgement` 只意味着某个传输/协议接受了输入。`stopReason:end_turn`、`turn.completed`、进程退出或 UI 空闲并不意味着 agent 理解、回复、改了任务或完成了副作用。
- Provider 会话复用 / ACP `loadSession` 能力 / `--resume` 只有在直接证据之后才能证明对上下文的后续引用。除非显式恢复了未完成的业务/工具续接，绝不得将其序列化为 `suspendContinuation`。
- 活跃 steer、中断与取消（cancellation）是提供方专属增强。它们必须有同 surface 的动态证据、显式安全策略与持久队列回退。成功的协议响应不能被 Codex exec/ACP、Claude stream-json、Kimi prompt 或 OpenCode serve 借用。
- 若 Provider 进程运行用户全局 hook、插件代码或任何无法排除影响的夹具外动作，把该尝试分类为 `delivery_uncertain`，停止该 Provider 案例，且不自动重试。不要仅为解释 hook 而检查无关的全局配置。
- 流证据必须保留方法/更新形状与关联，同时脱敏模型思考/消息块、prompt 内容、hook 载荷、不透明标识符、凭据与 home 路径。原始转录仅保留在 `/tmp`，脱敏后删除。
- 能力声明使用这些级别：`verified`、`conditional`、`unsupported`、`unverified`、`blocked`。`verified`/`conditional` 需要动态的同 surface 证据；CLI help 缺席仍为 `unverified`。可复现的显式协议拒绝仅对那个 surface/版本才可支持 `unsupported`。

### 4. 校验与错误矩阵

| 条件 | 必需行为 |
| --- | --- |
| 厂商回合活跃时新工作到达，但没有动态的活跃 steer 证据 | 为稍后的调用持久化/排队它；不要仅凭模型注意力写入第二个输入。 |
| Provider 返回 prompt/result/end-turn | 记录完成证据，但在回复/任务/工件/显式 ack 关联之前，Work Item 的语义结果保持待定。 |
| Provider 会话 id 可用 | 它可以作为候选会话引用；不标记 suspend/resume 支持。 |
| 同回合 steer/中断响应被接受 | 记录确切的回合/会话关联与约束；保留持久回退。 |
| 探测/runtime 实验期间发生用户/全局 hook 或未知外部副作用 | 停止该案例，分类为 `delivery_uncertain`，禁止自动重试。 |
| 静态 help/schema 省略某方法 | 标记能力为 `unverified`，不是 `unsupported`。 |
| 带模型的探针输入写入失败或超时 | 消耗共享提供方预算；不得通过更改 run id 退款/重试。 |
| 流式协议发出大量思考/消息块 | 仅持久化聚合计数/更新种类；绝不是任务本地的原始文本。 |

### 5. 良好/基准/反例案例

- 良好：一条持久化的 `@` Work Item 在服务器拥有的队列中等待，直到适配器可用，然后作为完整的后续 prompt 提交；终态与语义确认保持分离。
- 良好：一个 Kimi/OpenCode ACP 适配器为串行 prompt 记录 `session/update` 与 `stopReason:end_turn`，但在单独测量之前，把忙碌注入、取消复用、压缩与续接标记为 `unverified`。
- 基准：适配器当前有一个内存中的待处理消息数组。它可以保留为延迟优化，但不是持久的工作真相。
- 反例：把 `runtime_idle` 或零退出码当作 `@` 已被处理的证明。
- 反例：因为另一个提供方的协议暴露 `turn/steer` 就声明通用的活跃转向。
- 反例：在后端日志、任务证据或活动预览中保留单个模型推理块。

### 6. 所需测试

- 单元：能力评估拒绝没有同 surface 动态证据的 `verified`/`conditional` 声明。
- 单元：忙碌输入归因优先适配器队列、提供方确认、同回合关联、并行调用，然后显式拒绝；否则返回 `unknown`。
- 单元：Adapter 终态与会话恢复不产生语义 handled/suspend-continuation 布尔值。
- 单元：`delivery_uncertain` 与外部/未知副作用风险禁止自动重试。
- 单元：提供方输入账本跨活跃 run ID 共享，并拒绝第三个带模型的输入。
- 单元：证据记录器移除 `agent_thought_chunk`、`agent_message_chunk`、hook 载荷与凭据/home 数据，同时保留聚合协议形状。
- 集成/调研：每个提供方专属增强都先在一次性夹具中运行，带自有进程清理与证据验证器，然后才提议生产适配器工作。

### 7. 错误 vs 正确

#### 错误

```text
runtime_idle
  → mark @ message handled
  → delete pending work
```

#### 正确

```text
runtime terminal observed
  → record Adapter Invocation outcome
  → retain/resolve Work Item only with separate semantic evidence
```

#### 错误

```text
Codex app-server accepted turn/steer
  → enable mid-turn injection for every managed runtime
```

#### 正确

```text
Provider-specific steer evidence
  → opt-in adapter experiment with hook/side-effect policy
  → durable next-invocation queue remains the universal fallback
```

---

## 场景：优雅的 Runtime 取消

### 1. 作用域 / 触发

- 触发：从任意入口取消进行中的 runtime 回合 —— 后端生命周期 `action=cancel`、聊天 `POST /api/v1/agents/{id}/cancel-turn`、daemon `cancel_turn` 控制命令、ACP `session/cancel` / `$/cancel_request`、Claude Code stream-json stdin 中断，或停滞看门狗升级。
- 证据来源：任务 `08-15-agent-turn-cancel`、`08-15-acp-bridge-new-client-api`、`08-15-chat-cancel-claude`；看门狗阶梯在 `daemon.ts` 中验证，并记录在 `.agents/skills/smallkhoj-add-runtime`（优雅取消章节）。

### 2. 签名

- 后端 workspace 路径：`POST /api/v1/workspaces/{id}/lifecycle` body `{action:"cancel"}` -> `runtime_control_command()` -> 仅携带 `agentId` + `workspaceId` 的 `cancel_turn` 控制信封（无 `config`）。
- 后端成员路径：`POST /api/v1/agents/{memberId}/cancel-turn` -> 解析该 agent 的活跃 workspace（状态 `running`/`pending`）-> 复用同一生命周期取消核心。
- daemon：`DaemonControlCommand.type === "cancel_turn"`；`cancelRuntimeTurn(agentId: string, workspaceId?: string): boolean`。
- 驱动接缝：`ManagedRuntimeDriver.requestGracefulCancel?(): boolean`。
- ACP 双通道：`bridge.prompt(sessionId, text, {signal?: AbortSignal})` -> 中止时传输级 `$/cancel_request`；`requestGracefulCancel()` = `bridge.cancel()`（agent 域 `session/cancel`）加每回合 `AbortController.abort()`。
- Claude Code stream-json stdin 中断帧：`{"type":"control_request","request_id":...,"request":{"subtype":"interrupt"}}`（依据 claude 2.1.201 验证）。
- 停滞看门狗：`stallCancelSentAt`、宽限窗口 `min(30_000, max(stallTimeoutMs, 5_000))` ms、通过 `markRuntimeProgress()` 重置进展标记。

### 3. 契约

- `cancel_turn` 信封是最小的 —— `agentId` + 可选 `workspaceId`，无 config。它是一个请求，不是状态转换。
- 后端 `action=cancel` 执行零状态变更：不改 workspace/agent 状态，不做 runtime 提供方可用性检查（runtime 已在运行），保留计算机在线检查；它把控制命令入队并记录一条活动（`@handle 回合取消已请求 on <computer>`）。
- `cancelRuntimeTurn` 只守护存在性与 workspace 匹配；一个没有注册 `workspaceId` 的启动配置 runtime 是按 agent 的单例，匹配无作用域命令。空闲 runtime 记录 `runtime idle, nothing to cancel`；没有 `requestGracefulCancel` 的 runtime（今天的 pi/opencode）记录 `runtime does not support graceful cancel` —— 两者都是被记录的空操作，绝不是错误，也绝不改状态。
- 被取消的回合通过既有事件路径落定：`stopReason=cancelled` result -> `runtime_idle`。不要为取消发明新的活动/事件种类。
- ACP 双通道：agent 域 `session/cancel` 是主通道；传输 `$/cancel_request`（AbortSignal）是给忽略 `session/cancel` 的 agent 的独立第二路径。`$/cancel_request` 不得替代 `session/cancel`，其 promise 仍在对端的最终响应（可能是 `RequestCancelled`）上落定。
- Claude stream-json：只在忙碌且 stdin 可写时向 stdin 写中断 `control_request`。stdout 上到达的 `control_response` 帧必须从 `stream_event` 分发中过滤掉（仅记录为 daemon 诊断行），否则会污染活动流。中断之后，该回合既有的 `result` 路径正常落定（`awaitingTurnResult` 重置 -> 排队消息冲刷）。
- 当 agent 在本 server 上没有活跃 workspace（`running`/`pending`）时，`POST /api/v1/agents/{id}/cancel-turn` 返回 HTTP 409。
- 超过 `stallTimeout` 的忙碌 runtime 的停滞看门狗阶梯：1) 发送一次优雅取消（设置 `stallCancelSentAt`）；2) 等完宽限窗口 `min(30s, max(stallTimeout, 5s))` —— 协作的 `cancelled` 落定保持会话/resume 状态完整；3) 然后才终止（SIGKILL）。任何进展（`markRuntimeProgress`）都会重置升级标记。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 对运行中 workspace 的生命周期 `action=cancel` | 入队最小 `cancel_turn` 信封 + 一条活动；workspace/agent/computer 状态不变。 |
| 对空闲 runtime 的 `cancel_turn` | 记录 `runtime idle, nothing to cancel`；无错误，无状态变更。 |
| 驱动没有 `requestGracefulCancel`（pi/opencode） | 记录 `runtime does not support graceful cancel`；空操作，不是错误。 |
| 对未知 agentId 或不匹配 workspaceId 的 `cancel_turn` | 记录 `runtime not running` 警告；返回 false。 |
| 无活跃 workspace 的 `POST /agents/{id}/cancel-turn` | HTTP 409。 |
| Claude 驱动空闲或 stdin 不可写 | `requestGracefulCancel()` 返回 false；不写帧。 |
| Claude stdout 上的 `control_response` 帧 | 绝不分发为 `stream_event`；保留为 daemon 日志行。 |
| 优雅取消发出后的停滞 | 在 SIGKILL 前撑过 `cancelGraceMs`；进展重置 `stallCancelSentAt`。 |

### 5. 良好/基准/反例案例

- 良好：忙碌的 goose/codex-acp 回合收到 `cancel_turn` -> `session/cancel` + `$/cancel_request` -> prompt 以 `stopReason=cancelled` 落定 -> `runtime_idle`；会话保持可恢复。
- 良好：聊天页停止按钮调用 `POST /agents/{id}/cancel-turn`，它复用生命周期取消核心，零状态变更。
- 基准：Claude 中断写出确切的 `control_request` 帧；随后的 result 事件恢复正常的空闲处理与队列冲刷。
- 反例：用 SIGKILL 优先实现取消 —— 它摧毁优雅阶梯要保护的会话/resume 状态。
- 反例：`lifecycle action=cancel` 写入 `cancelling` 之类的合成 workspace 状态。
- 反例：发出定制的 `turn_cancelled` 活动/事件类型，或让 `control_response` 帧到达 `stream_event` 消费者。

### 6. 所需测试

- daemon 伪 ACP：挂起回合 -> `requestGracefulCancel()` -> 伪对端记录 `$/cancel_request`，回合以 `cancelled` 落定；没有该接缝的驱动报告不可取消；空闲返回 false。
- daemon 伪 claude：在 stdin 上断言中断帧形状（`type`/`request_id`/`subtype`）；`control_response` 被排除出 `stream_event`；伪 result 事件清除忙碌状态。
- daemon 集成：通过事件投递一个回合 -> 心跳携带 `cancel_turn` -> 标记以 `cancelled` 落定（无 workspaceId 的启动 runtime 仍匹配）。
- 后端：生命周期 `action=cancel` 入队最小信封且不改任何状态（pytest）；无活跃 workspace 的 `cancel-turn` 返回 409。
- 看门狗：终止前遵守宽限窗口；`markRuntimeProgress` 重置升级。
- 真实冒烟：在长工具调用中途取消（例如 `--cancel-after-events`）证明真实中断 —— 增量流停止且回合在数秒内落定，而不只是事件计数。

### 7. 错误 vs 正确

#### 错误

```text
cancel_turn -> SIGKILL child now -> workspace=exited -> invent activity kind "turn_cancelled"
lifecycle action=cancel -> workspace.status = "cancelling"
```

#### 正确

```text
cancel_turn -> requestGracefulCancel (session/cancel + $/cancel_request | stdin interrupt)
           -> result stopReason=cancelled -> runtime_idle via the existing event path
lifecycle action=cancel -> enqueue cancel_turn envelope + activity, zero state mutation
```

---

## 场景：新 Runtime 接入契约

### 1. 作用域 / 触发

- 触发：跨 daemon 接线、事件契约、产品面与测试，添加或审计一个新的 agent runtime（ACP 常驻、CLI 回合式、HTTP/SSE 服务器或打包 JS CLI）。也适用于诊断“新 runtime 无法创建 agent / 下拉缺失 / 活动错误”。
- 事实来源：`.agents/skills/smallkhoj-add-runtime`（提炼自任务 `08-06-goose-builtin-runtime` 与 08-15 的 AGENTS.md 提示词迁移）。

### 2. 签名

- 共享翻译器：`src/runtime/acp-event-translator.ts` 的 `translateAcpSessionUpdate()` -> AgentEvent 模式，以 `{ runtime: '<name>', ...AgentEvent }` 在 `stream_event` 上发出。
- 提示词文件接缝：`writeAgentInstructionsFile({ workspacePath, systemPrompt })` 写入 `<workspacePath>/AGENTS.md`，做基于标记的幂等（idempotent）合并。
- 前端注册表：`frontend/lib/runtime-options.ts`（`PRIMARY_RUNTIMES`、`RUNTIME_LABELS`、`publicRuntimeValue()`）；`app/(app)/computers/page.tsx`（`runtimeBrandLabel`）、`app/(app)/daemon/page.tsx` 与 `lib/control-plane.ts`（`runtimeLabel`）中的品牌标签表。
- 后端别名门禁：`backend/routers/public_api.py` 的 `_normalize_runtime()`。

### 3. 契约

- 每个新 runtime 的流事件必须流经共享的 `translateAcpSessionUpdate()` 并以统一的 AgentEvent 模式出现。禁止伪 Anthropic 信封与私有事件形状。任何新的 `stream_event` 消费者必须同时处理 `item_*` 类型与旧版信封（`eventType === 'assistant'`）形状。
- 工具失败必须以 `item_completed` + `status:"failed"` 呈现 —— daemon 结构化诊断只读这个。正则扫描模型文本仍保留给旧版信封 runtime 与进程 stderr。若 agent 在 `tool_call_update` 上省略 toolName（goose 风格），驱动必须按 `callId` 记住 `item_started` 的 toolName，使失败不会退化为 “tool”。
- Slock 系统提示词由驱动的 `start()` 通过 `writeAgentInstructionsFile` 一次性写入 workspace `AGENTS.md`（基于标记的幂等合并，保留 agent 撰写的新增内容）；每个回合只发送裸事件文本。绝不要把系统提示词拼接进每条用户消息 —— 旧的 `buildCodexPrompt` 方案每回合把约 9k token 卷进历史，是实测中一个数量级的过度开销。
- 产品接线是 runtime 契约的一部分：`PRIMARY_RUNTIMES` + `RUNTIME_LABELS` + `publicRuntimeValue()` 与全部三张品牌标签表都必须列出该新 runtime。任何一处缺失都会让 runtime 不可见（daemon 上报 `available` 但 UI 把它过滤掉），用户无法创建 agent —— goose 发布上线（rollout）时正好带着这个洞。
- daemon 接线是一份由独立故障点组成的清单，全部必需：`types.ts` 的 `RuntimeType`；`daemon.ts` 的 `DaemonRuntimeImplementation` 联合、`normalizeDaemonRuntimeType()` 别名、`start()` 启动自启条件（与工厂分开的分支 —— 缺了它意味着已配置的 runtime 从不在启动时启动）、工厂分支、`session` 就绪分支、PATH 探测（`requiresDetectedRuntimeCommand()` / `runtimeCommandDetectionError()`）、`sessionManager.upsert` 默认命令；`cmd/main.ts` CLI 标志；`runtime-activity.ts` 联合 + `runtimeProtocol()`；`providers/local-command-provider.ts` + `provider-types.ts` + `runtime-provider.ts` 清单条目；后端 `_normalize_runtime()` 别名。
- 每个门禁级别的测试阶梯：翻译器/驱动单元测试 -> 针对真实二进制的桥冒烟（`npm run smoke:<name>`：initialize -> createSession（编解码器编码）-> prompt（真实流式 + 用量）-> loadSession（编解码器解码））-> 隔离 daemon E2E（启动自启、编解码器会话 id、AgentEvent 流、结构化工具失败、按 agent 数据目录）-> 隔离全栈 E2E -> 与 `GET /api/v1/activity` 对账的 `./twd` UI 验收。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 新 runtime 发出私有/伪 Anthropic 信封 | 评审中拒绝；路由经过 `translateAcpSessionUpdate()` 到 AgentEvent。 |
| 驱动把系统提示词追加到每条用户消息 | 拒绝；`start()` 时一次写入 `AGENTS.md`，每回合裸事件文本。 |
| `PRIMARY_RUNTIMES` 或任一品牌标签表漏掉新 id | 产品缺陷：即使 daemon 上报可用，runtime 也不可见。 |
| 只单独添加启动自启条件或工厂分支 | 已配置的 runtime 永不启动（或从不在启动时启动）；两处都必需。 |
| `tool_call_update` 缺少 toolName | 驱动按 `callId` 回忆 `item_started` 的 toolName；诊断保留真实工具名。 |
| 新 `stream_event` 消费者只处理 `item_*` 或只处理旧版信封 | 拒绝；在旧版 runtime 消失前必须同时处理两种形状。 |
| 冒烟“绿”但用量为零且增量呈错误形状 | 不是通过：LLM 错误回合把错误文本作为增量流出；要求真实流式输出且 usage > 0。 |

### 5. 良好/基准/反例案例

- 良好：goose 事件全部通过共享翻译器以 `{runtime:'goose', ...AgentEvent}` 到达；预热门禁、用量记账与控制输出捕获（`item_delta`）不变可用。
- 基准：原生配置的 runtime 保留自己的 LLM 凭据；daemon 只清除冲突的中继环境（`ANTHROPIC_*`...）并设置平台开关。
- 反例：新驱动发出 `assistant`/`user` 伪 Anthropic 帧以复用旧解析器。
- 反例：发布 daemon 接线而不更新 `frontend/lib/runtime-options.ts` —— runtime 存在，但没有用户能创建它。
- 反例：只数 `item_delta` 帧就当冒烟成功，而该回合实际是 LLM 错误。

### 6. 所需测试

- 单元：镜像 `test/acp-event-translator.test.mjs` 的翻译器测试；驱动生命周期；`runtime-activity.test.mjs` 的 AgentEvent 路径断言。
- 桥冒烟（真实二进制）：initialize（+能力元数据）-> createSession（验证编解码器编码）-> prompt（真实流式，usage > 0）-> loadSession（验证编解码器解码）。
- 隔离 daemon E2E（进程内 `DaemonCore` + 伪后端 + 隔离 HOME）：启动自启、带命名空间的会话 id、AgentEvent 流、结构化工具失败、按 agent 数据目录、并发实例与不同 agentId。
- 全栈 E2E + `./twd`：创建对话框显示并接受该 runtime -> 真实 agent 启动 -> DM 回复经 `aura message send` 到达 -> 活动显示 Working/Thinking/Output/Error 与带真实按回合 token 的 Idle，并与 `GET /api/v1/activity` 对账。

### 7. 错误 vs 正确

#### 错误

```typescript
// Per-turn prompt assembly (legacy buildCodexPrompt style, ~9k tokens/turn).
await bridge.prompt(sessionId, `${SYSTEM_PROMPT}\n\n${eventText}`);
// Private envelope to reuse an old parser.
emit('stream_event', { eventType: 'assistant', message: chunk });
```

#### 正确

```typescript
// Once at start(); marker-idempotent merge into workspace AGENTS.md.
await writeAgentInstructionsFile({ workspacePath, systemPrompt });
// Per turn: bare event text; shared translator owns the schema.
await bridge.prompt(sessionId, eventText);
emit('stream_event', { runtime: 'goose', ...translateAcpSessionUpdate(update) });
```

---

## 场景：TaskRun 状态、模板与时间戳

### 1. 作用域 / 触发

改动 TaskRun 状态字段、TaskRunTemplate 默认值或 TaskRun 生命周期时间戳时，
使用本规范。证据：任务 `06-25-taskrun-config-templates`（三透镜设计方向）与
`06-24-channel-taskrun-model`（时区感知规则）。

### 2. 签名

```text
TaskRun.status        # single enum column (models/slock.py):
                      # queued|dispatched|running|awaiting_input|completed|failed|cancelled
TaskRunTemplate       # user-editable preset; direct dispatch resolves config from one
```

### 3. 契约

- 当前表结构是单一 `status` 枚举列。06-25 的三透镜模型（目标 / runtime 会话 /
  参与者作为独立列，例如 `objective_status`）是设计方向，
  未实现 —— 今天不要读写 `objective_status`；
  按上面的枚举编码。
- 无论透镜模型如何演进：`completed` 绝不能销毁或脱离 runtime 会话 ——
  run 保持可恢复且可检查（证据重放、跟踪、
  游标审计）。
- 直接任务分发从 `TaskRunTemplate` 解析其配置；没有自由格式回退 ——
  模板缺失是调用方错误，不是默认值。
- 所有 TaskRun 生命周期时间戳都是时区感知的。绝不能写入 naive datetime，也不能
  拿它与 aware 的比较；naive/aware 混用会产生
  虚假的“失效”判定。

### 4. 校验与错误矩阵

- 直接分发时模板 id 缺失/未知 -> 4xx 调用方错误，无 TaskRun 行
- 生命周期字段中的 naive datetime -> 在写边界拒绝
- 未知状态值 -> 被列的 CheckConstraint 拒绝

### 5. 良好/基准/反例案例

- 良好：run 完成；runtime 会话空闲且保持附着；重新打开 run 会重放证据。
- 基准：从模板新建 run；状态按顺序走枚举。
- 反例：仅凭 runtime 退出推断 `completed`，或在完成时拆掉会话。

### 6. 所需测试

- 单元：模板解析失败产生 4xx 且不写行。
- 单元：naive datetime 写入在边界被拒绝。
- 集成：完成 run 后 runtime 会话存活且 run 可检查。

### 7. 错误 vs 正确

#### 错误

```python
run.objective_status = "completed"   # column does not exist (AttributeError)
run.done = runtime_exited            # folding lenses into one flag
run.finished_at = datetime.utcnow()  # naive timestamp
```

#### 正确

```python
run.status = "completed"             # the real enum column
run.finished_at = datetime.now(timezone.utc)  # tz-aware
# runtime session stays attached for evidence replay
```
