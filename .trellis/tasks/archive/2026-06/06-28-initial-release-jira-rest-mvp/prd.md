# Initial release Jira REST MVP

## Goal

Implement the first Jira outbound REST integration slice for the 7-15 release-grade loop: SmallKhoj can read a Jira issue, append a result/evidence comment, and persist mappings between SmallKhoj local objects and Jira issue/comment objects through the integration gateway foundation.

This is not a generic Jira project-management feature. It exists to support the primary release scenario:

`@SmallKhoj 分析 JIRA-123 -> read Jira issue -> create/run SmallKhoj TaskRun -> append Jira comment -> preserve evidence/mapping`

## Parent And Dependency

- Parent task: `.trellis/tasks/06-28-07-15-initial-release/`.
- Depends on `.trellis/tasks/06-28-initial-release-integration-gateway-foundation/` and commit `e3a1a65`.
- The integration gateway owns connector/event/mapping records. Jira service code must not create a parallel integration state model.

## Confirmed API Evidence

- Atlassian Jira Cloud REST API v3 supports issue lookup with `GET /rest/api/3/issue/{issueIdOrKey}`.
- Atlassian Jira Cloud REST API v3 supports adding comments with `POST /rest/api/3/issue/{issueIdOrKey}/comment`.
- Jira Cloud comment body uses Atlassian Document Format (ADF), so plain SmallKhoj output must be converted to an ADF document before write-back.
- MVP auth should support Jira Cloud basic auth using email + API token, stored outside source control and represented through `ExternalConnector.secret_ref` or a runtime-provided secret dict.

Sources:

- `https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/`
- `https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/`

## Requirements

- **R1: Jira connector config contract.** A Jira connector must provide a `siteUrl` in non-secret config and credentials through explicit runtime input or a secret reference; tests must not commit real credentials.
- **R2: Issue lookup.** Backend service can fetch a Jira issue by key or id and return a normalized issue summary useful for TaskRun prompt construction.
- **R3: Comment write-back.** Backend service can append a plain-text SmallKhoj result/evidence comment by converting it to Jira ADF and calling Jira REST.
- **R4: Mapping persistence.** Successful issue/comment operations must create `ExternalMapping` rows for local `task`, `task_run`, or `message` records to Jira `issue` / `comment`.
- **R5: Failure evidence.** Auth failure, issue not found, malformed connector config, Jira API error, and comment write failure must return structured failure codes/reasons and must not erase local TaskRun output.
- **R6: Gateway boundary.** Jira REST code must use `services.integration_gateway` for mappings and status evidence. It must not execute daemon/runtime work.
- **R7: Testability.** Tests must use an injected HTTP client/fake transport; no real Jira network calls are required for unit tests.
- **R8: Secret redaction.** Jira email/API token must not appear in serialized connector payloads, event normalized payloads, mappings, or test snapshots.

## Scope

- Add backend Jira service module.
- Add request/response normalization and ADF conversion.
- Add tests for issue lookup, comment write-back, mappings, and failure codes.
- Optionally add minimal config dataclasses/types.
- No frontend settings UI.
- No Jira webhook ingestion.
- No Jira workflow transition/update status.
- No real credential management system beyond respecting `ExternalConnector.secret_ref` and injected credentials.

## Acceptance Criteria

- [ ] Jira service validates `siteUrl` and credential inputs without reading secrets from source-controlled files.
- [ ] Jira issue lookup uses `GET /rest/api/3/issue/{issueIdOrKey}` and normalizes key, summary, status, url, and description/context fields where available.
- [ ] Jira comment append uses `POST /rest/api/3/issue/{issueIdOrKey}/comment` with ADF body.
- [ ] Plain text comment content is converted to a valid minimal ADF document.
- [ ] Successful issue lookup can create or upsert a Jira issue mapping for a local object when requested.
- [ ] Successful comment append creates an `ExternalMapping` from local `task_run` or `message` to Jira `comment`.
- [ ] API/auth/not-found/comment failures return structured local errors with stable failure codes.
- [ ] Tests prove no Jira token/email appears in serialized connector/event/mapping payloads.
- [ ] Tests prove Jira service does not import daemon/runtime execution helpers.
- [ ] Existing integration gateway and TaskRun tests still pass.

## Non-Goals

- Do not implement Jira webhook ingestion.
- Do not implement Jira issue transitions/status changes.
- Do not create a full Jira settings/admin UI.
- Do not create a second connector/mapping store outside the integration gateway.
- Do not require public HTTPS or domain setup for Jira REST MVP.

## Open Questions

No blocking user decision remains for this child. The recommended first Jira write-back is issue lookup plus append comment, not create issue or workflow status transition.
