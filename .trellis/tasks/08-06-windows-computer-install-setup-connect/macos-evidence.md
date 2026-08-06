# Mac 侧证据与限制记录

> **Latest superseding recheck (2026-08-07):** 本文件较早的 2026-08-06 记录保留作历史候选证据。当前主路径已是 managed standalone：真实安装命令无需手工 `export PATH`，第二次同版本执行跳过大归档；安装后的 Aura 包含私有 Node、生产依赖和本地 ACP sidecar。当前运行时 focused checks 为 16/16，builder/installer 为 15/15，Integration Gate 合同为 58/58；真实安装后的隔离 fake-server Setup → Connect → register → `status --json online=true` 通过；同一隔离候选上的真实 SmallKhoj + Claude 产品语义 Gate 已输出 `PASS product-chat-reply-claude 12/12`，完整证据见 `evidence/live-product-chat-gate-20260807.json`。ACP 0.16.0 真实 `initialize` 通过，且对用户 `model_reasoning_effort="max"` 使用不修改配置的 `-c model_reasoning_effort=xhigh` 兼容覆盖。Windows 原生 PE/实机门槛仍未完成。

**日期：** 2026-08-07
**当前 Gate 源候选 commit：** `9f37401fa6d004fe5ab98d39344ba4e450a452d9`（`main`，Gate 运行时）
**历史 UI/runtime 候选：** `4d02667139a2`；可读性 UI 最后一轮来自
`082616e3a84eef3c7437ff70d016b1a176d8cd53`。历史报告中的候选值不代表当前产物身份。

## 自动化回归（Mac checkout）

| 命令/范围 | 结果 |
|---|---|
| `cd agent/daemon/aaa-daemon && npm run build` | PASS |
| `cd agent/daemon/aaa-daemon && node --test --test-concurrency=1 test/*.test.mjs`（隔离 `AURA_INSTALL_ROOT`、`SLOCK_AGENT_CREDENTIAL`、`AAA_DAEMON_MACHINE_ID_FILE`） | PASS，307/307，0 failures，0 cancelled |
| `cd agent/daemon/aaa-daemon && node --test test/platform-paths.test.mjs test/daemon-version-source.test.mjs` | PASS，4/4 |
| `rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs` | PASS，58/58 |
| `pytest -q backend/tests/test_daemon_command_generation.py` | PASS，12/12（含 preview ticket-free 断言） |
| `pytest -q backend/tests/test_server_account_membership.py` | PASS，26/26 |
| `python -m unittest scripts.tests.test_build_daemon_distribution` | PASS，8/8（含 PE 头拒绝） |
| frontend full tests | PASS，273/273（其中 onboarding/i18n 窄测 6/6） |
| frontend typecheck / targeted ESLint | PASS |
| frontend production build | PASS（使用非开发临时 public API key 与本地构建值，未写入仓库） |
| `status --json` CLI 回归 | PASS，2/2；stdout 为单一 JSON，停止状态 exit 1 |
| Unix Install → PATH handoff regression | PASS；backend command 12/12、distribution builder 8/8；真实命令证据见 `evidence/macos-install-path-fix-8000_20260807002251.md` |
| `git diff --check` | PASS |

| 真实产品语义 Gate（同一隔离候选、安装后的 Aura、真实 Claude Code） | PASS，`product-chat-reply-claude 12/12`；结果见 `evidence/live-product-chat-gate-20260807.json` |

此前直接使用本机默认 credential 跑 runtime suite 时出现的 502，根因是用户状态目录中的旧 server endpoint 指向已失效临时端口，导致 fake-upstream 测试被重定向；不是历史候选 backend `:8000` 未启动。历史候选隔离套件为 305/305；当前 main 已重新跑到 307/307，详细诊断见 [daemon-runtime-recheck.md](./evidence/daemon-runtime-recheck.md)。

Windows 路径回归额外确认：在 `platform="win32"` 但 root 为 POSIX 临时目录的测试场景，配置路径现在保持在临时 root 下；仓库不再出现 `\\var\\folders...` 伪路径文件。

## 当前隔离候选的真实 Claude 产品 Gate

这次 Gate 使用同一候选的隔离 PostgreSQL 容器 `smallkhoj-gate-db`（host `55433`）、
backend `http://127.0.0.1:18080`、当前 worktree frontend `http://127.0.0.1:3000`，以及
从当前 carrier 安装的 `/tmp/smallkhoj-aura-gate/bin/aura`。安装根通过
`AURA_INSTALL_ROOT=/tmp/smallkhoj-aura-gate` 显式绑定，避免读到宿主旧状态。

