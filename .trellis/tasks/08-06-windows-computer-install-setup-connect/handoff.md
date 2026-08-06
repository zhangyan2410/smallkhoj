# Windows Computer 三阶段安装与连接：交接说明

**交接日期：** 2026-08-07
**当前分支：** `main`
**当前结论：** `IN_PROGRESS`。Mac 侧主体实现、managed standalone 安装/Setup、隔离候选上的真实 SmallKhoj + Claude 产品语义 Gate 已完成；Windows x64 实机验收仍未完成，因此本任务不能标记为完成。最新 Gate 证据见 `evidence/live-product-chat-gate-20260807-reconnect.json`。

> **Latest superseding recheck (2026-08-07):** 下方早期证据保留作历史记录，不能覆盖本段。当前实现已经切换到 managed macOS standalone：安装后的真实 Aura 使用私有 Node、生产依赖和本地 `sidecars/codex-acp/codex-acp`；重复执行同版本安装命令会输出 `already-installed; archive download skipped`，不要求用户手工 `export PATH`。在隔离数据库、当前 worktree backend/frontend 和安装后的 Aura 上，先停止旧隔离 daemon，再用 fresh reconnect ticket 执行安装后的 Aura 顶层连接命令，随后真实 Claude Code 产品语义 Gate 输出 `PASS product-chat-reply-claude 12/12`；最新证据见 `evidence/live-product-chat-gate-20260807-reconnect.json`。ACP 0.16.0 对用户配置中的 `model_reasoning_effort="max"` 由启动参数临时兼容为 `xhigh`，不改用户配置；真实 ACP `initialize` 已返回版本 `0.16.0`。Windows builder 现在也会在传入真实 PE sidecar 时打包 `codex-acp.exe`。仍未完成的是 Windows 原生 PE/实机验收；不要把本段 Mac 证据扩写成 Windows PASS。

本次 Gate 运行时记录的源候选为 `9f37401fa6d004fe5ab98d39344ba4e450a452d9`；Windows agent 拉取后仍必须重新执行 `git rev-parse HEAD`，并用自己的 HEAD 重建和发布产物，不要硬编码 Mac SHA。

distribution builder 要求 `sourceRevision` 等于当前 HEAD；Windows agent 必须在拉取后重新
构建并记录自己的 HEAD 和 artifact SHA，不要复用历史 Mac 产物 SHA。

## 已落地的主体实现

- 后端在 `backend/routers/public_api.py` 增加了 ticket-free 的 `connect-preview` / `reconnect-preview`，并返回结构化的 Windows PowerShell 与 macOS/Linux shell 命令；旧 Unix `command` 字段继续保留。
- Connect/Reconnect 才会创建 `sk_connect_` ticket，并返回 `expiresAt`；预览响应固定返回 `ticket: null`、`expiresAt: null`。
- `scripts/build_daemon_distribution.py` 支持 `win32-x64` / `win32-arm64` / `win32-x86` ZIP、`install.ps1`、版本目录、SHA-256、用户 PATH 和 active pointer。Mac 不伪造 PE `.exe`：Windows 构建必须由 Windows 侧提供真实 `node.exe` 与 `aura.exe`。
- daemon 新增平台路径与本地 Setup：Windows 默认使用 `%LOCALAPPDATA%\\Aura\\daemon`，machine ID 首次生成、重复 Setup 复用、显式 `--reset` 重新生成；`status --json` 报告实现类型、平台、架构和路径。
- Computers UI 改为互斥的 Windows / macOS/Linux tabs，并展示 Install → Setup → Connect 三阶段；Connect/Reconnect 才有显式 ticket action；重连路径只展示 Connect。
- 新增可访问的共享 `Tabs` atom、真正按 locale 切换的双语文案、阶段/复制/过期/Online/失败状态和回归 test IDs；中文 onboarding 不再把英文阶段名或 `Terminal` 作为括号注释混入引导。
- onboarding 可读性调整：关键说明/命令为 16px 前景墨色，阶段/标签加粗，电脑名称输入框为全宽 44px 高并与步骤卡片对齐；对话框支持垂直滚动且禁止横向溢出。
- 前端规范已把旧的“一条可复制命令”契约改成平台互斥三阶段契约。

## Mac 侧已验证

以下验证在当前 checkout 执行并通过；完整命令与结果摘要见 [macos-evidence.md](./macos-evidence.md)。

