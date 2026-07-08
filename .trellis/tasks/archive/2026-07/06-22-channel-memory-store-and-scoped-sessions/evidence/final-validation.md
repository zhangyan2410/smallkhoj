# Final Validation

Date: 2026-06-23
Worktree: `/Users/code/project/smallkhoj-channel-memory-store-and-scoped-sessions`
Branch: `feat/channel-memory-store-and-scoped-sessions`

## Mainline Merge

Main frontend work was fast-forward merged before final validation:

```bash
rtk git merge --ff-only main
```

Result: fast-forward to `9014a1a`.

Latest re-check after scoped prompt/context injection:

```bash
rtk git merge --ff-only main
```

Result: already up to date.

Final branch check after the last validation pass:

```bash
rtk git log --oneline --decorate --graph --max-count=8 --all
```

Result: `HEAD -> feat/channel-memory-store-and-scoped-sessions` and `main` both point at `9014a1a`, so there is no newer local `main` commit to merge.

## Subagent Verification

Final independent privacy check:

- Trellis check worker Mendel reviewed the final branch and found one P1 in the task-scoped memory context manifest.
- Issue: an agent who could see a private-channel task as creator/assignee but was not a channel member could receive private channel memory snippets through `/internal/agent-api/memory/context-manifest`.
- Fix: `backend/routers/agent_api.py` now re-resolves the associated channel with `resolve_memory_scope(..., "channel", ..., viewer=member)` before listing channel memories. A `403` omits channel memories while preserving allowed task memories.
- Regression: `test_agent_memory_context_manifest_omits_private_channel_memory_for_task_visible_non_member`.
- Verification after fix:
  - `cd backend && rtk env PYTHONPATH=. uv run pytest tests/test_agent_task_memory_handoff.py -q` -> `13 passed`.
  - `cd backend && rtk env PYTHONPATH=. uv run pytest tests/test_memory_store.py tests/test_public_memory_routes.py tests/test_agent_task_memory_handoff.py tests/test_public_events.py -q` -> `38 passed`.
  - `cd backend && rtk env PYTHONPATH=. uv run pytest -q` -> `74 passed`.
- Mendel re-verified the fix independently after the main-thread patch:
  - one-test regression pass: `1 passed`.
  - positive + negative context-manifest tests: `2 passed`.
  - `py_compile` for `routers/agent_api.py` and `tests/test_agent_task_memory_handoff.py`: pass.
  - task handoff suite: `13 passed`.
  - memory store + public memory routes: `12 passed`.
  - no remaining P0/P1/P2 findings.

Subagent Gauss performed independent command-level verification and fixed three issues:

- Daemon/CLI memory scope allowlist now uses backend memory scopes: `agent`, `channel`, `thread`, `task`.
- Added agent-private memory route coverage for `slock memory read --scope agent ...` and `daemon/memory.read`.
- Removed a frontend lint warning by keeping `agentId` in the component prop type without unused destructuring.

Subagent checks after fixes:

- Backend focused suite: `56 passed`.
- Daemon targeted tests: `24 passed`.
- Frontend lint: pass.
- Frontend production build: pass.
- `rtk git diff --check`: pass.

Additional scoped-session review:

- Trellis check worker `check-scoped-session` reviewed the scoped provider session daemon diff.
- It fixed one mechanical duplicate guard in `agent/daemon/aaa-daemon/src/runtime/codex-acp-runtime.ts`.
- It verified the targeted daemon scoped-session suite: `31 passed`.
- It reported no open issues with scope selection, `sessionId: null|string|undefined` semantics, queued-message scope preservation, or heartbeat projection safety.

Final independent verification:

- Trellis check worker Mencius reviewed the final memory context/task handoff/scoped-session slice.
- It did not edit files and reported no blocking findings.
- Targeted daemon command:
  `rtk npm run build && rtk node --test test/slock-cli.test.mjs test/session-scope.test.mjs test/runtime-mcp.test.mjs test/codex-acp-runtime.test.mjs`
  - Result: TypeScript passed; Node test runner `49/49` passed.
