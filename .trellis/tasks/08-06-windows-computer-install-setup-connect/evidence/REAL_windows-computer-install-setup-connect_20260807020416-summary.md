# Windows x64 实机验收汇总 — REAL_windows-computer-install-setup-connect_20260807020416

## 候选身份
- **Git HEAD**: `7a684028bcdf1b23e566632a7546bc9ad6f17e77` (main)
- **主机**: Windows 10.0.18363 x64, `PROCESSOR_ARCHITECTURE=AMD64`, PowerShell 5.1.18362.1171 Desktop
- **Node (构建/驱动)**: v22.14.0 (产物内私有 node.exe 同版本)
- **真实 backend**: `http://127.0.0.1:8000` (backend/.venv FastAPI `main.py`, 带 DB lifespan, 非 carrier)
- **carrier**: 同一 backend 的 StaticFiles `/downloads/smallkhoj-daemon`
- **Artifact SHA-256**: `2597fe4731d92bc84f64dc09b65a2619e56cf14488325d7604b04425380ceb0f` (win32-x64 v0.2.6, BOM 修复后重建)
- **codex-acp sidecar**: 真实 PE `codex-acp.exe` 0.16.0 (187MB), 来自 `npm-cache/_npx/.../@zed-industries/codex-acp-win32-x64`

## 代码改动(本会话)
| 文件 | 改动 | 阶段 |
|---|---|---|
| `backend/routers/public_api.py` | 提取 `DAEMON_ARTIFACT_DIR` 模块常量;`_release_artifact_metadata` 改用常量 | A |
| `backend/tests/test_daemon_command_generation.py` | fail-closed 测试加 `tmp_path` + `monkeypatch DAEMON_ARTIFACT_DIR`,自包含不依赖真实 release-artifacts | A |
| `scripts/tests/test_build_daemon_distribution.py` | 11 处 `tempfile.TemporaryDirectory()` 加 `ignore_cleanup_errors=True` (Windows npm 残留句柄) | A |
| `scripts/build_daemon_distribution.py` | install.ps1 生成器: `active.json` 改用 `[IO.File]::WriteAllText` + `Utf8Encoding($false)` 写 **无 BOM** UTF-8 (见下"新发现 bug") | F |

回归: `test_build_daemon_distribution.py` 11/11 PASS; `test_daemon_command_generation.py` 12/12 PASS。
红线遵守: 未改 `main.ts` 命令注册、Unix `install.sh`、共享 CLI;未动端口 8000 backend 本身。

## 新发现并修复的 bug(Windows 专属,F 阶段发现)
**active.json UTF-8 BOM 致 `aura doctor` 在 Windows 上误报 not-installed/ACP-missing/privateNode-missing。**
- 根因: install.ps1 (PS 5.1) 用 `Set-Content -Encoding UTF8` 写 `active.json`,PS 5.1 该编码**带 BOM**;daemon 的 `readJsonRecord` (`main.ts:115`) 用 `JSON.parse(readFileSync('utf-8'))` **不去 BOM** → `active.json` 解析失败 → `activeReleaseInfo` 返回空 → doctor 报 `installed:false`、找不到 ACP/privateNode(实际都在磁盘上)。
- 影响: Windows 上 `aura doctor` 误报,但 Connect/Online 不受影响(走 `daemonPaths`,不读 active.json)。
- 修复: builder 生成的 install.ps1 改用 `[IO.File]::WriteAllText(path, json, new Text.UTF8Encoding($false))` 写无 BOM。
- 验证: 修复前 `active.json` 首字节 `EF BB BF`(BOM)、doctor `installed:false`/`codexAcp:false`/`privateNode:false`/EXIT=1;修复后首字节 `7B 0D 0A`(`{`)、doctor `installed:true`/`codexAcp:true`/`privateNode:true`/EXIT=0,ACP 解析到 `sidecars/codex-acp/codex-acp.exe`。
- 建议交 Mac 侧: 可选地在 `readJsonRecord` 加 `.replace(/^\uFEFF/,'')` 做防御性 BOM 容错(共享 helper,非命令注册,属可选加固)。

