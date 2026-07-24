# Scheduler loop silent failure and fixed-rate retry

## Bug 诊断胶囊

| 栏位 | 内容 |
| --- | --- |
| **1. 现象** | 候选分支中的 reminder/thread-summary scheduler 捕获任意异常后不写日志，并继续按固定周期重试；daemon WebSocket 推送失败会移除连接，但不留下失败原因。期望是保留取消语义、记录异常，并在 scheduler 连续失败时有界退避。 |
| **2. 证据** | 独立真相同步发现 advisor commit `e0ba3b4` 不在候选 `HEAD`；`backend/services/reminder_scheduler.py` 与 `backend/services/thread_summary.py` 仍为 `except Exception: pass`/固定 sleep；`backend/services/daemon_control.py` 两个发送 catch 只移除连接。Plan 003a 仍把该修复记为 DONE。 |
| **3. 问题假设或根因** | 根因已确认：整合候选吸收了 003b 等后续修复，但遗漏独立的 003a commit，且报告状态没有对 candidate reachability 做最终核对。异常处理因此退回到静默、固定频率重试。 |
| **4. 诊断策略** | 对照 `services.public_events` 的日志/重连模式与 advisor diff；用可控的失败函数和 fake sleep 直接观察连续失败、成功恢复、取消及日志行为；daemon 用失败 WebSocket 验证记录并移除。 |
| **5. 超时策略** | 若 async loop 测试在 30 分钟内无法稳定，不修改架构；缩小到一个迭代 helper 或保留为正式 release exclusion。 |
| **6. 预警策略** | 测试若需要真实时间等待、真实数据库或三次以上实现尝试，说明测试边界错误，停止并重新设计；不得改变正常 scheduler 周期或 daemon 交付语义。 |
| **7. 用户可见交互修正** | 无 UI 变化。运维日志能看到 scheduler/daemon 发送失败；持久故障不会继续按最短周期施压数据库。 |
| **8. 验收** | 新测试必须先在当前实现上因 backoff/logging 缺失而 RED；修复后 scheduler 连续失败按 `2x` 增长、最大 60 秒、成功后恢复原周期，`CancelledError` 继续上抛，daemon 发送失败被记录并移除；focused pytest、Ruff 与最终全量 backend gate 通过。 |

## 1. 报告人

2026-07-23，审计整改候选真相同步时由 Codex 独立复核发现。

## 2. 复现步骤

1. 让 `fire_due_reminders()` 或 `request_due_thread_summaries()` 持续抛出异常。
2. 运行对应 scheduler loop 并记录 sleep 参数与日志。
3. 当前候选每轮仍 sleep 原始 interval，且没有异常日志；reminder 默认会每秒重新开一次 session。
4. 让 daemon WebSocket 的 `send_json()` 抛异常；连接会被移除，但日志中没有失败原因。

## 3. 根因分析

原审计已在 advisor commit `e0ba3b4` 中实现 Plan 003a，但该 commit 未进入
`feat/2026-07-audit-remediation`。后续整合与报告同步只依赖旧 DONE 状态，没有再次验证
`commit → candidate HEAD` 可达性，因此遗漏在代码和文档中同时存在。

## 4. 修复方案

- scheduler 保留原始 interval，连续异常后以 2 倍增长并封顶 60 秒；任意成功迭代恢复原 interval；
- 使用模块 logger 的 `logger.exception(...)` 保存 stack trace；
- `asyncio.CancelledError` 仍原样上抛，shutdown 契约不变；
- daemon 发送失败继续移除坏连接，只补异常日志，不增加重试或改变投递计数；
- 不引入公共 backoff abstraction，不改 scheduler 默认开关或业务逻辑。

## 5. 验证方式

- RED/GREEN：`backend/tests/test_reminder_scheduler.py`；
- daemon focused：`backend/tests/test_daemon_control.py` 的失败 WebSocket 回归；
- `uv run ruff check services/reminder_scheduler.py services/thread_summary.py services/daemon_control.py tests/test_reminder_scheduler.py tests/test_daemon_control.py`；
- 最终运行完整 backend pytest/Ruff 门禁。

### 2026-07-23 RED / GREEN evidence

- RED：focused suite 为 `5 failed, 50 passed`。失败分别证明两个 scheduler 仍固定 sleep、
  backoff 不封顶，以及两个 daemon send catch 没有异常日志；
- GREEN：同一命令为 `55 passed in 0.37s`；
- focused Ruff：`All checks passed!`；
- `git diff --check`：通过。