- Targeted backend command:
  `rtk env PYTHONPATH=. uv run pytest tests/test_agent_task_memory_handoff.py tests/test_memory_store.py tests/test_public_memory_routes.py -q`
  - Result: `15 passed`.
- `rtk git diff --check`: pass.
- Review conclusions:
  - `build_memory_context_manifest()` remains selective and snippet-limited.
  - Missing `memory.context` scope/id fails before forwarding in daemon JSON-RPC, fails in CLI parsing, and fails with backend HTTP 400.
  - `memory.*` events are not runtime-actionable; daemon runtime delivery still only allows task/thread actionable event types.
  - `daemon/task.memory.summary` and `daemon/task.memory.promote` map to the intended agent API endpoints.

Final proposal/delete/conflict verification:

- Trellis check worker Bacon reviewed the latest proposal review, delete, conflict UX, and UI evidence slice.
- It found one real permission issue: public channel visibility was sufficient for memory mutation paths. The fix adds service-layer `ensure_scope_writable()` checks so write/propose/accept/reject/delete require channel membership, task creator/assignee, or explicit memory write capability.
- It added regression coverage for non-member proposal review rejection.
- It reported:
  - Backend focused suite: `34 passed`.
  - Backend full suite: `70 passed`.
  - Daemon targeted suite: `22 passed`.
  - Daemon full suite: `137 passed`.
  - Frontend memory presentation test: `3 passed`.
  - Frontend lint/build: pass.
  - `rtk git diff --check`: pass.

Scoped prompt/context injection verification:

- Trellis check worker Peirce reviewed the latest daemon prompt/context injection slice.
- It found and fixed one DM-scope leakage edge: legacy/proxy-shaped runtime events with `target=dm:...` but no `channelType=dm` could otherwise fall back to `channel:<channelId>` and request channel memory context.
- The fix makes `selectRuntimeSessionScope()` infer DM scope from reply-safe DM targets while preserving task-over-thread/channel precedence.
- Added regression coverage proving `target=dm:@alice` plus a `channelId` and no `channelType` resolves to DM scope and produces no memory context request.
- Targeted daemon command:
  `rtk npm run build && rtk node --test test/runtime-mcp.test.mjs test/daemon-runtime.test.mjs`
  - Result: TypeScript passed; Node test runner `41/41` passed.
- Main-thread daemon full suite after Peirce's fix:
  `rtk npm test`
  - Result: TypeScript passed; Node test runner `141/141` passed.

## Public/UI Permission Tightening

Mill's earlier review identified a non-blocking risk: public/UI memory routes used only the public API key and did not enforce account-level private-channel membership.

This is fixed in the final implementation:

- Public/UI memory routes now require the current account/session member.
- The current member is passed to `resolve_memory_scope(..., viewer=...)`.
- Channel, DM, task, thread, and agent visibility therefore reuse the shared memory permission checks.
- Public/UI memory write and proposal routes reject body-level actor spoofing.

Regression tests:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_public_memory_routes.py -q
```

Covered behavior:

- Scoped memory route passes the current viewer to `resolve_memory_scope`.
- Task memory alias passes the current viewer to `resolve_memory_scope`.
- Explicit memory actor must match the current viewer.

## Real UI Evidence

Local services were run on non-default ports because `8000/3000` were occupied:

- Backend: `http://127.0.0.1:8011`
- Frontend: `http://127.0.0.1:3011`

Browser verification used project WebDriver CLI `./twd`.

Seeded marker:

```text
REAL_memory_ui_202606230131
```

Verified:

- `/chat/slock`, Memory tab renders channel memory `MEMORY.md` and marker text:
  `REAL_memory_ui_202606230131 channel memory visible in Chat Memory tab.`
