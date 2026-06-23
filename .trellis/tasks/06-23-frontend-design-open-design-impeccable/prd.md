# frontend design workflow with open design and impeccable

## Goal

Improve SmallKhoj's frontend design workflow by adding two project-local design tools:

- Open Design as a local design studio and MCP-accessible design assistant.
- Impeccable as a design critique/skill layer for both Codex and Claude Code.

This task is about installing, wiring, and documenting the workflow foundation. The actual SmallKhoj frontend redesign work should happen in follow-up implementation tasks once these tools are verified.

## Requirements

- Open Design must run locally without a large repository clone or desktop DMG install, because disk space is constrained.
- Network installs and package lookups must use the local proxy at `127.0.0.1:7897`.
- Claude Code must receive the same design assistance as Codex where the tools support it.
- Codex should use the shared `.agents/skills/` layer for Impeccable, plus a project MCP entry for Open Design.
- Claude Code should use `.claude/skills/` for Impeccable, plus a project MCP entry for Open Design.
- Tooling should be project-local or narrow-scope where possible. Avoid broad user-global changes unless the CLI does not support project scope.
- Document deployment decisions, verification commands, and any fallback paths that were tried and rejected.
- Keep temporary installer artifacts small and delete what is no longer needed after verification.

## Acceptance Criteria

- [x] Open Design is reachable locally at `http://127.0.0.1:7456`.
- [x] Claude Code has a project-scoped `open-design` MCP server with `OD_DAEMON_URL=http://localhost:7456`.
- [x] Codex has a project-scoped `open-design` MCP server with `OD_DAEMON_URL=http://localhost:7456`.
- [x] Impeccable exists for Codex/shared agents under `.agents/skills/impeccable`.
- [x] Impeccable exists for Claude Code under `.claude/skills/impeccable`.
- [x] Impeccable hook status can be queried successfully for both Codex/shared and Claude Code installs.
- [x] Open Design UI receives a real browser smoke check.
- [x] Research notes record the Open Design Docker/GHCR failure and the npm ADE fallback.
- [x] Research notes record Impeccable's Node 24 requirement and the installation method used here.

## Notes

- Open Design generation tools may require BYOK environment variables later (`BYOK_BASE_URL`, `BYOK_API_KEY`, `BYOK_MODEL`). This task only wires the daemon/MCP baseline.
- The frontend visual quality concern remains open; this task prepares tooling for that design pass instead of redesigning the app in place.
- Claude Code reports the project MCP server as `Pending approval`; run `claude` in this project and approve the `open-design` MCP entry before expecting Claude Code to launch it.
- Impeccable reports `NO_PRODUCT_MD` until a user-confirmed `PRODUCT.md` is added.
