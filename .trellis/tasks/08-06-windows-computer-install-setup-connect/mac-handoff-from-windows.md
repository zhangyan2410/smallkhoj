# Mac 侧交接（从 Windows 验收，2026-08-07）

> 写给：继续本任务（`windows-computer-install-setup-connect`）的 Mac 侧 agent。
> Windows 侧已完成真实主机 daemon 实机链 + Web UI/命令端到端验收（PASS），并改动了**共享构建器**；本文档列出 Mac 侧需要知道/接手的事项。
> Windows 侧完整证据与逐项结论见 `evidence/REAL_windows-computer-install-setup-connect_20260807020416-summary.md`。

## 1. Windows 侧已改动的共享文件（Mac 拉取后请注意）

`scripts/build_daemon_distribution.py` 被 Windows 侧改动了三处区域，**全部是 Windows 兼容补丁，对 Mac 是 no-op**（`sys.platform=='win32'` 守卫 + `write_windows_install_script` 专属）。Mac 若改同区域注意合并：

| 区域 | 行（改动后） | 改动 | 对 Mac 影响 |
|---|---|---|---|
| `resolve_command` | ~67 | Windows `CreateProcess` 不搜 PATHEXT，`npm`/`npx` 是 `.cmd` shim；用 `shutil.which` 解析。非 win32 直接 pass-through | 无（非 win32 走 pass-through） |
| `create_archive` 内 `npm pack` | ~417 | 同上，`npm pack` 调用包了 `resolve_command` | 无（Mac 上 `shutil.which('npm')` 仍返回原值） |
| `write_windows_install_script` | ~806–907 | install.ps1：逐条目 ZipFile 解压（绕 MAX_PATH 260）、剥离 `.d.ts/.map/dist-types/dist-es`、短 TEMP staging `aura-stage-<12hex>`、`aura.cmd` 数组+ASCII 写真 CRLF、**`active.json` 用 `[IO.File]::WriteAllText` + `Utf8Encoding($false)` 写无 BOM** | 无（仅生成 install.ps1 文本，Mac 路径/install.sh 不变） |

**BOM 修复是 Windows 实测发现的真实 bug**（详见第 3 节），已在 install.ps1 端修；Mac 侧可选在 reader 端加防御性容错（第 4 节）。

`backend/routers/public_api.py`（提 `DAEMON_ARTIFACT_DIR` 模块常量）、`backend/tests/test_daemon_command_generation.py`（fail-closed 测试加 `tmp_path`+`monkeypatch`）、`scripts/tests/test_build_daemon_distribution.py`（11 处 `TemporaryDirectory(ignore_cleanup_errors=True)`）—— 纯重构/测试隔离，无行为变化，回归绿。

## 2. Windows 侧验收结论（PASS / BLOCKED）

候选身份：本机 worktree（frontend `localhost:3000` + backend `127.0.0.1:8000` + DB lifespan，HEAD `7a68402`）。**非远程云端**（远程 `124.222.40.40` 未发布 Windows manifest）。

**PASS**：preflight（干净 `%LOCALAPPDATA%`）、Install（真实 PE `node.exe`/`aura.exe`/`codex-acp.exe` sidecar）、Setup（machine-id 幂等 + `--reset` 轮转 + credential 不创建）、Connect/Online（本机 backend + DB，`sk_connect_`→`sk_machine_`，服务器侧 status=online/activeDaemonId/lastHeartbeat 对账）、Reconnect（lease 过期后复用 machine-id + 新 daemonId）、graceful stop（SIGTERM 3s、不 force-kill）、doctor（BOM 修复后 ACP/privateNode ready）、**Web UI**（平台 tabs 互斥 R9、三阶段卡片 R8、ticket 即时生成 R12、中英文 R11）、**命令端到端**（Web 复制命令原样执行 → install→setup→connect → Web 显示"1 台电脑/1 在线"闭环）。

**BLOCKED（code-missing，必须 Mac 实现，见第 4 节）**：rollback 命令、升级保留旧版本、客户端 lease 冲突预检提示。

## 3. Windows 实测发现的真实 bug（已从 install.ps1 端修复）

