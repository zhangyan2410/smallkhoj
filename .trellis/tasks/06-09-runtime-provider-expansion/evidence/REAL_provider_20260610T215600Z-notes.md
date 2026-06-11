# REAL_provider_20260610T215600Z

## Scope

Verified detected runtime provider inventory and provider selection UX.

## Evidence

* Screenshot: `REAL_provider_20260610T215600Z-01-provider-select.png`
* Browser verification showed the `runtimeProvider` select contains:
  * selectable detected CC Switch providers: `42`, `DeepSeek`, `Kimi`, `MiniMax`, `Zhipu GLM`, `cc`, `yier-gongyi`
  * disabled unsupported entries: `Codex CLI`, `OpenCode`, `Antigravity`, `Pi`
* Public API verification:
  * `GET /api/v1/computers` returned detected provider capabilities with sanitized keys only: `type`, `status`, `provider`, `runtimeProvider`, `model`, `source`.
  * No detected runtime payload contained a `command` field.
* Backend contract tests:
  * `runtime_start_command` includes explicit `runtimeProvider`.
  * legacy `backend` values do not become `runtimeProvider`.
  * stop/restart lifecycle envelopes reuse the same sanitized start config.

## Quality Gates

* `cd backend && PYTHONPATH=. .venv/bin/pytest tests/test_daemon_control.py -q`
* `cd frontend && npm run lint`
* `cd frontend && npm run build`

## Follow-Up Scope

Non-Claude runtime drivers such as Codex CLI, OpenCode, Antigravity, and Pi are explicitly not started by this task. They are shown as disabled until daemon detection and driver contracts exist for those runtimes.
