# Completion audit — stable member Names and Channel identity

Audit date: 2026-08-06  
Candidate: `main` at `be4c4e3a5604` plus the task-local removal evidence changes
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
| 5 | PASS | Deterministic projection tests plus the real two-origin `张翰` signup/invite/Channel flow prove `@张翰-s8db6` and `@张翰-st6e4` remain unambiguous. See `evidence/REAL_completion_supplement_20260806.md`. |
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
| 16 | PASS | A deliberately wrong bridge secret produced a Better Auth user with zero SmallKhoj Accounts, then the same session completed Name-only setup into exactly one Account/home Server. The separate same-Name signup resumed its real invitation and joined the target Server. |
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
| 32 | PASS | Shared entry points and focus/error/loading contracts are automated; a persistent 390x844, mobile, coarse-pointer, five-touch-point run proved the real narrow/touch interaction. |
| 33 | PASS | Desktop layout remains real-tested; the persistent 390x844 run measured the narrow Name/Computer/Description/Runtime/Provider semantic stacking with no horizontal overflow. |
| 34 | PASS | Real UI starts in `zh-CN`, switches completely to English, and accepts Chinese canonical Names independently of locale. |
| 35 | PASS | Real `@` suggestions list only current Channel members, insert contextual references atomically, and bind the selection to Member ID in tests. |
| 36 | PASS | The real two-origin `张翰` Channel showed both qualified suggestion rows and inserted `@张翰-st6e4`; deterministic tests cover optional origin-presentation secondary copy. |
| 37 | PASS | Manual unique/ambiguous/unknown Unicode mention behavior is covered by `backend/tests/test_unicode_mentions.py`. |
| 38 | PASS | Real `#` suggestions listed only visible current-Server `#identity-test`; backend/frontend scope tests cover public/private/non-DM rules. |
| 39 | PASS | Keyboard and Chinese IME behavior were real-tested; a real `Input.dispatchTouchEvent` in the persistent narrow/coarse-pointer context inserted `@open2 ` and retained composer focus. Automated contracts cover pointer, scrolling, clipping, empty, loading, and error states. |
| 40 | PASS | The user removed `open2` and observed no acknowledgement reply. UI changed to two members and omitted `open2` from `@` suggestions; EventRecord seq 33 carried one Description-free leave notice; daemon logged zero queued work and the narrow final delivery; a fresh `#identity-test` marker produced no runtime delivery/reply; a fresh `#remove-continuity-20260806` marker produced the exact provider ACK. |
| 41 | PASS | Fresh migration/bootstrap creates one home Server and no API/UI path can create another owned Server. |
| 42 | BLOCKED | Local clean-reset rollout is complete. Cloud target discovery is complete, but cloud database reset/deploy/smoke has not run because destructive rollout still needs explicit final approval. |
| 43 | PASS | The saved full gates plus focused identity, tenancy, Channel, mention, Description, UI, and daemon suites cover the requested contract categories. |

## Existing real evidence

- `evidence/REAL_create_agent_description_20260806.png`
- `evidence/REAL_channel_member_remove_reply_20260806.png`
- `evidence/REAL_channel_final.snapshot.txt`
- `evidence/REAL_local_ui_supplement_20260806.md`
- `evidence/REAL_completion_supplement_20260806.md`
- `evidence/REAL_narrow_create_agent_390x844_20260806.png`
- `evidence/REAL_collision_suggestions_20260806.png`
- `evidence/REAL_bootstrap_retry_setup_20260806.png`
- `evidence/REAL_bootstrap_retry_success_20260806.png`
- `evidence/REAL_remove_open2_member_count2_20260806.png`
- `evidence/REAL_post_remove_cutoff_suggestions_20260806.png`
- `evidence/REAL_second_channel_after_remove_ack_20260806.png`

## Remaining release decisions/actions

1. Obtain explicit confirmation for destructive reset and rollout of Tencent
   Lighthouse `124.222.40.40`, then deploy the accepted commit and run the
   minimal cloud smoke.

The local implementation and provider acceptance are complete. The task must
remain `in_progress` only until the user confirms cloud rollout timing and the
cloud reset/deploy/smoke is evidenced.
