# Design: Inkframe Desk Background Owner And Route Coverage

## Contract Shape

The app desk background is a shell-owned material object:

```text
ProductShell
  -> InkMaterialRuntimeScript
  -> AppDeskBackground
    -> MaterialSurface
      ownerKind = app-background
      ownerId = global-desk
      region = app-background
      tint = desk
```

Product routes should compose this shell instead of creating page-local
background material owners. Login and join are allowed to use entry-surface
styling instead of the full shell, but they still must not bring back old
pink/dark/dirty backgrounds.

## Test Strategy

Because real `./twd` route proof is intermittently unavailable, this slice uses
source/component tests as a hard regression net and records WebDriver status
truthfully.

Add tests in the existing frontend test files rather than creating a broad new
test harness:

- `frontend/test/inkframe-object-ui.test.tsx`
  - Product route coverage and no route-local legacy background.
  - `ProductShell` owns one app-background.
- `frontend/test/material-surface.test.tsx`
  - `AppDeskBackground` attributes and shell-owned material contract.
- `frontend/test/material-resource.test.ts`
  - app-background resource owner/tint/source/visual/restore separation.

These tests are intentionally source-heavy. Browser acceptance remains pending
until `./twd` has a connected tab.

## Owner And Resource Model

The app background can use the same `MaterialResource` type as other surfaces,
but its owner/tint identity is not interchangeable:

| Surface | ownerKind | tint | region |
|---|---|---|---|
| App desk background | `app-background` | `desk` | `app-background` |
| Chat message | `message` | `paper` | `chat-main` |
| Task ticket | `task` | `task` | `task-main` |
| Evidence | `evidence` | `evidence` | task/detail region |
| Review | `review` | `review` | task/detail region |

Tests should prove the app background can carry a `sourceBlob`, `visualBlob`,
and `restoreBlob` at the same time, and that replacement/discard helpers do not
drop owner/tint metadata.

## Route Coverage Model

Source tests should identify the intended composition, not hard-code fragile
line numbers. For each route:

- user-facing shell routes should import/render `ProductShell`;
- login/join entry routes should expose dry-paper entry surfaces and not use
  legacy color blocks;
- no route should import/mount `AppDeskBackground` directly except
  `ProductShell`.

This creates the language future agents need: "the app desk background owner"
means one thing in code.

## Guardrails

- Do not add new visual theme branches.
- Do not add drawing controls in this slice.
- Do not move background state into browser persistence.
- Do not make every route an always-active WebGL canvas.
- Do not weaken chat/task material tests while hardening background coverage.

## Review Focus

Reviewers should check:

- whether tests pin the shell owner rather than an incidental class name;
- whether route coverage excludes internal/operator pages by design;
- whether app-background resources remain session-only and owner-aware;
- whether source/visual/restore separation is meaningful for future background
  images;
- whether browser proof claims remain honest.
