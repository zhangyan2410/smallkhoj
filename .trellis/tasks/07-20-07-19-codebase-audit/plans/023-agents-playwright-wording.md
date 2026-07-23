# Plan 023: Clarify AGENTS.md Playwright wording (DOCS-02)

## Status
- **Priority**: P3, Effort: S, Risk: LOW
- **Depends on**: none
- **Category**: docs

## Why this matters
`AGENTS.md` line 29 says "do not use Playwright for repo UI verification." But the repo ships a Playwright e2e suite (`e2e/management-flow.spec.ts`), a `playwright.config.ts`, and an `npm run e2e` script — and that spec is current (tests routes that exist). Agents reading AGENTS.md will avoid `npm run e2e` and miss real coverage; or the rule is stale. Either way the team and agents disagree about what the verification surface is.

## Current state
`AGENTS.md:29`:
> Real UI/runtime testing: `docs/real-test-sop-template.md` and `docs/real-runtime-dm-reply-sop.md`. Use the project WebDriver wrapper `./twd`; do not call `twd.py` directly, and do not use Playwright for repo UI verification.

But:
- `e2e/management-flow.spec.ts` is a Playwright spec
- `frontend/playwright.config.ts` points `testDir: "../e2e"`
- `frontend/package.json` exposes `"e2e": "cross-env ... playwright test"`

## Scope
**In scope**: `AGENTS.md:29` — reword to distinguish ad-hoc agent UI checks from the committed e2e suite.

**Out of scope**: actual e2e test changes; Playwright config.

## Steps

### Step 1: Confirm the e2e suite is live
Read `e2e/management-flow.spec.ts` and `frontend/playwright.config.ts` — confirm the spec tests routes that still exist in the codebase. If the spec is stale (tests removed routes), the AGENTS.md rule may be correct as-is and the spec should be deleted instead.

### Step 2: Reword the AGENTS.md bullet
Replace line 29 with something like:
> Real UI/runtime testing: `docs/real-test-sop-template.md` and `docs/real-runtime-dm-reply-sop.md`. For ad-hoc agent UI checks during development, use the project WebDriver wrapper `./twd` (do not call `twd.py` directly). The committed Playwright e2e suite at `e2e/` (run via `cd frontend && bun run e2e`) is the canonical flow test — agents MAY run it for end-to-end verification but should not use Playwright for one-off interactive exploration.

(Adjust wording to match the actual intent — confirm with operator if possible, otherwise default to this interpretation.)

## Done criteria
- [ ] `AGENTS.md` no longer contains the blanket "do not use Playwright" ban.
- [ ] The new wording clearly distinguishes: ad-hoc exploration = `./twd`; committed e2e = Playwright via `bun run e2e`.
- [ ] `grep -i "playwright" AGENTS.md` returns a sensible reference.

## STOP conditions
- Step 1 reveals the e2e spec tests routes that no longer exist (stale) — report; the fix is to delete the stale spec, not update AGENTS.md.
- The operator wants a different interpretation (e.g. "agents should never use Playwright even for e2e") — report and defer.

## Maintenance notes
- Re-audit this when the e2e suite is expanded or removed.
- Reviewer scrutiny: confirm the new wording is actually unambiguous to an agent reading AGENTS.md cold.