- `/tasks?task=d5a0b61b-2631-4999-a23a-ab51dba0c5e0` renders `Task Memory`, `plan.md`, `evidence.md`, and marker text:
  `REAL_memory_ui_202606230131 task memory visible in Task Detail.`
- Verification was repeated after public/UI permission tightening and after passing session token through the server-rendered Tasks page.

Evidence files:

- `REAL_memory_ui_202606230131-chat-memory.png`
- `REAL_memory_ui_202606230131-chat-memory.snapshot.txt`
- `REAL_memory_ui_202606230131-task-memory.png`
- `REAL_memory_ui_202606230131-task-memory.snapshot.txt`

## Rich Output / Recovery Evidence

After the first validation pass, the UI was expanded from a flat memory list into a richer recovery surface:

- Task detail now renders a `Task Recovery` cockpit.
- Recovery completeness is shown as four explicit signals: brief, plan, progress, and output.
- Markdown checklist lines and metadata subtasks are extracted into a visible `Task breakdown`.
- Evidence/artifact entries are classified into typed viewers.
- Image artifacts render as real `<img>` previews when a file reference or artifact URL is present.
- Video artifacts render as `<video controls>` when a video URL/reference is present.
- Channel memory groups durable task results under `TASK OUTPUTS` and promotion records under `PROMOTIONS`.

Local services for this pass:

- Backend: `http://127.0.0.1:8012`
- Frontend: `http://127.0.0.1:3012`

Marker:

```text
REAL_memory_rich_outputs_202606230153
```

Seeded task memory paths:

- `brief.md`
- `plan.md`
- `progress.md`
- `final-summary.md`
- `artifacts/rich-output.svg`
- `artifacts/demo-video.md`

Seeded channel memory paths:

- `tasks/d5a0b61b/final-summary.md`
- `promotions/d5a0b61b-rich-output.md`

Browser evidence:

- `/tasks?task=d5a0b61b-2631-4999-a23a-ab51dba0c5e0` showed `Task Recovery`, `4/4 recovery signals`, `Task breakdown`, `Outputs and evidence`, and the rich marker.
- DOM eval confirmed one loaded image preview with natural dimensions and one video element with controls.
- `/chat/slock` Memory tab showed `TASK OUTPUTS`, `PROMOTIONS`, and the rich marker.

Evidence files:

- `REAL_memory_rich_outputs_202606230153-task-recovery.png`
- `REAL_memory_rich_outputs_202606230153-task-recovery.snapshot.txt`
- `REAL_memory_rich_outputs_202606230153-channel-memory.png`
- `REAL_memory_rich_outputs_202606230153-channel-memory.snapshot.txt`

## Proposal Review / Delete / Conflict Evidence

Latest implementation added the first proposal audit workflow and memory delete semantics:

- Public/UI proposal routes:
  - `GET /api/v1/memory/scopes/{scopeType}/{scopeId}/proposals?status=open`
  - `POST /api/v1/memory/proposals/{proposalId}/accept`
  - `POST /api/v1/memory/proposals/{proposalId}/reject`
- Public/UI delete route:
  - `DELETE /api/v1/memory/scopes/{scopeType}/{scopeId}/path/{path}`
- Memory delete is a soft delete: it sets `deleted_at`, increments `version`, emits `memory.deleted`, and serializes `deletedAt` for audit responses.
- Proposal resolution emits `memory.proposal.resolved`.
- `slock memory write` conflict errors now return an actionable instruction and hide `currentSha256` bookkeeping from the CLI error UX.

Real UI evidence used project WebDriver CLI `./twd`.

Local services for this pass:

- Backend: `http://127.0.0.1:8013`
- Frontend: `http://127.0.0.1:3013`

Marker:

```text
REAL_memory_proposal_review_202606230249
```

Seeded proposal:

