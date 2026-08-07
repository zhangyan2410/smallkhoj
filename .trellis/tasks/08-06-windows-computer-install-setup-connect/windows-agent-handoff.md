# Windows 端代理交接（2026-08-07）

> 接手人请先 `git pull --ff-only origin main` 并 `git rev-parse HEAD` 确认基线。
> 本文件是会话内交接快照，不是 Mac 端 handoff.md 的替代。

## 当前 git 状态

- **分支**：`main`，HEAD = `7a684028bcdf1b23e566632a7546bc9ad6f17e77`
- **tracked 改动（未提交）**：仅 `scripts/build_daemon_distribution.py`（已落地，见下）
- **untracked（已产出，未提交）**：
  - `tools/aura-launcher/`（go.mod, main.go, aura-launcher.exe）—— 真实 win32-x64 PE 启动器，可用
  - `.trellis/tasks/08-06-windows-computer-install-setup-connect/evidence/REAL_windows-computer-install-setup-connect_20260807020416-{preflight,install,setup}.txt` —— 已通过的实机证据
- **未保留的改动**：`backend/routers/public_api.py` 的 `DAEMON_ARTIFACT_DIR` 常量化、两个测试文件的隔离修复，在拉取 Mac 新代码后**丢失**，需要重新应用（见「待办 A」）。
- **release-artifacts/**：当前是 02:32 用**旧版** build_daemon 构建的产物（不含 MAX_PATH 修复），需用修复后的构建器重建。

## 主机环境（已验证，可在证据中复用）

- Windows 10.0.18363 x64，`PROCESSOR_ARCHITECTURE=AMD64`，PowerShell 5.1 Desktop
- Node v22.14.0（`C:\Program Files\nodejs\node.exe`，合法 win32-x64 PE，含 npm/npx）—— 用作私有 runtime
- Go 1.24（`GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build` 直接产出 PE，零 C 依赖）
- Python 3.13（**无 alembic**，无法起完整 backend；用最小 StaticFiles carrier 验下载）
- 端口 8000 被用户自己的 uv-Python backend 占用（PID 25984/27528），**不要动**
- 有一个最小 carrier 脚本在 `%LOCALAPPDATA%\aura-carrier.py`（端口 8011，仍在跑），mount `release-artifacts/smallkhoj-daemon` → `/downloads/smallkhoj-daemon`

## 已完成（有证据）

### 1. Go 启动器 `aura.exe`（PASS，可复用）
- 源码 `tools/aura-launcher/main.go` + `go.mod`，已编译 `aura-launcher.exe`（1.86MB，MZ/PE x64 已验证）
- 逻辑：定位自身目录 → 找同目录 `node.exe` → exec `node.exe dist/cmd/main.js <args>`，设 `AURA_STANDALONE=1`，透传 stdio + 退出码
- 构建命令：`cd tools/aura-launcher && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o aura-launcher.exe .`
- 实机验证：`aura.exe --version` → `0.2.6`；`aura.exe status --json` → 单个可解析 JSON，stopped exit 1，`implementationType=aura-standalone`

### 2. 构建侧 Windows 兼容性修复（已落到 `scripts/build_daemon_distribution.py`）
Mac 端在 macOS 上**无法发现**这些 Windows 专属 bug，均已实机确认：

| 修复 | 位置 | 根因 | Mac 是否修 |
|---|---|---|---|
| **`resolve_command` npm/npx 解析** | `run_command` + `create_npm_package` | Windows `CreateProcess` 不搜 PATHEXT，`npm`/`npx` 是 `.cmd` shim，直接 spawn 报 WinError 2 | 否 |
| **install.ps1 逐条目解压** | `write_windows_install_script` | PS 5.1 `Expand-Archive` + `extract\<rootName>\node_modules\...` 超 MAX_PATH(260) | 否 |
| **剥离非运行时声明文件** | 解压循环 | `.d.ts`/`.map`/`dist-types`/`dist-es` 等 AWS SDK 深路径文件超 MAX_PATH，且 daemon 运行不需要 | 否 |
| **短 TEMP staging** | `$staging` 改到 `[IO.Path]::GetTempPath()\aura-stage-<12hex>` | LOCALAPPDATA 下 `.staging-<32hex>` 后缀 + node_modules 超 MAX_PATH | 否 |
| **`aura.cmd` CRLF** | `$launcherLines` 数组替代单引号 `` `r`n `` 字面 | Mac 写的单引号字符串里反引号不转义，`Set-Content` 写出字面 `` `r`n ``，cmd.exe 无法执行 | 否 |

- 这些修复**全部是 Windows 兼容性最小补丁**，不改产物契约（manifest/install.ps1 关键字不变）、不改 Mac 路径、不改共享 CLI。已通过 `test_build_daemon_distribution` 8/8（旧 HEAD 验证过；新 HEAD 重建后需复跑）。
- **Mac 端大改了 build_daemon_distribution.py（622 行，managed standalone/sidecar/validate_deps）**，我的修复是叠加在它们之上的 install.ps1/run_command 区域，**不冲突**。

### 3. 实机 Install（PASS，marker `REAL_windows-computer-install-setup-connect_20260807020416`）
- 隔离 LOCALAPPDATA + 剥离系统 nodejs 的 PATH，执行 `irm install.ps1 | iex`
- `INSTALL_EXIT=OK`，`%LOCALAPPDATA%\Aura\versions\v0.2.6-win32-x64\` 含 aura.exe/node.exe/aura.cmd/manifest.json/dist/cmd/main.js/node_modules
- `bin\aura.cmd` 正确，`active.json` 正确，用户 PATH 含 Aura bin
- **`aura --version` rc=0 out=`0.2.6`**（bin/aura.cmd + direct aura.exe 都 OK）
- 证据：`evidence/REAL_windows-computer-install-setup-connect_20260807020416-install.txt` + `-preflight.txt`
- ⚠️ 这份证据是用**旧版** install.ps1（02:32 产物）跑的，但旧版也含我手动应用的 MAX_PATH/aura.cmd 修复，所以结论成立；重建后建议复跑一次留最新证据。

### 4. 实机 Setup（PASS）
- `aura setup --name` 首次 rc=0，生成 machine ID `70b88cfa-...`，config.json 写入，**credential.json 不存在**（Setup 不创建 token）
- 第二次 setup：**machine ID 复用**，name 可更新但 ID 不变（幂等）
- `--reset`：**machine ID 轮转**
- `aura status --json` stopped：**rc=1，单个可解析 JSON**，`implementation=implementationType=aura-standalone`，`platform=win32`，`architecture=x64`，路径全落 `%LOCALAPPDATA%\Aura\daemon`，**stdout 无 `Daemon is not running` 残留**
- 证据：`evidence/REAL_windows-computer-install-setup-connect_20260807020416-setup.txt`

## 待办（接手清单）

### A. 重新应用丢失的 backend/测试修复（高优先，约 10 分钟）
拉取后丢失，需重做：
1. `backend/routers/public_api.py`：把 line ~344 的 `artifact_dir = Path(__file__).resolve().parents[2] / "release-artifacts" / "smallkhoj-daemon"` 提成模块常量 `DAEMON_ARTIFACT_DIR`（加在 `SESSION_COOKIE_NAME` 附近），函数内改用常量。**目的**：发布真实 win32 manifest 后，`test_windows_release_metadata_fails_closed_without_published_manifest` 不再因真实 release-artifacts 有 manifest 而误失败——让该测试用 `monkeypatch` + `tmp_path` 指向空目录。
2. `backend/tests/test_daemon_command_generation.py::test_windows_release_metadata_fails_closed_without_published_manifest`：加 `tmp_path` 参数 + `monkeypatch.setattr(public_api, "DAEMON_ARTIFACT_DIR", tmp_path)`。
3. `scripts/tests/test_build_daemon_distribution.py`：所有 `tempfile.TemporaryDirectory()` 加 `ignore_cleanup_errors=True`（Windows 上 npm 残留句柄致 teardown WinError 32；Mac 无影响）。
4. 跑回归确认：`python -m pytest scripts/tests/test_build_daemon_distribution.py backend/tests/test_daemon_command_generation.py -q -o "addopts=" -p no:cacheprovider`（本机无 alembic，backend 用 `-o addopts=` 绕过 Django；CI 上正常跑）。需装 `pytest-asyncio>=0.24.0` 才能跑 backend 的 async 测试。

### B. 重建 win32-x64 产物（高优先）
Mac 端 build_daemon 已大改（managed standalone + codex-acp sidecar + validate_deps），需在修复后的构建器上重建：
1. 准备 runtime 目录：`%LOCALAPPDATA%\aura-build-runtime\` 含 `node.exe`（拷自 `C:\Program Files\nodejs\node.exe`）+ `aura.exe`（`tools/aura-launcher/aura-launcher.exe` 改名）
2. ⚠️ **新需求**：Mac 交接要求 Windows 提供真实 PE `codex-acp.exe` sidecar（`--codex-acp-binary`）。需确认：当前 Windows 有无 Codex CLI 的 PE？若无，构建会跳过 sidecar，ACP 走 npx fallback（交接文档说安装后路径优先 sidecar，缺失则 fail-closed）。**这是 Connect/doctor 验收的开放风险点**，见 D。
3. `python scripts/build_daemon_distribution.py --root . --output-dir release-artifacts/smallkhoj-daemon --platform win32-x64 --windows-runtime-dir "$LOCALAPPDATA/aura-build-runtime" --clean-output-dir --json`
4. 注意：`sourceRevision` 必须等于当前 HEAD。

### C. 重跑 Install + Setup（中优先，留最新证据）
用 B 重建的产物 + carrier(8011) 在隔离 LOCALAPPDATA 复跑 install.ps1 → setup → status。命令模板见 evidence/install.txt 的脚本。预期 PASS（逻辑同旧版，只是 manifest sha 变）。

### D. Connect / Online（核心未完成项）
**协议已就绪**：`aura --server-url <url> --api-key <sk_connect_ticket>` → `[Aura] Connected and running in background` → `aura status --json` 应为 `connected=true, online=true`。
- **现成模板**：`agent/daemon/aaa-daemon/test/managed-connect.test.mjs`（Mac 新增）——里面有 fake/real upstream 的 connect→register→heartbeat 断言。**先读这个文件**，它定义了要满足的协议形状。
- 两条路径可选：
  1. **fake-upstream**（与 Mac 历史证据一致，`macos-install-real-8000` 那条是 fake-upstream PASS）：写 Node http server 桩 ticket 交换 + register + heartbeat。Mac 文档说这是"协议层 PASS，不是云端 Online PASS"。
  2. **真实 backend**：本机 8000 端口有用户的 uv-backend（可能带 DB），但**不要假设它属于本任务/不要乱碰**。如要用真实 backend，需确认它有 DB lifespan + 能发 connect ticket。
- **credential.json ACL**：Connect 成功后验证 `%LOCALAPPDATA%\Aura\daemon\credential.json` 的 ACL 仅当前用户（`icacls` 摘要，不提交 token）。
- 脱敏：所有 `sk_connect_`/`sk_machine_` → `<REDACTED_...>`。

### E. Reconnect / 冲突 / 升级 / 回滚（PRD R13.4 必测）
- Reconnect：`aura stop` → 用新 ticket 重连 → 复用原 machine ID/名称/配置
- 冲突：活跃进程/lease 冲突拒绝重复启动；stale 进程 + 过期 lease 只 graceful stop（不 force kill）
- 升级：新版本下载→SHA256→原子切换→旧版本保留到新进程健康
- 回滚：显式 rollback 允许降级，machine ID/配置/credential 不被覆盖
- ⚠️ **能力缺口**：install.ps1 当前实现了 staging→原子切换，但**升级/回滚/lease 冲突的 CLI 入口和 active.json 版本协商逻辑可能不完整**。需读 Mac 新增的 `src/platform/daemon-state.ts` + `main.ts` 的 connect/restart/doctor 看哪些已实现、哪些是 PRD 要求但代码缺失。如实记录 BLOCKED，不要谎称通过。

### F. ACP / codex-acp.exe / doctor 环境验证（交接点名风险）
- `aura doctor` 命令已存在（main.ts:710）。在干净环境记录 Node/npm/npx/registry/cache/ACP stderr。
- ⚠️ Mac 交接明确：ACP 0.16.0 现作为 release-owned sidecar（`sidecars/codex-acp/codex-acp`）绝对路径优先启动；**Windows 必须提供真实 PE `codex-acp.exe`**，否则 sidecar 缺失时 `codexAcpReadiness()` fail-closed。需确认 Windows 上有无 Codex 的 PE——若无，记录为 BLOCKED 而非谎报 ready。

### G. 提交证据 + 更新文档
- evidence/ 补：`<marker>-connect.txt`、`-reconnect.txt`、`-upgrade-rollback.txt`、`-summary.md`（命名见 `evidence/README.md`，marker 沿用 `REAL_windows-computer-install-setup-connect_20260807020416` 或新建）
- 更新 `handoff.md`「尚未完成、必须由 Windows 侧继续」章节记录 Windows 结果
- `task.json.status` **保持 `in_progress`**，不要擅自标 completed（负责人最终复核 PRD R13）

## Windows 侧接手进度(2026-08-07,D 步骤 fake-upstream Connect 协议层)

### D. Connect / Online — fake-upstream 协议层 PASS ✅(实机)
- 基线复核:`git rev-parse HEAD` = `7a684028bcdf1b23e566632a7546bc9ad6f17e77`(与交接一致),`dist/cmd/main.js` gitignored。
- 重建:`cd agent/daemon/aaa-daemon && npx tsc`(exit 0,源码无未提交改动,dist 反映 HEAD)。
- 照模板跑:`node --test test/managed-connect.test.mjs` → **2/2 PASS**(`# pass 2 # fail 0`,exit 0)。
  - happy path:`setup --name --server-url` rc 0 → `--server-url --api-key` rc 0,stdout 含 `Connected and running in background`,断言 connect + register 均命中;`daemon-state.json` `status=online`,`daemonId/activeDaemonId/computerId/serverId` 与上游回包一致;`status --json` `implementationType=aura-standalone`、`connected=true`、`online=true`。
  - reject path:上游 `/register` 返 503 → 子进程 exit≠0,stderr/stdout 含 `registration|server|Aura`,`daemon-state.json` `status=error`、`lastError` 匹配 `registration|503`。fail-closed 符合预期。
- 隔离与清理:测试用 `isolatedEnv()` 把 INSTALL_ROOT/CONFIG/CREDENTIAL/PID/STATE/LOG/WORKSPACE 全指向 `os.tmpdir()` 下临时根,`AURA_CONNECT_TIMEOUT_MS=5000`;finally `stopChildFromState` + `rmSync` 清理。本机复核:Win32_Process 查 `cmd/main.js`/`aura-managed` 命令行 0 匹配(无孤儿 daemon),`tmpdir` 下 `aura-managed-connect*` 为空集。
- 边界遵守:未改 `main.ts`/`install.sh`/共享 CLI;未触及端口 8000 用户 backend;未提交 `release-artifacts`/原始 token;`task.json.status` 保持 `in_progress`。
- 定位声明:此为 **fake-upstream 协议层 PASS**(上游是测试内 Node http server),与 Mac 历史 `macos-install-real-8000` 系列 fake-upstream 同类,**非云端 Online PASS**。真实云端/真实 backend Connect、credential.json ACL(icacls 摘要)、D 的 reconnect/升级/回滚(E/F)仍开放,由负责人最终复核 PRD R13。
- 证据:`evidence/REAL_windows-computer-install-setup-connect_20260807020416-connect.txt`(带头部说明 + 完整 TAP)。
- 脱敏:测试内 `sk_connect_managed_connect`/`sk_machine_managed_connect` 等均为 fixture 常量,非真实凭据。

### 待续(本会话未覆盖,移交后续)
- A(backend/test 丢失修复)、B(重建 win32 产物)、C(重跑 Install+Setup 留最新证据)、E(reconnect/升级/回滚)、F(ACP/doctor)、G(汇总)。

## 主代码续作复核（2026-08-07，Windows 交接后的共享实现）

交接中的 E 项判断已由主代码复核并实现，不能再视为 Windows-only blocker：

- 新增 `aura rollback --target-version <version>`，仅切换已安装且完整的 release pointer；运行中
  daemon 拒绝切换，Setup、machine-id、credential 保持原样。
- Unix/Windows installer 都记录 `previous.json`。Windows installer 现在拒绝隐式降级、同版本完整
  安装跳过归档下载，使用读取 active pointer 的稳定 launcher，并在激活前执行 `aura.exe --version`
  健康探针；旧 active 版本目录保留用于恢复。
- Connect preview/command 先做远端 lease preflight，agent connect 的 409 也携带结构化
  `DAEMON_LEASE_ACTIVE`（过期时间与 stop/wait/retry 动作）；CLI/UI 显示可操作恢复提示，ticket 不
  在冲突前创建或消费。
- `readJsonRecord` 对 UTF-8 BOM 做防御性容错，避免 PowerShell 5.1 状态文件让 doctor 误报。

这些是共享源码修复，Windows 主机仍需用拉取后的最新 HEAD 重建真实 `win32-x64` carrier，并复跑
§2–§6 的 rollback/升级失败恢复/lease 提示证据；本地 Node/Python 回归不能替代该实机门槛。

## 边界与红线

- **不碰** `agent/daemon/aaa-daemon/src/cmd/main.ts` 命令注册（Mac 已实现 setup/restart/connect/status/doctor/stop）、Unix `install.sh` ensure 逻辑、共享 CLI。我的 install.ps1/run_command 改动是 Windows 兼容补丁，已避开这些区域。
- **不提交** `release-artifacts/`（gitignored，~80MB+）。
- **不提交** 任何 `sk_connect_`/`sk_machine_` 原始 token。
- **不动** 端口 8000 的用户 backend。
- `tools/aura-launcher/` 是否入库由负责人定；它是构建输入，目前 untracked。

## 关键文件索引
- 启动器源：`tools/aura-launcher/main.go`
- 构建器（我改）：`scripts/build_daemon_distribution.py`（`resolve_command` ~line 67；`write_windows_install_script` ~line 790）
- Connect 协议模板：`agent/daemon/aaa-daemon/test/managed-connect.test.mjs`
- daemon 状态：`agent/daemon/aaa-daemon/src/platform/daemon-state.ts`
- CLI 命令表：`agent/daemon/aaa-daemon/src/cmd/main.ts`（doctor:710, restart:577, connect:622）
- 已过证据：`evidence/REAL_windows-computer-install-setup-connect_20260807020416-{preflight,install,setup}.txt`
- carrier 脚本：`%LOCALAPPDATA%\aura-carrier.py`（端口 8011）
