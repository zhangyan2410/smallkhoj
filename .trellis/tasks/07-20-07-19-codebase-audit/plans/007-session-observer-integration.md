# Plan 007 (Direction): Integrate `session-observer/` into the main app shell

> **Executor instructions**: This is a **design/spike plan**, not a
> build-everything task. The goal is to define the integration boundary
> between the standalone `session-observer/` product and the authenticated
> SmallKhoj shell, prototype the thinnest viable bridge, and list the open
> questions before any L-sized build. Read the plan fully, gather the
> listed evidence, then propose the integration design for operator
> approval BEFORE building.

## Status

- **Priority**: P3
- **Effort**: L (full integration); M for the thinnest viable bridge
- **Risk**: MED (must preserve the observer's standalone boundary — see
  `.trellis/tasks/07-16-session-observability-console/design.md:40-44`)
- **Depends on**: none (independent of plans 001–005)
- **Category**: direction
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

`session-observer/` is the clearest product trajectory in the repo: three
of the six active `.trellis/tasks/*` are observability/diagnostics
(`07-16-session-observability-console`, `07-17-coding-agent-harness-diagnostics`,
`07-17-human-guided-harness-audit-mvp`). The observer is already
implemented — Node stdlib, `node:sqlite`, hand-authored SSR HTML, exposes
an SSE stream at port 7419, designed to work for daemons that are NOT part
of SmallKhoj.

But the main app has no path to it. `frontend/app/daemon/page.tsx:369`
describes the control surface as a local aggregation view
("agents, computers, tasks, files, reminders, activity") and does not link
to or embed the observer. `./smallkhoj-trace` (a CLI) is the only
operator-facing integration today, and operators have to know to open
`http://127.0.0.1:7419/` separately.

`PRODUCT.md:13` promises "the management/control UI exists to make runtime
and integration behavior inspectable at a glance." For non-SmallKhoj
daemons, that promise is half-met. The hard constraint: `07-16/design.md`
explicitly rejects just adding routes to the authenticated frontend because
it would hide coupling to the backend — the integration must preserve the
observer's standalone boundary.

## Current state

**`session-observer/`** (untracked, but implemented):

- `session-observer/README.md` — documents the standalone tool.
- `session-observer/src/{http,domain,store,stream}/` — Node stdlib + sqlite
  implementation; runs on port 7419.
- Designed for external daemons; "must work for a daemon that is not part
  of SmallKhoj, must not require the SmallKhoj backend" (per
  `.trellis/tasks/07-16-session-observability-console/prd.md:1-12, 95-112`).

**`frontend/app/daemon/page.tsx:369`** — main control surface; no link to
the observer.

**`scripts/smallkhoj-trace.mjs:14-29`** — CLI aggregator; already bridges
backend/frontend/daemon/log traces into one terminal view. Not productized.

**`AGENTS.md:30`** — documents `./smallkhoj-trace` as the trace tool, not
as a product surface.

**`.trellis/tasks/07-16-session-observability-console/design.md:40-44`** —
explicitly rejects coupling the observer into the authenticated frontend.

## Scope

**In scope for the SPIKE** (this plan):

- A design document proposing the integration boundary, with two prototype
  options side by side.
- A minimal proof-of-concept for the chosen option (operator picks).

**Out of scope** (defer to follow-on build plans after the spike):

- Full activity-timeline unification across SmallKhoj backend events and
  observer events.
- Authenticated proxying / SSO between the two surfaces.
- Replacing `./smallkhoj-trace` with a productized `/control/trace` page.

## Steps

### Step 1: Gather the complete observer contract

Read and excerpt:

- `session-observer/README.md` — what endpoints it exposes, what data it
  stores, how a daemon publishes to it.
- `session-observer/src/http/*` — the actual HTTP surface (paths, response
  shapes).
- `session-observer/src/stream/*` — the SSE contract (event types, fields).
- `.trellis/tasks/07-16-session-observability-console/{prd,design}.md` —
  the explicit constraint about standalone operation.