- id: `a36af39a-c917-41eb-86fa-f643ded97a58`
- channel id: `891b7a36-155f-464e-b85c-9152372d7852`
- path: `decisions/proposal-review-REAL_memory_proposal_review_202606230249.md`

Browser evidence before accept:

- Channel Memory tab showed the proposal review queue.
- Visible proposal data included path, reason, proposed content, base audit field, and Accept/Reject actions.

Browser evidence after accept:

- Open review queue no longer showed the proposal.
- Accepted content appeared as durable channel memory under Channel knowledge.
- Visible accepted path: `decisions/proposal-review-REAL_memory_proposal_review_202606230249.md`

API cross-check after accept:

```json
{
  "proposalStatus": "accepted",
  "proposalResolvedAt": "2026-06-22T18:50:36.957802+00:00",
  "proposalReviewerMemberId": "ff62a4f8-979e-44cb-80b0-a99c00342e13",
  "openProposalStillPresent": false,
  "acceptedEntryPresent": true,
  "acceptedEntryDeletedAt": null,
  "acceptedEntryKind": "decision",
  "acceptedEntryTextHasMarker": true,
  "entryCount": 4
}
```

Evidence files:

- `REAL_memory_proposal_review_202606230249-proposal-create.json`
- `REAL_memory_proposal_review_202606230249-before.png`
- `REAL_memory_proposal_review_202606230249-before.snapshot.txt`
- `REAL_memory_proposal_review_202606230249-after-accept.png`
- `REAL_memory_proposal_review_202606230249-after-accept.snapshot.txt`

## Agent Proposal Management Evidence

Latest continuation expanded proposal/delete management from UI-only to agent-operable surfaces:

- Agent API:
  - `GET /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/proposals?status=open|all`
  - `POST /internal/agent-api/memory/proposals/{proposalId}/accept`
  - `POST /internal/agent-api/memory/proposals/{proposalId}/reject`
  - `DELETE /internal/agent-api/memory/scopes/{scopeType}/{scopeId}/path/{path}`
- Slock CLI:
  - `slock memory proposals --scope channel --id <channel> --status open`
  - `slock memory accept-proposal --id <proposal-id> --note "<why>"`
  - `slock memory reject-proposal --id <proposal-id> --note "<why>"`
  - `slock memory delete --scope task --id <task-id> --path <path>`
- Daemon JSON-RPC forwarding:
  - `daemon/memory.proposals`
  - `daemon/memory.proposal.accept`
  - `daemon/memory.proposal.reject`
  - `daemon/memory.delete`
- Runtime prompt:
  - Managed Claude prompt now advertises server-owned task/channel memory recovery commands and proposal/delete workflows only after parser, proxy, backend endpoint, and tests exist.

Targeted checks:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_agent_task_memory_handoff.py -q
```

Result after agent proposal/delete management work: `12 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm run build && rtk node --test test/slock-cli.test.mjs
```

Result after CLI and JSON-RPC proposal/delete forwarding work: `19 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm run build && rtk node --test test/runtime-mcp.test.mjs
```

Result after prompt guidance work: `23 passed`.

Full regression after agent proposal/delete management work:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest -q
```

Result after final private-channel context-manifest permission fix: `74 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm test
```

Result: `137 passed`.

```bash
cd frontend
rtk npx tsx --test test/memory-presentation.test.ts && rtk npm run lint && rtk npm run build
```

Result: presentation tests `3 passed`; lint passed; production build passed.

```bash
rtk git diff --check
```

Result: pass.

Independent check worker Hubble reviewed the agent proposal/delete/prompt increment after the full local pass. It found and fixed one CAS edge:

- Problem: accepting a proposal created for a previously missing path could overwrite a later-created memory entry because `base_sha256` was absent.
- Fix: proposal acceptance now passes `content_sha256("")` as the base SHA when the proposal had no base entry/hash, so "created from empty" proposals still conflict if someone else created the path first.
- Added regression assertion in `backend/tests/test_agent_task_memory_handoff.py`.
- Added runtime gate assertions that `memory.updated` and `memory.proposal.created` remain non-actionable runtime events.