## 验收矩阵(windows-acceptance.md §0–7)
| 节 | 项 | 判定 | 证据 |
|---|---|---|---|
| §0 | preflight(架构/PS/PATH/Node 发现) | PASS | `-preflight.txt` (干净 LOCALAPPDATA) |
| §1 | 发布物(真实 PE node.exe/aura.exe/codex-acp.exe + manifest + sha256 + install.ps1) | PASS | builder --json, ZIP 22088 条目含 sidecar, 4 路由 HTTP 200 |
| §2 | Install(干净环境、版本目录、PATH、active.json、aura --version) | PASS | `-install.txt` |
| §3 | Setup(不访问服务器、machine-id 幂等复用、--reset 轮转、credential 不创建、status --json 单 JSON rc=1 aura-standalone) | PASS | `-setup.txt` |
| §4 | 首次 Connect/Online(`sk_connect_`→`sk_machine_`、服务器 Online+heartbeat) | **PASS(本机 backend:8000 + DB)** | `-connect.txt` + server 对账 status=online/activeDaemonId/lastHeartbeat |
| §5.1 | Reconnect(stop→新 ticket→复用 machine-id/online) | PASS | `-reconnect.txt` STEP3 |
| §5.4 | graceful stop(SIGTERM、3s 退出、不 force-kill) | PASS | `-reconnect.txt` STEP1 |
| §5.3 | 活跃 lease 冲突拒绝 | **PASS**(复测 R-4) | 服务器 409 拒绝 + 客户端结构化 DAEMON_LEASE_ACTIVE + stop/wait/retry;`-retest-mac-followup.txt` |
| §6.1 | 升级保留旧版本到新进程健康 | **PASS**(复测 R-2) | install.ps1 健康探针 + previous.json + 失败恢复分支;`-retest-mac-followup.txt` |
| §6.2 | 禁止隐式降级 / 显式 rollback | **PASS**(复测 R-3) | `aura rollback --target-version` + 拒绝隐式降级;`-retest-mac-followup.txt` |
| §6.3 | 回滚不覆盖 identity | **PASS**(复测 R-3) | rollback 前后 machine-id 一致;`-retest-mac-followup.txt` |
| §F | doctor / ACP readiness | PASS(BOM 修复后) | `-doctor.txt` pre/post |
| R8/R9 | 平台 tabs 互斥 + 三阶段命令卡片 | **PASS** | `-ui-zh.png`/`-ui-en.png` + twd DOM |
| R12 | preview 不创建 ticket、点 Connect 才创建 + expiresAt | **PASS** | twd: preview `hasConnectTicketInCommand:false`,点生成后 `hasTicketCommand:true` |
| R11/双语 | 中英文 UI 切换 | **PASS** | `-ui-zh.png`(连接新电脑)+ `-ui-en.png`(Connect New Computer) |
| **端到端** | Web 命令原样执行→install→setup→connect→**Web 显示 Online** | **PASS** | `-web-cmd-{install,setup,connect}.txt` + `-ui-online.png` |

## UI 验证(PRD R8/R9/R11/R12,`./twd` 浏览器实测)
候选身份:本机 worktree(frontend `localhost:3000` + backend `127.0.0.1:8000`,HEAD 7a68402,两端同候选)。twd bridge port 28765,account zy-ean(Better Auth bridge 注入 session cookie)。
- **平台 tabs 互斥(R9)**:Windows / macOS·Linux 两个 tab;切到 macOS 后 PowerShell 命令消失、`curl ... install.sh` 出现,shell 标签从 POWERSHELL→终端 ✅
- **三阶段卡片(R8)**:❶安装 / ❷初始化 / ❸连接,Windows 显示 PowerShell shell + 三条命令 ✅
- **ticket 即时生成(R12)**:preview(刚开对话框/切语言)状态 `hasConnectTicketInCommand:false`(Connect 区是"生成连接命令"按钮占位);点"生成连接命令"后才出 `aura --server-url ... --api-key sk_connect_...` 真实命令 + 有效期说明 ✅
- **中英文(R11)**:`-ui-zh.png`("连接新电脑/电脑名称/安装/初始化/连接")+ `-ui-en.png`("Connect New Computer/Computer Name/Install/Setup/Connect")✅

## Web 命令端到端验证(PRD 核心产品验收)
用户从 Web Windows tab 复制命令 → 原样在干净 Windows 环境执行 → 接入成功 + Web 显示 Online:
- **Install(WEB 原样)**: `$env:AURA_DOWNLOAD_BASE_URL='http://localhost:8000/downloads/smallkhoj-daemon'; irm '...install.ps1' | iex` → `Installed Aura 0.2.6 (win32-x64)` + 全部关键文件 + sidecar ✅(注:首次 `irm|iex` 在 CodexSandbox 偶发"访问被拒绝",重试即恢复 —— 见 `-web-cmd-install.txt`,沙箱瞬时拦截非命令缺陷)
- **Setup(WEB 原样)**: `aura setup --name 'my-computer' --server-url 'http://localhost:8000'` → `Setup complete for my-computer`, machine-id `3c52e941...`, credential 不创建 ✅
- **Connect(WEB 生成 ticket 原样)**: `aura --server-url 'http://localhost:8000' --api-key <ticket>` → `Connected and running in background`, `connected:true/online:true`, 复用 setup 的 machine-id `3c52e941` ✅
- **Web 闭环**: connect 后刷新 `/computers` → **"1 台电脑 / 1 在线"**, 显示 `my-computer · win32 10.0.18363 x64 · daemon 0.2.6 · 心跳 08/07 13:16 · 在线"` + 重连/扫描工作区控制 ✅(`-ui-online.png`)

