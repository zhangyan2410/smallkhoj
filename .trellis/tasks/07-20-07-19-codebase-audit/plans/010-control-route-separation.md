# Plan 010 (Direction): Enforce `/control/*` vs product surface separation

## Current remediation disposition (2026-07-24)

- **Disposition**: `DEFER_LINKED`
- **Release scope**: `RELEASE_EXCLUDED`
- **Decision**: keep `/daemon` unchanged for this release. Route separation and
  navigation redesign remain a linked product/architecture decision for a later
  task.
- **Current truth**: the current audit candidate does not move the route, add a
  redirect, or claim the `/control/*` restructuring is complete.

The plan below is retained as historical advisory context and must not be
executed as part of the important-bug audit scope.

> **Executor instructions**: This is a **route restructure plan** with a
> product-policy decision at its core. Read fully, confirm the operator's
> chosen direction in Step 1 BEFORE any code changes, then implement.
> Honor the STOP conditions.

## Status

- **Priority**: P3
- **Effort**: M (a day-ish — route move + redirects + nav audit)
- **Risk**: MED (moves a top-level nav target; needs redirects and a
  deep-link audit)
- **Depends on**: none
- **Category**: direction / architecture
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

`PRODUCT.md:27` states a design principle: "Separate control UI from
product UI; `/control/*` surfaces can be dense and operational without
becoming user-facing product flows." The route tree does not enforce this:

- The dense operational console ("agents, computers, tasks, files,
  reminders, activity" — `frontend/app/daemon/page.tsx:369`) lives at
  `/daemon`, the **top-level** nav target.
- Only two `/control/*` routes exist: `frontend/app/control/integration/`
  and `frontend/app/control/taskrun-templates/`.
- `/daemon` is linked from product surfaces: `frontend/app/settings/page.tsx:44`,
  `frontend/app/tasks/page.tsx:754`, `frontend/app/chat/[channel]/chat-sidebar.tsx:94`,
  mixing the two tiers PRODUCT.md says to separate.

As the observer (plan 007) and harness-diagnostics UIs land, the absence
of a `/control/*` home means they will get bolted onto `/daemon` or leak
into product nav.

## Current state

- `frontend/app/daemon/page.tsx:369` — content explicitly "本地后端聚合视图：
  agents、computers、tasks、files、reminders、activity" (the dense
  operational surface PRODUCT.md says belongs under `/control/*`).
- `frontend/app/control/` — only `integration/page.tsx` and
  `taskrun-templates/page.tsx`.
- `frontend/components/product-shell.tsx:38` — links `/daemon` as
  `{ key: "activity", href: "/daemon", ... }`, the top-level nav target.
- Product-side links to `/daemon`: `settings/page.tsx:44`,
  `tasks/page.tsx:754`, `chat-sidebar.tsx:94`.

## Scope

**In scope**:

- `frontend/app/daemon/` — move to `frontend/app/control/daemon/` (Step 2)
  OR keep at `/daemon` and treat as product (Step 1 Option B).
- `frontend/components/product-shell.tsx` — nav restructure.
- `frontend/middleware.ts` (or `next.config.mjs` redirects) — add
  `/daemon → /control/daemon` redirect if Option A.
- All files linking to `/daemon` — update or remove per the chosen option.
- `AGENTS.md` / docs — document the `/control/*` convention.

**Out of scope**:

- Moving `integration` and `taskrun-templates` (they are already under
  `/control/*`).
- Designing new `/control/*` surfaces (observer integration is plan 007).
- Authentication changes for `/control/*` (defer to a separate auth plan).

## Steps

### Step 1: Operator decision — which direction?

Present the choice (this is a product decision, not a technical one):

**Option A — Move `/daemon` to `/control/daemon`** (PRODUCT.md-aligned):
- `/daemon` becomes `/control/daemon`; the dense operational surface lives
  under the `/control/*` umbrella alongside `integration` and
  `taskrun-templates`.
- Product surfaces (chat sidebar, settings, tasks) no longer link to it
  directly; a separate control nav surfaces it.
