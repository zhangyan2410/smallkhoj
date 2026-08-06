# Mac 侧证据与限制记录

**日期：** 2026-08-06  
**候选实现 commit：** `4d02667139a2`（`main`；本次交接提交还会追加文档/设计同步，不改变该实现候选）

## 自动化回归（Mac checkout）

| 命令/范围 | 结果 |
|---|---|
| `cd agent/daemon/aaa-daemon && npm run build` | PASS |
| `cd agent/daemon/aaa-daemon && node --test --test-concurrency=1 test/*.test.mjs`（隔离 `AURA_INSTALL_ROOT`、`SLOCK_AGENT_CREDENTIAL`、`AAA_DAEMON_MACHINE_ID_FILE`） | PASS，305/305，0 failures，0 cancelled |
| `cd agent/daemon/aaa-daemon && node --test test/platform-paths.test.mjs test/daemon-version-source.test.mjs` | PASS，4/4 |
| `rtk node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs` | PASS，51/51 |
| `pytest -q backend/tests/test_daemon_command_generation.py` | PASS，12/12（含 preview ticket-free 断言） |
| `pytest -q backend/tests/test_server_account_membership.py` | PASS，26/26 |
| `pytest -q scripts/tests/test_build_daemon_distribution.py` | PASS，8/8（含 PE 头拒绝） |
| frontend full tests | PASS，273/273（其中 onboarding/i18n 窄测 6/6） |
| frontend typecheck / targeted ESLint | PASS |
| frontend production build | PASS（使用非开发临时 public API key 与本地构建值，未写入仓库） |
| `git diff --check` | PASS |

此前直接使用本机默认 credential 跑 runtime suite 时出现的 502，根因是用户状态目录中的旧 server endpoint 指向已失效临时端口，导致 fake-upstream 测试被重定向；不是当前 backend `:8000` 未启动。使用隔离状态目录后全套 daemon 测试 305/305 通过，详细诊断见 [daemon-runtime-recheck.md](./evidence/daemon-runtime-recheck.md)。

Windows 路径回归额外确认：在 `platform="win32"` 但 root 为 POSIX 临时目录的测试场景，配置路径现在保持在临时 root 下；仓库不再出现 `\\var\\folders...` 伪路径文件。

## 当前候选的真实服务与浏览器证据

先执行了真实测试上下文收集器：

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

Integration Gate 为 51/51；同一候选服务和 tab 的完整命令/输出摘要见 [live-runtime-report.md](./evidence/live-runtime-report.md)。

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
@zed-industries/codex-acp@0.16.0`。因此 305/305 隔离回归 PASS 后，不能把该日志
当作 Mac 产品缺依赖已证实。

同时，ACP 包不在 daemon 的 package.json、lockfile 或 tgz `files` 中，发行物依赖
运行时 npx 解析。Windows 若无网络、npm cache 未预热、registry 不可达或 npx.cmd
不在 PATH，仍会真实启动失败；已有 nested-npx 环境清理和 Windows PATH fallback
只解决选择器污染/路径解析，尚未提供 ACP 专用离线缓存或 preflight。Windows 侧应
在验收中记录并决定安装时预热或明确离线策略。

这些项目的执行步骤和脱敏证据格式见 [windows-acceptance.md](./windows-acceptance.md)。在 Windows 证据完成前，任务 `task.json.status` 保持 `in_progress`。
