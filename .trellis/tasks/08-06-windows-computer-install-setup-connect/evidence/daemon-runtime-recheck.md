# Daemon runtime recheck

**日期：** 2026-08-06  
**候选：** `main` / `4d02667139a2`，worktree `/Users/code/project/smallkhoj`

## 候选身份与安全边界

- Frontend：当前刷新后的 Next PID 37311（npm parent 37305），cwd `/Users/code/project/smallkhoj/frontend`。
- Backend：PIDs 19042/19045，命令来自 `/Users/code/project/smallkhoj/backend/.venv/bin/python3 main.py`，cwd `/Users/code/project/smallkhoj/backend`。
- `GET http://127.0.0.1:3000/` 与 `GET http://127.0.0.1:8000/docs` 均返回 200；服务来自当前 checkout，而不是旧 Docker image。
- 宿主 PostgreSQL `127.0.0.1:5432` 仅作既有共享服务，整个回归没有迁移、清理或写入。

## 先前 502 的原因与复核方式

第一次在启动服务后直接运行 daemon suite 时，测试进程继承了本机已有的用户 credential 文件；其中保存的 server endpoint 指向已失效的临时端口。于是 runtime 测试没有连到它们自己创建的 fake upstream，daemon proxy 报 `HTTP_502`/`ECONNREFUSED`。这不是当前后端 `:8000` 未启动，也不能作为代码失败结论。

为排除宿主状态污染，复核使用临时、隔离的本地状态目录（没有写入共享数据库）：

```bash
tmp="$(mktemp -d)"
AURA_INSTALL_ROOT="$tmp/aura" \
SLOCK_AGENT_CREDENTIAL="$tmp/credential.json" \
AAA_DAEMON_MACHINE_ID_FILE="$tmp/machine-id" \
  npm run build
AURA_INSTALL_ROOT="$tmp/aura" \
SLOCK_AGENT_CREDENTIAL="$tmp/credential.json" \
AAA_DAEMON_MACHINE_ID_FILE="$tmp/machine-id" \
  node --test --test-concurrency=1 test/*.test.mjs
```

## 结果

- daemon build：**PASS**。
- 全部 daemon test 文件：**305/305 PASS，0 failures，0 cancelled**（239 个 top-level/nested subtests，53.3 秒）。此前的 502、timeout 与 ACP 127 均未再出现。
- 本任务窄测 `node --test test/platform-paths.test.mjs test/daemon-version-source.test.mjs`：**4/4 PASS**。
- backend command generation：`pytest -q backend/tests/test_daemon_command_generation.py`：**12/12 PASS**。

## ACP 127 的源码核对

首次未隔离运行中出现的
`@zed-industries/codex-acp@0.16.0: No such file or directory` 不是默认启动命令的
失败证据。`agent/daemon/aaa-daemon/test/daemon-runtime.test.mjs:1522` 的测试名是
“daemon does not mark Codex ACP ready when the child exits 127 before creating a
session”；约 1557–1575 行显式创建一个会打印该 stderr 并以 127 退出的假子进程，
然后断言 exited、没有 ready/heartbeat 和 `runtime_error`。生产默认路径在
`agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts:14,30-43`，会用
`npx -y @zed-industries/codex-acp@0.16.0`；隔离回归 305/305 中该负向测试按预期
通过，未再出现外部 127。

仍要把它当作 Windows 发布风险：ACP 包没有声明在 daemon 的 package.json/lockfile，
也没有随 tgz `files` 打包，首次运行依赖 npx registry 或已有 npm cache。当前实现
有 nested-npx selector scrub、Windows `npx.cmd` 解析和注册表 PATH fallback，但无
ACP 专用离线缓存/preflight。Windows 证据必须记录 `node/npm/npx --version`、PATH、
registry/cache 状态和真实 ACP stderr；若目标环境离线，应在安装阶段预热或提供明确
的离线安装策略。

因此，“先启动当前 worktree 服务再重跑”已经完成；Mac 侧 runtime 不再是环境 blocker。Integration Gate 与浏览器证据见 [live-runtime-report.md](./live-runtime-report.md)。

## 仍需 Windows 侧执行

Windows 真机安装、真实 PE 发布物、PATH/ACL、Connect/Online/heartbeat、Reconnect、升级/回滚和 manifest 可用性仍未在 Mac 上执行；这些是 Windows-only 验收项，不应被本报告的 Mac PASS 替代。
