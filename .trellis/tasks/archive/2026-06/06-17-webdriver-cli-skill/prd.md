# Create WebDriver CLI skill

## Goal

Create a project-local skill that teaches agents to use the SmallKhoj WebDriver CLI wrapper for browser/UI verification instead of reading or invoking the Python implementation directly.

## Requirements

- Add a concise `.agents/skills/` skill focused on browser-visible verification with the project WebDriver CLI.
- Make the skill's trigger description cover frontend/browser-facing fixes, UI verification, screenshots, DOM checks, and marker-based real-test evidence.
- Prefer `agent/daemon/webdriver/twd` as the command surface. Treat `agent/daemon/webdriver/twd.py` and implementation modules as internal details for debugging the tool itself.
- Document the local proof pattern: use a unique marker, verify visible DOM state, capture screenshots/snapshots when useful, and cross-check API/database/trace state when relevant.
- Update project-facing guidance so future agents can discover the skill and stop defaulting to direct `twd.py` usage.
- Ensure the CLI wrapper is executable on macOS/Linux.

## Acceptance Criteria

- [x] A new skill exists under `.agents/skills/` with a valid `SKILL.md` frontmatter block.
- [x] The skill gives copy-pasteable CLI examples using `agent/daemon/webdriver/twd`, not `python .../twd.py`.
- [x] `AGENTS.md` points agents at the new skill and the CLI wrapper.
- [x] The WebDriver wrapper can display CLI help when invoked as `agent/daemon/webdriver/twd --help`.
- [x] No broad Trellis workflow rewrite is required for this focused cleanup.

## Notes

- User context: Trellis/agent guidance is currently scattered; this change should reduce token-heavy context loading by giving agents a compact, purpose-built skill for the browser verification path.
