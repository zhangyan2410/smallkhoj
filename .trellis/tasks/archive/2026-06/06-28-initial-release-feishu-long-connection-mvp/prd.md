# Initial release Feishu long-connection MVP

## Goal

Implement the backend Feishu entry boundary for the 7-15 release loop: a Feishu/Lark message event can be normalized, filtered, deduplicated, routed through the integration gateway, and parsed into the first supported task command:

`@SmallKhoj 分析 JIRA-123`

This child should prepare SmallKhoj for Feishu long-connection delivery without turning Feishu into a generic chatbot or a second runtime execution system.

## Parent And Dependencies

- Parent task: `.trellis/tasks/06-28-07-15-initial-release/`.
- Depends on integration gateway foundation commit `e3a1a65`.
- Depends on Jira REST MVP commit `8591b10`.
- The adapter must use `services.integration_gateway` for event claim/dedup, route outcomes, session binding, and mappings.
- The adapter must not call daemon/runtime execution helpers directly.

## Confirmed Evidence

- Multica's `/Users/code/project/multica/server/internal/integrations/lark/` keeps long-connection transport separate from dispatcher/business logic.
- Multica dispatcher uses typed outcomes: dropped, needs binding, ingested, agent offline, agent archived.
- Multica stores dedup/audit/bindings separately and avoids persisting unbound/unauthorized message bodies into chat content.
- Feishu/Lark long-connection mode is outbound from the app worker and is preferable for this release because it reduces dependence on public inbound webhook/ICP/domain readiness.
- Feishu/Lark message receive events use `im.message.receive_v1`; the Python ecosystem uses the official `lark-oapi` SDK for production long-connection workers.

## Requirements

- **R1: Normalized message shape.** Add a backend Feishu/Lark normalized inbound message model independent from raw SDK JSON.
- **R2: Group filter.** Group chat messages should enter SmallKhoj only when explicitly addressed to the bot or when the event is a direct/p2p message.
- **R3: Command parser.** Support the first command shape: optional bot mention plus `分析 <JIRA-KEY>`, returning a structured command with `jiraIssueKey`.
- **R4: Event claim/dedup.** Feishu message events must claim an `ExternalEvent` with provider `feishu` and stable dedup key before creating any local work.
- **R5: Route resolution.** The adapter must resolve an `ExternalRoute` by connector/source shape and return typed outcomes for matched, disabled, or no route.
- **R6: Drop/audit outcomes.** Duplicate, unaddressed group message, unknown command, unknown route, and missing binding must be representable without creating task/channel content.
- **R7: Session binding.** Accepted messages should create or reuse an `ExternalSession` keyed by Feishu chat/thread/topic identifiers.
- **R8: Jira command bridge.** The parsed Jira issue key should be available to later orchestration so the next child can call Jira lookup and TaskRun creation.
- **R9: Runtime boundary.** Feishu adapter must not execute daemon/runtime/model work directly.
- **R10: Testability.** Unit tests must use normalized fake events and fake sessions; no real Feishu connection or credentials are required in this child.

## Scope

- Backend Feishu adapter/dispatcher service.
- Normalized message dataclasses or equivalent typed structures.
- Command parser and route/drop outcome handling.
- Integration gateway calls for event claim, route resolution, session creation, and link/drop state.
- Tests covering group filtering, parser, dedup, route outcomes, session creation, and runtime boundary.

## Out Of Scope

- Full production `lark-oapi` long-connection worker process.
- Feishu interactive cards.
- Feishu user binding UI.
- Full Feishu app install/device flow.
- Jira issue lookup + TaskRun + comment orchestration; that is the next vertical-loop child.
- Frontend settings UI.

## Acceptance Criteria

- [ ] Feishu message normalization is independent from raw SDK JSON.
- [ ] `@SmallKhoj 分析 JIRA-123` and `分析 JIRA-123` in direct chat parse to a Jira analysis command.
- [ ] Unaddressed group messages are dropped/audited and do not create local channel/task content.
- [ ] Duplicate Feishu events return a duplicate/drop outcome through integration gateway claim logic.
- [ ] Unknown command and unknown route outcomes contain stable failure codes and readable reasons.
- [ ] Matched route creates/reuses an external session and links the external event to route/session/channel context.
- [ ] Accepted outcome exposes the parsed Jira issue key for the next orchestration slice.
- [ ] Tests prove no daemon/runtime execution helpers are imported or called.
- [ ] Existing Jira REST, integration gateway, and TaskRun tests still pass.

## Open Questions

No blocking user decision remains for this child. The first supported command is `分析 JIRA-123`; broader Feishu card/binding/install flows are deferred.
