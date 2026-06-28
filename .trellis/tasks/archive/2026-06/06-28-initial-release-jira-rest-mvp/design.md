# Jira REST MVP design

## Boundary

This child implements outbound Jira REST read/write-back only.

It should produce a service that later Feishu and TaskRun orchestration can call:

`Jira issue key -> Jira issue context -> TaskRun prompt/evidence -> Jira comment write-back -> ExternalMapping`

It must not introduce inbound Jira webhook ingestion or runtime execution.

## Service Shape

Recommended module:

`backend/services/jira_rest.py`

Recommended public functions:

- `resolve_jira_config(connector, credentials=None)`
- `jira_issue_url(config, issue_key)`
- `jira_text_to_adf(text)`
- `fetch_jira_issue(http_client, config, issue_key)`
- `append_jira_comment(http_client, config, issue_key, text)`
- `map_jira_issue(...)`
- `map_jira_comment(...)`

The service should be designed around an injected async HTTP client. Tests should use a fake client with recorded requests and responses.

## Config Contract

Connector non-secret config:

```json
{
  "siteUrl": "https://example.atlassian.net"
}
```

Runtime-provided credentials:

```json
{
  "email": "operator@example.com",
  "apiToken": "..."
}
```

Credential lookup from `secret_ref` is intentionally deferred. The service should accept explicit credentials now so tests and later runtime wiring can avoid source-controlled secrets.

## REST Contract

Issue lookup:

```text
GET {siteUrl}/rest/api/3/issue/{issueIdOrKey}
Authorization: Basic base64(email:apiToken)
Accept: application/json
```

Comment append:

```text
POST {siteUrl}/rest/api/3/issue/{issueIdOrKey}/comment
Authorization: Basic base64(email:apiToken)
Accept: application/json
Content-Type: application/json
Body: {"body": <ADF document>}
```

## Normalized Issue Shape

Return a small, TaskRun-friendly shape:

- `key`
- `id`
- `url`
- `summary`
- `status`
- `descriptionText`
- `rawFields` only where safe and useful

The first release should not require full ADF parsing. If Jira description is ADF, extract plain text from common `text` nodes recursively.

## Failure Codes

Use stable local failure codes:

- `JIRA_CONFIG_MISSING_SITE_URL`
- `JIRA_CONFIG_INVALID_SITE_URL`
- `JIRA_CREDENTIALS_MISSING`
- `JIRA_ISSUE_NOT_FOUND`
- `JIRA_AUTH_FAILED`
- `JIRA_API_FAILED`
- `JIRA_COMMENT_FAILED`

Failures should include human-readable reasons and optional HTTP status, but not credentials.

## Mapping Contract

Successful issue lookup may create:

```text
local task/message/task_run -> external issue
```

Successful comment append should create:

```text
local task_run/message -> external comment
```

Use `services.integration_gateway.create_external_mapping`.

## Security

- Never log or serialize API tokens.
- Never store token/email in `ExternalEvent.normalized`.
- Keep credentials out of `.env.example` unless a placeholder is clearly non-secret.
- Fake tests must assert outgoing `Authorization` exists but not print the raw token.

## Rollback

The service is additive. If Jira write-back fails in the later full scenario, SmallKhoj should keep local TaskRun output and record write-back failure through integration gateway event status.
