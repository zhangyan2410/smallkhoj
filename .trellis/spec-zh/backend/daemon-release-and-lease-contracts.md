# Daemon 发布与租约（Lease）契约

> 跨后端、CLI 与 UI 的可执行契约（contract）：Aura 发布指针、安装器恢复、显式回滚（rollback）与 daemon 租约冲突预检。

## 场景（Scenario）：可恢复的 Aura 发布激活与感知租约的连接

### 1. 作用域（Scope）/ 触发条件

当改动 Aura 安装器、稳定启动器、发布选择/回滚、计算机 Connect/Reconnect 预览或命令生成、daemon connect 409 处理，或计算机 onboarding 状态表面时，使用本 spec。

### 2. 签名

```text
aura rollback --target-version <installed-semver>

python3 scripts/production_image_transfer.py \
  --task-scoped --task-id <trellis-task-id> ...

<install-root>/active.json
<install-root>/previous.json
<install-root>/versions/v<version>-<platform>/

POST /api/v1/computers/connect-preview
POST /api/v1/computers/{computer_id}/reconnect-preview
POST /api/v1/computers/connect-command
POST /api/v1/computers/{computer_id}/reconnect-command
POST /internal/agent-api/daemon/connect
```

租约冲突详情：

```json
{
  "reasonCode": "DAEMON_LEASE_ACTIVE",
  "message": "...",
  "computerId": "uuid",
  "activeDaemonId": "uuid-or-null",
  "leaseExpiresAt": "ISO-8601-or-null",
  "retryAfterSeconds": 42,
  "recoveryActions": ["stop", "wait", "retry"]
}
```

### 3. 契约

- `active.json` 是唯一的活动发布指针。稳定的 Windows `aura.cmd`/`aura.ps1` 启动器在调用时读取它；它不得内嵌版本目录。
- 在激活另一个完整发布之前，安装器会原子地把旧活动指针拷贝到 `previous.json`。下载、解压、manifest 检查、校验和或 `aura --version` 探测失败时，旧指针与旧发布目录仍可用。
- 普通安装拒绝隐式降级。显式恢复安装需要 `SMALLKHOJ_DAEMON_FORCE=1` 或 `AURA_DAEMON_FORCE=1`；普通用户回滚用 `aura rollback --target-version`，且只能选择安装根内已安装、完整的发布。
- 回滚要求 daemon 已停止，且绝不改写 Setup 配置、机器 ID 或凭证文件。被离开的版本保持已安装，操作可逆。
- PowerShell JSON 指针用无 BOM 的 UTF-8。读取方防御性地剥掉一个前导 BOM，使 PowerShell 5.1 或用户编辑器无法让 `status`/`doctor` 错误分类一个已安装发布。
- 预览端点返回 `connectPreflight`，不创建也不消费 ConnectTicket。当具名计算机有活动租约时，命令端点在票据创建之前以 HTTP 409 与上述结构化详情失败。
- `/internal/agent-api/daemon/connect` 使用同一 409 原因码。daemon CLI 必须呈现 stop/wait/fresh-ticket/retry 指引，且不得在被拒绝的交换后持久化机器凭证。
- 前端 server action 同时接受旧式 `{detail: string}` 与结构化 `{detail: {message}}` 错误。onboarding 表面在 `connect-status-region` 渲染活动租约警告；它不得退化为裸 `HTTP 409`。
- `recoveryActions` 是有序标识符，不是可执行命令。客户端可以本地化其显示文本，但必须保持 stop -> wait -> retry 顺序。
- 功能性任务作用域镜像传输必须同时带 `--task-scoped` 与已存在的 `--task-id` 选择加入。其发布证据记录 `deploymentScope.type=task-scoped` 与 `capacityClaim=not-asserted`；它不能用作正式容量或首次发布证据。正式传输保留被接受的 `--capacity-report` 路径。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 目标版本缺失、不完整、在安装根之外或 semver 无效 | 拒绝回滚；活动指针与凭证保持不变。 |
| 回滚期间 daemon PID 活跃 | 拒绝并指引用户运行 `aura stop`；绝不强杀。 |
| 本地活动版本比安装器目标新 | 除非设置显式恢复强制标志，否则拒绝。 |
| 新 Windows 可执行文件 `aura --version` 失败 | 如有已被替换的目标目录则恢复；不切换 `active.json`。 |
| 同一完整版本已活动 | 刷新稳定启动器并跳过归档下载。 |
| 预览看到活动服务器租约 | 返回 `connectPreflight.ok=false`；创建零票据。 |
| Connect/Reconnect 命令看到活动租约 | HTTP 409 `DAEMON_LEASE_ACTIVE`；创建/消费零票据。 |
| daemon 收到结构化活动租约 409 | 非零退出并带 stop/wait/fresh-ticket/retry 指引；不持久化凭证。 |
| UI 收到结构化活动租约 409 | 在 `connect-status-region` 显示本地化消息，而不是 `HTTP 409`。 |
| 任务作用域传输缺失/混用其门禁标志或引用不存在的任务 | 在任何 SSH/Docker 命令之前拒绝。 |

