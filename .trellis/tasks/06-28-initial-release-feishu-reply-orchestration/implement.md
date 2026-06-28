# Initial release Feishu reply orchestration implementation plan

## Step 1: RED tests

- Add `backend/tests/test_feishu_reply_orchestration.py`.
- Cover accepted confirmation send and mapping.
- Cover completed TaskRun output reply.
- Cover failed TaskRun failure reply.
- Cover idempotent terminal skip.
- Cover missing Feishu source context skip.
- Cover Feishu send failure structured outcome.
- Cover daemon/runtime import boundary.

## Step 2: Implementation

- Add `backend/services/feishu_reply_orchestration.py`.
- Reuse `send_feishu_text_reply`.
- Reuse `list_external_mappings_for_local`.
- Query `ExternalEvent` and output `Message` directly.

## Step 3: Spec update

- Update `.trellis/spec/backend/database-guidelines.md` with the reply orchestration boundary.

## Step 4: Validation

Run:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_feishu_reply_orchestration.py tests/test_feishu_replies.py tests/test_feishu_adapter.py tests/test_release_loop.py tests/test_task_run_writeback.py
rtk env PYTHONPATH=. uv run pytest
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-feishu-reply-orchestration
```
