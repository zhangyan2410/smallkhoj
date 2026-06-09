# frontend product shell and navigation

## Goal

Replace the current homepage/link-based navigation with an app-first SmallKhoj product shell comparable in structure to Slock, while using SmallKhoj's own cyan/blue visual identity.

## Requirements

* Build a persistent app shell for the main authenticated product.
* Include first-level navigation: Search, Chat, Tasks, Members, Computers, Notifications/Activity, Settings.
* Include a secondary sidebar pattern for context-specific lists: channels/DMs in Chat, members in Members, computers in Computers.
* Make `/` land on the real workbench, not a marketing or verification landing page.
* Preserve access to API docs/control plane as secondary/admin links.
* Support desktop and mobile without text overlap or layout jumps.
* Use icon buttons with accessible labels/tooltips where appropriate.

## Acceptance Criteria

* [ ] Browser opens `http://127.0.0.1:3000/` and sees the product shell immediately.
* [ ] Main nav links or buttons reach Chat, Tasks, Members, Computers, Settings.
* [ ] The shell can host per-section sidebars without nesting page cards inside cards.
* [ ] Existing channel/DM creation flows remain reachable.
* [ ] Real WebDriver screenshot evidence is saved under `evidence/`.

## Real Test SOP

Use marker `REAL_shell_<timestamp>`.

1. Open `/` through `twd.py`.
2. Verify visible nav labels and current route.
3. Navigate to Chat, Tasks, Members, Computers, Settings.
4. Capture screenshots for desktop and a narrow viewport if supported by the harness.
5. Record pass/fail notes in `evidence/REAL_shell_<timestamp>-notes.md`.

## Context

* Parent: `.trellis/tasks/06-09-product-maturity-gap-decomposition/prd.md`
* Research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/slock-product-surface.md`
* Research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/smallkhoj-current-gap.md`
* Frontend specs: `.trellis/spec/frontend/`
