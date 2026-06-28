# Initial release Feishu Channel SDK transport

## Goal

Add the real Feishu/Lark Channel SDK transport adapter and worker entrypoint for the 7-15 initial release.

The previous runtime slice made raw Feishu events processable with resolved connectors and dependencies. This task connects that runtime boundary to the current Python Channel SDK shape:

```text
lark_channel.FeishuChannel message callback
-> transport adapter converts SDK message to raw event payload
-> services.feishu_worker_runtime.handle_feishu_worker_raw_event
```

## User Value

The backend should be close enough to deploy that a Feishu app can run as a long-connection worker without a public webhook/domain. This task removes the remaining fake-only transport gap while preserving testability and keeping business logic out of SDK callbacks.

## Confirmed Evidence

- Official SDK docs say legacy `lark_oapi.channel` is kept for compatibility, while new Channel features ship in `lark-channel-sdk` with import path `lark_channel`.
- The Channel quickstart uses:
  - `from lark_channel import FeishuChannel`
  - `FeishuChannel(app_id=..., app_secret=...)`
  - `channel.on("message", on_message)`
  - `await channel.connect()`
  - `await channel.disconnect()` for graceful shutdown.
- PyPI currently exposes `lark-channel-sdk` version `1.1.0`.
- Existing SmallKhoj code has:
  - `services.feishu_worker_runtime.resolve_feishu_worker_config`
  - `load_feishu_worker_connectors`
  - `build_feishu_worker_dependencies`
  - `handle_feishu_worker_raw_event`
  - `run_feishu_event_transport`
- The transport must not parse `分析 JIRA-123` or call Jira/TaskRun services directly.

## Requirements

- **R1: SDK dependency.** Add `lark-channel-sdk` as a backend dependency for deployable Feishu Channel transport.
- **R2: Lazy import.** SDK import must happen inside a factory/transport function so base backend imports and unit tests do not fail when only non-transport code is loaded.
- **R3: SDK message conversion.** Convert a Channel SDK message callback object into the raw Feishu event shape that `normalize_feishu_message` already understands.
- **R4: Message fields.** Preserve event/message ids, chat id/type, sender open id, content text, thread/root/parent ids when available.
- **R5: Transport adapter.** Add a `FeishuChannelSDKTransport` or equivalent that registers `on("message", handler)`, calls the runtime event handler, and exposes `connect`/`disconnect`.
- **R6: Worker entrypoint.** Provide a coroutine that resolves runtime config/connectors/dependencies, builds the SDK transport, and runs it.
- **R7: Error visibility.** SDK transport creation failure, missing SDK, missing config, and connector/dependency failures must be structured enough for logs/CLI use.
- **R8: Testability.** Tests must use fake SDK/channel objects. No real Feishu network, no real credentials, no SDK connection in automated tests.
- **R9: Boundary safety.** SDK transport must not import daemon execution helpers, TaskRun creation helpers, Jira REST helpers, or Feishu command parser logic.

## Acceptance Criteria

- [ ] Backend dependency list includes `lark-channel-sdk`.
- [ ] Unit tests prove SDK import is lazy and fake channel injection works.
- [ ] SDK message conversion produces raw payload accepted by existing Feishu normalization.
- [ ] Transport registers a message handler and forwards callback events to the runtime handler.
- [ ] Transport connect/disconnect methods call the underlying Channel SDK object.
- [ ] Worker entrypoint resolves config/connectors/dependencies and returns structured startup/config failures without starting transport.
- [ ] Tests prove no business logic or daemon/runtime execution helpers are imported into transport code.
- [ ] Existing Feishu worker runtime, raw event loop, adapter, release loop, and full backend tests pass.

## Out Of Scope

- Real live Feishu credential smoke test.
- Multi-replica WebSocket lease/fencing.
- FastAPI lifespan automatic startup.
- Interactive cards or binding UI.
- Tenant token cache replacement for reply API.

## Open Questions

No user decision blocks this code slice. The later deployment task still needs a process decision: run worker as separate process/service or attach to FastAPI lifespan. This task should keep both deployment shapes possible.
