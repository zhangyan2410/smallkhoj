# Quality Report — Integration Gate Restoration

## Outcome

Pass. All in-repo gates required by the PRD are green, the visual route has real `./twd` evidence, and a real Foundation smoke produced an honest persisted failure for the explicitly selected Server tenant.

## Spec Compliance

- Backend/runtime: `daemon/runtime_control` accepts only `inspect_context`, `compact`, and `usage_status`; arbitrary slash text, workspace mismatch, missing runtime, and invalid timeout inputs fail closed.
- Provider behavior: Claude Code maps to `/context`, `/compact`, `/usage`; Codex ACP maps to `/status`, `/compact`, `/status` through the explicit control path. Ordinary Codex messages retain the Slock wrapper.
- Authentication/tenancy: CLI requires Server id before network access and includes `X-Server-Id` on scoped public API calls. Expected configuration failures return code 2 without a stack trace.
- Persistence: reports use atomic same-directory rename under gitignored `.runtime/integration-gate`; latest, run, and index documents are written from recursively redacted data.
- Frontend boundary: only seven fixed filenames are readable; path traversal, missing, malformed, oversized, stale, and running reports have typed states; strings, evidence depth, item counts, and credential shapes are bounded/redacted.
- UI: `/control/gates` is separate from `/control/integration`, composes `ProductShell` and shared product primitives, keeps stable `data-region` hooks, and uses the committed water/sand/ink tokens. Chinese and English state/copy contracts are complete.
- Browser acceptance: the real route rendered seven rows, safe command text, duration, Server target, structured failure, and the TaskRun link without horizontal overflow or an error boundary. Final server log contained only successful requests.

## Automated Checks

- `node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs`: 39 passed.
- `npm test` in `agent/daemon/aaa-daemon`: TypeScript build plus 268 passed.
- `bun test` in `frontend`: 213 passed.
- `bun run lint`: passed with no warnings.
- `bun run typecheck`: passed.
- Production `next build` with build-only placeholder configuration: passed and emitted `/control/gates` as a dynamic route.
- `git diff --check`: passed.

## Cross-Layer Trace

```text
gate scenario/model
  → CLI with explicit Server headers and bounded transports
  → recursively redacted atomic runtime report
  → fixed-mode, size/schema-bounded server reader
  → ProductShell /control/gates projection
```

Failures retain category/code/step from the scenario model through persisted JSON and the UI. Secret-bearing transport configuration is not included in the projected target or evidence.

## Coverage and Consistency

- New report store has atomic-write and redaction regression tests.
- New reader has valid/missing/malformed/oversized/stale/running/traversal/redaction tests.
- New route has source composition, stable-region, legacy-control preservation, and bilingual copy tests.
- Runtime-control parsing, exact provider mapping, arbitrary-command rejection, bounded result wait, workspace scope, and Codex wrapper separation are tested.
- The persistent `(app)` route merge left obsolete local realtime/scroll state declarations; those were removed, and route-path contract tests were updated to the current `(app)` locations.

## Spec Sync Decision

No `.trellis/spec/` source was changed. The feature-specific executable contract is fully captured in this task's PRD/design/evidence. The root worktree already contains a user-owned concurrent modification to `.trellis/spec/backend/runtime-slock-integration.md`; avoiding a second overlapping spec edit prevents clobbering that work. The restored behavior itself is protected by tests and can be promoted into the shared spec after the concurrent change is reconciled.

## Known External Limitation

The real smoke selected the authenticated account's explicit Server, while the currently running daemon belonged to a different Server context. The gate therefore returned `FAIL foundation-only 3/12` with `DAEMON_NOT_CONNECTED` and downstream readiness failures. This is an environment/tenant alignment limitation, not an in-repo test failure; the required behavior is to preserve and visualize it honestly.
