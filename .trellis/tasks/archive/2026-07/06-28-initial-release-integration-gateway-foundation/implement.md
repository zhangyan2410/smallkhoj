# Integration gateway foundation implementation plan

## Order

1. **Pre-development context**
   - Run `trellis-before-dev` before code changes.
   - Read backend model/service/test specs relevant to `backend/models`, `backend/services`, and `backend/tests`.
   - Keep this child task in planning until reviewed, then run `task.py start`.

2. **Red tests for metadata and startup DDL**
   - Add tests that expect `external_connectors`, `external_routes`, `external_events`, `external_sessions`, and `external_mappings` in `Base.metadata`.
   - Add startup DDL tests against `backend/models/seed.py` fake engine output.
   - Add expected critical index/constraint assertions:
     - external event dedup uniqueness;
     - external session uniqueness;
     - local and external mapping indexes.

3. **ORM and startup DDL**
   - Add ORM models to `backend/models/slock.py`.
   - Export them from `backend/models/__init__.py`.
   - Add startup DDL to `backend/models/seed.py` using current project style.
   - Prefer additive `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, and `CREATE INDEX IF NOT EXISTS` statements.

4. **Red tests for service behavior**
   - Event claim creates first event and returns accepted/claimed outcome.
   - Duplicate claim returns duplicate/existing outcome and does not create another local work record.
   - Route miss can be recorded as dropped/failed with readable reason.
   - Session get-or-create returns stable mapping.
   - Mapping creation and lookup work from local side and external side.
   - Serializer redacts connector secret fields.

5. **Service implementation**
   - Add `backend/services/integration_gateway.py`.
   - Keep service functions transaction-friendly: callers pass the active `AsyncSession`.
   - Use explicit status/failure code constants.
   - Avoid process-global state.
   - Do not call daemon/runtime/model execution code.

6. **Integration boundary test**
   - Add a test that simulates an accepted external event linked to local ids without invoking runtime/daemon execution.
   - If a later helper attaches TaskRun ids, it should use existing TaskRun records and not create a new execution path.

7. **Validation**
   - Run targeted backend tests for the new integration gateway behavior.
   - Run existing task run tests to confirm TaskRun behavior was not disturbed.
   - Run Trellis task validation.

## Suggested Test Commands

Run from `/Users/code/project/smallkhoj/backend`:

```bash
rtk uv run pytest tests/test_integration_gateway.py tests/test_task_runs.py
```

Task validation from `/Users/code/project/smallkhoj`:

```bash
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-integration-gateway-foundation
```

## Risks

- **Schema drift risk:** Current project has startup DDL rather than Alembic migrations. Any model-only table addition will fail on existing DBs.
- **Over-generalization risk:** The foundation should support Feishu/Jira but should not become a generic integration platform before the release loop exists.
- **Execution boundary risk:** It is tempting for an adapter handler to execute runtime work directly. This child must prevent that by making the service stop at durable state and mapping.
- **Secret leakage risk:** Connector config and event serialization must not expose credentials.
- **Dedup race risk:** Idempotency must rely on database uniqueness plus transaction handling, not only a select-before-insert check.

## Definition Of Done

- PRD, design, and implementation plan are reviewed.
- Task is started only after review approval.
- Metadata, startup DDL, service behavior, dedup, mapping, and redaction tests pass.
- Existing TaskRun tests still pass.
- No Feishu/Jira adapter code is implemented in this child.
- Follow-up tasks can depend on this foundation without rewriting it:
  - `jira-rest-mvp`
  - `feishu-long-connection-mvp`
  - `feishu-taskrun-jira-loop`