### 5. 好/基准/坏案例

- 好：暂存并探测 v0.2.7，保留 v0.2.6 及其指针，原子激活 v0.2.7，然后显式回滚到仍完整的 v0.2.6。
- 好：预览一台在线计算机，显示租约到期/恢复警告，并在任何凭证存在之前拒绝票据生成。
- 基准：旧式后端返回 `{detail: "Computer already has an active daemon"}`；前端仍显示该文本，而结构化客户端从升级后的服务器获得更丰富的恢复元数据。
- 坏：在探测新可执行文件之前删除旧版本、把版本硬编码进 `aura.cmd`、先创建票据再返回 409，或只向用户显示 `HTTP 409`。

### 6. 必需测试

- daemon CLI 测试切换已安装指针，保留 Setup/机器/凭证状态与旧目录，拒绝缺失/不完整目标，拒绝运行中的 daemon，并容忍 `active.json` 中的 BOM。
- 安装器生成器/集成测试断言版本比较、无隐式降级、同版本零归档下载、稳定感知指针的启动器、激活前健康探测、`previous.json` 与失败暂存恢复。
- 后端测试断言预览无票据、活动租约返回精确结构化字段、命令拒绝发生在票据创建/消费之前、过期租约仍允许新票据。
- daemon connect 测试断言结构化 409 消息与无持久化凭证状态。
- 前端类型检查/测试覆盖 `connectPreflight`；基于标记的 `./twd` 证据断言在确切候选标签页的 `connect-status-region` 中可见本地化文本。
- Windows x64 真机验收重建最新 PE 载体并演练升级、失败升级恢复、显式回滚与租约 stop/wait/retry。

### 7. 错误 vs 正确

#### 错误

```text
download -> delete current version -> move new files -> write version-specific aura.cmd
active lease -> create ticket -> HTTP 409 "conflict"
```

#### 正确

```text
download -> verify -> stage -> probe -> preserve previous pointer -> atomic activate
active lease -> structured preflight/409 before ticket creation -> stop/wait/retry UI
```

---

## 场景：WebSocket 注册处的单活动 daemon 租约强制

### 1. 作用域 / 触发条件

当改动 daemon WS 端点（`/internal/agent-api/ws`）、`DaemonControlHub` 连接处理、daemon 重连策略，或 `active_daemon_id` / `daemon_lease_expires_at` 字段时，使用本 spec。触发背景：2026-08-16 事故——六个持有同一机器凭证的 daemon 进程各保持一条 WS 连接，每次 `push`/`push_events` 都对每条连接投递一份（一条用户消息产生六条回复）。连接时预检（场景 1）不覆盖直接重连到 `/ws` 的 daemon。

### 2. 签名

```text
services.daemon_control.DaemonControlHub.add_exclusive(computer_id, websocket, event_cursor) -> list[WebSocket]
GET /internal/agent-api/ws?daemonId=<process-uuid>
WS control frame: {"type": "lease.revoked", "reason": "superseded_by_new_daemon" | "lease_taken_over"}
WS close code 4001  # lease revoked / taken over
daemon exports: isLeaseRevokedMessage(input): boolean, LEASE_REVOKED_CLOSE_CODE = 4001
```

### 3. 契约

