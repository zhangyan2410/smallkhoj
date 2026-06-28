# Initial release integration bootstrap CLI

## Goal

Add a repeatable backend bootstrap command for configuring the Feishu/Jira connector and route records needed by the 7-15 initial release live-run, without storing real secrets in the repository or requiring manual database edits.

This task moves the release loop from "service code exists" to "operator can configure and start a real integration worker with known connector IDs."

## Background

The parent release task targets this product loop:

`Feishu task entry -> integration gateway event/session/route/mapping -> Jira issue lookup -> SmallKhoj channel/message/task/TaskRun -> daemon/runtime execution path -> Jira write-back -> Feishu accepted/result/failure replies`

The backend already has the integration gateway, Jira REST service, Feishu adapter, release loop, write-back hook, Feishu replies, event loop, worker runtime boundary, and Feishu channel SDK transport. The remaining blocker before a live run is repeatable configuration:

- Feishu and Jira `ExternalConnector` rows must exist with stable IDs.
- A Feishu `ExternalRoute` must map the selected Feishu chat/command to a SmallKhoj channel and default assignee.
- The Feishu worker env needs connector IDs, creator ID, bot identity, and app credentials.
- Real credentials must stay in runtime env or external secret stores, not in task docs, tests, route records, or committed examples.
- The current real DB path has a constraint gap: `release_loop.py` creates TaskRun assignments with `assignment_mode="external_feishu"`, but the ORM/startup DDL check constraint does not currently allow that value.

## Requirements

- Provide a backend CLI entrypoint that can be run with `python -m ...` under `backend/` and uses the existing async SQLAlchemy session.
- The command must be idempotent: repeated runs with the same server/channel/member/chat parameters update or reuse the same bootstrap records rather than creating duplicates.
- The command must create or update:
  - a Feishu `ExternalConnector`;
  - a Jira `ExternalConnector`;
  - a Feishu `ExternalRoute` matching `chatId`, `chatType`, and `command="jira_analysis"`;
  - channel membership for the creator and assignee when the referenced channel/member rows exist.
- The command must require existing server, channel, creator member, and assignee member references. It should not silently create product identity records that the operator has not chosen.
- The command must store only non-secret connector config, such as Jira `siteUrl`, Feishu app ID, and route selectors. It must not accept or persist Jira API tokens, Feishu app secrets, access tokens, or cloud credentials.
- The command must print the exact env var names and generated IDs needed to run the Feishu worker:
  - `FEISHU_WORKER_ENABLED`
  - `FEISHU_WORKER_CONNECTOR_ID`
  - `FEISHU_WORKER_JIRA_CONNECTOR_ID`
  - `FEISHU_WORKER_CREATOR_ID`
  - `FEISHU_WORKER_BOT_OPEN_ID`
  - `FEISHU_WORKER_BOT_NAME`
  - `FEISHU_WORKER_APP_ID`
  - `FEISHU_WORKER_APP_SECRET`
  - `JIRA_EMAIL`
  - `JIRA_API_TOKEN`
- The command must be testable with fake DB sessions and must not make real Feishu/Jira network calls.
- The release loop's `external_feishu` TaskRun assignment mode must be legal in both the ORM model and startup DDL, because bootstrap is intended to support a real database live run.
- Documentation should be enough for an operator to run the bootstrap locally or on the deployment host without looking up implementation details.

## Acceptance Criteria

- [x] A unit test proves the bootstrap creates Feishu/Jira connectors and one matching Feishu route from existing server/channel/member IDs.
- [x] A unit test proves repeated bootstrap input is idempotent and does not add duplicate connector/route rows.
- [x] A unit test proves secret-shaped inputs are rejected or excluded from persisted config/output.
- [x] A unit test proves missing server/channel/creator/assignee references fail with clear reason codes before partial route creation.
- [x] A unit test or model/DDL test proves `assignment_mode="external_feishu"` is accepted consistently by the ORM declaration and `backend/models/seed.py`.
- [x] The CLI entrypoint prints generated connector IDs and env var guidance required by `services.feishu_worker_runtime.resolve_feishu_worker_config`.
- [x] No real Feishu, Jira, Tencent Cloud, or daemon credentials are committed.
- [x] Targeted backend tests pass for bootstrap, integration gateway, Feishu adapter/worker, release loop, and task run constraints.

## Verification

- `rtk env PYTHONPATH=. uv run pytest tests/test_integration_bootstrap.py tests/test_task_runs.py tests/test_integration_gateway.py`
- `rtk env PYTHONPATH=. uv run pytest tests/test_feishu_adapter.py tests/test_feishu_worker_runtime.py tests/test_feishu_event_loop.py tests/test_release_loop.py`
- `rtk env PYTHONPATH=. uv run pytest`
- `rtk env PYTHONPATH=. uv run python -m compileall services integration_bootstrap_cli.py models`
- `rtk env PYTHONPATH=. uv run python -m integration_bootstrap_cli --help`
- `rtk python3 ./.trellis/scripts/task.py validate 06-28-initial-release-integration-bootstrap-cli`

## Out Of Scope

- Running the real Feishu SDK connection.
- Creating a full integration settings UI.
- Creating missing servers, channels, members, computers, or daemon identities.
- Encrypting persisted secrets. This task avoids persisted secrets entirely.
- Deployment automation with TencentCloud CLI.
