# Trellis Dashboard Bootstrap (Cross-Project Reuse)

> How to stand the Trellis Dashboard up in a fresh project and manage Comet alongside Trellis from one place.

---

## Portability contract (what the tool is)

- Zero third-party dependency: Python stdlib only (`ThreadingHTTPServer` + `urllib`) and no-build vanilla JS. Any machine with python3 runs it.
- The dashboard reads whatever exists under the target repo's `.trellis/` (tasks, sessions, journal, spec corpus, capture ledger, spec-audit) and `docs/comet/`; every data source degrades gracefully to an empty state when its inputs are missing.
- Security model travels with the tool: binds `127.0.0.1` only, `Cache-Control: no-store`, path-traversal guards on static/artifact serving, 256KiB artifact preview cap, CSP `default-src 'self'` with a single `frame-src` exception for the embedded Comet Dashboard.

## Files to copy into a new project

1. `tools/trellis-dashboard/` — the whole directory (`dashboard.py`, `server.py`, `collector.py`, `agent_runner.py`, `agent_chat.py`, `agents/workflows/`, `web/`, `test_collector.py`).
2. `./trellis-dashboard` — the repo-root launcher shim.
3. Makefile target `trellis-dashboard-test`: `node --check` on `web/*.js` + `python3 -m unittest discover -s tools/trellis-dashboard -p 'test_*.py'`.
4. Optional but recommended: `.agents/skills/trellis-dashboard-dev/SKILL.md` so coding agents learn the tool's conventions on arrival.

Launch: `./trellis-dashboard` (default `127.0.0.1:4322`, auto-bumps when busy), one-shot snapshot `./trellis-dashboard --json`, or point at another checkout with `--root`. Python-side changes need a server restart; web files only need a page refresh.

## What works out of the box vs. what degrades

| Area | Needs | Without it |
|------|-------|-----------|
| 任务/时间线/会话/journal tabs | `.trellis/` basic layout (tasks, `.runtime/sessions`, workspace journal) | tab renders empty |
| Spec 沉淀 / Spec 文件 tabs | `.trellis/spec/` (+ optional `spec-zh/` mirror, `capture-ledger.json`, `spec-audit.json`) | tabs degrade to empty |
| Agent tab workflows/chat | `dsh` on PATH and `~/.dsh/` configured (GLM provider) | shows "未安装/不在 PATH"; chat input disabled |
| Comet tab | `comet` on PATH | shows "未安装/不在 PATH"; archive list still renders from `docs/comet/archive/` |

## Comet integration contract (one dashboard, two workflows)

The user's working model is Trellis + Comet together; the Comet tab manages the Comet side read-only:

- **Data**: active changes from `comet status --json` (schema `comet.status.v2`, 4s timeout, graceful error field); default workflow from `.comet/config.yaml` (regex parse — no yaml dependency); archived changes summarized from `docs/comet/archive/<dir>/comet-state.yaml` (top-level `name/phase/status/verification_result/created_at` via MULTILINE regex; nested keys are ignored by the `^key:` anchor).
- **Launch**: `POST /api/comet-web` — port-probes `127.0.0.1:4321` first (idempotent); otherwise spawns `comet dashboard --port 4321 --no-open` with `start_new_session=True` (survives the dashboard process) and returns `{url, started}`.
- **Embed**: the tab iframes `http://127.0.0.1:4321/`. CSP is `default-src 'self'; frame-src http://127.0.0.1:4321` — the only frame-src exception; do not widen it.
- **Read-only boundary**: only `comet status --json` is executed from the collector; no `comet native next/archive/new` (state-mutating) commands ever run from the dashboard.

## Hard conventions (unchanged when the tool travels)

- POST whitelist is exactly `/api/agent-runs`, `/api/agent-chat`, `/api/dsh-web`, `/api/comet-web`; everything else is read-only. New POST endpoints are an architecture decision, not a convenience.
- `collector._collect_*(root)` functions take an explicit root and tolerate missing inputs; pure parse helpers (e.g. `parse_comet_config`, `parse_comet_state_summary`) stay side-effect free for fixture tests.
- Frontend builds DOM with the `el()` helper (no HTML string concatenation); tabs are registered in `index.html` + `renderView()` routing.
