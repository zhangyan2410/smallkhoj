# Delivery and visible UI design

## Gate model

One canonical gate matrix drives local documentation and CI:

| Layer | Required evidence | Failure meaning |
|---|---|---|
| source hygiene | diff check, generated/schema drift | patch/artifact inconsistency |
| backend | migrations, pytest, Ruff | data/API/code-quality regression |
| frontend | frozen Bun install, tests, lint, typecheck, build | dependency/UI/build regression |
| automated flow | isolated authenticated management flow | cross-layer session/API regression |
| real runtime UI | `./twd` + trace markers | visible/runtime integration regression |

CI runs deterministic non-interactive layers. The worktree release gate additionally
runs real runtime UI evidence. Neither substitutes for the other.

## Non-secret build environment

CI creates ephemeral values only for the job process. Values satisfy length/URL shape
requirements but grant no access outside the disposable environment. The variable
names come directly from auth-tenancy's canonical environment contract.

```text
job env -> frontend build/server env validation
        -> backend control-plane key validation
        -> isolated test DB/server/account bootstrap
```

Secrets are redacted by exact-name and value-pattern assertions. Source scanning
rejects the known default credential and credential-bearing query strings.

## Ruff baseline decision

First classify the 73 reproduced errors:

- mechanical imports/modernization in owned source: fix with review and tests;
- generated/vendor code: exclude only at the narrowest stable path;
- intentional compatibility: per-rule/per-file configuration with rationale;
- real undefined/unused behavior: fix manually.

The preferred terminal state is repository-wide `ruff check .` green. A configuration
baseline is acceptable only when it does not exempt newly touched code and every ignore
has a documented removal/ownership decision.

## Authenticated flow fixture

The test bootstrap API/fixture creates a unique namespace and returns primitive test
facts, not ORM state:

```text
account credentials/session
active server id
membership role
public/control key from job env
seed object ids
cleanup namespace
```

Browser state is established using the same session mechanism as real login or an
explicitly supported test-only bootstrap route unavailable in production. It asserts
the rendered account/server marker before exercising management pages. Every API
helper sends the required account/server context and canonical headers.

Auth-tenancy handoff contract (2026-07-23):

- generate one non-default ephemeral `PUBLIC_API_KEY` per isolated run; give the
  backend that value directly and build the frontend with
  `--secret id=public_api_key,env=PUBLIC_API_KEY` under
  `NEXT_PUBLIC_DEPLOYMENT_ENV=production`;
- never write the value into test source, a build arg, command-plan JSON, or a URL;
- public HTTP/SSE helpers send `X-Public-Key`; authenticated control-plane helpers
  additionally send the supported session token/cookie and `X-Server-Id` for the
  selected membership;
- chat WebSocket URL is only `/api/chat/ws`; requested protocols are
  `smallkhoj.chat.v1` and `smallkhoj.public-key.<base64url(value)>`, and the server
  must select only `smallkhoj.chat.v1`;
- login/setup must assert account identity and active Server before management
  actions. A public key alone is never accepted as human identity or tenant context;
- explicit empty agent permissions mean deny-all. Only missing/JSON-null legacy
  permission data receives compatibility backfill.

The local-prod auth child gate already proved Caddy preserves the chat subprotocol:
missing/wrong keys returned 403, the correct key negotiated
`smallkhoj.chat.v1`, and backend logs did not echo the credential. Delivery/UI still
owns browser-visible `./twd` evidence for the integrated runtime.

## UI state machines

Deletion:

```text
IDLE -> CONFIRMING -> SUBMITTING -> SUCCEEDED/REMOVED
                         |-> FAILED/RESTORED
                         |-> FORBIDDEN/UNCHANGED
```

Loading/error:

```text
INITIAL -> LOADING -> CONTENT
                  -> ACTIONABLE_ERROR -> RETRYING -> CONTENT/ERROR
```

Realtime invalidation:

```text
one shared event -> classify -> invalidate owning query -> loading-stale -> fresh
```

Each state has an accessible label, focus rule and localized copy. UI does not remove
an item permanently until the server confirms the transaction.

## Real runtime evidence topology

```text
isolated PostgreSQL
  -> worktree backend/daemon -> smallkhoj-trace
  -> worktree frontend       -> ./twd tab
                               DOM + network + screenshot markers
```

Before each scenario, record branch/commit, process PIDs, ports, database name and tab
URL. Marker names tie browser action, network request, backend event and final DOM.

Required scenarios:

1. authenticated landing and active-server proof;
2. task delete success plus dedicated tombstone event and targeted refresh;
3. file delete success/failure and visible rollback;
4. cross-channel task pagination beyond 50 rows;
5. loading/error boundary and retry;
6. one physical SSE connection and task-only invalidation;
7. theme/accessibility smoke for changed surfaces.

## Documentation authority

- package metadata/lockfile are dependency truth;
- CI workflow is required command truth;
- frontend README explains local execution;
- AGENTS and real-test SOP define acceptance tooling;
- task evidence records exact release-run results.

Contradictions are gate failures, not prose nits.
