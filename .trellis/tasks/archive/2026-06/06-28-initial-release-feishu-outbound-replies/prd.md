# Initial release Feishu outbound replies

## Goal

Add a minimal Feishu outbound reply service for accepted/result/failure messages using injectable HTTP dependencies and external mappings, without implementing the full long-connection worker yet.

## Background

The initial release parent requires Feishu task entry plus accepted/running/result/failure responses. Current code has inbound Feishu normalization/dispatch and the Feishu -> Jira -> TaskRun -> Jira write-back loop, but no Feishu outbound reply service.

Reference evidence from Multica's Lark implementation:

- Successful/free-form replies should usually be normal text IM messages, not noisy cards.
- Failure replies may later become cards, but the first SmallKhoj slice can use concise text.
- Thread reply should target the source message only when a thread/source message is available.
- Blind fallback from thread reply to chat-level send can duplicate or leak a reply; fallback classification is a later hardening step.

## Requirements

- **R1: Feishu text send.** Provide a service operation that sends a text message to a Feishu chat using an injected HTTP client and access token.
- **R2: Thread/source reply target.** When a source message id is supplied, use Feishu's reply endpoint; otherwise send at chat level by `chat_id`.
- **R3: Stable Feishu errors.** Missing config/token/chat/text and provider failures return typed local errors.
- **R4: Mapping.** Successful sends create an `ExternalMapping` row linking the local task_run/message/event context to the Feishu reply message id.
- **R5: Secret boundary.** Feishu access tokens are runtime inputs or future secret-manager outputs, not stored in mappings/event payloads.
- **R6: Testability.** Unit tests use fake HTTP clients; no real Feishu network calls.
- **R7: Boundary.** The reply service must not execute daemon/runtime work or own the long-connection receive loop.

## Acceptance Criteria

- [ ] Text send uses `POST /open-apis/im/v1/messages?receive_id_type=chat_id` with `msg_type=text` and JSON-string content.
- [ ] Source-message reply uses `POST /open-apis/im/v1/messages/{message_id}/reply`.
- [ ] Successful sends return reply message id/url and create `ExternalMapping(provider="feishu", external_type="message")`.
- [ ] Feishu API errors expose stable local failure codes and do not store tokens in persisted payloads.
- [ ] Empty text/chat/token are rejected before HTTP.
- [ ] Tests prove the service does not import daemon/runtime execution helpers.
- [ ] Existing Feishu, gateway, release-loop, TaskRun, and Jira tests still pass.

## Notes

- This task does not implement the production `lark-oapi` long-connection worker or a tenant token fetch/cache. It provides the outbound boundary that those workers can call.
