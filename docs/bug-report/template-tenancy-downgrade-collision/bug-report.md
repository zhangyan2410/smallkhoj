# Template tenancy downgrade collision

### Bug 诊断胶囊：0004 合法跨租户 slug 无法安全回滚

| 栏位 | 内容 |
|------|------|
| **1. 现象** | `0004_template_tenancy` 允许不同 Server 拥有相同 template slug；downgrade 恢复旧的全局 slug unique 时，这些完全合法的新数据无法表示。当前实现先删除新索引/约束，再在创建旧 unique 时抛出普通 unique violation，operator 得不到明确的冲突清单或处置边界。 |
| **2. 证据** | `downgrade()` 没有数据 preflight，直接 `create_unique_constraint('uq_task_run_templates_slug', ['slug'])`。事务虽可回滚 DDL，但失败发生在结构变更序列中，错误只表现为底层重复键。 |
| **3. 问题假设或根因** | 根因是 downgrade 把可逆 DDL 当作完整可逆性，却没有承认新 schema 的 `(server_id, slug)` 值域比旧 schema 的全局 `slug` 更宽。无损自动降级在存在重复 slug 时数学上不可能。 |
| **4. 诊断策略** | 在真实 disposable PostgreSQL 升到 head，写入两个不同 Server 的同 slug template，运行真实 Alembic downgrade；观察 revision/column/index 是否事务保持，并比较 operator 先重命名冲突后的成功路径。 |
| **5. 超时策略** | 若 Alembic/PostgreSQL 不能保证失败 DDL 的事务回滚，增加迁移外只读 preflight；不通过删行或静默重命名制造“成功”。 |
| **6. 预警策略** | 任何方案若自动丢数据、改变 template 身份、选择任意 Server 胜出，或错误发生在已经提交部分 DDL 之后，立即停止。 |
| **7. 用户可见交互修正** | 无产品 UI 变化；operator 会在 downgrade 的第一个步骤收到稳定诊断，先显式重命名/合并冲突 slug，再重试。 |
| **8. 验收** | 真实 PostgreSQL：冲突数据导致带稳定错误码/说明的 fail-closed，revision 仍为 0004、server_id 与新索引仍在；冲突由 operator 显式消除后 downgrade 到 0003 成功并恢复全局 unique。 |

## 五件套

1. **报告人**：独立 delivery re-audit，2026-07-23。
2. **复现步骤**：head 上两个 Server 各插入同 slug 的合法模板，然后运行 `alembic downgrade 0003_messages_seq_auto`。
3. **根因分析**：新旧唯一性值域不等价，且 downgrade 缺数据 preflight。
4. **修复方案**：在 `downgrade()` 的第一个步骤执行只读 duplicate-slug
   preflight；一旦存在冲突，以稳定错误码
   `TEMPLATE_TENANCY_DOWNGRADE_SLUG_COLLISION` fail closed。迁移不删行、不选择任意
   Server 胜出，也不静默重命名。operator 显式重命名或合并后再重试。
5. **验证方式**：实际 Alembic + disposable PostgreSQL。冲突失败发生在任何 DDL
   之前，事务仍位于 `0004`，`server_id` 与 tenant unique index 保持不变；显式
   修改第二个 slug 后成功降至 `0003`，`server_id` 被移除并恢复
   `uq_task_run_templates_slug`。
