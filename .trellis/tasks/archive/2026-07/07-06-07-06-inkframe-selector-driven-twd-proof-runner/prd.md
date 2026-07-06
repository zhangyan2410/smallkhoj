# Inkframe Selector Driven TWD Proof Runner

## Goal

Turn the Inkframe DOM/mobile proof checklist into a repeatable project `./twd`
evidence runner that can collect real browser/mobile acceptance the moment a
browser tab is connected, while exiting honestly when no tab exists.

This is the next optimization loop under:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It builds directly on:

```text
.trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness
```

## Why This Task Exists

The previous loop added stable `data-inkframe-*` markers and a selector
checklist. The remaining proof gap is operational: a future agent should not
rediscover selectors or make screenshot-only claims. It should run one project
proof command that:

- checks whether `./twd` has a connected tab;
- opens the relevant routes through project guard wrappers when possible;
- asserts selector presence/counts for product shell, chat, tasks, material
  states, unread markers, and mobile roles;
- writes structured evidence under the active task;
- exits with a clear "blocked: no connected tab" result if browser proof cannot
  run.

## In Scope

- Add a small project proof runner or script for Inkframe `./twd` checks.
- The runner must use the stable selectors from:
  `.trellis/tasks/07-06-07-06-inkframe-browserless-dom-mobile-proof-readiness/evidence/twd-proof-checklist.md`
- The runner must never use Playwright.
- The runner must not launch Chrome by itself.
- The runner must produce machine-readable and human-readable evidence files.
- The runner must cover desktop and mobile selector assertions when a tab is
  connected.
- Add shell/unit tests for the runner behavior where feasible:
  no-tab detection, selector manifest shape, evidence path generation, and
  command construction.

## Out Of Scope

- Fixing the browser bridge itself.
- Launching Chrome without explicit operator permission.
- Visual redesign.
- Backend cursor schema changes.
- Cross-refresh persistence of ink/material images.

## Requirements

### R1. No-Tab Gate

The runner must start with:

```bash
./twd --compact tabs
```

If no tabs are connected, it must:

- write evidence that browser proof was blocked by no connected tab;
- exit in a way that automation can classify as "blocked/pending", not
  "passed";
- make no browser/mobile acceptance claim.

### R2. Selector Manifest

The runner must keep selectors in a readable manifest or code structure grouped
by:

- product shell;
- chat desktop;
- chat mobile;
- task desktop;
- task mobile;
- material pointer/canvas state;
- unread/event state.

Selectors must use the stable `data-inkframe-*` vocabulary, not brittle class
names.

### R3. Evidence Output

Evidence should be written under this task or a caller-provided task directory,
for example:

```text
.trellis/tasks/<active-task>/evidence/twd-inkframe-proof.json
.trellis/tasks/<active-task>/evidence/twd-inkframe-proof.md
```

The evidence must record:

- timestamp;
- routes checked;
- viewport/mobile widths checked;
- selector assertions and counts;
- `./twd --compact tabs` result;
- screenshots only as supplemental if the runner supports them later.

### R4. Mobile Checks

The runner should switch or request mobile viewport checks through the supported
`./twd` command surface. If the current `./twd` wrapper lacks a direct viewport
command, record a clear TODO in the evidence and still assert mobile role
markers in DOM at the current viewport.

### R5. Honest Failure Modes

The runner must distinguish:

- no connected tab;
- route open/auth failure;
- selector assertion failure;
- `./twd` command error;
- checklist unsupported by current `./twd`.

### R6. Tests

Add tests for:

- no-tab output classification;
- selector manifest includes required selector groups;
- generated evidence path is inside the task directory;
- command construction uses `./twd` and not Playwright.

## Acceptance Criteria

- [ ] A repeatable Inkframe `./twd` proof runner or script exists.
- [ ] The runner starts with a no-tab gate.
- [ ] The runner uses stable `data-inkframe-*` selectors.
- [ ] The runner writes JSON and/or Markdown evidence.
- [ ] The runner does not launch Chrome.
- [ ] The runner does not use Playwright.
- [ ] No-tab behavior records blocked evidence and does not claim acceptance.
- [ ] Tests cover selector manifest and no-tab behavior.
- [ ] `git diff --check` passes.
- [ ] Relevant frontend/tool tests pass.

## Guardrails

- Do not make the script pass when selectors were never checked.
- Do not bury failures in prose; produce structured status.
- Do not couple the runner to a single local port unless the project guard
  wrapper already owns route discovery.
- Do not add UI changes unless the proof runner exposes a real missing selector
  from the previous task.
