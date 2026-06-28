# Initial release integration bootstrap CLI design

## Boundary

The bootstrap command is an operational bridge between existing database state and the Feishu worker runtime. It should not become an admin product surface or a second integration service.

It owns:

- validating existing SmallKhoj IDs for server, channel, creator, and assignee;
- creating/updating non-secret Feishu/Jira connector records;
- creating/updating one Feishu route for `jira_analysis`;
- printing worker env guidance.

It does not own:

- Feishu/Jira network calls;
- runtime execution;
- daemon/computer identity creation;
- secret storage;
- product onboarding UI.

## Proposed Files

- `backend/services/integration_bootstrap.py`
  - pure service logic and dataclasses;
  - async DB operations;
  - deterministic idempotency rules;
  - output serializer for CLI/runbook use.
- `backend/integration_bootstrap_cli.py`
  - small `argparse` entrypoint;
  - opens `models.async_session`;
  - commits on success and rolls back on failure;
  - prints JSON so shell scripts can consume the IDs.
- `backend/tests/test_integration_bootstrap.py`
  - fake or lightweight session tests for service behavior;
  - no network calls.
- `docs/initial-release-integration-bootstrap.md`
  - operator runbook with example command and env vars.
- `backend/models/slock.py` and `backend/models/seed.py`
  - allow `assignment_mode="external_feishu"` consistently.

## Data Flow

1. Operator identifies existing `server_id`, `channel_id`, `creator_id`, and `assignee_id`.
2. Operator runs the CLI with Feishu chat selector and Jira site URL.
3. Bootstrap validates the referenced rows exist and belong to the server.
4. Bootstrap upserts:
   - Feishu connector by `(server_id, provider="feishu", name)`;
   - Jira connector by `(server_id, provider="jira", name)`;
   - Feishu route by `(server_id, connector_id, name)`.
5. Bootstrap ensures creator and assignee are channel members.
6. Bootstrap prints:
   - connector IDs;
   - route ID;
   - required env var names and placeholder values for secrets.

## Idempotency Rules

There are no uniqueness constraints for connector name or route name, so the service must query first and update in place:

- connector lookup: `server_id`, `provider`, `name`;
- route lookup: `server_id`, `connector_id`, `name`.

If a matching row exists, update its non-secret config and set status to `active`. Do not create another row.

## Secret Handling

Persisted config may include:

- Feishu `appId`;
- Feishu `botOpenId`;
- Feishu `botName`;
- Jira `siteUrl`.

Persisted config must not include:

- Feishu `appSecret`;
- Feishu access tokens;
- Jira API token;
- Jira email if the operator treats it as credential material;
- Tencent Cloud credentials.

The CLI should not expose arguments for secret values. It should print placeholders that tell the operator which environment variables to set.

## Route Shape

The first live-run route should match the current Feishu adapter source object:

```json
{
  "chatId": "oc_xxx",
  "chatType": "group",
  "command": "jira_analysis"
}
```

The route should point to:

- `channel_id`: selected SmallKhoj channel;
- `default_assignee_id`: selected agent member;
- `runtime_rule`: operator-readable metadata for later runtime targeting;
- `writeback_policy`: `{ "feishu": true, "jira": true }`.

## Compatibility

The bootstrap command depends on the existing integration gateway schema and does not add new tables.

The `external_feishu` assignment mode compatibility fix is required because the release loop already uses that value. This is a schema contract repair, not a new product capability.

## Rollback

The CLI runs in one DB transaction. On validation or persistence failure it rolls back and exits non-zero.

Because this task adds no new tables and stores no secrets, rollback is limited to reverting the service/CLI/test/docs changes. Existing manually-created connector/route rows can be disabled by setting `status="disabled"` outside this task's code path.
