# Windows Computer 三阶段安装与连接：交接说明

**交接日期：** 2026-08-06  
**当前分支：** `main`  
**当前结论：** `IN_PROGRESS`。Mac 侧主体实现、当前候选服务的真实运行/UI 验收和隔离后的 daemon 回归已完成；Windows x64 实机验收仍未完成，因此本任务不能标记为完成。实时证据见 `evidence/live-runtime-report.md` 与 `evidence/daemon-runtime-recheck.md`。

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
| daemon 全量 runtime suite（隔离 Aura 状态目录） | PASS（305/305；此前 502 是宿主持久 credential 指向失效临时端口，详见 `evidence/daemon-runtime-recheck.md`） |
| backend command/preview + server-context tests | PASS（12/12 + 26/26，含 preview 不写 DB 的测试） |
| distribution builder tests | PASS（8/8，含 PE 头拒绝） |
| frontend full tests / typecheck / ESLint | PASS（273/273；onboarding/i18n 窄测 6/6；typecheck PASS；0 errors，1 个既有 warning） |
| frontend production build | PASS（使用本地临时构建变量；仅有 Better Auth base URL warning） |
| `git diff --check` | PASS |

当前候选的真实运行门禁：backend `/docs` 与 frontend `/` 均返回 200；Integration Gate 51/51；WebDriver `tabId=1617513010`、`http://127.0.0.1:3000/computers` 的 DOM/eval/screenshot 证据已保存。前端可读性/locale 最终证据见 `evidence/computers-readable-final-{zh,en}-eval.json` 与对应 PNG。未把未知旧 tab 当作证据。

路径测试曾在 Mac 上用 `platform: "win32"` + POSIX 临时目录生成过 4 个反斜杠文件；`paths.ts` 已修复，异常文件已删除，并新增断言防止再次污染 checkout。

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

- 当前 Mac checkout 没有 Windows release manifest，后端会把 Windows 平台标为 unavailable；这是有意的 fail-closed 行为，不是伪造安装命令的理由。
- 初始 preflight 时 `127.0.0.1:3000`、`127.0.0.1:8000` 均未监听；随后已从当前 worktree 直接启动并证明候选身份（backend/frontend cwd、PID、健康响应）。因此不能再把“端口未启动”写成最终 Mac blocker；若复跑 daemon suite，应使用隔离的 `AURA_INSTALL_ROOT` / `SLOCK_AGENT_CREDENTIAL`，避免宿主旧 credential 把 fake upstream 重定向到失效端口。
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
305/305 PASS；以后复跑必须保持隔离。

### 2. `@zed-industries/codex-acp@0.16.0` 的 exit 127

日志里的 `No such file or directory` 来自负向测试
`agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs:1522`：测试显式启动一个
会在创建 session 前打印该字符串并以 127 退出的假 ACP 子进程，断言 daemon
不得把它标记为 ready。它不是默认生产启动路径，因此 Mac 侧 305/305 回归没有
证明产品缺少这个包。

但这揭示了 Windows 发布的真实前提：`agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts`
默认通过 `npx -y @zed-industries/codex-acp@0.16.0` 动态解析；该包不在 daemon
`package.json` / lockfile 或发行 tgz 的 `files` 中。已有 nested-npx selector 清理
及 Windows `npx.cmd`/注册表 PATH fallback，但没有专用离线缓存或 preflight。Windows
若首次运行无网络、npm cache 未预热、registry 不可达或 PATH 解析异常，仍可能真实
得到 exit 127/启动失败。Windows 验收必须记录 Node/npm/npx、registry/cache、PATH
和 ACP 启动 stderr，并决定“安装时预热”或“明确离线策略”，不能把该风险写成已解决。

## 建议的 Windows 交接顺序

```text
fetch main → 在 Windows 生成真实 node.exe/aura.exe → 构建并发布 ZIP + manifest
    → install.ps1 → setup（幂等）→ Connect（fresh ticket）→ Online/heartbeat
    → stop → Reconnect（复用 machine ID）→ 冲突/升级/回滚 → 填 evidence
```

Windows 证据完成后，再由负责人复核 PRD R13 和 Acceptance Criteria，最后更新任务状态；Mac 同候选真实 UI/runtime 证据已经在本次交接中补齐。
