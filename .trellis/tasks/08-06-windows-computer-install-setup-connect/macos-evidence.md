# Mac 侧证据与限制记录

**日期：** 2026-08-06  
**分支/HEAD：** `main` / `2637ba4c0b3c`（实现完成后会产生新的提交；Windows 侧应以远程 `main` 的实际提交为准）

## 自动化回归（Mac checkout）

| 命令/范围 | 结果 |
|---|---|
| `cd agent/daemon/aaa-daemon && npm run build` | PASS |
| `cd agent/daemon/aaa-daemon && node --test test/platform-paths.test.mjs` | PASS，3/3 |
| daemon 全量 `node --test` | BLOCKED：runtime 集成用例访问不可达的本地 backend，出现 HTTP 502/等待超时 |
| daemon 平台路径/Setup 窄测试 | PASS，3/3 |
| `pytest -q backend/tests/test_daemon_command_generation.py` | PASS，12/12（含 preview ticket-free 断言） |
| `pytest -q backend/tests/test_server_account_membership.py` | PASS，26/26 |
| `pytest -q scripts/tests/test_build_daemon_distribution.py` | PASS，8/8（含 PE 头拒绝） |
| frontend targeted tests | PASS，42/42 |
| frontend typecheck / targeted ESLint | PASS |
| frontend production build | PASS；仅 Better Auth base URL warning |
| `git diff --check` | PASS |

Windows 路径回归额外确认：在 `platform="win32"` 但 root 为 POSIX 临时目录的测试场景，配置路径现在保持在临时 root 下；仓库不再出现 `\\var\\folders...` 伪路径文件。

## 真实运行环境门禁

先执行了：

```text
rtk bash .agents/skills/smallkhoj-real-test/scripts/collect-context.sh
```

当前 collector 结果：

- 当前 checkout：`main`，起点 HEAD `2637ba4c0b3c`；
- `127.0.0.1:3000` frontend：unreachable；
- `127.0.0.1:8000` backend：unreachable；
- `38190/38191` local-test：unreachable；
- 仅宿主 `127.0.0.1:5432` 有 PostgreSQL 监听，未对其执行写入、迁移或清理；
- 没有可证明属于本 checkout 的健康候选测试栈。

`rtk ./twd --compact tabs` 能看到 WebDriver bridge，但其中的 `127.0.0.1:3000` 标签页属于未知/旧会话，无法证明对应当前 worktree。因此本次没有把它的截图或 DOM 断言计为 PASS，状态为 `BLOCKED_CANDIDATE_IDENTITY`。

## 待补的 Mac 真实证据

在同一候选 frontend/backend 启动并通过 Integration Gate 后，使用项目 `./twd`（不要用 Playwright）补充：

1. 中文默认文案、Windows/Unix tabs 和未选中命令不在 DOM；
2. 预览没有 ticket，显式 Connect/Reconnect 才有 ticket/过期时间；
3. ticket 过期后重新生成、Online/失败状态和复制反馈；
4. macOS 当前 npx Connect/Reconnect、machine ID/credential 复用，以及 Node/legacy daemon 共存回归；
5. water 与 shuimo 两个主题截图。

这些证据完成前，Mac 真实验收也不能写成完成；本文件只记录本次安全停止的原因，避免把未知候选当作产品证据。