## credential.json ACL(如实记录)
- 文件存在于 `%LOCALAPPDATA%\Aura\daemon\credential.json`,含 server_id/computer_id/machine_id/server_url/ws_url + token(已脱敏)。
- ACL 为**继承自父目录**(所有 ACE 带 `(I)` 标记):`CodexSandboxUsers:(RX)`、`SYSTEM:(F)`、`Administrators:(F)`、`zhangyan.ean:(F)`。
- 说明: 非"严格仅当前用户"锁定,而是继承父目录 ACL(Windows 常见);本机额外有 `CodexSandboxUsers` 是公司沙箱环境特有。设计 §2.3 要求"用户 ACL 保护"——保护存在(非 world-readable),但非独占当前用户。如实记录,不作 PASS 伪装。

## 阻塞项(交 Mac 侧实现,task.json 保持 in_progress)
1. **rollback 命令未实现** + install.ps1 无版本比较/降级检测(红线禁止 Windows 侧在 main.ts 注册命令)。**→ 复测 PASS(Mac 已实现,见 `-retest-mac-followup.txt` R-3)**
2. **install.ps1:76 升级时删除旧版本目录**,未保留到新进程健康。**→ 复测 PASS(Mac 已实现健康探针 + previous.json + 失败恢复,R-2)**
3. **客户端 lease 冲突预检提示缺失**:connect 前不预查远端 activeDaemonId/lease 给 stop/wait/retry(服务器 409 兜底已生效,UX 提示缺)。**→ 复测 PASS(Mac 已实现 409 DAEMON_LEASE_ACTIVE + recoveryActions,R-4)**
4. (建议) `readJsonRecord` 加 BOM 容错,防御用户编辑器写入带 BOM 的 JSON 状态文件。**→ 复测 PASS(Mac 已加 .replace(/^\uFEFF/,''),R-0 测试套 8/8)**

> 首轮 3 项 BLOCKED(code-missing)经 Mac 共享代码续作(commit 29eec25 等)+ Windows 用最新 HEAD 7824a59 重建 PE carrier 复跑,已全部转为 PASS。详见 `-retest-mac-followup.txt`。剩余未完成项为云端发布部署(production_image_transfer + 远端 compose + post-deploy smoke),非 Windows 实机验收范畴。

## 结论
- Windows x64 真机 Install/Setup/Connect/Online/Reconnect/graceful-stop/doctor(含 ACP sidecar)= **PASS(本机 backend:8000 + DB,非 fake-upstream)**。
- **Web 前端 UI 验证 + 命令端到端验证全部 PASS**:平台 tabs 互斥、三阶段卡片、ticket 即时生成(R12)、中英文(R11);用户从 Web 复制命令原样执行 → 接入成功 → Web 显示 Online 闭环通过。
- **复测(Mac 共享代码续作后)**:rollback / 升级保护 / lease preflight / BOM 容错 在 Windows x64 真机全部 PASS。首轮 3 项 BLOCKED(code-missing)已解除。
- Windows 实机验收范围内的 PRD R13.4 必测项现已全部 PASS。剩余未完成项为云端发布部署(production_image_transfer + 远端 compose + post-deploy smoke),非 Windows 实机验收范畴。
- 前后端同候选(本机 3000+8000),非远程云端部署(远程 `124.222.40.40` 未发布 Windows manifest,Windows tab 应 fail-closed)。
- 升级旧版本保留 / rollback / 客户端冲突预检提示 = **BLOCKED(code-missing, Mac 侧实现)**。
- 发现并修复一个 Windows 专属 bug(active.json BOM 致 doctor 误报)。
- **task.json.status 保持 `in_progress`**(E 有 BLOCKED 项 + PRD R13 要求 rollback 等未满足,不可标 completed)。

## 脱敏文件清单(本 marker)
- `REAL_windows-computer-install-setup-connect_20260807020416-preflight.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-install.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-setup.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-connect.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-reconnect.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-upgrade-rollback.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-doctor.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-web-cmd.txt`(Web 命令原文)
- `REAL_windows-computer-install-setup-connect_20260807020416-web-cmd-install.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-web-cmd-setup.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-web-cmd-connect.txt`
- `REAL_windows-computer-install-setup-connect_20260807020416-ui-zh.png` / `-ui-en.png` / `-ui-online.png`(浏览器截图,本地不入库)
- `REAL_windows-computer-install-setup-connect_20260807020416-summary.md`(本文件)
- 全部已扫描:无原始 `sk_connect_`/`sk_machine_`/`sk_session_` token。