Hubble verification:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_agent_task_memory_handoff.py tests/test_memory_store.py tests/test_public_memory_routes.py tests/test_public_events.py -q
```

Result: `37 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk node --test test/slock-cli.test.mjs test/runtime-mcp.test.mjs test/proxy-wrapper.test.mjs
```

Result: `45 passed`.

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest -q
```

Result: `73 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm test
```

Result: `137 passed`.

Frontend presentation test, lint, and build also passed in Hubble's check.

## Final Commands

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest tests/test_agent_task_memory_handoff.py tests/test_memory_store.py -q
```

Result after adding memory context manifest and explicit task handoff: `12 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm run build && rtk node --test test/slock-cli.test.mjs
```

Result after adding memory context JSON-RPC forwarding: `18 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm run build && rtk node --test test/session-scope.test.mjs test/runtime-mcp.test.mjs test/codex-acp-runtime.test.mjs
```

Result after adding scoped provider session routing: `31 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm test
```

Result after adding scoped provider session routing: `135 passed`.
Final result after memory context/task handoff work: `136 passed`.
Latest result after memory conflict UX work: `137 passed`.

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest -q
```

Result: `63 passed`.
Latest result after proposal review/delete/conflict work: `70 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk node --test test/session-scope.test.mjs test/proxy-wrapper.test.mjs test/slock-cli.test.mjs
```

Result: `24 passed`.

```bash
cd frontend
rtk npx tsx --test test/memory-presentation.test.ts
```

Result: `3 passed`.

```bash
cd frontend
rtk npm run lint
```

Result: pass, no warnings.

```bash
cd frontend
rtk npm run build
```

Result: pass.

```bash
rtk git diff --check
```

Result: pass.

Latest full validation pass:

```bash
cd frontend
rtk npx tsx --test test/memory-presentation.test.ts && rtk npm run lint && rtk npm run build
```

Result: presentation tests `3 passed`; lint passed; production build passed.

```bash
rtk git diff --check
```

Result: pass.

Latest scoped prompt/context injection validation:

```bash
cd agent/daemon/aaa-daemon
rtk npm run build && rtk node --test test/runtime-mcp.test.mjs test/daemon-runtime.test.mjs
```

Result after Peirce's DM-scope regression fix: TypeScript passed; Node test runner `41/41` passed.

Covered behavior:

- `formatRuntimeIncomingMessageWithMemoryContext()` prepends an inspectable `## Slock Memory Context` block.
- The block consumes selective manifest snippets and read/search instructions, not raw/full `contentText`.
- Backend `readMore` object manifests and `sessionScope` `{type,id}` manifests format correctly.
- Daemon runtime delivery automatically requests `/internal/agent-api/memory/context-manifest` through the local proxy for shared channel scope before sending the runtime prompt.
- Channel-scope prompt injection includes only short memory snippets.
- Task/thread scoped delivery requests task/thread manifests and formats task/channel snippet groups from the returned manifest.
- DM scope returns no memory context request by default, avoiding accidental channel-memory injection.

Latest backend/frontend/static validation after the final scoped prompt/context work:

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest -q
```

Result after private-channel context-manifest permission fix: `74 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm test
```

Result after private-channel context-manifest permission fix: TypeScript passed; Node test runner `141/141` passed.

```bash
cd frontend
rtk npx tsx --test test/memory-presentation.test.ts && rtk npm run lint && rtk npm run build
```

Result after private-channel context-manifest permission fix: memory presentation tests `3 passed`; lint passed; production build passed.

```bash
rtk git diff --check
```

Result: pass.

Latest fresh browser smoke:

- Backend: `http://127.0.0.1:8014`
- Frontend: `http://127.0.0.1:3014`
- WebDriver: project `./twd` plus guarded auth/open helpers.
- Marker: `REAL_memory_final_smoke_202606230338`

