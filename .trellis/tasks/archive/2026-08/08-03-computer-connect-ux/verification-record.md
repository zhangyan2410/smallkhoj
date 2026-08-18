# Verification Record — 08-03-computer-connect-ux

Marker: `REAL_08-03-computer-connect-ux_20260803114000`
Candidate: worktree=/Users/code/project/smallkhoj, branch=main, head=7f2dc06 (+ working-tree changes from this task)
Stack: frontend http://127.0.0.1:3000 (npm run dev, hot reload), backend http://127.0.0.1:8000 (uv run python main.py, restarted after the SSE change), DB postgresql://localhost:5432/smallkhoj (fresh, alembic upgrade head).

## 自动测试

| 项 | 结果 |
| --- | --- |
| `bun test` (frontend, 42 files) | 243 pass / 0 fail |
| `bun test test/computer-navigation.test.ts` | 3 pass / 0 fail |
| `uv run pytest tests/test_daemon_control.py tests/test_public_events.py tests/test_daemon_command_generation.py` | 82 pass / 0 fail |
| `npx eslint` touched files | clean |
| `npx tsc --noEmit` | no errors |
| Integration Gate contract tests (`node --test tools/integration-gate*.test.mjs`) | 39 pass / 0 fail |
| Live Gate `foundation-only` | 6/12 pass — 失败项 (`minimax-runtime-ready`, `runtime-reuse-candidate`, `context-preflight`, `compact-if-needed`, `warmup-ready`, `session-resume`) 都需要真实 runtime/workspace 在线，本任务用模拟 daemon connect，无法覆盖；与本改动无关。auth/frontend/backend/daemon-connect/control-plane-sync 均 pass。 |

## 真实 UI 验证（./twd，候选身份已确认）

1. **空状态自动打开 steps dialog**（0 台电脑）：
   `stepsAutoOpen=true`，宽度 672px（max-w-2xl）。evidence: `*-empty-auto-steps-dialog.png`
2. **生成命令 → daemon connect → 自动刷新 + already-connected dialog**：
   - 在 dialog 内填 `REAL-0803-final-machine` 生成命令；curl 模拟 daemon connect 返回
     `{"connected": true, "name": "REAL-0803-final-machine"}`。
   - 后端 `event_records` 出现 `computer.status.updated / action=connect`。
   - 浏览器**无手动刷新**：列表出现 `REAL-0803-final-machine`，且 steps dialog 自动让位给
     already-connected dialog（文案含「电脑已连接 … 保持当前连接 / 连接另一台电脑」）。
     evidence: `*-final-already-dialog.png`
3. **already → steps 切换（单 dialog 状态机）**：点「连接另一台电脑」后
   `portals=["connect-computer-dialog"]`、`alreadyOpen=false`、`stepsOpen=true`，不再出现
   双 dialog 残留（修复前 Base UI 会把关闭中的 dialog 以 `data-closed` 留在 DOM）。
   evidence: `*-final-steps-dialog-wide.png`
4. **已有 1 台在线时仍能 Add**：sidebar Add 按钮打开 steps dialog 并生成第二条命令
   `REAL-0803-second-machine`；模拟第二台 daemon connect 成功后列表同时显示两台电脑，
   already-connected dialog 再次出现。evidence: `*-two-computers-already-dialog.png`

## 后端行为确认

- 同一 server 可挂多台电脑（`machine_id` 区分）；同名 + 活跃租约时 connect 返回
  `409 Computer already has an active daemon`（未改动，属于既有语义）。
- 新增的 `computer.status.updated action=connect` 事件只在 `/daemon/connect` 成功后发出，
  前端 `/computers` 既有 `RealtimeRefresh` 订阅该事件 → `router.refresh()`，无需手动 reload。

## 附带的工具链修复（同一 worktree，与本任务一起验证）

- `dev.sh`：删掉 `default_db_port` 对 55432 的监听猜测（历史上被 SSH/worker 占用，会把后端
  指到别人的库）；默认固定 `localhost:5432`，需要其它端口时显式 `SMALLKHOJ_DB_PORT`。
  新增 `SMALLKHOJ_DEV_FORCE_RESTART=1` / `./dev.sh restart` 说明，避免复用到旧 build。
- `.agents/skills/smallkhoj-real-test/SKILL.md`：按用户授权把 `:5432` 从「受保护共享库」
  改为「本地开发库可重建」，并把身份门禁改写为基于 dev.sh 进程来源判断。

## 证据文件

- `REAL_08-03-computer-connect-ux_20260803114000-empty-auto-steps-dialog.png`
- `REAL_08-03-computer-connect-ux_20260803114000-final-already-dialog.png`
- `REAL_08-03-computer-connect-ux_20260803114000-final-steps-dialog-wide.png`
- `REAL_08-03-computer-connect-ux_20260803114000-two-computers-already-dialog.png`
- `foundation-only-after.json`
- 早期探索截图（`computers-empty`、`already-connected-dialog`、`auto-refresh-already-dialog`、
  `computers-one-offline`）保留作过程参考。

## 已知边界

- 仅 local-dev 证据；未验证 local-prod / cloud。
- live Gate 中 runtime/session 相关 6 步依赖真实 daemon runtime，不在本任务范围。
- 模拟的 daemon connect 用 curl 完成（真实 `npx aura` 流程未跑），但走的正是 daemon 实际
  调用的 `/internal/agent-api/daemon/connect` 路径。
