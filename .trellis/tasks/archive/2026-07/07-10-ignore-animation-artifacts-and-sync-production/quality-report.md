# Quality Report

## Scope And Evidence

| Requirement | Evidence | Result |
| --- | --- | --- |
| Ignore local browser evidence and Remotion workspace | `git check-ignore -v` matched root `.gitignore` rules for both paths; files remained on disk | Pass |
| Commit frontend changes and existing docs | `35325e9` and `a0da9db` on `main` | Pass |
| Preserve old Daemon compatibility while advertising `aura` package | Backend tests prove `MINIMUM_DAEMON_VERSION=0.2.0` with `DAEMON_RELEASE_VERSION=0.2.1`; generated package manifest includes `aura` | Pass |
| Deploy current frontend/backend/Daemon release | Local production smoke, image transfer/load, remote Compose recreation, and cloud smoke completed | Pass |

## Fresh Verification

- `bun run lint` in `frontend/`: passed.
- `./twd` on `http://localhost:3000/chat/promo-video`: the scroll rail was visible; after scrolling to the end exactly one rail tick was active. Screenshot: `evidence/REAL_release_sync_20260710_chat_scroll_rail.png`.
- `uv run pytest tests/test_daemon_command_generation.py tests/test_daemon_control.py -q`: 56 passed.
- `npm test` in `agent/daemon/aaa-daemon`: 265 passed.
- `uv run python -m unittest scripts.tests.test_post_deploy_smoke scripts.tests.test_build_daemon_distribution scripts.tests.test_update_prod_env_from_stdin -q`: passed.
- `uv run python scripts/initial_release_deploy_preflight.py --env-file /tmp/smallkhoj-prod-smoke.env --runtime --json`: zero failures; expected IP-only URL warning only.
- Local production smoke against `http://127.0.0.1:18080`: all checks passed, including the `0.2.1` hosted Daemon package.
- Cloud production smoke against `http://124.222.40.40`: all checks passed.
- `uv run python scripts/initial_release_foundation_gate.py --base-url http://124.222.40.40 --allow-http --json`: ready, zero failures, zero warnings, zero blocked checks.

## Residual Risk

The release uses the current IP-only HTTP validation endpoint. HTTPS/domain/ICP readiness remains outside this task's scope. The verified commits are now on local `main` but have not been pushed; the root worktree's unrelated local artifact directories were intentionally preserved and ignored.
