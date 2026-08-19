# 日志指南

> 本项目的日志怎么做。

---

## 概览

后端只用 **Python 标准库 `logging`**——没有 structlog/loguru（backend 源码零命中；pyproject.toml 依赖里也没有）。应用**没有集中式日志配置**：`main.py` 与 `config.py` 都不 import logging，没有 `basicConfig`/`dictConfig`，`Settings` 里没有日志级别字段——格式/级别/输出实际由 uvicorn 默认行为决定（Dockerfile:13 的 CMD 未传 `--log-config/--log-level`）。仓库里唯一的 `fileConfig` 在 alembic.ini:115-149，只作用于迁移进程（root=WARNING、alembic=INFO、stderr console handler）。

模块级 logger 惯用写法（6 个业务模块 + 测试）：

```python
logger = logging.getLogger(__name__)   # services/public_events.py:26、daemon_control.py:18、
                                       # routers/public_api.py:170、upload_storage.py:17 等
```

---

## 消息风格

主导风格是 **%-式惰性格式化 + 消息内嵌 `key=value`**——不是结构化字段 API：

```python
logger.info("public event stream subscriber connected count=%s", self.subscriber_count)      # public_events.py:70
logger.warning("public event subscriber queue full; dropping event id=%s", event_id)         # public_events.py:94
logger.exception("daemon control push failed for computer_id=%s", computer_id)               # daemon_control.py:325
```

- 参数以 %-arg 传入（惰性格式化），保持上述样式。
- 目前唯一一处 `extra={...}` 用法是 upload_storage.py:47（`extra={"path": str(path)}`）；可接受但不是惯例。
- 延迟可观测性（latency 观测）不走 logger——见下一节。

---

## 延迟追踪（stdout 的 JSON 单行，不是日志）

请求路径的计时走 `services/latency_trace.py`，向 stdout 打单行 JSON 事件：

- trace id：header `X-SmallKhoj-Trace-Id`，或 body 里的 `traceId/trace_id`，否则生成 `prefix:uuid12`（latency_trace.py:15-32）。
- 事件字段：`at/traceId/flow/span/elapsedMs/durationMs/status/attrs`（latency_trace.py:84-109）。
- router 侧在发送路径周围使用：agent_api.py:2136-2142、2145-2222；public_api.py:2455。
- **可观测性绝不破坏实时消息路径**：trace 发送吞掉自身异常（latency_trace.py:105-109）。
- 消费方式：仓库根的 `./smallkhoj-trace` 对这些 timeline 事件分组。

其他刻意的 stdout（非日志）输出：种子完成标记（seed.py:198）、CLI JSON 结果（integration_bootstrap_cli.py:78、live_run_preflight_cli.py:42-44、scripts/legacy_schema_preflight.py:704-713）。

---

## 日志级别（可观察到的惯例）

| 级别 | 用途 | 真实示例 |
|-------|----------|---------------|
| `debug` | 高频降噪路径 | 事件去重丢弃（public_events.py:81）、关闭阶段任务失败（public_events.py:676,701） |
| `info` | 生命周期事件 | 订阅者连/断（public_events.py:70,75）、listener 重连（public_events.py:611） |
| `warning` | 可恢复的降级 | 队列满丢事件（public_events.py:94）、发布重试失败（public_events.py:523-529）、非法 notify JSON（public_events.py:719） |
| `error` | 数据丢失或资源关闭超时 | publisher 不健康时丢弃通知（public_events.py:489-493）、关闭超时（public_events.py:678,694） |
| `critical` | 回滚后的一致性风险 | 事务回滚后 blob 恢复失败（public_api.py:4385-4391、4502-4507） |
| `exception`/`exc_info` | 异常路径的默认选择 | public_events.py:567,630；upload_storage.py:47,120,133；reminder_scheduler.py:177；thread_summary.py:343 |

后台循环遵循统一模式：`logger.exception(...)` + 指数退避（reminder_scheduler.py:176-178、thread_summary.py:342-344）。

与事件投递契约的衔接：尽力而为的丢弃（队列溢出）必须通过 warning 日志保持可观测、绝不无限增长（event-delivery-contracts.md；public_events.py:94）。

---

## daemon 侧是另一套栈（不要盲目照搬）

`agent/daemon/aaa-daemon` 是 TypeScript，**不用**日志库：

- `console.*` 加方括号前缀：`[WS] Connecting...`（websocket.ts:57）、`[WS] Lease revoked by server: not reconnecting.`（websocket.ts:93）、`[Aura] ...` CLI 输出（cmd/main.ts:296-443）。
- `DaemonCore` 自带内存环形缓冲（容量 2000，逐出最旧；daemon.ts:2571-2583），条目结构 `{timestamp, level, message}`，经 JSON-RPC 方法 `DaemonMethods.Logs` 提供（client-handler.ts:228-231）。
- 由此带来的差异：daemon 没有 %-惰性格式化的概念（模板字符串没问题），且 daemon 的日志级别是环形缓冲自己的 `debug|info|warn|error`。
