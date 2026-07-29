# Design — Integration Gate Restoration

## 1. Architecture Summary

The restoration keeps the gate as a Node-owned executable boundary and separates four concerns:

```text
scenario/report models
        ↓
CLI orchestration ─── current public API + Server scope
        │                         │
        │                         └── chat / DM / collaboration evidence
        ├── daemon JSON-RPC allowlisted runtime control
        │                         └── context / compact / usage evidence
        └── atomic report store (.runtime/integration-gate)
                                  ↓
                         bounded report reader
                                  ↓
                         /control/gates UI
```

Pure tests stop at the first two boxes with injected transports and fixtures. Real runs cross the external boundaries and retain explicit dependency readiness steps.

## 2. Historical Restore Strategy

The historical branch head `99771f4` is the behavioral oracle, not a source to cherry-pick wholesale. The old commits also contain obsolete frontend persistence and routing choices. Restoration proceeds after compatibility RED tests by copying the isolated `tools/integration-gate/` files, then adapting them in-place.

Contracts to preserve:

- seven stable mode names;
- report status/summary/check layout;
- marker parsing and causal relationship checks;
- failure categories and compact one-line output;
- dependency injection used by mock CLI tests.

Contracts to replace:

- implicit tenant selection → required Server id;
- `frontend/data/integration-gate` writes → atomic runtime report store;
- obsolete daemon method wiring → current JSON-RPC method registry plus allowlisted handler;
- old integration page data binding → dedicated `/control/gates` route.

## 3. CLI Contract

Primary shape:

```text
node tools/integration-gate/run.mjs \
  --mode <mode> \
  --api-base <url> \
  --frontend-base <url> \
  --daemon-rpc-base <url> \
  --public-key <key> \
  --account-token <token> \
  --server-id <uuid> \
  --result-dir <path>
```

Secrets may also come from existing environment variables, but the normalized options object separates secret values from serializable report target metadata. Usage/help and error messages display flag names, never values.

`--server-id` is mandatory for real modes. Mock/model tests can inject a target fixture. Invalid UUID/string format is rejected locally; ambiguous discovery is never attempted silently.

Exit codes:

- `0`: gate passed;
- `1`: gate executed and failed a check;
- `2`: CLI/configuration/preflight contract error.

## 4. Report Contract and Storage

Each report contains:

- schema version;
- run id and mode;
- started/finished timestamps and duration;
- redacted target (`apiBase`, `frontendBase`, `daemonRpcBase`, `serverId`);
- status and summary totals;
- ordered checks with status, code, category, safe message, and bounded evidence;
- scenario-specific marker relationships.

Default storage:

```text
.runtime/integration-gate/
├── runs/<run-id>.json
├── latest/<mode>.json
└── index.json
```

Writes use temp-file + rename in the same directory. A report is validated and size-bounded before publishing `latest`. The writer creates directories but never tracks them. `.gitignore` owns the runtime path.

The frontend read boundary is a server-only module/route handler under the Next application. It resolves only known mode filenames beneath the configured result root, rejects traversal, caps file size, parses JSON defensively, validates the minimal schema, redacts unexpected secret-like keys, and returns a missing/stale/error state instead of crashing the page. It is read-only and does not start gates.

## 5. Daemon Runtime Control

Reintroduce `daemon/runtime_control` in the daemon JSON-RPC registry with actions:

```text
inspect_context
compact
usage_status
```

The handler validates action, agent/workspace target, timeout bounds, and runtime readiness. It maps actions internally:

| Provider family | inspect_context | compact | usage_status |
|---|---|---|---|
| Claude Code | `/context` | `/compact` | `/usage` |
| Codex ACP | `/status` direct prompt | `/compact` direct prompt | `/status` direct prompt |

No request field accepts raw command text. The exact provider command bypasses the normal Slock/user-message wrapper only through this allowlist. Results are collected until a recognized terminal event or bounded timeout. Limit/context errors preserve structured categories.

## 6. Scenario Adaptation

All HTTP transports attach:

```text
X-Public-Key: <secret>
X-Account-Token: <secret>
X-Server-Id: <explicit target>
```

Only headers required by the current endpoint are sent, but the Server header is always present for scoped real gate requests.

Every scenario generates a high-entropy marker containing mode and run id. Polling accepts only evidence created after the run start and containing the marker. Relationship checks compare stable ids/thread/channel metadata rather than display strings alone.

The current public API routes are inspected and mapped during implementation. If a historical endpoint no longer exists, the scenario uses the nearest current public contract rather than introducing an integration-only backdoor.

## 7. Visual Surface

Add `/control/gates` under the persistent `(app)` route group. The page is server-rendered from the bounded reader and uses existing product shell/material components. It contains:

- overall freshness and result-store state;
- one summary card/row per stable mode;
- selected mode detail with ordered checks and failure evidence;
- safe command example;
- link back to `/control/integration`.

The current `/control/integration` implementation remains intact except for an optional navigation link. The app rail control destination remains stable unless a small control submenu is already available; no broad information-architecture redesign is included.

## 8. Security and Failure Handling

- Secrets stay in process memory and request headers only.
- Reports are redacted recursively for token/key/authorization/cookie-like keys.
- Result reader treats disk JSON as hostile and caps bytes, item counts, string lengths, and accepted fields.
- Network and daemon calls use explicit timeouts/abort signals.
- Missing services are failed checks, not thrown unstructured stack traces.
- Stale latest reports are labeled, not presented as current success.
- The UI never executes a shell command or accepts a result path from a query parameter.

## 9. Verification Strategy

TDD layers:

1. compatibility tests fail while `tools/integration-gate/` is absent;
2. historical model/CLI suite becomes green;
3. new Server/auth/redaction/storage tests begin red and drive adaptation;
4. daemon runtime-control tests drive JSON-RPC restoration;
5. frontend reader/render tests drive `/control/gates`;
6. lint/type/build and focused backend/daemon suites catch integration drift;
7. `./twd` verifies the real route and captures evidence;
8. one real gate smoke validates dependency reporting and, when credentials/capacity permit, an end-to-end pass.

## 10. Decisions

- Use a separate `/control/gates` route; do not overwrite `/control/integration`.
- Reintroduce allowlisted daemon context control because Foundation Gate behavior depends on direct context observation/compaction; TaskRun summaries alone are not behaviorally equivalent.
- Use a gitignored atomic runtime store rather than source-tree JSON.
- Preserve standalone model/CLI verification while being explicit that real scenarios need a stack.
