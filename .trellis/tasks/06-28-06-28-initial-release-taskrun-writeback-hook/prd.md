# Initial release TaskRun write-back hook

## Goal

Automatically trigger external Jira write-back when a TaskRun reaches a terminal lifecycle state, without making TaskRun completion depend on external network success.

## Background

The current 7-15 release branch already has the service-level loop:

`Feishu accepted jira_analysis command -> Jira issue lookup -> SmallKhoj message/task/TaskRun state -> Jira comment write-back`

The missing product behavior is that TaskRun completion does not yet cause the write-back path to run. Operators would need a manual orchestration call, which is not an end-to-end release loop.

## Dependencies

- Parent task: `.trellis/tasks/06-28-07-15-initial-release/`.
- Depends on release loop commit `a7af7ee`.
- Depends on integration gateway foundation commit `e3a1a65`.
- Depends on Jira REST MVP commit `8591b10`.
- Depends on Feishu entry adapter commit `f50285c`.

## Requirements

- **R1: Terminal-only trigger.** The hook runs only when a TaskRun reaches `completed`, `failed`, or `cancelled`.
- **R2: Local completion is authoritative.** A Jira write-back failure must not roll back or erase the local TaskRun lifecycle update.
- **R3: Idempotency.** A TaskRun that already has a Jira comment mapping must not create another comment on repeated lifecycle reports.
- **R4: Mapping-driven routing.** The hook must discover Jira issue context from existing external mappings and/or linked external events rather than hard-coding Feishu-specific assumptions in the lifecycle endpoint.
- **R5: Thin router.** The agent API route may trigger the hook, but Jira/Feishu logic must stay in backend services.
- **R6: Explicit dependency injection.** HTTP client, Jira connector, and Jira credentials must be injectable for tests and later production secret wiring.
- **R7: Missing configuration is structured.** If the hook cannot resolve Jira connector/credentials/issue mapping, it returns a typed skipped or failed outcome instead of crashing the TaskRun endpoint.
- **R8: Evidence preservation.** When write-back fails, the linked external event should retain a readable failure code/reason when one is available.
- **R9: Testability.** Tests must use fake sessions and fake HTTP clients; no real Feishu/Jira network calls.

## Acceptance Criteria

- [ ] Non-terminal lifecycle updates do not call Jira write-back.
- [ ] Terminal lifecycle updates call the write-back service when a Jira issue mapping and connector context are available.
- [ ] Existing Jira comment mappings make the hook return an idempotent skipped result.
- [ ] Jira API failures are converted into a structured hook failure and do not prevent the TaskRun update from being committed.
- [ ] Missing connector/credential context is observable as a structured skipped result.
- [ ] The agent lifecycle endpoint can trigger the hook without embedding Jira request construction in router code.
- [ ] Tests prove the hook does not import daemon/runtime execution helpers.
- [ ] Existing TaskRun, release loop, Jira, Feishu, and integration gateway tests still pass.

## Notes

- This task does not implement the final secret manager. It keeps the production boundary explicit so the next deployment task can wire credentials without changing TaskRun lifecycle semantics.
