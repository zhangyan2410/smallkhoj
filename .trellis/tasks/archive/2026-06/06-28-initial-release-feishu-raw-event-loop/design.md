# Initial release Feishu raw event loop handler design

## Boundary

Add `backend/services/feishu_event_loop.py`.

Responsibilities:

- Normalize raw Feishu event payload.
- Call `dispatch_feishu_message`.
- For accepted `jira_analysis`, call `start_feishu_jira_analysis`.
- Send accepted reply through `send_feishu_accepted_reply`.
- Mark external event failed if release-loop startup fails after an event exists.
- Return structured outcomes for the future worker and tests.

Non-responsibilities:

- Long-connection WebSocket lifecycle.
- Feishu SDK ACK timing.
- Tenant access token acquisition/cache.
- Daemon/runtime execution.
- TaskRun terminal replies. Those are already owned by the TaskRun lifecycle hook.

## Inputs

```python
process_feishu_raw_event(
    db,
    raw_event,
    server_id,
    feishu_connector_id,
    jira_connector,
    creator_id,
    jira_http_client,
    jira_credentials,
    feishu_http_client,
    feishu_reply_config,
    bot_open_id=None,
    bot_name=None,
)
```

The future worker is responsible for resolving the server, connector, Jira connector, and runtime credentials. This handler owns business flow only.

## Outcome Shape

Statuses:

- `accepted`
- `accepted_reply_failed`
- `duplicate`
- `dropped`
- `failed`

Fields:

- `dispatch_outcome`
- `release_result`
- `accepted_reply`
- `failure_code`
- `failure_reason`

## Failure Handling

- Dispatch statuses other than accepted are returned directly and do not start local work.
- `ReleaseLoopError` marks the dispatch event failed via `mark_external_event_failed` when an event exists.
- Accepted reply failure is reported but does not mark the event failed, because local TaskRun state exists and terminal reply can still happen later.

## Idempotency

Dedup stays in `dispatch_feishu_message` through `external_events(connector_id, dedup_key)`. The event loop handler respects duplicate outcome and returns without starting local work.