- **Consequence**: existing `/daemon` deep links (docs, bookmarks, daemon
  scripts) need a redirect.

**Option B — Keep `/daemon` as a product surface, relax PRODUCT.md**:
- Accept that `/daemon` is a product surface operators reach for; update
  PRODUCT.md to match.
- **Consequence**: the design principle is weakened; future operational
  surfaces have no natural home.

**Verify**: operator picks A, B, or defers. Do NOT proceed to Step 2
without a decision.

### Step 2 (Option A only): Move the route

- Move `frontend/app/daemon/page.tsx` →
  `frontend/app/control/daemon/page.tsx` (and any collocated files).
- Add a redirect: in `frontend/middleware.ts` or `next.config.mjs`:
  ```javascript
  // next.config.mjs
  async redirects() {
    return [
      { source: "/daemon", destination: "/control/daemon", permanent: false },
      { source: "/daemon/:path*", destination: "/control/daemon/:path*", permanent: false },
    ];
  }
  ```
  (Use `permanent: false` initially — a 308 would cache in browsers and
  make a rollback painful.)
- Audit and update all in-app links to `/daemon`:
  `grep -rn '"/daemon\|href.*daemon' frontend/` — for product surfaces
  (chat sidebar, settings, tasks), either remove the link or reroute it
  through a control-nav entry.

**Verify**: `./twd` (per AGENTS.md) — navigate from the home page to the
operational console via the new path; confirm the `/daemon` URL redirects.

### Step 3: Restructure the nav

In `frontend/components/product-shell.tsx`:
- Add a control-nav section (or a separate `<ControlShell>`) that lists
  `/control/daemon`, `/control/integration`, `/control/taskrun-templates`.
- Remove `/daemon` from the product nav's `activity` entry (Option A) or
  confirm its product-nav placement (Option B).

**Verify**: `./twd` screenshot showing the nav restructure renders
correctly in all three themes (water, dark, shuimo — plan 006).

### Step 4: Document the convention

Update `AGENTS.md` or add `docs/routing-conventions.md`:

```markdown
## Route conventions

- `/control/*` — operational surfaces for the product owner, local
  operators, and agents. Dense, evidence-focused; not user-facing.
  Examples: `/control/daemon`, `/control/integration`,
  `/control/taskrun-templates`, and future `/control/sessions` (observer).
- Top-level routes (`/`, `/chat`, `/tasks`, `/members`) — product surfaces;
  keep them free of operational density per PRODUCT.md.
```

**Verify**: the doc exists and is linked from `AGENTS.md`'s Project Index.

## Done criteria

- [ ] Operator decision (A or B) recorded in `plans/README.md`.
- [ ] If Option A: `/control/daemon` exists, `/daemon` redirects to it,
      and `grep -rn '"/daemon"' frontend/app frontend/components` shows
      only the redirect config and intentional product-side links (if any
      remain by design).
- [ ] Nav restructure rendered correctly via `./twd`.
- [ ] `AGENTS.md` or `docs/routing-conventions.md` documents the
      `/control/*` convention.
- [ ] `plans/README.md` status row for plan 010 updated to DONE.

## STOP conditions

- Operator defers the decision — STOP, mark plan BLOCKED with reason
  "awaiting product decision on /daemon placement."
- A daemon-side script or external tool depends on the literal `/daemon`
  URL and cannot tolerate a redirect (e.g. it does not follow 307/308) —
  report; the redirect must be permanent or the move must be abandoned.
- Step 2 reveals that `/daemon` has deep collocated state (e.g.
  `layout.tsx`, dynamic `[id]` routes) that complicates the move — report
  the actual structure before proceeding.

## Maintenance notes

- **The redirect should stay `permanent: false` for one release cycle**
  before flipping to permanent, so rollbacks are cheap.
- **New operational surfaces should default to `/control/*`** — the
  convention exists so that the next observer/diagnostics UI does not
  re-litigate the question.
- **Reviewer scrutiny**: confirm no product surface (chat, tasks,
  members) silently lost its `/daemon` link without a replacement path.
