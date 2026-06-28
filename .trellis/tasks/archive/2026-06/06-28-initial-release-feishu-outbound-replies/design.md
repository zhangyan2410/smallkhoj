# Initial release Feishu outbound replies design

## Boundary

Add `backend/services/feishu_replies.py`.

Responsibilities:

- Validate Feishu reply inputs.
- Build Feishu Open Platform text-send HTTP requests.
- Parse Feishu API response shape.
- Persist successful local-to-external reply mappings.
- Return stable local error codes.

Non-responsibilities:

- Long-connection receive loop.
- Tenant access token acquisition/cache.
- Interactive card design.
- Runtime/daemon execution.

## HTTP Contract

Chat-level send:

```text
POST {base_url}/open-apis/im/v1/messages?receive_id_type=chat_id
Authorization: Bearer <token>
Content-Type: application/json

{
  "receive_id": "<chat_id>",
  "msg_type": "text",
  "content": "{\"text\":\"...\"}"
}
```

Source-message reply:

```text
POST {base_url}/open-apis/im/v1/messages/{source_message_id}/reply
Authorization: Bearer <token>
Content-Type: application/json

{
  "msg_type": "text",
  "content": "{\"text\":\"...\"}"
}
```

The service defaults base URL to `https://open.feishu.cn`, with injected config for tests or future Lark global deployment.

## Data Mapping

Successful send maps:

- `provider="feishu"`
- `local_type`: caller-provided, usually `task_run`, `message`, or `external_event`
- `local_id`: caller-provided UUID
- `external_type="message"`
- `external_id=<Feishu message_id>`
- `external_url`: optional, likely unavailable for the first slice
- metadata can record `chatId` and `sourceMessageId`, not tokens.

## Error Codes

- `FEISHU_REPLY_CONFIG_MISSING_BASE_URL`
- `FEISHU_REPLY_CREDENTIALS_MISSING`
- `FEISHU_REPLY_CHAT_MISSING`
- `FEISHU_REPLY_TEXT_MISSING`
- `FEISHU_REPLY_API_FAILED`
- `FEISHU_REPLY_RESPONSE_MISSING_MESSAGE_ID`

## Future Extensions

- Runtime dependency builder for Feishu app credentials and tenant token acquisition.
- Accepted/running/result/failure orchestration helpers that call this service.
- Thread fallback classification.
- Failure card renderer.
