# Windows Computer 三阶段安装与连接：交接说明

**交接日期：** 2026-08-06  
**当前分支：** `main`  
**当前结论：** `IN_PROGRESS`。Mac 侧主体实现、当前 `main` 的 daemon 产物下载/安装/Setup 验证和隔离后的 daemon 回归已完成；Windows x64 实机验收仍未完成，因此本任务不能标记为完成。实时证据见 `evidence/live-runtime-report.md`、`evidence/daemon-runtime-recheck.md`、`evidence/macos-install-real-8000_20260806234756.md` 和 `evidence/macos-install-path-fix-8000_20260807002251.md`。

当前源候选是 `0b6222202921001e88d6aec159410ad54543edb6`。此前 UI/runtime 报告里出现的
`4d02667139a2` 是历史候选，不应被 Windows 侧当作当前提交；可读性 UI 最后一轮来自其后的
`082616e3a84eef3c7437ff70d016b1a176d8cd53`。

这里的 SHA 指最新 Mac 安装产物实际使用的源码提交；此前的 26a artifact 只保留作历史
回归证据。本次交接文档可以随后形成一个 docs-only
提交，因此 Windows agent 必须以拉取后实际的 `git rev-parse HEAD` 作为自己的构建和证据
`sourceRevision`（distribution builder 要求该值等于当前 HEAD），不要硬编码上面的 Mac 产物 SHA。

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
| `git diff --check` | PASS |

历史 UI/runtime 候选曾通过 backend `/docs`、frontend `/`、Integration Gate 51/51 和
WebDriver `tabId=1617513010`；这些报告中的服务身份必须按历史候选阅读。当前 `main` 另用
当前 worktree 的 FastAPI `backend/main.py`（`uvicorn main:app --lifespan off`，PID 69302，cwd
`/Users/code/project/smallkhoj/backend`）在 `http://127.0.0.1:8000` 提供 carrier 路由，并完成了
真实安装器验证；`--lifespan off` 只用于下载/安装测试，不代表数据库 API、注册或 Online 通过。
前端可读性/locale 最终证据见 `evidence/computers-readable-final-{zh,en}-eval.json` 与对应 PNG。

路径测试曾在 Mac 上用 `platform: "win32"` + POSIX 临时目录生成过 4 个反斜杠文件；`paths.ts` 已修复，异常文件已删除，并新增断言防止再次污染 checkout。

## 当前 main 的真实安装器验证

使用当前 commit 构建的 `darwin-arm64` 0.2.6 产物已放入本机
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

## 运行中值得关注的问题（已核对，不要误判）

### 1. daemon 首次 502 / timeout

直接复用宿主用户状态运行 daemon suite 时，`/internal/agent-api/server`
和 `/internal/agent-api/send` 曾出现 HTTP 502、`fetch failed` 及等待超时。
`~/.smallkhoj/daemon/credential.json` 中的旧 server endpoint 指向已失效的临时
端口，测试因此没有命中自己创建的 fake upstream。这是宿主状态污染，不是当前
backend `:8000` 的代码失败。使用隔离的 `AURA_INSTALL_ROOT`、
`SLOCK_AGENT_CREDENTIAL`、`AAA_DAEMON_MACHINE_ID_FILE` 后，daemon 全量回归为
307/307 PASS；以后复跑必须保持隔离。

### 2. `@zed-industries/codex-acp@0.16.0` 的 exit 127

日志里的 `No such file or directory` 来自负向测试
`agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs:1522`：测试显式启动一个
会在创建 session 前打印该字符串并以 127 退出的假 ACP 子进程，断言 daemon
不得把它标记为 ready。它不是默认生产启动路径，因此 Mac 侧 307/307 回归没有
证明产品缺少这个包。

但这揭示了 Windows 发布的真实前提：`agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts`
默认通过 `npx -y @zed-industries/codex-acp@0.16.0` 动态解析；该包不在 daemon
`package.json` / lockfile 或发行 tgz 的 `files` 中。已有 nested-npx selector 清理
及 Windows `npx.cmd`/注册表 PATH fallback，但没有专用离线缓存或 preflight。Windows
若首次运行无网络、npm cache 未预热、registry 不可达或 PATH 解析异常，仍可能真实
得到 exit 127/启动失败。Windows 验收必须记录 Node/npm/npx、registry/cache、PATH
和 ACP 启动 stderr，并决定“安装时预热”或“明确离线策略”，不能把该风险写成已解决。

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