**active.json UTF-8 BOM 致 `aura doctor` 在 Windows 误报。**
- 根因：install.ps1（PS 5.1）`Set-Content -Encoding UTF8` 写 `active.json` 时**带 BOM**；daemon `readJsonRecord`（`agent/daemon/aaa-daemon/src/cmd/main.ts:115`）用 `JSON.parse(readFileSync(path,'utf-8'))` **不去 BOM** → `active.json` 解析失败 → `activeReleaseInfo` 返回空 → doctor 报 `installed:false`、找不到 ACP/privateNode（实际都在磁盘上）。
- 影响：仅 Windows、仅 doctor 误报；Connect/Online 不受影响（走 `daemonPaths`，不读 active.json）。
- Windows 侧修复：`build_daemon_distribution.py` 生成的 install.ps1 改用 `[IO.File]::WriteAllText(path, json, new Text.UTF8Encoding($false))` 写无 BOM。
- 验证：修复前 `active.json` 首字节 `EF BB BF`（BOM）、doctor EXIT=1/`installed:false`/`codexAcp:false`/`privateNode:false`；修复后首字节 `7B 0D 0A`（`{`）、doctor EXIT=0/全 true、ACP 解析到 `sidecars/codex-acp/codex-acp.exe`。证据 `evidence/REAL_windows-computer-install-setup-connect_20260807020416-doctor.txt`。

## 4. Mac 侧待办（code-missing 阻塞项 + 建议）

### 4.1 必须实现（PRD R13.4 / acceptance §5–6 必测项，Windows 红线禁止动 main.ts 命令注册）

1. **`rollback` 命令**：当前 `aura` 无 rollback/downgrade/force 子命令，`install.ps1` 硬编码单一版本、无版本比较。需在 `main.ts` 注册 `rollback`（或 `--force`/`--downgrade`），并加 semver 比较 + "本地高于服务器默认拒绝降级，显式 rollback 才允许"。Windows 侧已验证拒绝路径（acceptance §6.2/6.3 当前直接 BLOCKED）。
2. **升级保留旧版本到新进程健康**：`install.ps1:76` `if (Test-Path $versionRoot) { Remove-Item ... -Recurse -Force }` 在 stage 新版本后、move 前直接删整个旧版本目录。需改成"stage→校验→原子切 active.json→**保留旧版本目录**直到新进程健康→清理"（acceptance §6.1）。
3. **客户端 lease 冲突预检提示**：`launchManagedDaemon`（`main.ts:237`）connect 前只查本地 pid（`isDaemonRunning`），不预查远端 `activeDaemonId`/`leaseExpiresAt` 给 stop/wait/retry 可操作提示；当前靠服务器 409 兜底（Windows 实测：lease 有效时重连被服务器 409 拒绝，客户端 surface 为 `state.status=error` + `lastError` 匹配 409、exit 1——冲突保护**实际生效**，但 UX 缺显式提示，acceptance §5.3）。

### 4.2 建议加固（非阻塞）

4. **`readJsonRecord` BOM 容错**（`main.ts:115`）：加 `readFileSync(path,'utf-8').replace(/^\uFEFF/,'')` 防 BOM。Windows 已从 install.ps1 端修了 active.json，但共享 reader 加固能防用户用带 BOM 的编辑器手改 config/credential/manifest。属共享 helper，非命令注册。

### 4.3 Windows 侧观察（供 Mac 参考，非待办）

- **CodexSandbox 环境**：首次 `irm | iex` 偶发"对路径 Temp\aura-stage-xxx 的访问被拒绝"，**重试即恢复**（沙箱瞬时拦截，非命令/installer 缺陷）。证据 `-web-cmd-install.txt`。
- **credential.json ACL**：继承父目录（带 `(I)`），含本机特有的 `CodexSandboxUsers:(RX)` + `SYSTEM/Administrators:(F)` + 当前用户 `(F)`；非严格"仅当前用户"锁定，是部署环境差异，非代码缺陷。
- **路径**：daemon 已正确用 Windows 原生路径（`%LOCALAPPDATA%\Aura\daemon`），`win32` 平台前缀不与 x64 架构混淆。

## 5. 红线遵守（Windows 侧）

未改 `main.ts` 命令注册、Unix `install.sh`、共享 CLI；未动端口 8000 backend 本身（只用它做 Connect/Online 验收）；`release-artifacts/` 未提交（gitignored，~280MB）；所有 `sk_connect_`/`sk_machine_`/`sk_session_` token 在证据中脱敏（11 个证据文件 + 3 张截图全量扫描 clean）；`task.json.status` 保持 `in_progress`。

## 6. 文件索引
- Windows 实测证据：`evidence/REAL_windows-computer-install-setup-connect_20260807020416-*`（summary/install/setup/connect/reconnect/upgrade-rollback/doctor/web-cmd-*）
- Windows 会话快照（给下一个 Windows agent）：`windows-agent-handoff.md`
- 本文件（给 Mac agent）：`mac-handoff-from-windows.md`
- 正式交接（任务级）：`handoff.md`
- BOM bug 根因代码：`agent/daemon/aaa-daemon/src/cmd/main.ts:115`（reader）+ `scripts/build_daemon_distribution.py`（install.ps1 生成器，已修）