Verified:

- `/chat/slock` Memory tab showed `CHANNEL KNOWLEDGE`, `TASK OUTPUTS`, `PROMOTIONS`, the rich output marker, and the accepted proposal marker.
- `/tasks?task=d5a0b61b-2631-4999-a23a-ab51dba0c5e0` showed `Task Recovery`, `4/4 recovery signals`, `Task breakdown`, `Outputs and evidence`, rich output marker, one loaded image, and one video element with controls.
- Temporary ports `8014` and `3014` were stopped after capture.

Evidence files:

- `REAL_memory_final_smoke_202606230338-channel-memory.png`
- `REAL_memory_final_smoke_202606230338-channel-memory.snapshot.txt`
- `REAL_memory_final_smoke_202606230338-task-recovery.png`
- `REAL_memory_final_smoke_202606230338-task-recovery.snapshot.txt`

Post privacy-fix browser smoke:

- Backend: `http://127.0.0.1:8015`
- Frontend: `http://127.0.0.1:3015`
- WebDriver: project `./twd` plus guarded auth/open helpers.
- Marker: `REAL_memory_post_privacy_fix_202606230400`

API cross-check before browser assertions:

- `/api/v1/memory/scopes/channel/891b7a36-155f-464e-b85c-9152372d7852` returned 4 entries:
  - `MEMORY.md`
  - `decisions/proposal-review-REAL_memory_proposal_review_202606230249.md`
  - `promotions/d5a0b61b-rich-output.md`
  - `tasks/d5a0b61b/final-summary.md`
- `/api/v1/tasks/d5a0b61b-2631-4999-a23a-ab51dba0c5e0/memory` returned 7 entries:
  - `artifacts/demo-video.md`
  - `artifacts/rich-output.svg`
  - `brief.md`
  - `evidence.md`
  - `final-summary.md`
  - `plan.md`
  - `progress.md`

Verified:

- `/chat/slock` Memory tab showed `CHANNEL KNOWLEDGE`, `TASK OUTPUTS`, `PROMOTIONS`, 4 entries, the rich output marker, and the accepted proposal marker.
- `/tasks?task=d5a0b61b-2631-4999-a23a-ab51dba0c5e0` showed `Task Recovery`, `4/4 recovery signals`, `Task breakdown`, `Outputs and evidence`, the rich output marker, one loaded image with natural dimensions, and one video element with controls.

Evidence files:

- `REAL_memory_post_privacy_fix_202606230400-channel-memory.png`
- `REAL_memory_post_privacy_fix_202606230400-channel-memory.snapshot.txt`
- `REAL_memory_post_privacy_fix_202606230400-task-recovery.png`
- `REAL_memory_post_privacy_fix_202606230400-task-recovery.snapshot.txt`

After-main-frontend integration validation:

- Local `main` still points at `9014a1a`; there is no newer committed local `main` delta available for `git merge`.
- The root `/Users/code/project/smallkhoj` worktree contained uncommitted frontend identity/design changes. The relevant committed-intent design pieces were manually integrated into this feature worktree without staging or reverting root worktree files:
  - shared agent color tokens through `frontend/lib/agent-color.ts` and `frontend/app/globals.css`
  - shared agent status buckets/labels/dot classes through `frontend/lib/agent-status.ts`
  - `MessageFrame` agent identity stripe through `frontend/components/message-frame.tsx`
  - default button gradient token through `frontend/components/ui/button.tsx`
- The root-only global radial background and larger radius change were not copied because this task's UI should remain an operational surface and avoid broad unrelated theme churn.

Commands:

```bash
cd frontend
rtk npx tsx --test test/member-avatar.test.tsx test/memory-presentation.test.ts
```

Result: `19 passed`.

```bash
cd backend
rtk env PYTHONPATH=. uv run pytest -q
```

