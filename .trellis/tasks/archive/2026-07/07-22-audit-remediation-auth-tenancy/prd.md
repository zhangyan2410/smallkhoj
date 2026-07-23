# Repair authentication and tenant boundaries

## Goal

修复 public key、actor identity、首次 owner 和 TaskRunTemplate 租户边界，使认证材料不经 URL 泄漏、权限默认拒绝、合法自引用不被误伤，并由数据库保证并发与租户不变量。

## Source Findings

- Independent verdicts 002, 012, 013 and 014 are `REVISE`; TEST-02 and DEP-01 remain open.
- Current public API accepts `X-Public-Key` or `?api_key=` and retains a seed/default key path.
- Advisor 002 leaves backend `PUBLIC_API_KEY` disconnected from frontend/compose `NEXT_PUBLIC_API_KEY` and does not deny any currently known permission for permission-less agents.
- Advisor 012 blocks valid `@viewer`/viewer UUID self-reference.
- Advisor 013 uses check-then-act role selection, allowing concurrent first registrations to both become owner.
- Advisor 014 allows ordinary users to create global builtin templates, hides legacy NULL non-builtin rows, and keeps globally unique slugs.

## Requirements

### Public/API credential contract

- One documented server-side source defines the configured public API credential; frontend build/runtime and compose wiring must agree with it.
- Production must not silently fall back to a repository-known default credential.
- Browser/public HTTP uses an authorization header; WebSocket/SSE clients use a header, subprotocol, short-lived exchange, or another reviewed non-URL channel. Credentials must not appear in query strings, logs, history, screenshots or error text.
- Revoked/unknown keys fail closed. Key lookup and comparison remain constant-time where applicable.
- Agent permission evaluation is explicit default-deny for every protected capability; absence of a permission set cannot imply all currently known permissions.

### Actor identity contract

- A viewer may identify itself by display name, `@handle`, canonical UUID, or omission/default according to the endpoint contract.
- A viewer may not act as another member through any accepted representation, case/normalization alias or ambiguous duplicate.
- Identity normalization occurs once at the boundary and yields a canonical member UUID before authorization.

### First-owner concurrency contract

- At most one account can become bootstrap owner for the relevant initial server scope.
- Two independent transactions racing first registration cannot both commit owner membership.
- Retried/rolled-back registration does not leave orphan Server/Member/Account rows or downgrade an established owner.
- Creating a new Server for an existing account still gives that account owner of the new Server; this is distinct from global bootstrap registration.

### TaskRunTemplate tenant contract

- Only trusted system/bootstrap/migration code can create or modify global `builtin` templates.
- Human-created templates belong to an active Server; user/server visibility semantics are explicit and authorization uses active membership.
- Slug uniqueness is scoped so two Servers may use the same slug without collision; builtin slug resolution remains deterministic.
- Legacy `server_id IS NULL` rows are migrated/classified explicitly—never silently hidden.
- Read/update/delete/run resolution rejects cross-tenant IDs and does not reveal foreign template existence.

## Invariants

- **INV-A1:** No long-lived reusable credential is transported in a request URL.
- **INV-A2:** Missing configuration or permissions denies protected access in production.
- **INV-A3:** All legal self aliases resolve to the same viewer UUID; all foreign aliases are rejected.
- **INV-A4:** A bootstrap scope has at most one committed owner under arbitrary registration interleaving.
- **INV-A5:** A non-privileged request cannot create/update/delete a global builtin.
- **INV-A6:** Tenant A cannot observe or block Tenant B through template IDs or slugs.

## Acceptance Criteria

- [ ] Header/config/compose/build tests prove one coherent public-key contract and production refuses missing/default credentials.
- [ ] HTTP, WebSocket and SSE tests prove credentials are absent from URLs and invalid/revoked values receive 401/403 as designed.
- [ ] Permission matrix covers every current protected operation plus an unknown future capability; missing/empty permissions deny.
- [ ] Self-identity matrix passes for omitted/display/handle/UUID and rejects another member through every form.
- [ ] Real PostgreSQL two-session race commits exactly one bootstrap owner and leaves consistent account/member/server state.
- [ ] Template migration classifies legacy rows, creates tenant scope/indexes and allows same slug in two Servers.
- [ ] Ordinary members cannot create builtin or access foreign template IDs; owner/admin/user policy is directly tested.
- [ ] Auth/public-key/template tests execute real route/service boundaries rather than only mocks.
- [ ] Auth boundary ADR and deployment docs match the implementation.
- [ ] Focused/full backend and frontend gates pass.

## Dependencies and Boundaries

- Depends on the schema-integrity child's Alembic foundation before adding template/owner constraints.
- Delivery/UI child owns browser login/onboarding evidence and canonical e2e setup, but this child owns backend auth contracts.
- Email verification/provider product policy is unchanged unless separately approved; UI must not imply verification that is not configured.