- artifact：`0.2.6`，SHA-256 `181f729a8dcc71fade56a41d5ef4d6de80c4ccc04e35d7143ac3019161da00f6`；manifest `gitCommit=9f37401fa6d004fe5ab98d39344ba4e450a452d9`。
- 身份：Server `30c7a5ab-b4e8-4899-ad36-2c54b19a3b0b`、Computer `2fdd7635-4572-4b3f-b23b-eecd106b6b4c`、daemon `f1b15ec8-619b-42be-9016-40baa3585f24`、Claude Agent `47a5dc52-ec6d-432b-af4d-379d325065c8`、channel `gate-lab`。
- marker `REAL_PRODUCT_CLAUDE_GATE_20260807_0355` 的 human 消息被真实 Claude Code 处理；同一 channel 持久化并可见 `ACK REAL_PRODUCT_CLAUDE_GATE_20260807_0355`。Activity 含 runtime delivery、provider thinking、tool output、`aura message send`、runtime idle。
- 终端结果：`PASS product-chat-reply-claude 12/12`。完整脱敏报告在 [`evidence/live-product-chat-gate-20260807.json`](./evidence/live-product-chat-gate-20260807.json)；报告 `ok=true`，仅有非阻塞的 `CONTEXT_EVIDENCE_MISSING` warning。

这证明 Mac 侧安装后的 Aura 已经能连接真实 SmallKhoj 候选并完成真实 Claude 回复；它不替代
Windows 的 PE、PowerShell、ACL、升级/回滚和实机验收。复跑时必须保留候选 API、Server、
Computer、Agent、channel 和安装根的一致性。

同一 carrier 上又按用户的真实 `curl | bash` 形状做了 Ensure 复核（临时用户状态根）：
第一次输出 `Installed Aura 0.2.6 (darwin-arm64)`，第二次输出
`already-installed; archive download skipped`，随后在同一 shell 中
`command -v aura` 解析到临时 `bin/aura`，`aura --version` 输出 `0.2.6`。这确认重复
同版本不会再次下载大归档，也不要求用户追加 `export PATH`；安装器在当前 shell 没有可发现的
用户 bin 目录时会 fail-closed，而不是打印一个需要用户手工执行的假“完成”提示。

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

历史候选 commit `0b6222202921001e88d6aec159410ad54543edb6` 重新构建了
`darwin-arm64` 0.2.6，并将生成物放入 gitignored 的
`release-artifacts/smallkhoj-daemon/`。该历史 FastAPI carrier 由
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

当前 Gate 候选使用同一 worktree 重新生成的 managed standalone manifest：
`sourceRevision=9f37401fa6d004fe5ab98d39344ba4e450a452d9`、版本 `0.2.6`、artifact
SHA-256 `181f729a8dcc71fade56a41d5ef4d6de80c4ccc04e35d7143ac3019161da00f6`；安装后的
`manifest.json` 标记 `standalone=true`、private Node 和 ACP `0.16.0` sidecar。该产物经
真实 SmallKhoj + Claude Gate 复核，见上节；`release-artifacts/` 仍是 gitignored 生成输入，
不得提交归档本体。

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
让假 ACP 子进程在 session 前退出，正是为了断言 daemon 不会错误标记 ready；该日志
不是默认 Mac standalone 启动失败的证据。

当前 managed standalone 已把 ACP 0.16.0 作为 release-owned sidecar 放在
`sidecars/codex-acp/codex-acp`，`resolveBundledCodexAcpPath()` 通过绝对路径优先启动，
`codexAcpReadiness()` 在 sidecar 缺失时 fail-closed；真实 `initialize` 和 Claude 产品
Gate 均已通过。开发/兼容入口仍允许 npx fallback，但不属于安装后的 Aura 产品路径。
Windows 侧必须提供真实 PE `codex-acp.exe`，并在无网络/无 npx 的干净主机上验证
`aura doctor` 的 sidecar 检查与真实 runtime 启动；若缺失，应报告可操作错误而不是把
Codex 宣传为 ready。

这些项目的执行步骤和脱敏证据格式见 [windows-acceptance.md](./windows-acceptance.md)。在 Windows 证据完成前，任务 `task.json.status` 保持 `in_progress`。
