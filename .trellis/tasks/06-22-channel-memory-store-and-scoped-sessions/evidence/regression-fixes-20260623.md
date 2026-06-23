# Regression Fix Validation 2026-06-23

## Scope

Operator-reported regressions:

- Assigned task runtime delivery leaked to another same-channel agent.
- Chat, Tasks, and Computers did not fully honor the default Chinese product language.
- `glm1` had stale lifecycle state that could block deletion.

## Automated Checks

```bash
cd backend
rtk .venv/bin/python -m pytest tests/test_agent_task_memory_handoff.py tests/test_public_memory_routes.py tests/test_public_events.py tests/test_daemon_control.py -q
```

Result: `71 passed`.

```bash
cd frontend
rtk npm run lint
rtk npm run build
```

Result: eslint passed; Next build and TypeScript passed.

```bash
rtk git diff --check
```

Result: passed with no whitespace errors.

## Browser Evidence

The language cookie was cleared before checking default locale behavior. Real browser checks used `./twd`.

- Chat: `REAL_regression_i18n_runtime_20260623_chat_final.png`
- Tasks: `REAL_regression_i18n_runtime_20260623_tasks_final.png`
- Computers: `REAL_regression_i18n_runtime_20260623_computers_final.png`

Text scans for the known previous English remnants on each page returned no UI residuals. The remaining English in samples came from user/task content, provider/runtime names, or the language switcher's `English` option.

## Independent Sub-Agent Check

Sub-agent Lorentz ran read-only verification and confirmed:

- `task.created`, `task.claimed`, and `task.updated` expand to one event for the assigned agent, not the same-channel non-assignee.
- Stale `starting` workspaces no longer permanently block delete helper behavior, fresh `starting` still blocks, and missing `starting` autostart workspaces rearm.
- Frontend default locale logic is `fromCookie ?? defaultLocale`.

Lorentz initially found remaining Chat/Tasks English strings; those were fixed and reverified after the sub-agent report.
