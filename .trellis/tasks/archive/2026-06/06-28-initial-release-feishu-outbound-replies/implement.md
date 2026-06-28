# Initial release Feishu outbound replies implementation plan

## Step 1: RED tests

- Add `backend/tests/test_feishu_replies.py`.
- Test chat-level text request shape.
- Test source-message reply request shape.
- Test missing token/chat/text validation.
- Test Feishu non-zero API response failure code.
- Test successful mapping through `ExternalMapping`.
- Test daemon/runtime boundary.

## Step 2: Implementation

- Add `backend/services/feishu_replies.py`.
- Reuse `services.integration_gateway.create_external_mapping`.
- Keep credentials injected.

## Step 3: Spec update

- Update backend database guidelines with the Feishu outbound reply boundary.

## Step 4: Validation

Run:

```bash
rtk env PYTHONPATH=. uv run pytest tests/test_feishu_replies.py tests/test_feishu_adapter.py tests/test_integration_gateway.py tests/test_release_loop.py tests/test_task_run_writeback.py
rtk env PYTHONPATH=. uv run pytest
rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-feishu-outbound-replies
```
