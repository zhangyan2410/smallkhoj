# Codex ACP Product Path Cleanup

## Goal

Codex must use the ACP integration path as the product runtime path. The historical native `codex_cli` runtime path should be removed or made unreachable from product flows, because the CLI path launches frequent short-lived processes and is not the intended interaction model.

The end state should be simple:

- Product-facing Codex runtime is `codex`.
- Daemon implementation for product Codex is Codex ACP.
- Backend, daemon, frontend, tests, task docs, and validation language no longer present native Codex CLI as the desired product path.
- Windows validation failures around `spawn npx ENOENT` are treated as ACP environment/command resolution failures, not as a reason to revive native CLI.

## Background

Task `06-30-windows-runtime-launch-conversation-validation` verified the Windows product runtime path. Claude Code passed the real backend/daemon conversation validation. Codex failed on Windows because the product path attempted Codex ACP and hit:

```text
spawn npx ENOENT
ACP connection closed
```

During review, the conclusion briefly drifted toward making `codex_cli` / `codex-cli` available as a product path. That is incorrect. Prior product direction is that Codex should interact through ACP, not through the native CLI process model.

The older task `.trellis/tasks/06-19-daemon-codex-runtime/prd.md` is CLI-oriented and should be treated as superseded by this cleanup PRD.

## Product Requirements

1. Codex ACP is the only supported product path for Codex runtime launch.
2. Public/product APIs should continue to expose Codex as `runtime: "codex"` unless a more explicit product name is introduced.
3. `codex_cli` should not be accepted as a product runtime in agent creation, runtime selection, or frontend runtime options.
4. Daemon runtime inventory should not advertise native Codex CLI as a product-launchable provider. If local Codex command detection remains useful for diagnostics, it must be labeled as diagnostic/non-product and must not drive backend provider availability.
5. Backend runtime provider availability checks should validate the ACP-capable Codex product path, not the historical `codex_cli` type.
6. Daemon launch should use the Codex ACP bridge for `runtime: "codex"` and produce clear startup failure logs if ACP prerequisites are missing.
7. Windows ACP startup must not depend on a shell lookup that fails for `npx` on machines where npm shims are available only as `.cmd` files. The implementation should either resolve the correct Windows executable (`npx.cmd`) or use a deterministic packaged command strategy.
8. Tests and docs must stop recommending "fix Codex by enabling native CLI" as the product solution.
9. Existing stale references to `runtime=codex_cli` as a supported product runtime should be removed, rewritten as historical context, or moved to archived research.
10. Claude Code runtime behavior and provider selection must not regress.

## Non-Goals

- Do not revive native Codex CLI as a product runtime path.
- Do not add a UI choice between "Codex CLI" and "Codex ACP" unless product explicitly asks for an internal/debug toggle later.
- Do not broaden this task into a full runtime provider redesign.
- Do not change the Slock/Raft communication contract for agents.
- Do not store credentials, ACP prompts containing secrets, or local executable paths in backend-visible product state.

## Proposed Scope

### Phase 1: Contract Cleanup

- Update backend runtime normalization so product Codex maps to the ACP implementation consistently.
- Reject or remove `codex_cli` from public/product creation paths.
- Update backend tests that currently assert `codex_cli` is normalized or provider-checked as a product runtime.
- Update frontend labels/options so Codex appears once, as the ACP-backed product runtime.

### Phase 2: Daemon Cleanup

- Remove product use of `CodexRuntimeDriver` / native CLI launch where it is not needed.
- Keep only the Codex ACP driver for product `runtime: "codex"`.
- If native CLI code remains temporarily for migration safety, gate it behind an explicit internal/debug-only flag and document its planned removal.
- Ensure Windows ACP launch resolves executable names correctly (`npx.cmd` vs `npx`) or avoids shell-dependent resolution entirely.
- Ensure ACP failure messages identify the missing command and the attempted executable clearly.

### Phase 3: Documentation and Evidence Cleanup

- Mark `.trellis/tasks/06-19-daemon-codex-runtime/prd.md` as superseded or rewrite its goal away from native CLI.
- Update `.trellis/tasks/06-30-windows-runtime-launch-conversation-validation/test-results.md` remaining-fix language so it points to ACP command resolution and legacy CLI removal.
- Search for user-facing or task-facing references that recommend `runtime=codex_cli` and update them.
- Keep historical mentions only where they are clearly labeled as archived history, not current product direction.

### Phase 4: Real Validation

- Re-run Windows daemon validation on `SH-zhangyan04` or another real Windows machine.
- Create a Codex product runtime agent with `runtime: "codex"`.
- Confirm the daemon starts the ACP process successfully.
- Confirm the Codex ACP runtime receives a real SmallKhoj/Slock message and replies through the generated Slock/Raft wrapper.
- Capture daemon stdout/stderr excerpts and channel/message evidence in the task directory.

## Acceptance Criteria

- [ ] Product code no longer treats `codex_cli` as a supported product runtime.
- [ ] Backend agent creation rejects `runtime: "codex_cli"` or maps it only through an explicit migration path with a warning/test.
- [ ] `runtime: "codex"` produces a daemon start command for the Codex ACP implementation.
- [ ] Runtime provider availability checks no longer require a detected runtime item with type `codex_cli` for product Codex.
- [ ] Frontend/runtime option surfaces do not present native Codex CLI as the product option.
- [ ] Daemon Windows ACP launch no longer fails only because `npx` cannot be resolved when `npx.cmd` is available.
- [ ] If ACP prerequisites are missing, the daemon reports a clear configuration/startup error instead of a misleading `pid=unknown` success.
- [ ] Tests cover backend runtime normalization, provider availability, and start command construction for ACP-backed Codex.
- [ ] Tests or daemon smoke coverage verify Windows command resolution for ACP launcher names.
- [ ] The old CLI-oriented PRD and Windows validation result language are corrected or explicitly superseded.
- [ ] Real Windows validation shows Codex ACP can start and complete a real message round trip, or records a precise remaining ACP blocker.

## Validation Plan

- Backend unit tests:
  - `runtime=codex` remains accepted.
  - `runtime=codex_cli` is rejected or migrated only by an explicit compatibility shim.
  - provider availability for product Codex does not depend on `detectedRuntimes[].type == "codex_cli"`.
  - runtime start command for Codex is ACP-backed.
- Daemon unit/smoke tests:
  - Codex ACP launcher resolution chooses the correct Windows command form.
  - ACP startup failure reports the attempted executable and does not masquerade as a running process.
- Frontend tests:
  - runtime option list exposes one Codex product choice.
  - legacy `codex_cli` values from old records render as Codex or historical/unknown without encouraging new selection.
- Real validation:
  - Windows daemon connected to backend.
  - Codex ACP runtime starts from product/backend path.
  - unique marker message is received and answered through Slock/Raft.
  - evidence written under this task directory.

## Migration Notes

- Existing database records with `runtime: "codex_cli"` should be migrated or treated as legacy records. The preferred migration target is `runtime: "codex"` with ACP implementation.
- If a native CLI driver remains in source for a short transition, add comments/tests making clear it is not the product path.
- Avoid deleting archived evidence. Instead, add "superseded by 07-01-codex-acp-product-path-cleanup" notes where current readers may otherwise follow the wrong direction.

## Open Questions

1. Should `codex_cli` be hard-rejected immediately, or should backend accept it only as a migration alias to `codex` while logging a deprecation warning?
2. Should ACP launcher use `npx.cmd`, a bundled package entry point, or an installed project-local dependency to avoid global PATH variance on Windows?
3. Which CI environment can exercise Windows ACP launcher resolution without requiring real Codex credentials?