- 每台计算机一条 WS 连接，在注册时强制：`add_exclusive` 替换任何既有 peer 并返回它们；端点向每个被替换的 socket 发送 `lease.revoked` 帧（尽力而为）并以代码 4001 关闭。
- 当 `daemonId` 存在时，WS 注册无条件认领租约（最新实例获胜）：`active_daemon_id = daemonId`、`daemon_lease_expires_at = now + DAEMON_LEASE_SECONDS`、`last_heartbeat_at = now`、`status = "online"`，在首次命令/事件投递之前提交。不带 `daemonId` 的连接不得替换活动租约持有者——立即以 4001 关闭且绝不进入 hub。
- 运行时控制命令（`start_runtime` / `cancel_turn` / …）与事件推送按构造只到达唯一活动连接；不存在以后要加的按命令路由决策。
- 心跳（heartbeat）（`activity`/`ack`）的 `daemonId` 已把租约输给更新实例时：服务器发送 `lease.revoked` 并以 4001 关闭，而不是跳过写入并留下僵尸消费者。
- daemon 侧：`lease.revoked` 消息或 4001 关闭 → 停止所有运行时、断开、退出，且不自动重连。重连会替换新持有者，并在两个受管实例之间开启接管乒乓（孤儿清理：`docs/orphan-daemon-cleanup.md`）。

### 4. 校验与错误矩阵

- 无 daemonId + 活动租约由另一 daemon 持有 -> 以 4001 关闭 "active lease held by another daemon"；hub 不受影响
- 对被替换 socket 的 send/close 抛错 -> 尽力忽略；hub 已丢弃它
- 心跳 daemonId ≠ active_daemon_id 且有活动租约 -> 通知 `lease.revoked` + 以 4001 关闭
- 同一 socket 重新注册（重连）-> displaced == []，租约原地刷新

### 5. 好/基准/坏案例

- 好：daemon 重启注册新 daemonId → 失效（stale）socket 被替换、租约转移、单次投递恢复，无重启竞态。
- 基准：单个健康 daemon → `add_exclusive` 对空集合是 no-op；行为不变。
- 坏：两个受管 daemon 都在 4001 后自动重连 → 接管循环；daemon 退出且不重连的契约正是打破循环的关键。

### 6. 必需测试

- `backend/tests/test_daemon_control.py::test_daemon_hub_add_exclusive_displaces_previous_websockets` — 被替换集合恰为先前 socket，且 `push` 恰好投递一次（只有活动 socket 收到）。
- `backend/tests/test_daemon_control.py::test_daemon_hub_add_exclusive_is_idempotent_for_same_socket` — 重新注册同一 socket 不替换任何连接。
- `backend/tests/test_daemon_control.py::test_agent_api_lease_helpers_still_guard_conflict_paths` — 对不同 daemonId 冲突为真，对持有者为假，租约过期后为假。
- `agent/daemon/aaa-daemon/test/daemon-lease.test.mjs` — `isLeaseRevokedMessage` 匹配裸/包装载荷并拒绝控制/运行时类型；关闭码常量为 4001。

### 7. 错误 vs 正确

#### 错误

```python
daemon_control_hub.add(computer.id, websocket, event_cursor)  # multi-connection hub
if _apply_daemon_ws_activity(computer, daemon_id, now):        # conflict → skip write
    await db.commit()                                          # zombie keeps consuming events
```

#### 正确

```python
for stale in daemon_control_hub.add_exclusive(computer.id, websocket, event_cursor):
    await stale.send_json({"type": "lease.revoked", "reason": "superseded_by_new_daemon"})
    await stale.close(code=4001, reason="superseded by new daemon")
# register claims the lease unconditionally (daemonId present); a later
# heartbeat conflict closes this socket with 4001 instead of skipping.
```

---

## 场景：daemon 优雅关闭端点

### 1. 作用域 / 触发条件

- 触发：改动 daemon 停止/退出生命周期、`POST /internal/agent-api/daemon/shutdown`、daemon 侧关闭钩子，或 daemon 退出时计算机/工作区/成员状态的释放方式。
- 根因背景（06-10 任务 `06-10-fix-daemon-stale-active-lease`）：在该端点之前，本地停止的 daemon 会留下仍活动的租约行，导致重连以 `409 Computer already has an active daemon` 失败，计算机页对离线/停止状态滞后。

### 2. 签名