- `frontend/app/daemon/page.tsx` — what the existing control surface
  already shows, so the integration is additive, not duplicative.

**Verify**: produce a brief documenting the observer's public contract and
the standalone-operation constraint, with the exact design.md lines that
forbid tight coupling.

### Step 2: Propose two integration options

Draft (do not build) both, side by side:

**Option A — Deep-link + iframe**: add a `/control/sessions` route in the
main app that links to `http://127.0.0.1:7419/?from=smallkhoj` and embeds
the observer's UI in an `<iframe>`. The observer stays a separate process;
the main app just discovers it and surfaces a button.

- **Pro**: preserves the standalone boundary perfectly; zero coupling.
- **Con**: two URLs, two auth models; iframe sandboxing caveats.

**Option B — Reverse-proxy + unified timeline**: the SmallKhoj backend
proxies `/api/v1/observer/*` to the observer's loopback origin, and the
main app renders a unified activity timeline sourced from BOTH the
SmallKhoj backend event stream AND the observer's `/api/v1/stream`.

- **Pro**: one URL, one auth model, unified view.
- **Con**: tighter coupling; must preserve the observer's ability to run
  standalone (the proxy must fail-open when the observer is absent).

Include for each: data flow diagram (textual), files touched, effort
estimate, and how it honors the `07-16/design.md` constraint.

**Verify**: operator picks A, B, or defers. Do not build until picked.

### Step 3: Prototype the chosen option

Build the thinnest viable version of the chosen option:

- **If A**: one new page `frontend/app/control/sessions/page.tsx` that
  renders a button + iframe pointed at `http://127.0.0.1:7419/`. No backend
  changes.
- **If B**: one new route in `backend/routers/public_api.py`
  (`GET /api/v1/observer/stream`) that proxies to the observer with a short
  timeout; one new frontend component that consumes it. Fail-open if the
  observer is not running (return empty stream, not an error).

In both cases, add a link from `frontend/app/daemon/page.tsx` to the new
surface.

**Verify**:
- `./twd` screenshot (per AGENTS.md) shows the new surface reachable from
  `/daemon`.
- With the observer stopped, the main app does NOT crash (fail-open
  verified).

## Done criteria

- [ ] A design document exists at
      `.trellis/tasks/07-16-session-observability-console/integration-design.md`
      documenting the chosen boundary and the rejected alternative.
- [ ] The thinnest-viable prototype is reachable from `/daemon`.
- [ ] With `session-observer` stopped, the main app still loads (fail-open
      verified via `./twd`).
- [ ] The standalone operation constraint from `07-16/design.md:40-44` is
      honored — the observer still runs independently when invoked
      directly.
- [ ] `plans/README.md` status row for plan 007 updated to DONE (or
      BLOCKED if the operator deferred the decision).

## STOP conditions

- The operator does not pick A or B — STOP, leave the design doc as the
  deliverable, mark plan BLOCKED.
- Step 1 reveals the observer's HTTP/SSE contract is substantially
  different from what the README claims (drift) — report; the integration
  cannot proceed until the contract is re-verified.
- Option B's reverse-proxy turns out to require auth changes (e.g. the
  observer has its own auth that conflicts) — STOP and surface as a
  design question; do not silently introduce a second auth model.
- Building the prototype requires touching the observer's code in a way
  that breaks its standalone operation — that violates the core
  constraint; report and pick Option A instead.

## Maintenance notes

- **The observer is its own product.** Any integration that makes the
  observer depend on SmallKhoj is a regression on the stated direction;
  reject such changes in review.
- **`./smallkhoj-trace` is the bridge today**; if the integration lands,
  decide explicitly whether the CLI stays (for power users) or is
  superseded by a `/control/trace` page. Don't leave both in limbo.
- **Reviewer scrutiny**: the fail-open behavior is the most important
  correctness property. A missing observer must never break the main app.
