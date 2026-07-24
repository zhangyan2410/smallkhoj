# Actor identity normalization and impersonation

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | Public human routes accept several actor forms, but authorization is scattered and may compare raw input text. A foreign member can be selected on insufficiently protected paths, while the advisor fix rejects legitimate self forms such as `@viewer` and the viewer UUID. Expected: omission, display name, handle and UUID all normalize to the current scoped viewer UUID; foreign identities are rejected. |
| **2. Evidence** | `_resolve_human_actor()` and `_ensure_memory_actor_matches_viewer()` enforce overlapping actor rules in `backend/routers/public_api.py`. Existing `backend/tests/test_public_memory_routes.py` explicitly treats omitted/display/`@display`/UUID as legal self aliases. Advisor commits `6f453a3` and `f35c339` compare a narrower representation and alter tests to accept regressions. |
| **3. Confirmed root cause** | Parsing, tenant-scoped identity resolution, ambiguity handling, and authorization are not one boundary operation. Raw aliases are sometimes authorized before being resolved to a canonical member UUID. This creates both impersonation gaps and false denials. |
| **4. Diagnostic strategy** | Inventory every public route that accepts `actor`, `sender`, `creator`, or equivalent. Build one characterization matrix for omission/display/handle/UUID/foreign/ambiguous/cross-server input, then trace each route to the resolver. Compare UUIDs only after tenant-scoped resolution. |
| **5. Timeout strategy** | If duplicate case-folded display names make resolution policy ambiguous, stop and document a stable 4xx policy rather than selecting a member arbitrarily. Keep the existing viewer-default contract while the ambiguity decision is isolated. |
| **6. Warning strategy** | Any fix that authorizes a raw string, queries without `server_id`, treats a UUID-looking display name as unambiguous, or makes an existing legal self form fail is rejected. Three route-specific patches without a shared resolver trigger a design reset. |
| **7. User-visible correction** | Users may continue using the supported self aliases, but cannot name another member to author messages, reactions, tasks, memory, files, or profile changes. Cross-tenant attempts remain non-disclosing. |
| **8. Acceptance** | RED/GREEN matrix: omitted, exact display, `@display`, and canonical UUID resolve to the viewer UUID; every foreign representation returns 403; ambiguous/not-found returns a stable non-disclosing 4xx; cross-server UUID never resolves. Route tests cover all actor-bearing public operations. |

## Report

- **Reporter:** Independent re-audit of finding 012 on 2026-07-23.
- **Reproduction:** Exercise actor-bearing routes with self and foreign display/handle/UUID values and compare behavior across message, task, memory, file and member operations.
- **Root cause:** Identity parsing and authorization are duplicated and operate on non-canonical text.
- **Repair direction:** Centralize scoped actor resolution, normalize once, and authorize canonical UUIDs.
- **Verification:** Preserve the existing legal self matrix while rejecting foreign, ambiguous and cross-tenant forms at real route boundaries.

## Candidate patch disposition

- `6f453a3` / `f35c339`: reuse the inventory of affected routes and the intent to require viewer matching; reject raw/narrow alias comparison and tests that remove valid `@viewer` or UUID behavior.

## TDD evidence

### RED

The actor matrix initially produced `6 failed, 3 passed`: viewer UUID input
created/selected the wrong Member path; foreign display, handle, and UUID forms
were not consistently denied; unknown and ambiguous aliases were auto-created or
selected instead of returning stable 4xx responses.

### GREEN

The focused actor matrix passed `9 passed`. The existing memory compatibility
matrix passed `7 passed`, preserving omitted/display/`@display`/UUID self aliases.
The combined current command is:

```bash
cd backend
uv run pytest -q \
  tests/test_auth_tenancy_contracts.py \
  tests/test_public_memory_routes.py
# 35 passed in 1.01s
```

Assertions cover canonical viewer UUID resolution, 403 for every foreign form,
400 for ambiguous aliases, 404 for unknown aliases, and no Member creation by
actor lookup.
