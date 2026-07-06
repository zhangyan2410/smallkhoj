# Quality Gate: Inkframe Product UI Refactor

Date: 2026-07-06
Branch: `codex/inkframe-object-ui`
Worktree: `/Users/code/project/smallkhoj-inkframe-object-ui`

## Scope Checked

This quality gate covers the parent task `07-05-inkframe-product-ui-refactor`
and its merged child scopes:

- `07-02-chat-event-unread-indicators`
- `07-04-ink-material-card-restore-resource`

The current implementation is a frontend-first pass. It makes Inkframe the
default visible product direction for the shell, chat, and tasks, while keeping
server-side unread cursor persistence and deeper backend work as explicit
follow-ups.

## Requirement Matrix

| Requirement | Evidence | Status |
|---|---|---|
| Product pages use clean Inkframe desk background | `AppDeskBackground` mounted from `ProductShell`; source/tests assert a single shell owner and fixed material contract | Pass by code/test |
| Chat uses Inkframe object UI | `MessageFrame` / `MessagePaper`, sidebar entity rows, hidden message actions, object primitive tests | Pass by code/test |
| Tasks use distinct task/evidence/review objects | `TaskMaterialSurface`, `EvidenceSurface`, `ReviewStamp`, task/mobile source-contract tests | Pass by code/test |
| Root-message count no longer foregrounded | chat unread/object tests and route source checks cover the replacement event-badge path | Pass by code/test |
| Channel/DM unread/event scope included | `chat-unread-state`, `useChatUnreadStore`, `EventBadge`, `SidebarEntityItem`; tests cover local pending/clear behavior and realtime seq replay dedupe | Pass for frontend adapter |
| Server-side unread cursor persistence | explicitly out of current pass; local adapter is implemented | Deferred |
| Avatar stamp removed / status dot unobstructed | unit tests and `AvatarObject` behavior; `MemberAvatar` status dot test passes | Pass |
| Markdown `<marker>` invalid DOM regression prevented | `test/markdown-message.test.tsx` passes | Pass |
| Mobile chat/task do not overflow | source-contract tests cover mobile roles, containment, and shell drawer reachability; true-device proof remains separate | Pass by code/test; true-device pending |
| Material restore/resource lifecycle | material demo regression now returns `PASS 52 / FAIL 0`; test file now awaits async activate/deactivate API | Pass |
| No one-per-card permanent WebGL contexts | material demo T10 green; shared active-surface model preserved | Pass |
| Productized WebGL runtime in real app | global static material background and object vocabulary are integrated; full reusable `MaterialSurface` extraction remains partial | Partial / follow-up |

## Commands Run

From `/Users/code/project/smallkhoj-inkframe-object-ui/frontend`:

```bash
rtk npm run lint -- --max-warnings=0
```

Result: passed.

```bash
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
```

Initial result: `78` tests passed, `0` failed.

After sub-agent review fixed realtime unread replay dedupe, this was rerun.
Final result: `79` tests passed, `0` failed.

```bash
rtk env NODE_PATH=./node_modules npx tsc --noEmit
```

Result: passed.

Material demo browser regression:

```text
http://127.0.0.1:8771/message-cards-ink.test.html?v=20260706-await-api
```

Result: `PASS 52 / FAIL 0`.

## Browser / Screenshot Notes

`./twd` status during this quality pass:

- `./twd serve` started successfully on `127.0.0.1:18765`.
- `./twd --compact tabs` returned `{"ok":true,"tabs":[],"count":0}`.
- No connected project WebDriver tab was available, so this gate does **not**
  use screenshots or in-app browser captures as delivery acceptance.
- Any saved screenshots under `evidence/` are retained only as historical visual
  context for later design review. They are not pass/fail evidence for this
  merge.
- Real product/browser acceptance should be collected later with a connected
  `./twd` tab or true-device preview URL. The current merge decision is based on
  code-level tests, source contracts, build, and backend cursor tests.

## Issue Found And Fixed In This Pass

The material regression initially failed:

```text
PASS 48 / FAIL 4
```

Failed assertions were T15/T15b restore checks:

- kept ink did not restore on re-render;
- restored ink could not be extended with new ink.

Root cause: `message-cards-ink.test.html` mostly called the demo API without
`await`, even though the API had already been made asynchronous and serialized.
The fixed sleeps were not reliable enough after image restore and `toBlob`
became part of the lifecycle. On a slower browser run, the test could draw or
capture before the intended active surface finished activation/restoration,
creating a false "lost ink" failure.

Fix: update the executable material test to `await api.activate(...)`,
`await api.deactivate(...)`, `await api.activateDesk(...)`, and
`await api.deactivateDesk(...)` except for the deliberate race test that starts
keep and render concurrently.

After the fix, the material regression returned:

```text
PASS 52 / FAIL 0
```

Sub-agent review found one additional non-blocking correctness issue:

- `frontend/lib/chat-unread-state.ts`: replayed or older realtime
  `message.created` events could increment local unread counts again because the
  stored `lastSeq` was not used for dedupe.

Fix:

- `incrementChatUnreadForScope` now skips updates when `seq <= current.lastSeq`.
- `frontend/test/chat-unread-state.test.ts` adds
  `replayed realtime events do not inflate local unread counts`.

After this fix:

```text
rtk npm run lint -- --max-warnings=0
rtk env NODE_PATH=./node_modules npx tsx --test test/*.test.ts test/*.test.tsx
rtk env NODE_PATH=./node_modules npx tsc --noEmit
```

All passed; full frontend test result is `79` pass / `0` fail.

## Sub-Agent Review

Review channel: `cr-inkframe-product-ui`

Worker: `check-inkframe`

Result:

- No blocking issues found.
- One local unread replay-dedupe issue found and fixed by the worker.
- Residual risks confirmed:
  - full product `MaterialSurface` extraction remains follow-up scope;
  - backend read cursor persistence remains follow-up scope;
  - unused/deprecated `mdast` package should be considered in cleanup if no
    other pending branch work needs it.

## Residual Risks / Follow-Ups

- The real product currently has the shell-owned Inkframe desk background and
  object primitives integrated. The full reusable product `MaterialSurface`
  extraction from the demo remains incomplete and should be the first item in
  the next optimization task.
- Chat unread/event state is frontend-local. Server-side member read cursors
  are still needed for cross-device persistence and backend correctness.
- Other pages have the shared background and some visual alignment, but full
  object-language refactors for members/computers/settings are intentionally
  outside this pass.
- Fresh `./twd` browser evidence could not be collected in this session because
  no WebDriver tab was connected. Screenshots/in-app-browser observations are
  not treated as acceptance for this merge; they remain supplemental context.
- The deprecated `mdast` package appears unused in the current checked files.
  It is not a blocker for this pass because package changes predate this review
  and may relate to adjacent markdown work, but it should be cleaned in a
  dependency hygiene pass if confirmed unused.

## Gate Result

Code/test gate: pass.

Product scope gate: pass for the code-level frontend-first
chat/task/default-background iteration. True-device/browser UX acceptance is
deferred to a preview/connected-`./twd` pass and is not represented by
screenshots in this Trellis record.
