# Bug report: Task DELETE audit rows reference an already-deleted Task

## Metadata

- Reporter: 2026-07 independent codebase-audit verification
- Remediation task: `.trellis/tasks/07-22-audit-remediation-schema-integrity`
- Baseline: `c280e43` plus approved pytest prerequisite `135e118`
- Severity: release-blocking destructive-write transaction defect

### Bug 诊断胶囊：Task 删除后审计/事件 FK 使事务回滚

| 栏位 | 内容 |
|---|---|
| **1. 现象** | 期望：授权 owner/admin 删除 Task 后返回成功，Task 消失且保留可审计 tombstone/event。实际 advisor 路径先 `DELETE tasks`，随后 `_record_activity(... task_id=旧 UUID)` 立即 flush ActivityLog，并创建相同 task_id 的 EventRecord。真实 PostgreSQL 报外键错误，整笔事务回滚，Task 仍存在。 |
| **2. 证据** | 2026-07-22 在独立 PostgreSQL 16 按路由顺序验证：ActivityLog 插入命中 `activity_logs_task_id_fkey`；单独推进 EventRecord 插入命中 `event_records_task_id_fkey`。两次事务均回滚，Task=1、activity/event=0。advisor fake-session tests 通过但从未执行 FK。 |
| **3. 问题假设或根因** | 根因已确认：`ON DELETE SET NULL` 只会清理删除动作发生时已存在的引用，不允许删除后新插入一个指向不存在实体的 FK。删除审计需要把旧 UUID 保存在 JSON tombstone 中，关系列为 NULL；同时旧 plan 复用了 update/message event kind，事件语义也不正确。 |
| **4. 诊断策略** | 先用 real PostgreSQL authenticated HTTP/route test 固化当前 FK RED，并覆盖依赖记录、non-admin、cross-server、rollback。调查 `_record_activity` 的 flush/EventRecord 顺序、Task 依赖 FK、saved references、public event mapping、daemon `isRuntimeActionableEventType` 与 File storage helpers。 |
| **5. 超时策略** | 若完整 HTTP fixture 45 分钟内无法建立，保留真实 route dependency overrides，先用同一 AsyncSession 调用实际 handler（不可 mock `_record_activity`/FK）；随后再提升到 ASGI HTTP。若 storage cleanup 所有权不清晰，Task 先完成，File durability 决策单独停下呈报。 |
| **6. 预警策略** | fake session 绿但 PostgreSQL 未跑；先写 activity 再删除却在失败时留下错误审计；把旧 UUID 重新塞回 FK；commit 前 publish；新 `task.deleted` 被 daemon runtime allowlist 接受；File DB 成功但 blob failure 被静默当成功。任一信号说明终端合同未满足。 |
| **7. 用户可见交互修正** | 授权删除不再返回 500/静默回滚；失败时 UI 保留实体并显示可操作错误；成功后列表通过 UI-only `task.deleted` 刷新，审计仍能显示删除者、旧 taskId/number/title，但不会唤醒模型 runtime。 |
| **8. 验收** | 永久 `test_task_delete_postgres_http.py` 先以实际 FK constraint RED，再证明成功响应、Task/依赖消失、ActivityLog.task_id=NULL、EventRecord.task_id=NULL、payload 保留旧 UUID、commit 后 publish。另需 non-admin/missing/cross-server/dependency/rollback、daemon drop、File permission/storage failure、完整 backend 与 event tests。 |

## Required transaction order

```text
authorize and resolve scoped Task
  -> capture primitive tombstone
  -> delete saved/dependent rows and Task
  -> ActivityLog(task_id=NULL, details.tombstone=...)
  -> EventRecord(task_id=NULL, event_type=task.deleted, payload.taskId=old UUID)
  -> commit
  -> publish committed browser event
```

`task.deleted` is product/browser state invalidation by default. It must not become
runtime/model work and must not participate in message freshness.

## Consistency invariant

A successful response means the entity deletion and its tombstone audit/event committed
together. Any database or storage failure returns failure and leaves a mutually
consistent recoverable state; no event is published before commit.

## RED / GREEN evidence (2026-07-23)

- Independent raw PostgreSQL RED reproduced both advisor failures:
  `activity_logs_task_id_fkey` and `event_records_task_id_fkey` after deleting the
  referenced Task. The current synchronized base additionally returned HTTP 405 for
  the first permanent route test because no DELETE route existed yet.
- GREEN: 11 real PostgreSQL Task/File route cases cover owner success, member denial,
  missing/foreign scope, dependent rows, saved items, old-FK SET NULL, tombstone
  Activity/Event, forced commit rollback, local blob purge, quarantine fallback and
  blob restoration on DB failure.
- Independent observer sessions assert entity absence before `_push_committed_events`;
  daemon tests explicitly classify `task.deleted`, `task_deleted` and `file.deleted`
  as non-runtime and passed inside the complete 265-test daemon suite.
- Integrated dedicated-container backend result: `347 passed`; touched/full Ruff and
  `git diff --check` passed before task validation.
