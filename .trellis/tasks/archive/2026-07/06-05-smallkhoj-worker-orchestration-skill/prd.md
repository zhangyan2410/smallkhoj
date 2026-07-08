# PRD: SmallKhoj Worker Orchestration Skill

## Goal
Create a reusable project skill that captures the verified SmallKhoj supervisor -> daemon -> Claude worker -> slock CLI workflow so future development sessions can quickly start workers, delegate tasks, observe results, and perform code review.

## Requirements
- Add a project-level skill under `.agents/skills/` named `smallkhoj-worker-orchestration`.
- The skill must document when to use it: starting or verifying the local worker stack, delegating work through SmallKhoj/Slock, using GLM/Kimi/MiniMax via `ccs-claude`, and reviewing worker output.
- The skill must include the verified commands and key caveats:
  - Start Colima/Docker if Docker daemon is down.
  - Start or reuse `smallkhoj-test-db` on `55432`.
  - Start backend with `DATABASE_URL=postgresql+asyncpg://smallkhoj:smallkhoj@127.0.0.1:55432/smallkhoj`.
  - Start daemon runtime on port `3457` with `ccs-claude "Zhipu GLM" glm-5.1` by default.
  - Use public API to create supervisor/human messages; `.slock/slock message send` sends as the worker agent.
  - Use `SLOCK_ALLOW_WRITES=1` for write-capable wrapper commands.
  - Use `scripts/watcher.py` and `smallkhoj-trace` appropriately.
- Include at least one helper script for the fragile startup sequence.
- Update `AGENTS.md` outside the Trellis managed block to include the new skill, purpose, and when to use it.
- Validate the skill with `quick_validate.py`.

## Non-Goals
- Do not change runtime daemon source code.
- Do not implement a full task dispatcher UI.
- Do not alter Trellis workflow internals.
