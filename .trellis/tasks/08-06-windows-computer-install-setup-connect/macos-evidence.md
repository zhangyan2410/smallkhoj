# Mac 侧证据与限制记录

> **Latest superseding recheck (2026-08-07):** 本文件较早的 2026-08-06 记录保留作历史候选证据。当前主路径已是 managed standalone：真实安装命令无需手工 `export PATH`，第二次同版本执行跳过大归档；安装后的 Aura 包含私有 Node、生产依赖和本地 ACP sidecar。当前运行时 focused checks 为 16/16，builder/installer 为 15/15，Integration Gate 合同为 30/30；真实安装后的隔离 fake-server Setup → Connect → register → `status --json online=true` 通过。ACP 0.16.0 真实 `initialize` 通过，且对用户 `model_reasoning_effort="max"` 使用不修改配置的 `-c model_reasoning_effort=xhigh` 兼容覆盖。真实 SmallKhoj Online + Claude 产品语义 Gate 仍因候选身份/隔离数据库未建立而未执行，Windows 原生 PE/实机门槛仍未完成。

**日期：** 2026-08-06  
**当前源候选 commit：** `0b6222202921001e88d6aec159410ad54543edb6`（`main`）
**历史 UI/runtime 候选：** `4d02667139a2`；可读性 UI 最后一轮来自
`082616e3a84eef3c7437ff70d016b1a176d8cd53`。历史报告中的候选值不代表当前产物身份。

## 自动化回归（Mac checkout）

| 命令/范围 | 结果 |
|---|---|
| `cd agent/daemon/aaa-daemon && npm run build` | PASS |
| `cd agent/daemon/aaa-daemon && node --test --test-concurrency=1 test/*.test.mjs`（隔离 `AURA_INSTALL_ROOT`、`SLOCK_AGENT_CREDENTIAL`、`AAA_DAEMON_MACHINE_ID_FILE`） | PASS，307/307，0 failures，0 cancelled |
| `cd agent/daemon/aaa-daemon && node --test test/platform-paths.test.mjs test/daemon-version-source.test.mjs` | PASS，4/4 |
| `rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs` | PASS，51/51 |
| `pytest -q backend/tests/test_daemon_command_generation.py` | PASS，12/12（含 preview ticket-free 断言） |
| `pytest -q backend/tests/test_server_account_membership.py` | PASS，26/26 |
| `python -m unittest scripts.tests.test_build_daemon_distribution` | PASS，8/8（含 PE 头拒绝） |
| frontend full tests | PASS，273/273（其中 onboarding/i18n 窄测 6/6） |
| frontend typecheck / targeted ESLint | PASS |
| frontend production build | PASS（使用非开发临时 public API key 与本地构建值，未写入仓库） |
| `status --json` CLI 回归 | PASS，2/2；stdout 为单一 JSON，停止状态 exit 1 |
| Unix Install → PATH handoff regression | PASS；backend command 12/12、distribution builder 8/8；真实命令证据见 `evidence/macos-install-path-fix-8000_20260807002251.md` |
| `git diff --check` | PASS |

此前直接使用本机默认 credential 跑 runtime suite 时出现的 502，根因是用户状态目录中的旧 server endpoint 指向已失效临时端口，导致 fake-upstream 测试被重定向；不是历史候选 backend `:8000` 未启动。历史候选隔离套件为 305/305；当前 main 已重新跑到 307/307，详细诊断见 [daemon-runtime-recheck.md](./evidence/daemon-runtime-recheck.md)。

Windows 路径回归额外确认：在 `platform="win32"` 但 root 为 POSIX 临时目录的测试场景，配置路径现在保持在临时 root 下；仓库不再出现 `\\var\\folders...` 伪路径文件。

## 历史候选的真实服务与浏览器证据

先执行了真实测试上下文收集器。该轮 UI/runtime 服务记录属于历史候选
`4d02667139a2`，不能覆盖当前产物或 Windows 验收：

```text
rtk bash .agents/skills/smallkhoj-real-test/scripts/collect-context.sh
```

初始 collector 显示 3000/8000/38190/38191 均未监听，仅共享宿主 PostgreSQL `127.0.0.1:5432` 在监听；没有对 5432 做迁移、清理或写入。随后由验收代理从本 worktree 直接启动候选服务，并记录了身份：

- backend：`AUTH_BRIDGE_SECRET=… uv run python main.py`，cwd `/Users/code/project/smallkhoj/backend`，PID 19042/19045；
- frontend：`npm run dev`，cwd `/Users/code/project/smallkhoj/frontend`，为刷新当前 CSS 后的 Next PID 37305/37311；
- `http://127.0.0.1:8000/docs` 与 `http://127.0.0.1:3000/` 均返回 200。

使用项目 `./twd`（没有直接调用 Playwright）登录测试账号后，在同一 marker 采集：

