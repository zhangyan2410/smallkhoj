# Bug report: historical `messages.seq` migration reuses existing values

## Metadata

- Reporter: 2026-07 independent codebase-audit verification
- Remediation task: `.trellis/tasks/07-22-audit-remediation-schema-integrity`
- Baseline: `c280e43` plus approved pytest prerequisite `135e118`
- Severity: release-blocking database migration defect

### Bug 诊断胶囊：identity migration 未越过历史 seq 高水位

| 栏位 | 内容 |
|---|---|
| **1. 现象** | 期望：把已有 `messages.seq` 改成 PostgreSQL identity 后，第一条省略 `seq` 的 INSERT 获得大于历史最大值的唯一序号。实际：历史行已有 `seq=1,2,3` 时，advisor 0002 迁移后的 identity 仍从 1 开始，第一条隐式 INSERT 报 `messages_seq_key`，`Key (seq)=(1) already exists`。 |
| **2. 证据** | 2026-07-22 使用一次性 PostgreSQL 16：执行 baseline migration，显式写入 seq 1/2/3，upgrade 0002，然后省略 seq 写入；稳定复现 duplicate key。独立记录见 `.trellis/tasks/07-20-07-19-codebase-audit/research/2026-07-22-independent-verification.md`。当前 `main` 尚无 Alembic，`Message.seq` 只是非 PK `autoincrement=True`，生产 writer 依赖应用 `MAX(seq)+1`。 |
| **3. 问题假设或根因** | 已确认根因有两层：当前 schema 没有真实 generator；advisor 迁移虽添加 `BY DEFAULT` identity，却没有在迁移事务内把关联 sequence restart/setval 到现有 `MAX(seq)` 之后。过渡期显式 identity INSERT 也不会自动推进 generator，因此自动-only rollout 前还需要最终高水位 reconciliation。 |
| **4. 诊断策略** | 在独立 PostgreSQL 16 容器/唯一数据库中执行真实 Alembic revision，而不是 `Base.metadata.create_all`。永久测试覆盖 empty、historical 1/2/3、迁移后显式 100、后续隐式写入和两个并发隐式 writer；同时检查 public/agent/reminder 三个 writer 与 FastAPI startup schema mutation。 |
| **5. 超时策略** | 若 45 分钟内无法让 migration harness 执行真实 revision，先缩小到 Alembic command API + 独立 database，保留容器日志并检查 advisor 004 环境配置；不得改成 metadata/create-all 假测试。若 PostgreSQL URL/数据库所有权不明确，立即停止并创建新的唯一容器。 |
| **6. 预警策略** | 测试因 Docker/依赖/权限报错而不是高水位断言失败；测试在空表上立即通过；修复只覆盖历史行但 post-migration explicit=100 仍使后续 implicit 回退；使用 `stamp head`；startup 仍运行 DDL；writer 在迁移前停止显式 seq。任一信号说明方向错误。 |
| **7. 用户可见交互修正** | 部署升级后消息发送不再因历史序号或并发自动分配而 500；旧库接入会在 drift/unknown schema 时明确停止，而不是伪造 head；运维文档给出 baseline-only stamp 与 postcheck。 |
| **8. 验收** | 永久测试 `test_alembic_migrations_postgres.py` 必须先在 broken advisor migration 上以 duplicate/high-water 原因 RED，再在修复后 GREEN。验收包括 fresh→head、legacy fingerprint→baseline stamp→head、1/2/3→implicit、explicit 100→implicit、concurrent implicit、三个 writer 无 `MAX(Message.seq)+1`、startup 无 create-all、完整 backend pytest/Ruff、migration docs 和 `git diff --check`。 |

## Reproduction contract

```text
isolated PostgreSQL 16
  -> upgrade baseline revision
  -> insert valid prerequisite rows and messages.seq = 1, 2, 3 explicitly
  -> upgrade identity revision
  -> INSERT message without seq
  -> expected seq >= 4; broken result duplicate seq=1
```

The test database/container name and port must identify the remediation worktree. Never
point this test at the shared development or cloud database.

## Terminal invariant

After every supported migration/transition sequence, the next committed implicit
`messages.seq` is strictly greater than every committed explicit or historical value
observed before that insert. Application writers may stop allocating `MAX(seq)+1` only
after this invariant is proven by actual revisions.

## RED / GREEN evidence (2026-07-23)

- RED on advisor `0002`: `test_identity_migration_starts_above_historical_message_seq`
  raised `UniqueViolationError`, `Key (seq)=(1) already exists` after historical
  values 1/2/3.
- RED after the first fix: the explicit-transition test generated `2` after an
  explicit `100`, proving a second reconciliation barrier was required.
- GREEN: `backend/tests/test_alembic_migrations_postgres.py` passed all 7 actual
  revision/readiness/legacy cases; message allocation and schema-authority guard
  tests passed 6 additional focused assertions.
- Integrated command with explicit dedicated-container URLs: backend `347 passed`
  with no PostgreSQL skip; full Ruff returned `All checks passed`.
- The disposable harness created a unique database per case and dropped it in
  `finally`; container `smallkhoj-audit-remediation-pg` on port 55433 was the only
  destructive target.
