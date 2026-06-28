# Initial release Feishu raw event loop handler implementation plan

## Step 1: RED tests

- Add `backend/tests/test_feishu_event_loop.py`.
- Test accepted raw event calls normalize -> dispatch -> release-loop -> accepted reply.
- Test duplicate/drop outcomes do not call release-loop.
- Test release-loop failure marks external event failed.
- Test accepted-reply failure is structured and preserves release result.
- Test daemon/runtime import boundary.

## Step 2: Implementation

- Add `backend/services/feishu_event_loop.py`.
- Reuse existing services; do not duplicate parsing, route resolution, Jira lookup, or reply send logic.

## Step 3: Spec update

- Update `.trellis/spec/backend/database-guidelines.md` with the raw event loop boundary.

## Step 4: Validation

Run:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_feishu_event_loop.py tests/test_feishu_adapter.py tests/test_release_loop.py tests/test_feishu_reply_orchestration.py
rtk env PYTHONPATH=. uv run pytest
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-feishu-raw-event-loop
```
