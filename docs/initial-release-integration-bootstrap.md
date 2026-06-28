# Initial Release Integration Bootstrap

This runbook creates the non-secret Feishu/Jira connector and route rows required for the 7-15 initial release live-run.

It does not create SmallKhoj product identities. Pick existing `server_id`, `channel_id`, `creator_id`, and `assignee_id` first so the live run lands in the intended channel and targets the intended agent.

## Command

Run from `backend/` with the deployment database configured in `DATABASE_URL`:

```bash
PYTHONPATH=. uv run python -m integration_bootstrap_cli \
  --server-id <server_uuid> \
  --channel-id <channel_uuid> \
  --creator-id <human_member_uuid> \
  --assignee-id <agent_member_uuid> \
  --feishu-chat-id <oc_or_ou_chat_id> \
  --feishu-chat-type group \
  --feishu-app-id <cli_app_id> \
  --feishu-bot-open-id <ou_bot_open_id> \
  --feishu-bot-name SmallKhoj \
  --jira-site-url https://your-team.atlassian.net
```

The command is idempotent for the same connector and route names. Re-running it updates the non-secret config and route target instead of creating duplicate connector/route rows.

## Output

The command prints JSON with:

- Feishu connector ID;
- Jira connector ID;
- Feishu route ID;
- env var names needed by the Feishu worker runtime.

Use the printed IDs in runtime env:

```bash
FEISHU_WORKER_ENABLED=true
FEISHU_WORKER_CONNECTOR_ID=<printed_feishu_connector_id>
FEISHU_WORKER_JIRA_CONNECTOR_ID=<printed_jira_connector_id>
FEISHU_WORKER_CREATOR_ID=<printed_creator_id>
FEISHU_WORKER_BOT_OPEN_ID=<bot_open_id>
FEISHU_WORKER_BOT_NAME=SmallKhoj
FEISHU_WORKER_APP_ID=<cli_app_id>
FEISHU_WORKER_APP_SECRET=<set outside repo>
JIRA_EMAIL=<set outside repo>
JIRA_API_TOKEN=<set outside repo>
```

## Secrets

Do not pass these values to the bootstrap command and do not store them in connector config:

- Feishu app secret;
- Feishu access tokens;
- Jira API token;
- Tencent Cloud credentials;
- daemon connect tokens.

The bootstrap command stores only:

- Feishu app ID, bot open ID, and bot name;
- Jira site URL;
- Feishu chat route selector;
- SmallKhoj channel and assignee references.

## Route Contract

The created Feishu route matches the current adapter source shape:

```json
{
  "chatId": "<feishu_chat_id>",
  "chatType": "group",
  "command": "jira_analysis"
}
```

The first supported command is:

```text
@SmallKhoj 分析 JIRA-123
```

When this route matches, the event loop can create a SmallKhoj message/task/TaskRun, read the Jira issue, and later use the existing write-back hooks for Jira/Feishu terminal updates.

## Failure Modes

- Missing server/channel/creator/assignee ID: command exits non-zero before creating connector or route rows.
- Existing channel/member belongs to a different server: command exits non-zero.
- Existing connector or route is disabled: bootstrap reactivates the selected initial-release rows, because the operator is explicitly preparing the live-run path.
- Invalid worker credentials: bootstrap still succeeds; the Feishu worker will report runtime config or provider errors when launched.
