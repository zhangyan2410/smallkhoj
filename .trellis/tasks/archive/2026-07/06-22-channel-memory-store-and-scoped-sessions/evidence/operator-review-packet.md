# Operator Review Packet

Date: 2026-06-23
Worktree: `/Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions`
Branch: `feat/channel-memory-store-and-scoped-sessions`
Task: `.trellis/tasks/06-22-channel-memory-store-and-scoped-sessions`

## Review Purpose

This packet exists for the remaining human sign-off checkbox in `task-plan.md`:

```text
- [ ] PRD reviewed with operator.
```

The implementation and automated verification are complete for the first server-owned channel/task memory and scoped runtime session slice. The operator review should decide whether the delivered slice matches the intended product boundary, not whether later projection work such as FUSE is complete.

## First-Slice Scope

The branch delivers these user-visible and agent-visible capabilities:

- Server-owned `agent`, `channel`, `thread`, and `task` memory entries with path-like organization.
- Memory provenance, metadata, version/hash, CAS conflict behavior, soft delete, and proposal audit records.
- Public/UI and agent memory APIs for list, read, search, write, propose, proposal accept/reject, delete, and context manifests.
- `slock memory ...` and `slock task summary/promote` agent-facing commands.
- Scoped runtime sessions for DM, channel, thread, and task contexts.
- Selective runtime prompt memory context for channel/thread/task scopes, using snippets and read-more hints rather than raw full memory.
- DM scope protection so direct messages do not accidentally receive channel memory context.
- Channel Memory UI for channel knowledge, task outputs, promotions, and proposal review.
- Task Recovery UI for brief, plan, progress, outputs/evidence, final summary, task breakdown, images, videos, files, and provenance.

## Operator Acceptance Checklist

Use this checklist for sign-off:

- [ ] The first slice being reviewed is server-owned memory plus scoped runtime sessions, not FUSE/local filesystem projection.
- [ ] Channel/task memory being the backend/control-plane source of truth matches the desired product direction.
- [ ] Agent private memory remains separate from shared channel/task memory.
- [ ] Private channel/task memory permission behavior is acceptable for this slice.
- [ ] Proposal review and audit visibility are acceptable as the initial operator trust surface.
- [ ] Task Recovery and Channel Memory surfaces are rich enough for post-compaction recovery and multi-agent handoff.
- [ ] Selective memory context injection is acceptable; full channel memory is intentionally not injected every turn.
- [ ] The deferred items below are acceptable follow-up work and do not block this branch.

If all items are acceptable, the operator can approve with wording like:

```text
PRD reviewed and approved for the first server-owned memory/scoped-session slice.
FUSE/local projection and the listed follow-ups are accepted as later work.
```

After that explicit approval, the remaining `PRD reviewed with operator` checkbox in `task-plan.md` can be marked complete.

## Evidence To Inspect

Primary task documents:

- `prd.md`
- `design.md`
- `task-plan.md`
- `evidence/completion-audit.md`
- `evidence/final-validation.md`
- `evidence/quality-gate-report.md`

Real browser evidence:

- `evidence/REAL_memory_final_smoke_202606230338-channel-memory.png`
- `evidence/REAL_memory_final_smoke_202606230338-channel-memory.snapshot.txt`
- `evidence/REAL_memory_final_smoke_202606230338-task-recovery.png`
- `evidence/REAL_memory_final_smoke_202606230338-task-recovery.snapshot.txt`
- `evidence/REAL_memory_proposal_review_202606230249-before.png`
- `evidence/REAL_memory_proposal_review_202606230249-after-accept.png`

Reference research:

- `research/memory-fuse-reference.md`
- `research/clowder-task-evidence.md`
- `research/clowder-product-reference.md`
- `research/validation-plan.md`

Spec updates for future work:

- `.trellis/spec/backend/memory-contracts.md`
- `.trellis/spec/frontend/product-ui-style.md`

## Validation Summary

