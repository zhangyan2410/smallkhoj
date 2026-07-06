# Inkframe Mobile Source Contract Hardening

## Goal

Continue the Inkframe frontend optimization loop while real `./twd` browser
proof is blocked by no connected tab. Harden chat/task mobile behavior through
source-level contracts and component/unit tests so the real browser pass has
less ambiguity once Chrome reconnects.

This task does **not** replace real browser/mobile proof. It is the next
productive frontend pass while
`.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof` remains at
`blocked_no_tab`.

## Parent Context

Parent task:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

Required sibling inputs:

- `.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof`
- `.trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner`
- `.trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness`
- `.trellis/tasks/07-06-inkframe-runtime-browser-proof-product-polish/12-hour-product-refactor-plan.md`

## Current Facts

- The reusable proof runner exists at
  `tools/twd-guard/twd-inkframe-proof`.
- Running that runner under the browser-proof task currently writes
  `blocked_no_tab` evidence because `./twd --compact tabs` returns no connected
  tabs.
- The frontend already exposes many `data-inkframe-*` markers, but mobile
  behavior still needs stronger source/test guarantees before browser proof can
  be called reliable.
- The user explicitly called out mobile/front-end polish as still remaining.

## In Scope

- Strengthen component/source tests for chat and task mobile Inkframe contracts.
- Ensure tests verify the same DOM roles used by the canonical proof runner:
  - chat workspace/message list/composer/thread/member panels;
  - task workspace/controls/board/detail/evidence/review;
  - app desk background;
  - material surfaces and pointer-capture state.
- Verify long-message readability contracts at the component/source level:
  - long messages stay stable, readable, and not over-tilted;
  - message actions are hidden by default and remain local to the message;
  - toolbar behavior is represented by stable attributes/classes.
- Verify mobile layout source contracts:
  - scroll owners have `min-h-0` / `min-w-0` / overflow containment;
  - sidebars/drawers can collapse without removing route-critical content;
  - static material surfaces do not capture pointer/scroll.
- Update or add tests in the existing frontend test style.
- Keep all evidence under this task's `evidence/` directory.

## Out Of Scope

- Claiming real browser/mobile acceptance without a connected `./twd` tab.
- Launching Chrome without explicit user permission.
- Broad visual redesign beyond source/test hardening.
- Backend read-cursor expansion.
- Persisting ink/material blobs.
- Replacing the canonical `twd-inkframe-proof` runner.

## Requirements

### R1. No Browser Substitution

This task may use component/source tests while browser is blocked, but must not
describe them as real browser proof. Any status report must keep browser/mobile
acceptance pending until `twd-inkframe-proof` passes with a connected tab.

### R2. Chat Mobile Contracts

Tests or source assertions must cover:

- `data-inkframe-mobile-role="chat-workspace"`;
- `data-inkframe-mobile-role="chat-message-list"`;
- `data-inkframe-mobile-role="chat-composer"`;
- message objects with density/readability metadata;
- message actions hidden by default;
- no default active material canvas per inactive message;
- static message material surfaces do not capture pointer by default.

### R3. Task Mobile Contracts

Tests or source assertions must cover:

- `data-inkframe-mobile-role="task-workspace"`;
- `data-inkframe-mobile-role="task-controls"`;
- `data-inkframe-mobile-role="task-board"`;
- task ticket objects;
- task detail/evidence/review mobile role markers when their states are
  rendered;
- static task material surfaces do not capture pointer by default.

### R4. Shared Product Shell Contracts

Tests or source assertions must cover:

- exactly one shell-owned app background marker on product-shell routes under
  test;
- background uses `owner-kind="app-background"`, `owner-id="global-desk"`, and
  `tint="desk"`;
- background pointer capture is false by default.

### R5. Canonical Runner Remains The Browser Gate

After source/component hardening, re-run:

```bash
rtk ./tools/twd-guard/twd-inkframe-proof \
  --task-dir .trellis/tasks/07-06-inkframe-browser-connection-mobile-proof \
  --account zy-ean \
  --json
```

If it is still `blocked_no_tab`, record that as the browser blocker, not as a
failure of the source hardening.

## Acceptance Criteria

- [ ] Existing relevant frontend tests still pass.
- [ ] New or strengthened tests cover chat mobile `data-inkframe-*` contracts.
- [ ] New or strengthened tests cover task mobile `data-inkframe-*` contracts.
- [ ] New or strengthened tests cover shell background owner/tint/pointer
      contracts.
- [ ] Long-message and message-action source contracts are covered without
      requiring a live browser.
- [ ] Static material surfaces are covered as non-pointer-capturing by default.
- [ ] `twd-inkframe-proof` is run after the source pass and its result is saved
      or referenced truthfully.
- [ ] Evidence under this task distinguishes source/component verification from
      still-pending real browser/mobile proof.
- [ ] A check agent review is attempted; if provider/auth fails, record that
      and perform a main-session self-review.