```text
POST /internal/agent-api/daemon/shutdown
auth: machine credential (resolve_machine: Bearer sk_machine_* / X-Machine-* context)
body: {"daemonId": "<uuid>", "status": "offline"?}
guard: _daemon_shutdown_can_release(computer, daemonId) ->
       not computer.active_daemon_id or not daemonId or computer.active_daemon_id == daemonId
daemon hook: daemon.ts shutdownDaemonLifecycle() -> POST /daemon/shutdown before exit
```

### 3. 契约

- 认证是机器令牌（token）（与 connect/register/heartbeat 同一主体），绝不是 agent 或公共 key。
- 释放作用于上报 daemon id 的作用域：只有 `daemonId` 匹配 `active_daemon_id`（或未注册活动 id / 无 id）的关闭才可释放。不匹配的 id 是良性 no-op——HTTP 200 `{ok: true, ignored: true, reason: "active_daemon_id_mismatch"}` 且状态不变，使失效/落败的 daemon 无法把当前租约持有者踢下线。
- 合法释放会设置 `status = body.status or "offline"`、`active_daemon_id = None`、`daemon_lease_expires_at = now`、`last_heartbeat_at = now`，并标记该计算机的运行时为停止：处于 `running`/`active`/`idle`/`pending_start` 的工作区变为 `stopped`，带 `pid = None` 与 `stopped_at = now`；处于 `online`/`active`/`running`/`idle` 的 agent 成员变为 `offline`，每次转换发出常规成员状态事件 / 工作区活动。
- daemon 必须在优雅停止期间、退出之前调用该端点。无法到达后端时记录日志且非致命——daemon 仍然退出。
- 硬杀（SIGKILL、崩溃、断网）不在该端点覆盖范围；该路径中的失效租约只能由既有的租约过期兜底回收。不要"以防万一"地添加绕过 daemonId 守卫的关闭路径。
- register/heartbeat/connect 行为不变；该端点只释放，绝不认领。

### 4. 校验与错误矩阵

| 条件 | 预期行为 |
| --- | --- |
| 机器令牌有效，`daemonId == active_daemon_id` | 释放租约、计算机离线、工作区停止、成员离线、发出状态事件。 |
| `daemonId` 与仍活动的 `active_daemon_id` 不同 | HTTP 200 `ignored: true`，原因 `active_daemon_id_mismatch`；零状态变化。 |
| 计算机无 `active_daemon_id`（租约已过期） | 释放幂等（idempotent）进行；无错误。 |
| 优雅停止但后端不可达 | daemon 记录 `Daemon shutdown failed`，仍退出；租约稍后经兜底过期。 |
| daemon SIGKILL/崩溃 | 无关闭调用；租约过期是唯一回收者。 |

### 5. 好/基准/坏案例

- 好：`aura stop`/优雅退出以自己的 daemonId 调用 `/daemon/shutdown`；立即重连无 409 成功，计算机页及时显示离线 + 已停止工作区。
- 基准：被取代的旧 daemon 在新实例注册后关闭；其不匹配的 daemonId 被忽略，新持有者保持在线。
- 坏：任意已认证关闭都释放租约而不看 daemonId——僵尸会替换活的租约持有者。
- 坏：把关闭 POST 失败当作不退出的理由，或在该端点重新认领状态。

### 6. 必需测试

- 后端：合法关闭释放 active_daemon_id/租约/工作区/成员并发出状态转换；不匹配 daemonId 返回被忽略的信封（envelope）且零状态变化；非机器认证被拒绝。
- daemon：优雅停止在退出前以其 daemonId 发出 POST；网络失败记日志而不阻塞退出。
- 回归：关闭后重连不引发 `DAEMON_LEASE_ACTIVE` 409；并发的新租约在旧 daemon 关闭后存活。

### 7. 错误 vs 正确

#### 错误

```python
if machine_token_valid:
    computer.active_daemon_id = None      # any daemon can release any lease
    computer.daemon_lease_expires_at = now
```

#### 正确

```python
if not _daemon_shutdown_can_release(computer, body.daemonId):
    return {"ok": True, "ignored": True, "reason": "active_daemon_id_mismatch"}
# release scoped to the reporting daemon id; SIGKILL stays bounded by lease expiry
```
