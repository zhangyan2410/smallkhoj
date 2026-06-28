# Feishu long-connection MVP design

## Boundary

This child implements the backend adapter/dispatcher boundary for Feishu message events. It does not need a production long-connection worker to pass; production worker wiring can call this service later.

Target flow:

`Feishu long-conn SDK -> normalized message -> Feishu dispatcher -> integration gateway event/session/route -> parsed command`

The dispatcher stops before TaskRun execution.

## Service Shape

Recommended module:

`backend/services/feishu_adapter.py`

Recommended structures:

- `FeishuInboundMessage`
- `FeishuCommand`
- `FeishuDispatchOutcome`

Recommended operations:

- `normalize_feishu_message(raw_event)`
- `is_message_addressed_to_bot(message, bot_open_id=None, bot_name=None)`
- `parse_feishu_command(message)`
- `dispatch_feishu_message(db, message, connector_id, server_id, bot_name="SmallKhoj")`

## Normalized Message Fields

- `event_id`
- `message_id`
- `chat_id`
- `chat_type`: `p2p`, `group`, `unknown`
- `sender_open_id`
- `text`
- `mentions`
- `thread_id`
- `root_id`
- `parent_id`
- `create_time`
- `addressed_to_bot`

The raw Feishu SDK event should be translated into this shape before business logic.

## Command Parser

Supported first command:

```text
@SmallKhoj 分析 JIRA-123
分析 JIRA-123
```

Rules:

- Strip common mention text such as `@SmallKhoj`.
- Accept Jira keys matching `[A-Z][A-Z0-9]+-\d+`.
- Return command kind `jira_analysis` with `jiraIssueKey`.
- Unknown command should not create local work.

## Integration Gateway Use

Event claim:

```text
provider = feishu
dedup_key = feishu:{event_id or message_id}
```

Route source:

```json
{
  "chatId": "...",
  "chatType": "group",
  "command": "jira_analysis"
}
```

Session scope:

- Use `thread` if `thread_id` exists.
- Otherwise use `chat`.

## Outcomes

Recommended stable statuses:

- `accepted`
- `duplicate`
- `dropped`
- `no_route`
- `disabled_route`
- `unknown_command`
- `unaddressed_group`
- `needs_binding`

This child may defer user binding persistence, but the outcome category must exist.

## Security And Privacy

- Unknown/unaddressed group messages should not become channel/task content.
- Event normalized payload should store minimal metadata and command text only after the group/addressing filter.
- No Feishu app secret should be stored or serialized by this child.

## Follow-Up

The next child should orchestrate:

`accepted Feishu jira_analysis command -> Jira issue lookup -> TaskRun creation -> Jira comment write-back -> Feishu reply`