| 层 | 结果 |
|---|---|
| daemon TypeScript build | PASS |
| daemon build + 本任务平台路径测试 | PASS（平台路径 3/3） |
| daemon 全量 runtime suite（隔离 Aura 状态目录） | PASS（307/307；此前 502 是宿主持久 credential 指向失效临时端口，详见 `evidence/daemon-runtime-recheck.md`） |
| backend command/preview + server-context tests | PASS（12/12 + 26/26，含 preview 不写 DB 的测试） |
| distribution builder tests | PASS（8/8，含 PE 头拒绝） |
| frontend full tests / typecheck / ESLint | PASS（273/273；onboarding/i18n 窄测 6/6；typecheck PASS；0 errors，1 个既有 warning） |
| frontend production build | PASS（使用本地临时构建变量；仅有 Better Auth base URL warning） |
| `aura status --json` CLI contract | PASS（stdout 为单个 JSON；停止状态仍 exit 1；回归 2/2） |
| 真实产品语义 Integration Gate（隔离候选，安装后的 Aura + Claude Code） | PASS，`product-chat-reply-claude 12/12`；同一 channel marker/ACK、`aura message send`、Online lease 和 artifact identity 全部对账通过 |
| `git diff --check` | PASS |

历史 UI/runtime 候选曾通过 backend `/docs`、frontend `/`、Integration Gate 51/51 和
WebDriver `tabId=1617513010`；这些报告中的服务身份必须按历史候选阅读。当前 `main` 另用
当前 worktree 的 FastAPI `backend/main.py`（`uvicorn main:app --lifespan off`，PID 69302，cwd
`/Users/code/project/smallkhoj/backend`）在 `http://127.0.0.1:8000` 提供 carrier 路由，并完成了
真实安装器验证；`--lifespan off` 只用于下载/安装测试，不代表数据库 API、注册或 Online 通过。
前端可读性/locale 最终证据见 `evidence/computers-readable-final-{zh,en}-eval.json` 与对应 PNG。

路径测试曾在 Mac 上用 `platform: "win32"` + POSIX 临时目录生成过 4 个反斜杠文件；`paths.ts` 已修复，异常文件已删除，并新增断言防止再次污染 checkout。

## 最新真实产品语义 Gate（Mac 隔离候选）

本段是当前 Mac 侧最重要的运行证据；它不是 fake server，也不写共享宿主
PostgreSQL `127.0.0.1:5432`：

- 候选身份：worktree `/Users/code/project/smallkhoj`，测试时 `HEAD=9f37401fa6d004fe5ab98d39344ba4e450a452d9`；隔离 DB 容器 `smallkhoj-gate-db`（host `55433`），backend `http://127.0.0.1:18080`，当前 worktree frontend `http://127.0.0.1:3000`。
- 安装身份：`/tmp/smallkhoj-aura-gate/bin/aura`，`AURA_INSTALL_ROOT=/tmp/smallkhoj-aura-gate`，版本 `0.2.6`，artifact SHA-256 `181f729a8dcc71fade56a41d5ef4d6de80c4ccc04e35d7143ac3019161da00f6`。
- 真实连接命令：停止旧隔离 daemon 后向同一候选申请 fresh reconnect ticket，执行安装后的顶层 `aura --server-url http://127.0.0.1:18080 --api-key <REDACTED_CONNECT_TICKET>`，输出 `[Aura] Connected and running in background`；随后 `aura status --json` 为 `connected=true`、`online=true`。
- 真实对账：Server `30c7a5ab-b4e8-4899-ad36-2c54b19a3b0b`、Computer `2fdd7635-4572-4b3f-b23b-eecd106b6b4c`、fresh daemon `569607ab-52c7-4c01-95f1-2b226ad44029`、Claude Agent `47a5dc52-ec6d-432b-af4d-379d325065c8` 和 channel `gate-lab` 均来自同一候选；安装版本、artifact、Computer、daemon lease、online、runtime kind 全部为 `true`。
- 唯一 marker `REAL_PRODUCT_CLAUDE_GATE_20260807_042628` 的 human 消息被真实 Claude Code 收到，并在同一 channel 持久化可见 `ACK REAL_PRODUCT_CLAUDE_GATE_20260807_042628`；runtime timeline 含 delivered/thinking/tool-output/`aura message send`/idle。此次复跑同时验证了产品 Gate 的 Claude 作者、完整 ACK 和 message-send 目标绑定。
- Gate 输出：`PASS product-chat-reply-claude 12/12`；完整脱敏 JSON 在 [`evidence/live-product-chat-gate-20260807-reconnect.json`](./evidence/live-product-chat-gate-20260807-reconnect.json)。报告有一个非阻塞 `CONTEXT_EVIDENCE_MISSING` warning，但 `ok=true`、12 个产品语义步骤全部通过。

