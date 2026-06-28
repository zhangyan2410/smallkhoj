# Initial release post deploy smoke CLI

## Goal

Add a repeatable post-deploy smoke CLI for the initial release deployment path. After the production stack is started on Lighthouse, a tunnel, or any test host, one command should prove the public URL is reachable and that the frontend, backend health route, docs/openapi route, and domain/TLS basics are working.

## Requirements

- Provide a repository-local CLI that accepts `--base-url`.
- The command must be read-only and must not require authentication or external integration credentials.
- The command must emit machine-readable JSON and human-readable output.
- Checks must include URL shape, DNS resolution, TCP connection to the target host/port, frontend root reachability, `/api/health`, `/docs`, and `/openapi.json`.
- HTTPS should be the default expectation; HTTP must warn unless `--allow-http` is set.
- The CLI must fail when required endpoints are unreachable or return unexpected status/content.
- The deployment runbook must replace manual curl-only verification with the new smoke command while keeping curl examples as fallback.

## Acceptance Criteria

- [x] A new post-deploy smoke CLI exists under `scripts/`.
- [x] Tests cover successful smoke, HTTP warning behavior, health failure, and JSON/exit semantics.
- [x] The command can smoke a local fake deployment in tests.
- [x] Deployment docs include the command after `docker compose up`.
- [x] The task is archived and committed.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
