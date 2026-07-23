# Authentication and tenancy implementation plan

## 0. Diagnostic capsules

- [ ] Create capsules under `docs/bug-report/` for public-key deployment/URL leakage, actor self-alias regression, concurrent bootstrap owner, and template tenant escape.
- [ ] Record advisor 002/012/013/014 diffs as untrusted candidate evidence and name tests that currently encode incorrect behavior.

## 1. Characterization and contract tests

- [ ] Add direct tests for `verify_public_api_key`, configured/default/revoked keys and production startup/preflight.
- [ ] Add a protected-operation permission matrix; confirm RED for missing permissions currently allowed.
- [ ] Add actor resolver matrix for omitted/display/handle/UUID/foreign/ambiguous/cross-server inputs; confirm current 012 candidate fails legal handle/UUID cases.
- [ ] Add two-independent-session PostgreSQL registration race; confirm two-owner or missing DB invariant RED.
- [ ] Add real PostgreSQL template migration and route matrix for builtin privilege, legacy rows, same tenant slug, same slug across tenants and cross-ID access.

## 2. Credential transport and deployment coherence

- [ ] Search all key constants/env names/query parameters across backend/frontend/daemon/compose/docs before changing values.
- [ ] Define the canonical environment contract and local-dev exception.
- [ ] Wire backend/frontend/build/compose/preflight consistently; production missing/default credential fails closed.
- [ ] Replace WS/SSE query credentials using coordinated client/server transport and add no-credential-in-URL assertions.
- [ ] Verify Caddy/local-prod path and redact auth failure logs.

## 3. Permission and actor authorization

- [ ] Implement explicit capability registry/default-deny semantics with tests for every known operation and unknown values.
- [ ] Centralize scoped actor normalization to canonical UUID.
- [ ] Apply self-only checks after normalization; preserve legal aliases and reject foreign identities.
- [ ] Run auth route suites and regression tests for public/agent operations.

## 4. Database-enforced first owner

- [ ] Select and document the cross-process DB mechanism plus state/event table and retry policy.
- [ ] Implement migration/transaction changes after schema foundation.
- [ ] Ensure rollback/retry uses primitive IDs or reloads expired ORM state.
- [ ] GREEN the two-session race repeatedly and assert exactly one owner plus no orphan rows.

## 5. Template tenant scoping

- [ ] Write migration for `server_id`, legacy classification and partial/scoped unique indexes.
- [ ] Gate builtin mutation to system/bootstrap privilege; human routes cannot request global builtin visibility.
- [ ] Scope list/get/create/update/delete/run resolution through active Server membership.
- [ ] GREEN cross-tenant, legacy and duplicate-slug tests.

## 6. ADR, UI dependency and full gates

- [ ] Write/update ADR for public control-plane vs account/agent auth boundaries.
- [ ] Update deployment env docs without real credential values.
- [ ] Hand canonical authenticated setup contract to delivery/UI e2e child.
- [ ] Run focused PostgreSQL/auth tests, full backend tests/Ruff, frontend tests/lint/typecheck/build, diff check and Trellis validation.
- [ ] Fill all capsule acceptance fields with exact RED/GREEN evidence.

## STOP conditions

- Stop if credential transport requires a Caddy/browser capability not proven in local-prod.
- Stop if product policy for public signup/verification must change; present that separate value decision.
- Stop if bootstrap-owner scope is ambiguous (global installation vs per Server); resolve it before encoding a constraint.
- Stop legacy template migration when provenance cannot classify a NULL row safely; do not hide or guess.
- Never weaken tenant checks to keep an advisor fake-session test green.
