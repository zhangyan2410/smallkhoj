# Implementation Plan

## Phase 1: Auth Research And Dependency Shape

1. Confirm Better Auth package versions and Next.js 16 compatibility.
2. Decide database adapter strategy for the frontend deployment:
   - direct Postgres driver;
   - Drizzle adapter;
   - Prisma adapter.
3. Add required env template entries without committing secrets.
4. Add Better Auth route handler and auth client/server helpers.

## Phase 2: Backend Bridge

1. Add a backend endpoint that creates/resolves a SmallKhoj account from a verified Better Auth user identity.
2. Add idempotent default Server provisioning.
3. Add minimal create-Server endpoint for the current account.
4. Extend account/session serialization with active memberships.
5. Add backend tests for idempotency, second Server creation, and cross-Server scope.

## Phase 3: Frontend Active Server State

1. Add active Server persistence in a cookie readable by SSR and Server Actions.
2. Extend `apiHeaders` / server-side header helpers to attach `X-Server-Id`.
3. Update key fetch helpers and Server Actions to use the active Server header.
4. Add tests for header behavior and stale active Server fallback.

## Phase 4: Server Switcher UI

1. Add switcher component to `ProductShell`.
2. Render memberships from the account session payload.
3. Implement switch action and refresh behavior.
4. Add minimal create-Server action in the switcher.
5. Style with existing SmallKhoj product system; verify responsive behavior.

## Phase 5: Scope Coverage

1. Verify channel list/read/write under selected Server.
2. Verify Computer list/connect command under selected Server.
3. Verify Agent list/create under selected Server.
4. Verify Task list/create under selected Server.
5. Verify activity/memory/saved/files either scoped or explicitly tracked if not yet migrated.

## Phase 6: Validation

Run:

```bash
rtk python3 -m pytest backend/tests/test_server_account_membership.py -q
rtk python3 -m pytest <new backend auth/server switcher tests> -q
rtk npm --prefix frontend test -- <new frontend tests if available>
rtk npm --prefix frontend run lint
rtk npm --prefix frontend run build
./twd <real two-server UI drill>
rtk python3 scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json
```

Record `./twd` evidence under this task.
