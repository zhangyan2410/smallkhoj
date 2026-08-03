# 核心结论：可靠唤醒不是通信协议问题

> 调研收束日期：2026-07-15。本文是本任务的决策摘要；完整实验事实见 [provider-capability-matrix.md](provider-capability-matrix.md)，完整推导与来源见 [research.md](research.md)。本轮不再进行新的 Provider 探针或生产实现。

## 先把问题说对

问题不是“Agent 之间用 NATS、发布/订阅还是 RPC 通信”，而是：

> 当有人 `@` 一个正在长程工作的外部 Agent 时，谁能保证这件事不会因为模型没有注意到、上下文压缩或 turn 结束而被遗忘？

答案不能是模型自己。SmallKhoj 托管的大多数 Codex、Claude Code、Kimi、OpenCode 等运行时是外部 Agent 工具：我们可以启动一次调用、传入完整输入、观察外围进程或协议事件；通常却不能可靠地控制其内部 turn、工具循环、暂停点或上下文压缩。

因此，`@` 不应只是“期待模型下次调用 `message check` 时看到的消息”，而应成为 SmallKhoj 自己持久化的一项 **待处理事项（Work Item）**。

## 应依赖的最小可靠边界

```text
actionable @ / task / result
        ↓
SmallKhoj durable Work Item（不依赖模型记忆）
        ↓
目标 Agent 忙碌时保留在队列；scheduler 负责等待、唤醒、重查
        ↓
到达可观察的下一次 invocation 边界
        ↓
以完整上下文提交新的后续调用
        ↓
用关联回复、任务迁移、产物或显式 ack 判断是否真的完成
```

这里的 `wait` 是 **SmallKhoj 控制面**在等待事件和 Agent 容量，不是要求 vendor Agent 在自己的内部 turn 里可靠地 `await` 外部消息。

这能消除“模型忘了检查 mailbox”这个正确性依赖：模型即使忘记，队列和 scheduler 也不会忘记。

## 可以承诺什么，不能承诺什么

| SmallKhoj 可以作为基础保证 | 当前不能对所有 vendor Agent 保证 |
| --- | --- |
| Work Item 被持久化、有目标、有关联关系 | 在当前 turn 中立即把新 `@` 注入模型 |
| Agent 忙碌时该事项不会仅存在于模型上下文或 daemon 内存 | 暂停当前任务、处理新消息后无损恢复 |
| 在下一次可用 invocation 边界自动提交完整后续输入 | `sessionId`、`--resume` 或 `end_turn` 代表 continuation |
| 记录一次投递尝试与其外围终态 | 进程退出 / runtime idle / transport ack 等于业务已处理 |
| 用 reply、task transition、artifact 或 explicit ack 证明语义结果 | 外部 Agent 的 exactly-once 副作用或真正的 Agent RPC await |

若投递后外部运行时崩溃、hook 或副作用是否发生无法确定，状态必须是 `delivery_uncertain`，不能直接自动重放；否则可能重复发消息、重复改文件或重复执行外部动作。

## 第一轮实验实际说明了什么

- Kimi ACP、OpenCode ACP：同一**常驻** session 可以串行接受两条后续 prompt，并能暴露 `end_turn` / structured update。这是可用的“下一次调用边界”，**不是** busy-time 插话、暂停恢复或 unfinished continuation。
- Codex app-server：一次实验中 `turn/steer` / `turn/interrupt` 在协议层被接受，但同时发现用户级 hook 在 fixture 外执行。该条记录为 `delivery_uncertain`，只能视为未来的 Codex 专用研究方向，不能作为通用或生产基础。
- Claude Code：busy-time 第二输入没有得到有效观测，仍为 `unverified`；不能假称它支持排队、合并、拒绝或中途注入。

所以，当前没有任何已验证的通用能力能支持“暂停当前 vendor Agent turn，插入 `@`，然后原地精确恢复”。

## 对 NATS、Mailbox 和 `message check` 的含义

- NATS、Redis Streams 或数据库队列以后都可以承担 transport / wake hint；它们不能替代 Work Item、attempt、correlation、幂等与 `delivery_uncertain` 的业务语义。因此现在不应先做消息中间件选型。
- `slock message check` 仍可作为上下文补齐工具，但不能再是显式 actionable `@` 唯一的正确性路径。
- “Mailbox enqueue”有价值的部分不是 UI 或命名，而是：**控制面拥有未处理事项，并在 Agent 可调度时替它投递。**

## 后续路线（本任务不实施）

1. **默认 vendor tier**：单独设计 SmallKhoj-owned durable Work Item + next-invocation queue。这是现在唯一有证据支持、同时覆盖 Codex/Claude/Kimi/OpenCode 的基础方向。
2. **Provider enhancement（可选）**：例如 Codex app-server steer，只能在独立的 hook 隔离、外部副作用对账与 fallback-to-queue 验证完成后启用。
3. **真正的 continuation（另一类产品能力）**：如果目标是 Agent 等待子 Agent 结果后保持内部调用栈并继续，需要引入我们拥有 loop 的 runtime（如 Pi 或其他开源 Agent base），另做认证、工具、权限与恢复机制评估；不能把 vendor session resume 当作它的替代品。

**一句话决策：**先让 SmallKhoj 成为永远不会忘记的等待者和调度者；外部 Agent 只负责在下一次可用执行边界处理完整、明确的待处理事项。
