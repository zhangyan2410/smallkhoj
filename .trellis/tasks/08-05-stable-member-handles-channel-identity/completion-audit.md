# Completion audit — stable member Names and Channel identity

Audit date: 2026-08-06  
Candidate: `main` at `a7dc867fb367` plus the task-local test/evidence changes
listed below.

## Status vocabulary

- **PASS**: implemented and covered by source/automated or existing real evidence.
- **PARTIAL**: the deterministic contract is green, but a PRD-requested real UI,
  provider, or device observation is still pending.
- **BLOCKED**: the required environment mutation has deliberately not run.

## Automated gate baseline

- Backend Ruff: PASS.
- Backend ordinary suite: `505 passed, 58 skipped`.
- Isolated PostgreSQL release gate: `562 passed`, zero skips.
- Daemon full `npm test`: PASS.
- Frontend: `265 passed`; lint, typecheck, E2E typecheck, production build, and
  standalone artifact: PASS.
- Supplemental backend identity/profile contract:
  `tests/test_daemon_control.py`: `60 passed` on 2026-08-06.
- Supplemental frontend login/bootstrap source contract:
  `test/login-bootstrap.test.ts`: `2 passed` on 2026-08-06.

## PRD Acceptance Criteria mapping

| # | Status | Evidence / remaining proof |
| --- | --- | --- |
| 1 | PASS | Origin-scoped Human/active-Agent uniqueness is enforced by the named partial PostgreSQL index and `backend/tests/test_member_identity_postgres.py`. |
| 2 | PASS | Shared home namespace, Agent tombstone release, and new-ID reuse are covered by `backend/tests/test_member_identity_postgres.py` and `backend/tests/test_agent_tombstone_identity_postgres.py`. |
| 3 | PASS | Atomic one-home-Server bootstrap, joined Servers, and the `POST /api/v1/servers` 410 contract are covered by `backend/tests/test_server_account_membership.py` and `backend/tests/test_better_auth_bridge.py`. |
| 4 | PASS | Invite identity reuse and foreign-Agent rejection are covered by `backend/tests/test_server_invites.py`, `backend/tests/test_server_account_membership.py`, and Channel membership tests. |
| 5 | PARTIAL | Bare/qualified cross-origin projections pass deterministic PostgreSQL/service tests; the two-origin same-Name scenario has not yet been repeated in the real browser/runtime. |
| 6 | PASS | Reserved `-s<code>` rejection and ordinary hyphenated Names are covered by the shared identity fixtures and `backend/tests/test_member_identity.py`. |
| 7 | PASS | Shared live validation/preview/availability and authoritative concurrent insert behavior are covered by backend/frontend identity tests and the real Create Agent UI check. |
| 8 | PASS | NFC presentation and NFKC/case-folded uniqueness are covered by the shared fixtures and PostgreSQL tests. |
| 9 | PASS | `@张翰` is covered by Unicode mention, frontend validation/rendering, daemon/CLI tests, and the real composer evidence. |
| 10 | PASS | Immutable `serverHandle` qualification is covered by schema and Channel reference projection tests. |
| 11 | PASS | Collision-free bare and colliding qualified projections, including reference updates, are covered by `backend/tests/test_channel_member_references.py` and membership event tests. |
| 12 | PASS | Supported public and Agent self-profile APIs reject Name/handle/displayName mutation; supplemental assertions are in `backend/tests/test_daemon_control.py`. |
| 13 | PASS | Human/serverHandle reservation and Agent tombstone reuse are covered by schema/migration and tombstone tests. |
| 14 | PASS | Re-registration creates a new Member ID with cleared configuration, credentials, Description, membership, and state in tombstone tests. |
| 15 | PASS | Signup and Agent creation require an explicit Name; foreign Server membership keeps the same Human Member identity. |
| 16 | PARTIAL | Signup/Sign In/setup/return-to contracts and translations are green, but a deliberately failed bootstrap retry plus a complete real invitation return has not been exercised end to end. |
| 17 | PASS | Chinese/English product copy says `名字` / `Name`, not Handle, and presents no competing displayName field. |
| 18 | PASS | Human displayName is isolated from identity/mention/attribution and omitted from Agent-facing contracts. |
| 19 | PASS | Human handle fallback is covered by serializers/UI contracts; no joined-Server or Channel behavior requires displayName. |
| 20 | PASS | Agent-facing Channel API/CLI/runtime/event serializers omit Human displayName; see `.trellis/spec/backend/member-identity-channel-contracts.md` and daemon/backend tests. |
| 21 | PASS | Agent create/edit/read contracts do not accept or expose Agent displayName. |
| 22 | PASS | Channel-scoped `@handle` resolution and UUID attribution are covered by reference and Unicode mention tests. |
| 23 | PASS | Initial runtime context loads only the current Channel roster; daemon context tests reject Server-wide member discovery. |
| 24 | PASS | `agent/daemon/aaa-daemon/test/channel-member-context.test.mjs` proves one entry snapshot with Agent expertise and no Human Description/displayName. |
| 25 | PASS | The same daemon suite proves one snapshot request, no Description repetition on ordinary/update turns, and on-demand `aura channel members`. |
| 26 | PASS | Compact join/leave/reference updates and volatile-roster instructions are covered at `agent/daemon/aaa-daemon/test/channel-member-context.test.mjs:83` and `:186`; prompts explicitly say not to reply merely to acknowledge. |
| 27 | PASS | Membership changes preserve authored Message content and UUID attribution in backend event/reference tests. |
| 28 | PASS | Agent Description create/read/owner-admin edit and one-time safe runtime representation are covered by backend, frontend, and daemon tests. |
| 29 | PASS | Human Description is rejected server-side and omitted from serializers/UI; supplemental assertion is in `backend/tests/test_daemon_control.py`. |
| 30 | PASS | Trimmed optional plain text, 200-code-point validation, bilingual counter, and 201/200 visible error are covered by tests and real UI evidence. |
| 31 | PASS | The shared Agent form keeps Computer/Runtime/Provider behavior while mapping Agent Name to immutable handle and adding optional Description. |
| 32 | PARTIAL | Shared entry points, focus/error/loading contracts, and desktop behavior are covered; a persistent real narrow/touch viewport has not yet been accepted. |
| 33 | PARTIAL | Desktop Name + Computer / full-width Description / Runtime + Provider is real-tested; narrow semantic stacking is source/unit-covered but not yet proven in a persistent real narrow viewport. |
| 34 | PASS | Real UI starts in `zh-CN`, switches completely to English, and accepts Chinese canonical Names independently of locale. |
| 35 | PASS | Real `@` suggestions list only current Channel members, insert contextual references atomically, and bind the selection to Member ID in tests. |
| 36 | PARTIAL | Collision row/origin-secondary semantics are deterministic-test covered; a real two-origin collision suggestion has not yet been observed. |
| 37 | PASS | Manual unique/ambiguous/unknown Unicode mention behavior is covered by `backend/tests/test_unicode_mentions.py`. |
| 38 | PASS | Real `#` suggestions listed only visible current-Server `#identity-test`; backend/frontend scope tests cover public/private/non-DM rules. |
| 39 | PARTIAL | Keyboard and Chinese IME behavior are real-tested; pointer contracts are automated, while real touch/narrow/scroll-clipping acceptance remains pending. |
| 40 | PARTIAL | Authorization, visible bilingual confirmation, compact final notice, dedupe, and delivery cutoff are covered by UI/backend/daemon tests. The exact current-build `open2` removal still awaits the user's click/observation, and continued operation in a second Channel has not yet been real-tested. |
| 41 | PASS | Fresh migration/bootstrap creates one home Server and no API/UI path can create another owned Server. |
| 42 | BLOCKED | Local clean-reset rollout is complete. Cloud target discovery is complete, but cloud database reset/deploy/smoke has not run because destructive rollout still needs explicit final approval. |
| 43 | PASS | The saved full gates plus focused identity, tenancy, Channel, mention, Description, UI, and daemon suites cover the requested contract categories. |

## Existing real evidence

- `evidence/REAL_create_agent_description_20260806.png`
- `evidence/REAL_channel_member_remove_reply_20260806.png`
- `evidence/REAL_channel_final.snapshot.txt`
- `evidence/REAL_local_ui_supplement_20260806.md`

## Remaining release decisions/actions

1. User clicks **移除 open2** in `#identity-test` and observes no acknowledgement
   reply plus no later delivery for that Channel.
2. If required for release, run a true narrow/touch check, a second-Channel
   continuity check, a real two-origin same-Name collision, and a failed
   bootstrap/invite-return flow.
3. Obtain explicit confirmation for destructive reset and rollout of Tencent
   Lighthouse `124.222.40.40`, then deploy the accepted commit and run the
   minimal cloud smoke.

The task must remain `in_progress` until the user accepts the local provider
result and decides the cloud rollout timing.
