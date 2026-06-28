# Feishu worker DB session lifecycle hardening implementation plan

## Checklist

1. [x] Add failing test for `_on_message()` with an async context-manager DB factory.
2. [x] Implement a small helper in `services.feishu_channel_transport` to use async context managers when present and direct objects otherwise.
3. [x] Run targeted tests:
   - `PYTHONPATH=. uv run pytest tests/test_feishu_channel_transport.py tests/test_feishu_worker_runtime.py tests/test_feishu_worker_cli.py`
4. [x] Run full backend tests.
5. [x] Update backend spec if the session lifecycle contract is not already documented.
6. [x] Validate and archive the Trellis task.
