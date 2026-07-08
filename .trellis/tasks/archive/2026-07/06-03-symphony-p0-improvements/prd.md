# Symphony-inspired Retry/Timeout/Workspace Safety

## Goal

吸收 OpenAI Symphony 编排框架的设计优点，为 agent 委派控制面补齐自动重试、超时检测、workspace 安全校验三项关键能力。

## What I already know

* OpenAI Symphony 是一个开源的 Codex 编排框架，核心能力包括：poll Linear issue → spawn Codex agent → 管理并发/重试
* 我们的控制面比 Symphony 更宽（channels、DMs、权限、事件溯源、提醒），但缺少三项生产级能力
* 完整对比见 `research/symphony-comparison.md`
* 当前闭环已走通：supervisor 派任务 → daemon polling → worker 执行 → slock CLI 汇报

## Requirements

### P0: 自动重试 + 指数退避

* Task 增加 `attempt_count`、`last_error`、`last_attempt_at` 字段
* 实现 `min(10s * 2^(attempt-1), max_backoff)` 指数退避
* 可配置 `max_retry_backoff_ms` 和 `max_attempts`
* 失败 task 自动重排队，emit `task_retry_scheduled` event

### P0: 超时 / 停滞检测

* AgentWorkspace 增加 `last_activity_at` 字段
* 后台定时 tick 检查 elapsed time since last activity
* 超过 `stall_timeout_ms`（默认 5 分钟）的 workspace 自动终止
* 超过 `hard_timeout_ms`（默认 1 小时）的 workspace 强制终止
* Emit `workspace_stalled` / `workspace_timed_out` event

### P0: Workspace 路径安全

* 启动时验证 workspace `cwd` 在配置的 root 目录下
* 消毒 workspace 目录名（sanitize）
* 确保进程 cwd 与 workspace path 匹配

### P1: Workspace 生命周期 hooks

* `before_start`: agent 启动前执行（git pull、npm install）
* `after_stop`: agent 退出后执行（cleanup、artifact collection）
* hooks 存储在 workspace config 或项目 `.slock/WORKFLOW.md`
* hook 超时强制终止（默认 60s）

### P1: 启动时孤立 workspace 回收

* Backend 启动时扫描 status=running 的 workspaces
* 检查 daemon heartbeat 判断是否存活
* 标记孤立 workspace 为 stopped
* 清理 terminal 状态的 workspace 目录

### P1: Token/rate-limit 追踪

* 从 Claude/Codex stream events 解析 token 用量
* 每会话 + 聚合统计存入 AgentWorkspace 和 ActivityLog
* 暴露在 `/api/v1/computers` 和 dashboard

## Research References

* [research/symphony-comparison.md](research/symphony-comparison.md) — 完整架构对比、10 项具体建议、blind spots 分析
* [research/gaps-audit.md](../06-02-agent-delegation-control-plane/research/gaps-audit.md) — 当前系统 12 项缺陷审计

## Out of Scope

* WORKFLOW.md prompt 模板系统（P2，以后再做）
* Hot-reload 配置（P2）
* per-status 并发限制（P2）
* SSH/远程 worker 支持（P2）
* Workspace cleanup on task completion（P2）

## Technical Notes

* 参考实现：Symphony SPEC.md section 7（retry）、9（workspace）、10（timeout）
* 后端改动集中在 `backend/models/slock.py`（字段）和 `backend/routers/agent_api.py`（逻辑）
* 需要新的后台 scheduler（参考现有 `services/reminder_scheduler.py` 模式）
