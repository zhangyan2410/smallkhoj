# Review Request: Restore Integration Gate on Pi-enabled main

Review-Target-ID: integration-gate-restoration
Branch: feat/integration-gate-restoration

## What

Restore the standalone `tools/integration-gate/` runtime, its CLI/report-store
tests, daemon control methods, and the `/control/gates` browser surface. The
branch is based on the Pi-enabled `main` and also repairs deterministic Pi
semantic-merge regressions in backend linting and the persistent frontend
shell/task projection composition.

## Why

The operator identified the removed `integration-gate/` directory as the
missing frontend/backend-independent test and visualization tool. It must be
restored without weakening the current Pi runtime or persistent app shell, and
every canonical gate failure must be investigated before merge.

## Original Requirements

> 恢复 `integration-gate/`；复杂度按 agent 计算，有明确目标、参考代码和行为。
> 基于已经合入 Pi Runtime 的最新 `main`，调查并修复所有门禁失败，然后通过 PR 合入 `main`。

- 来源：`.trellis/tasks/archive/2026-07/07-29-integration-gate-restoration/prd.md`
  与 `.trellis/tasks/archive/2026-07/07-30-pi-merge-ruff-gate-cleanup/prd.md`
- 请对照上面的摘录判断交付物是否解决了 operator 的问题。

## Tradeoff

The restoration follows the repository's historical Integration Gate behavior
and current shell/runtime contracts. It does not redesign gate protocols, Pi
relay behavior, provider selection, or product information architecture.

## Architecture Ownership

Architecture cell: frontend persistent shell / realtime transport / task projection composition
Map delta: none
Why: the patch restores existing owners and an established gate surface; it does not introduce a parallel Store, Queue, Router, Adapter, Dispatcher, or Binding.

Please check that the diff matches `Map delta: none`, that shared providers
still have one owner, and that no parallel state or transport abstraction was
introduced.

## Open Questions

### Technical OQ

- Do the seven gate modes preserve the historical CLI/JSON compatibility
  contract while using isolated report fixtures?
- Does the Pi merge cleanup preserve both relay routes and the persistent
  `(app)` shell/provider ownership without hiding a test gap?

### Value OQ

None.

## Next Action

Perform an independent review of the full `origin/main...HEAD` diff and return
`APPROVE` or `REQUEST CHANGES`, explicitly naming the reviewed full SHA and any
P0/P1/P2 findings. Independently rerun the highest-risk focused checks rather
than relying only on the author report.

## Review Sandbox

- Path: `/tmp/cat-cafe-review/integration-gate-restoration/codex-peer`
- Start command for visible verification: `./twd`
- Reserved ports if runtime verification is needed: `web=3321`, `api=8321`
- Sandbox must remain detached and read-only; implementation changes require a
  separate formal worktree.

## Self-check Evidence

### Spec compliance

- Report: `.trellis/tasks/archive/2026-07/07-30-pi-merge-ruff-gate-cleanup/quality-report.md`
- All acceptance criteria in both archived task PRDs are checked.
- Architecture ownership delta is `none`; the frontend merge guardrail is
  recorded in `.trellis/spec/frontend/quality-guidelines.md`.
- Root media/design artifact guard and `git diff --check` pass.

### Test results

```text
make ci
  scripts: 170 passed, 1 skipped
  backend: Ruff pass; pytest 523 passed
  frontend: 217 passed; lint/typecheck/e2e-typecheck/build pass
  Alembic upgrade/check, compose config, standalone output, diff-check: pass

node --test tools/integration-gate.compatibility.test.mjs tools/integration-gate/*.test.mjs
  39 passed, 0 failed

cd agent/daemon/aaa-daemon && npm test
  273 passed, 0 failed

cd backend && uv run pytest -q tests/test_llm_run_leases.py tests/test_pi_llm_relay.py
  10 passed, 0 failed
```

### Browser evidence

- `./twd` verified `/tasks`, `/chat`, and `/control/gates` from the feature
  worktree against isolated frontend/backend/PostgreSQL ports.
- Notes: `.trellis/tasks/archive/2026-07/07-30-pi-merge-ruff-gate-cleanup/evidence/REAL_pi_merge_gate_cleanup_202607301326-notes.md`
- Screenshots are stored beside the notes in the task-local evidence directory.

### Related documents

- Plan: `.trellis/tasks/archive/2026-07/07-29-integration-gate-restoration/`
- Repair task: `.trellis/tasks/archive/2026-07/07-30-pi-merge-ruff-gate-cleanup/`
- Feature ID: N/A; this is a restoration task rather than an `FNNN` feature.
