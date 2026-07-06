# Inkframe Browser Mobile And Backend Route Flow Hardening

## Goal

Turn the code-level Inkframe product refactor into real runtime evidence: connect
`./twd`, prove chat/task/background behavior in the browser at desktop and
390px mobile widths, then harden backend read-cursor route-flow tests with real
authenticated rows instead of source-text checks.

This is the next optimization loop after:

```text
.trellis/tasks/07-06-inkframe-runtime-browser-proof-product-polish
```

## Background

The previous loop reached code-level pass and sub-agent review:

- frontend typecheck passed;
- frontend lint passed;
- frontend tests passed: `120` pass / `0` fail;
- backend cursor + membership tests passed: `36` pass / `0` fail;
- backend compile passed;
- `git diff --check` passed;
- sub-agent review found and then confirmed fixed the actual `/tasks` route
  list/detail material activation gap.

The remaining truth gap is not small:

- browser/mobile proof is still missing because `./twd --compact tabs` returns
  `{"ok": true, "tabs": [], "count": 0}`;
- starting `./twd serve` succeeds, but no browser tab/extension client connects;
- backend cursor route-flow tests still lean partly on source-level assertions
  rather than authenticated API calls with persisted rows.

## Requirements

### R1. Restore `./twd` Browser Connectivity

Use the project WebDriver wrapper only:

```bash
rtk ./twd --compact tabs
```

If no tab connects:

- diagnose whether the issue is bridge, extension, browser tab, port discovery,
  or frontend server availability;
- start `./twd serve` only as a controlled temporary process and stop it after
  diagnosis;
- do not leave a long-running bridge process orphaned;
- record every command and exact output in evidence.

Do not use Playwright as a substitute for repo UI evidence.

### R2. Real Browser Proof For Product Surfaces

Once a tab is connected, prove the real app with `./twd`:

- `/chat` or `/chat/[channel]` loads authenticated;
- `/tasks` loads authenticated;
- `data-region="app-desk-background"` exists on product routes;
- old pink/dark/dirty route backgrounds do not appear on user-facing routes;
- browser screenshots and DOM JSON are saved under this task's `evidence/`.

### R3. Chat Browser Behavior

Use DOM assertions rather than visual guesswork:

- message toolbar is hidden by default and appears near the message on hover or
  focus;
- `data-slot="message-material-toggle"` exists;
- clicking one message toggle creates exactly one active message material canvas
  in `chat-main`;
- clicking another message toggle deactivates the previous one;
- long messages remain readable and are not aggressively tilted;
- thread root markers/unread state are visible only where backed by actual
  state.

### R4. Task Browser Behavior

Prove the route-level fixes from the previous loop:

- board task cards expose `data-slot="task-material-toggle"`;
- `/tasks?view=list` also exposes task material toggles through the shared
  `TaskBoard` list row path;
- selected task sidebar/detail/dialog exposes `TaskRouteDetailMaterialFrame`;
- opening `/tasks?task=<id>` starts static, not active;
- explicit paintbrush toggle activates exactly one task material canvas in
  `task-main`;
- switching active task deactivates the previous one.

### R5. Mobile 390px Proof

At a representative phone width:

- chat has no horizontal overflow;
- task has no horizontal overflow;
- composer/task controls are not clipped;
- material canvas does not steal scroll unless an explicit draw/water mode is
  active;
- evidence includes DOM measurements, not only screenshots.

### R6. Backend Authenticated Route-Flow Tests

Move backend read-cursor proof beyond source-text checks where the harness
allows it:

- authenticate as a real account/member;
- create or seed server/channel/DM/thread/message rows;
- call `POST /api/v1/chat/read-cursors` for channel, DM, and thread scopes;
- call `GET /api/v1/chat/read-cursors` and list routes to verify projection;
- prove monotonic writes;
- prove server/member scoping;
- prove channel/DM kind mismatch rejection;
- prove unread counts use actual newer messages, not global sequence gaps.

If the existing test harness cannot perform a true route-flow without large
fixture surgery, document the blocker and add the smallest missing harness
piece rather than falling back to source-text assertions again.

### R7. Keep Current Product Direction Stable

Do not introduce a new visual direction. This loop should harden proof and
runtime behavior, not redesign the theme.

Allowed UI edits:

- small fixes revealed by browser/mobile evidence;
- accessibility/focus/overflow fixes;
- selectors/data-region hooks needed for `./twd`;
- material activation bugs.

Not allowed:

- a new theme switcher;
- decorative redesign of members/computers/settings;
- backend/localStorage/IndexedDB persistence for large material blobs.

## Acceptance Criteria

- [ ] `./twd --compact tabs` has a connected tab, or a specific diagnosed
      blocker is recorded with command output and no orphan process left.
- [ ] Browser evidence for `/chat` is saved: screenshot plus DOM JSON.
- [ ] Browser evidence for `/tasks` is saved: screenshot plus DOM JSON.
- [ ] Browser DOM assertions prove chat has exactly one active message material
      canvas after toggling.
- [ ] Browser DOM assertions prove tasks have exactly one active task material
      canvas after toggling in board/list/detail contexts.
- [ ] Browser/mobile 390px DOM assertions prove chat and task have no horizontal
      overflow and no clipped primary controls.
- [ ] Browser evidence proves `/tasks?task=<id>` starts static until the
      explicit paintbrush toggle is clicked.
- [ ] Authenticated backend route-flow tests cover channel, DM, and thread
      read cursor writes.
- [ ] Backend tests cover cursor monotonicity, server/member scoping,
      channel/DM mismatch rejection, and unread count correctness with global
      sequence gaps.
- [ ] Frontend typecheck, lint, and full tests pass.
- [ ] Backend cursor/account/route-flow tests and compile pass.
- [ ] `git diff --check` passes.
- [ ] A Trellis channel review or self-review is recorded after implementation.

## Out Of Scope

- Large visual redesign beyond fixing evidence-discovered issues.
- Cross-refresh material persistence.
- Backend or browser storage of large image/ink blobs.
- Full notification center.
- Production observability beyond local route/browser proof.

## Evidence Paths

Use this task directory:

```text
.trellis/tasks/07-06-inkframe-browser-mobile-backend-hardening/evidence/
```

Suggested files:

- `browser-connectivity.md`
- `chat-browser-proof.json`
- `tasks-browser-proof.json`
- `mobile-proof.json`
- `backend-route-flow.md`
- screenshots under `evidence/screenshots/`