Recorded current-state checks:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest -q
```

Result after private-channel context-manifest permission fix: `74 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm test
```

Result: `141 passed`.

```bash
cd frontend
rtk npx tsx --test test/memory-presentation.test.ts && rtk npm run lint && rtk npm run build
```

Result: memory presentation tests `3 passed`; lint passed; production build passed.

```bash
rtk git diff --check
```

Result: pass.

Fresh WebDriver smoke used project `./twd` on temporary local ports `3014` and `8014`, then stopped the services. It verified:

- Channel Memory tab: `CHANNEL KNOWLEDGE`, `TASK OUTPUTS`, `PROMOTIONS`, rich output marker, accepted proposal marker.
- Task detail: `Task Recovery`, `4/4 recovery signals`, `Task breakdown`, `Outputs and evidence`, one loaded image, and one video element with controls.

Post privacy-fix WebDriver smoke used project `./twd` on temporary local ports `3015` and `8015`. It verified the same channel/task recovery surfaces after the private-channel context-manifest permission fix:

- Channel Memory tab: 4 entries, `CHANNEL KNOWLEDGE`, `TASK OUTPUTS`, `PROMOTIONS`, rich output marker, accepted proposal marker.
- Task detail: `Task Recovery`, `4/4 recovery signals`, `Task breakdown`, `Outputs and evidence`, one loaded image with natural dimensions, and one video element with controls.
- Evidence files:
  - `REAL_memory_post_privacy_fix_202606230400-channel-memory.png`
  - `REAL_memory_post_privacy_fix_202606230400-channel-memory.snapshot.txt`
  - `REAL_memory_post_privacy_fix_202606230400-task-recovery.png`
  - `REAL_memory_post_privacy_fix_202606230400-task-recovery.snapshot.txt`

After-main-frontend integration smoke used project `./twd` on temporary local ports `3015` and `8015` after manually integrating the root worktree's frontend identity/status design pieces into this feature worktree. It verified:

- Channel Memory tab: 4 entries, `CHANNEL KNOWLEDGE`, `TASK OUTPUTS`, `PROMOTIONS`, rich output marker, accepted proposal marker.
- Task detail: `Task Recovery`, `4/4 recovery signals`, `Task breakdown`, `Outputs and evidence`, one loaded image with natural dimensions, one video element with controls.
- API cross-check: `/api/v1/channels/slock/memory` returned 4 entries and `/api/v1/tasks/d5a0b61b-2631-4999-a23a-ab51dba0c5e0/memory` returned 7 entries.
- Frontend identity/status integration: shared Chinese status labels (`在线` / `离线`) rendered in the same browser pass.
- Evidence files:
  - `REAL_memory_after_main_frontend_20260623091939-channel-memory.png`
  - `REAL_memory_after_main_frontend_20260623091939-channel-memory.snapshot.txt`
  - `REAL_memory_after_main_frontend_20260623091939-task-recovery.png`
  - `REAL_memory_after_main_frontend_20260623091939-task-recovery.snapshot.txt`

## Mainline Merge Status

The feature branch and local `main` both currently point at `9014a1a`, so there is no newer local committed `main` work to merge into this branch at the time of this packet.

The root `/Users/code/project/smallkhoj` worktree still has uncommitted frontend changes. Relevant identity/status design pieces were manually integrated into this feature worktree and verified; root worktree files were not reverted, staged, committed, or pushed by this task.

## Deferred Follow-Ups

These are intentionally not first-slice blockers:

- FUSE/macFUSE/WinFsp local memory projection.
- Durable backend persistence for scoped provider session records.
- Automatic task memory summary/promotion on task status transition.
- Retention, TTL, quota, and large blob lifecycle cleanup policy.
- DnD hydration warning in `TaskBoard` sortable `aria-describedby` IDs.

## Final Privacy Gate

Independent check worker Mendel found one P1 before sign-off: task-scoped `/memory/context-manifest` could include private channel snippets for an agent who could see an assigned task but was not a private-channel member.

Fix:

- `backend/routers/agent_api.py` now re-resolves the associated channel through `resolve_memory_scope(..., "channel", ..., viewer=member)` before listing channel memory for task/thread manifests.
- If the viewer cannot see the channel, the route omits channel memories and still returns permitted task memories.
- Regression test `test_agent_memory_context_manifest_omits_private_channel_memory_for_task_visible_non_member` proves the private channel snippet is not returned.

Verification:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_agent_task_memory_handoff.py -q
```

Result: `13 passed`.

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_memory_store.py tests/test_public_memory_routes.py tests/test_agent_task_memory_handoff.py tests/test_public_events.py -q
```

Result: `38 passed`.

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest -q
```

Result: `74 passed`.

Mendel re-verified the fix independently after the patch and reported no remaining findings:

- regression test only: `1 passed`.
- positive + negative context-manifest tests: `2 passed`.
- route/test `py_compile`: pass.
- task handoff suite: `13 passed`.
- memory store + public memory routes: `12 passed`.

## Sign-Off Decision

Current status:

- Implementation: complete for first slice.
- Automated verification: complete in recorded evidence.
- Browser verification: complete in recorded evidence.
- Mainline merge: no newer committed local `main` delta at packet time.
- Remaining action: operator PRD review approval.
