# Feishu Channel SDK transport design

## Boundary

Add the SDK-facing transport layer. It owns SDK object construction, message callback registration, and SDK message to raw event conversion. It delegates all durable business work to `services.feishu_worker_runtime`.

```text
Channel SDK message object
-> sdk_message_to_raw_event
-> FeishuChannelSDKTransport callback
-> handle_feishu_worker_raw_event
```

## Module

`backend/services/feishu_channel_transport.py`

## Dependency

Add backend dependency:

```toml
"lark-channel-sdk>=1.1.0"
```

SDK import is lazy:

```python
def create_feishu_channel(config):
    from lark_channel import FeishuChannel
    return FeishuChannel(app_id=config.app_id, app_secret=config.app_secret)
```

Tests inject fake channel factories and never import or connect the real SDK.

## Message Conversion

`sdk_message_to_raw_event(message, config)` should produce a shape compatible with `services.feishu_adapter.normalize_feishu_message`:

```python
{
  "header": {
    "event_id": "...",
    "event_type": "im.message.receive_v1",
    "app_id": config.app_id,
  },
  "event": {
    "sender": {"sender_id": {"open_id": "..."}},
    "message": {
      "message_id": "...",
      "chat_id": "...",
      "chat_type": "...",
      "content": "{\"text\":\"...\"}",
      "mentions": [...],
      "thread_id": "...",
      "root_id": "...",
      "parent_id": "...",
      "create_time": "...",
    },
  },
}
```

The converter should use tolerant attribute access because SDK message object fields may be dataclasses, dict-like payloads, or simple fake objects in tests.

## Transport Class

`FeishuChannelSDKTransport`:

- constructor receives channel, config, db factory, connectors, dependencies factory;
- `connect()` registers `channel.on("message", handler)` and awaits `channel.connect()`;
- handler converts SDK message to raw event and calls `handle_feishu_worker_raw_event` with close-owned dependencies;
- `disconnect()` awaits `channel.disconnect()` when available;
- stores or returns per-event outcomes for test/log integration.

## Worker Entrypoint

`run_feishu_channel_worker(db_factory, configured_settings=settings, channel_factory=create_feishu_channel)`:

1. Resolve worker config.
2. Open a DB session and load connectors.
3. Build transport with a dependency factory.
4. Await `transport.connect()`.

Normal config/connector failures return a structured startup outcome and do not start transport.

## Error Handling

Stable startup outcomes:

- `FEISHU_CHANNEL_TRANSPORT_SDK_MISSING`
- `FEISHU_CHANNEL_TRANSPORT_STARTED`
- `FEISHU_CHANNEL_TRANSPORT_CONFIG_FAILED`
- `FEISHU_CHANNEL_TRANSPORT_CONNECTOR_FAILED`
- `FEISHU_CHANNEL_TRANSPORT_START_FAILED`

Per-event outcomes are returned by `handle_feishu_worker_raw_event`.

## Rollback

Dependency and module are additive. If deployment does not use the Channel worker entrypoint, the existing backend API and worker runtime remain unchanged.
