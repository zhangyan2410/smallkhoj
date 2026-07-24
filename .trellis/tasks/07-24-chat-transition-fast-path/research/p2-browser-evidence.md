# P2 browser evidence — shell chrome persists across navigation

Captured 2026-07-24 against `next dev` (Turbopack) on :3000 + backend :8000,
authenticated as `e2e.fastpath@example.com`.

## What changed (P2)

- New `app/(app)/layout.tsx` (Next route group, URL unchanged) mounts the stable
  chrome ONCE: `<InkMaterialRuntimeScript />` + `<AppDeskBackground />` + `<AppRail />`
  (icon rail, `active` derived from `usePathname()`). It also calls
  `requireCurrentAccount()` as the single auth gate.
- `ProductShell` slimmed to body-only (header + three-column body via
  `ProductShellBody`). No longer mounts rail/background/engine/session/active.
- All 7 product pages + `chat/layout.tsx` dropped `active=` and `session={session}`
  from their `<ProductShell>` calls.
- Routes moved into `(app)/`: page.tsx, chat/, tasks/, members/, computers/,
  control/, daemon/, dm/, settings/. `/login`, `/join/[token]` stay top-level.
- `provider-select.tsx` moved from the route to `components/` (layer-rule fix: a
  Layer-2 component imported it).
- Test contracts updated to point shell-ownership assertions at `(app)/layout.tsx`
  and the rail at `components/app-rail.tsx`.

## Persistence proof (./twd)

Method: stamped `data-persist-stamp` on the rail `<nav>` and `.sk-app-desk-background`
DOM nodes, then triggered **client-side** navigation by clicking the rail's Next
`<Link>`s (NOT `./twd goto`, which does a full page reload and rebuilds everything
by design).

Stamp `csp-1784906464295` set on `/`:

| client-side nav to | url after | railStamp | bgStamp |
|---|---|---|---|
| `/tasks` (click Tasks link) | `/tasks` | **csp-…295** ✓ | **csp-…295** ✓ |
| `/chat` (click Chat link → redirect) | `/chat/e2e-fast-path` | **csp-…295** ✓ | **csp-…295** ✓ |

Both stamps survived both navigations → the rail and background DOM nodes were
NOT unmounted/remounted by React across client-side route changes. The `(app)`
layout chrome is persistent, which is exactly the P2 goal: switching pages no
longer rebuilds the workbench shell.

Note: `./twd goto` performs a full browser navigation (`type: "navigate"`), which
rebuilds the entire React tree including layouts — so persistence must be measured
via in-page Link clicks, not `goto`. This is expected Next.js behavior, not a
regression.

## Static gates (P2)

- `tsc --noEmit`: 0 errors.
- `eslint` on changed areas: clean.
- `tsx --test` full suite: 148/148 pass.