隔离复跑时若未把 `AURA_INSTALL_ROOT` 传给已安装 launcher，`aura status` 会读取宿主旧
`~/.smallkhoj/daemon`，Gate 会准确失败为 `AURA_COMPUTER_MISMATCH`。这次先修正测试状态根后
重新执行并得到上述 PASS；Windows 侧运行真实安装器时应使用默认用户状态根，并在证据中记录
launcher/config root，避免把不同候选的身份混在一起。

## 历史安装器证据（保留，不作为最新结论）

以下段落记录的是早期 `node-npx`/PATH-export 候选。最新 managed standalone 结果以本文件顶部
的 superseding recheck 为准；Windows 侧不要据此复现旧的 `export PATH` 命令。

使用历史候选 commit 构建的 `darwin-arm64` 0.2.6 产物已放入本机
`release-artifacts/smallkhoj-daemon/`，并由 backend 的 StaticFiles 路由实际提供。manifest
记录：`sourceRevision=0b6222202921001e88d6aec159410ad54543edb6`、archive SHA-256
`8fbd0052d5e0de6fee286266f7bac657d29b43302c99bdb2a60fd1f0c62a859a`。marker
`REAL_macos-daemon-path-fix-8000_20260807002251` 的真实证据包括：

- 用户原始 `curl -fsSL ... | ... bash` 形状真实执行，install/manifest/archive 均 HTTP 200，installer 内置 checksum 校验通过；修复后的产品命令在同一终端追加 `&& export PATH="$HOME/.smallkhoj/bin:$PATH"`；
- `/tmp/.../bin/aura --version` 输出 `0.2.6`，版本目录含 `aura`、`smallkhoj-daemon`、`dist`、`node_modules` 和 manifest；
- 两次 `aura setup` 复用同一 machine ID，未创建 credential；
- `aura status --json` 输出可直接 `JSON.parse` 的单一 JSON 文档，`implementationType=node-npx`、`darwin/arm64` 和路径均落在临时 root，daemon 未运行时 exit 1 是预期状态码。
- 用同一个安装出来的 launcher 对随机端口 fake upstream 完成 connect ticket → machine token → register → 15 秒 heartbeat（`status=online`），并确认 Connect credential 复用 Setup machine ID；详见 `evidence/macos-setup-real-8000_20260806234756.md`。这是协议层 fake-upstream PASS，不是云端 Online PASS。

该 Mac archive 的 manifest 明确 `standalone=false`、`requires.node=>=20`；它证明 Unix/macOS
下载链路，不是 Windows PE 或无 Node 环境的证明。`release-artifacts/` 被 `.gitignore` 忽略，
约 191 MB 的 archive 是生成/发布输入，禁止提交到 Git；Windows 侧需从当前 `main` 重新构建
`win32-x64` 真实 PE 并把对应 carrier 产物发布到后端镜像。

## 尚未完成、必须由 Windows 侧继续

请按 [windows-acceptance.md](./windows-acceptance.md) 在真实 Windows x64 主机执行并把脱敏证据放入 `evidence/`：

1. 用原生 API/PowerShell 记录 CPU 架构、PowerShell 版本、PATH，以及是否预装 Node/npm/npx。
2. 在无 Node/npm/npx 的干净用户环境执行 `install.ps1`，验证 `%LOCALAPPDATA%\\Aura`、版本目录、`node.exe`、`aura.exe`、sidecar、manifest/checksum、PATH 和 `aura --version`。
3. 执行 Setup，验证名称、machine ID、配置/credential ACL、重启后幂等复用，以及显式 reset 只在需要时换 ID。
4. 用新 ticket 执行首次 Connect，确认服务器 Computer Online/heartbeat；停止后用 Reconnect 验证最新兼容版本和原 machine ID/配置复用。
5. 验证旧 daemon/Node daemon 与 active lease 冲突、stale lease 的 graceful stop（不得 force kill）、升级、禁止隐式降级、下载失败恢复和显式 rollback。
6. 发布真实 Windows manifest 后，确认 Web Windows tab 从 unavailable warning 恢复为三阶段命令；未发布 manifest 时必须保持 fail-closed，不复制残缺命令。