- `tabId=1617513010`；`tabUrl=http://127.0.0.1:3000/computers`；
- 中文默认文案、Windows 与 macOS / Linux tabs、Install → Setup → Connect 阶段可见；
- preview 阶段没有 ticket/expiry；未选平台的命令不在 DOM；
- DOM：`evidence/computers-dom.json`；eval：`evidence/computers-eval.json`；截图：本机 `evidence/computers.png`（图片按仓库策略不入 git）。
- 对话框打开状态另有 `computers-dialog-dom.txt` / `computers-dialog-eval.json`；同一 tab 切到 Windows 后的 fail-closed 证据为 `computers-windows-dom.txt` / `computers-windows-eval.json`（对应 PNG 均为本地验证图片）。
- 可读性/locale 最终证据为 `computers-readable-final-zh-eval.json` 与
  `computers-readable-final-en-eval.json`（对应 PNG 仅本地保存）。中文只出现
  `安装 / 初始化 / 连接`、`终端` 和中文引导；切到 English 后同一 tab 只出现
  `Install / Setup / Connect`、`Terminal` 和英文引导。两种 locale 的电脑名称
  字段均为 829px × 44px、16px，和步骤卡片同宽。

Integration Gate 为 51/51；同一历史候选服务和 tab 的完整命令/输出摘要见
[live-runtime-report.md](./evidence/live-runtime-report.md)。

## 当前 main 的真实下载/安装证据

当前 commit `0b6222202921001e88d6aec159410ad54543edb6` 重新构建了
`darwin-arm64` 0.2.6，并将生成物放入 gitignored 的
`release-artifacts/smallkhoj-daemon/`。当前 FastAPI carrier 由
`uvicorn main:app --host 127.0.0.1 --port 8000 --lifespan off` 启动（PID 69302，cwd
`/Users/code/project/smallkhoj/backend`）；`/docs`、install script、manifest 和 archive
均从该 worktree 的 StaticFiles mount 返回 HTTP 200。它没有执行 lifespan/数据库初始化，
所以只证明下载 carrier，不证明完整 backend API 或 Online/heartbeat。

marker `REAL_macos-daemon-path-fix-8000_20260807002251` 真实执行了用户形状的
`curl -fsSL http://localhost:8000/downloads/smallkhoj-daemon/install.sh | ... bash`，并在
真实 `/Users/lee/.smallkhoj` 安装根和隔离 runtime root 下验证：

- `aura --version` 为 `0.2.6`；版本目录含 launcher、`dist`、`node_modules`、manifest；
- manifest `sourceRevision=0b6222202921001e88d6aec159410ad54543edb6`，archive SHA-256
  `8fbd0052d5e0de6fee286266f7bac657d29b43302c99bdb2a60fd1f0c62a859a`，通过 installer 的
  下载校验；
- 原始安装命令退出 `0` 但裸 `aura` 不在 PATH；修复后的 UI 命令追加 `&& export PATH="$HOME/.smallkhoj/bin:$PATH"`，同一终端 `command -v aura` 和 `aura --version` 均通过；
- 两次 Setup 复用同一 machine ID，未创建 credential；
- `status --json` 可直接解析为单 JSON，返回 `implementationType=node-npx`、`darwin/arm64`
  和隔离路径，daemon 未运行时 exit 1（预期）。
- 同一个安装出来的 launcher 对随机端口 fake upstream 完成 connect ticket → machine token → register → heartbeat(`online`)，并确认 machine ID 复用；这是协议层证据，不是云端 Online。

完整脱敏命令与输出见 [macos-install-path-fix-8000_20260807002251.md](./evidence/macos-install-path-fix-8000_20260807002251.md)、
[macos-install-real-8000_20260806234756.md](./evidence/macos-install-real-8000_20260806234756.md)
和 [macos-setup-real-8000_20260806234756.md](./evidence/macos-setup-real-8000_20260806234756.md)。

## Mac 上明确未执行的项目

以下不是 Mac 代码 blocker，而是必须交给 Windows 主机的硬件/发布门槛：

1. 真实 Windows x64/ARM64/x86 主机上的 `install.ps1`、`%LOCALAPPDATA%\\Aura`、用户 PATH、ACL 和 `aura.exe`/`node.exe` PE 运行；
2. 发布真实 Windows manifest 后的 available 命令，以及无 manifest 时的 fail-closed warning；
3. Windows 首次 Connect 的 Online/heartbeat、停止后的 Reconnect、lease 冲突、升级/回滚；
4. Connect ticket 的真实过期/重新生成交互，以及会写入 daemon registration 的端到端状态对账（本次不向共享 5432 造数据）。

## Zed ACP 运行问题记录

首次未隔离的 daemon 运行中看到 `@zed-industries/codex-acp@0.16.0` 的
`No such file or directory` 和 127。源码核对显示它来自
`agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs:1522` 的故障注入：测试显式
让假 ACP 子进程在 session 前退出，正是为了断言 daemon 不会错误标记 ready；默认
生产命令仍由 `src/runtime/codex-acp-runtime.ts` 生成 `npx -y
@zed-industries/codex-acp@0.16.0`。因此当前 307/307 隔离回归 PASS 后，不能把该日志
当作 Mac 产品缺依赖已证实。

同时，ACP 包不在 daemon 的 package.json、lockfile 或 tgz `files` 中，发行物依赖
运行时 npx 解析。Windows 若无网络、npm cache 未预热、registry 不可达或 npx.cmd
不在 PATH，仍会真实启动失败；已有 nested-npx 环境清理和 Windows PATH fallback
只解决选择器污染/路径解析，尚未提供 ACP 专用离线缓存或 preflight。Windows 侧应
在验收中记录并决定安装时预热或明确离线策略。

这些项目的执行步骤和脱敏证据格式见 [windows-acceptance.md](./windows-acceptance.md)。在 Windows 证据完成前，任务 `task.json.status` 保持 `in_progress`。