Result: `74 passed`.

```bash
cd agent/daemon/aaa-daemon
rtk npm test
```

Result: TypeScript passed; Node test runner `141/141` passed.

```bash
cd frontend
rtk npm run lint && rtk npm run build
```

Result: lint passed; production build passed.

Real UI smoke on temporary local ports:

- Backend: `http://127.0.0.1:8015`
- Frontend: `http://127.0.0.1:3015`
- WebDriver: project `./twd` plus guarded auth/open helpers.
- Marker: `REAL_memory_after_main_frontend_20260623091939`

API cross-check:

- `/api/v1/channels/slock/memory` returned 4 entries:
  - `MEMORY.md`
  - `decisions/proposal-review-REAL_memory_proposal_review_202606230249.md`
  - `promotions/d5a0b61b-rich-output.md`
  - `tasks/d5a0b61b/final-summary.md`
- `/api/v1/tasks/d5a0b61b-2631-4999-a23a-ab51dba0c5e0/memory` returned 7 entries:
  - `artifacts/demo-video.md`
  - `artifacts/rich-output.svg`
  - `brief.md`
  - `evidence.md`
  - `final-summary.md`
  - `plan.md`
  - `progress.md`

Verified:

- `/chat/slock` Memory tab showed 4 entries, `CHANNEL KNOWLEDGE`, `TASK OUTPUTS`, `PROMOTIONS`, the rich output marker, and the accepted proposal marker.
- `/tasks?task=d5a0b61b-2631-4999-a23a-ab51dba0c5e0` showed `Task Recovery`, `4/4 recovery signals`, `Task breakdown`, `Outputs and evidence`, the rich output marker, one loaded image with natural dimensions, and one video element with controls.
- The same browser run showed the integrated frontend status labels (`在线` / `离线`) from the shared status helper.

Evidence files:

- `REAL_memory_after_main_frontend_20260623091939-channel-memory.png`
- `REAL_memory_after_main_frontend_20260623091939-channel-memory.snapshot.txt`
- `REAL_memory_after_main_frontend_20260623091939-task-recovery.png`
- `REAL_memory_after_main_frontend_20260623091939-task-recovery.snapshot.txt`

## Spec Update

Phase 3.3 spec update was required because this task added cross-layer DB/API/CLI/runtime/UI contracts.

Updated specs:

- `.trellis/spec/backend/memory-contracts.md`
  - New code-spec with the required seven sections for server-owned scoped memory, proposal audit, context manifests, CLI/API signatures, permission rules, error matrix, tests, and wrong-vs-correct examples.
- `.trellis/spec/backend/index.md`
  - Added `Memory Contracts` to the backend spec index.
- `.trellis/spec/frontend/product-ui-style.md`
  - Added `Memory And Recovery Surfaces` rules for Channel Memory and Task Recovery, including typed media viewers and browser evidence expectations.

Validation:

```bash
rtk git diff --check
```

Result: pass.

## Remaining Product Follow-Ups

- Requirement-by-requirement completion audit is recorded in `completion-audit.md`.
- Final quality gate report is recorded in `quality-gate-report.md`.
- Operator review packet for the remaining PRD sign-off checkpoint is recorded in `operator-review-packet.md`.
- Runtime session scoping now has selector/key tests, daemon in-memory scoped provider session storage, driver-level scoped provider session routing, and heartbeat projection. Durable backend persistence for scoped provider session records is still a follow-up.
- Task memory handoff is explicit and tested through `slock task summary` / `slock task promote`, but it is not automatically invoked on status transitions yet.
- Hard retention/TTL/quota policy and large blob/object lifecycle cleanup still need a follow-up slice. First-slice soft delete is implemented.
- Next dev logged a DnD hydration warning from `TaskBoard` sortable `aria-describedby` IDs. Memory UI validation still passed and production build is green, but the board DnD hydration mismatch should be handled in a separate frontend polish pass.