Windows 侧在证据完成前不要把 `task.json.status` 改成 `completed`，也不要声称“Windows acceptance 通过”。

## 当前已知边界

- 当前 Mac checkout 只有 `darwin-arm64` release manifest；Windows manifest 仍 unavailable，后端 UI 应继续 fail-closed，不能复制残缺 PowerShell 命令。
- `127.0.0.1:8000` 当前是从本 worktree 启动、关闭 lifespan 的 FastAPI carrier 候选，仅用于证明 StaticFiles 下载路由；没有启动数据库 lifespan，因此不能把它写成完整 backend/API/Online 通过。
- 早期临时 Python 静态服务器已停止；它只能证明文件能被 HTTP 取到，不能作为 backend route 证据。
- 初始 preflight/历史 runtime 报告中的旧端口与候选 commit 不代表当前 main；若复跑 daemon suite，应使用隔离的 `AURA_INSTALL_ROOT` / `SLOCK_AGENT_CREDENTIAL`，避免宿主旧 credential 把 fake upstream 重定向到失效端口。
- 本地自动化没有替代 Windows 实机门槛；任何 `.exe`、PATH、ACL、升级/回滚和进程/lease 结论都必须来自 Windows 主机输出。
- Connect 命令含一次性敏感 ticket。证据只保留脱敏命令（例如把 token 替换为 `<REDACTED_CONNECT_TICKET>`），不要把原始 token 写进截图、URL、日志或提交。

## 运行中值得关注的问题（历史记录与最新处置）

### 1. daemon 首次 502 / timeout

直接复用宿主用户状态运行 daemon suite 时，`/internal/agent-api/server`
和 `/internal/agent-api/send` 曾出现 HTTP 502、`fetch failed` 及等待超时。
`~/.smallkhoj/daemon/credential.json` 中的旧 server endpoint 指向已失效的临时
端口，测试因此没有命中自己创建的 fake upstream。这是宿主状态污染，不是当前
backend `:8000` 的代码失败。使用隔离的 `AURA_INSTALL_ROOT`、
`SLOCK_AGENT_CREDENTIAL`、`AAA_DAEMON_MACHINE_ID_FILE` 后，daemon 全量回归为
307/307 PASS；以后复跑必须保持隔离。

### 2. `@zed-industries/codex-acp@0.16.0` 的 exit 127（历史观察；当前路径已修复）

日志里的 `No such file or directory` 来自负向测试
`agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs:1522`：测试显式启动一个
会在创建 session 前打印该字符串并以 127 退出的假 ACP 子进程，断言 daemon
不得把它标记为 ready；它不是默认 Mac standalone 启动失败的证据。

当前 managed standalone 已把 ACP 0.16.0 作为 release-owned sidecar 放在
`sidecars/codex-acp/codex-acp`，通过绝对路径优先启动；sidecar 缺失时
`codexAcpReadiness()` 会 fail-closed，真实 ACP `initialize` 和本次 Claude 产品 Gate
均已通过。开发/兼容入口仍允许 npx fallback，但不属于安装后的 Aura 产品路径。Windows
发布必须提供真实 PE `codex-acp.exe`，并在无网络/无 npx 的干净主机上记录
`aura doctor`、registry/cache、PATH 和 ACP stderr；如果 sidecar 缺失，应报告可操作错误，
不能把 Codex 宣传为 ready。

### 3. `status --json` 曾混入人类文本（已修复）

真实安装验证第一次执行时发现，CLI 会在 JSON 后继续向 stdout 打印
`Daemon is not running`，严格 JSON 解析因此失败。`main.ts` 已在 commit
`26a506cfb464c5a3e43d1775918ee1b6e356fe57` 修复：`--json` 现在只输出一个 JSON
文档，同时保留 running=0/stopped=1 的退出码语义；新增 CLI 回归后 daemon 全量套件为
307/307 PASS。Windows 侧应保留对“纯 JSON + 非运行 exit 1”的断言。

## 建议的 Windows 交接顺序

```text
fetch main → 在 Windows 生成真实 node.exe/aura.exe → 构建并发布 ZIP + manifest
    → install.ps1 → setup（幂等）→ Connect（fresh ticket）→ Online/heartbeat
    → stop → Reconnect（复用 machine ID）→ 冲突/升级/回滚 → 填 evidence
```

Windows 证据完成后，再由负责人复核 PRD R13 和 Acceptance Criteria，最后更新任务状态；Mac 同候选真实 UI/runtime 证据已经在本次交接中补齐。
