# Directory Structure

> How backend code is organized in this project.

---

## Overview

`backend/` is a single FastAPI application (module-level `app` in `main.py:50-54`, not an app factory). Code layers as **routers → services → models**, with Alembic as the only schema writer and a read-only startup guard enforcing it. Facts below are the current layout, not an aspiration.

---

## Directory Layout

```
backend/
├── main.py                    # FastAPI app entry: lifespan, CORS, router registration
├── config.py                  # pydantic-settings Settings (config.py:62-201)
├── alembic/                   # migration env
│   ├── env.py                 # imports models.slock into Base.metadata (env.py:15)
│   └── versions/              # 6 revisions, single chain: 0001_baseline → 0006_stable_member_identity
├── models/                    # SQLAlchemy ORM layer
│   ├── base.py                # engine, async_session, Base, get_db dependency (base.py:7-26)
│   ├── slock.py               # all 32 ORM tables (single file, schema source of truth)
│   ├── seed.py                # runtime data seeding ONLY — "Never add table/index DDL here"
│   └── __init__.py            # re-exports all ORM classes
├── routers/                   # FastAPI HTTP/WS endpoints (8 modules)
│   ├── agent_api.py           # agent-facing API + /ws daemon WebSocket (incl. lease add_exclusive)
│   ├── public_api.py          # public API (5960 lines)
│   ├── auth.py                # Bearer + X-Agent-Id auth dependencies
│   └── chat.py / health.py / hello.py / member_serialization.py / serialization_prefetch.py
├── schemas/                   # Pydantic response schemas (currently only health.py HealthResponse;
│                              #   most response models are still inline in routers)
├── services/                  # business logic & background services (40 modules)
├── scripts/                   # legacy_schema_preflight.py (read-only compatibility preflight)
├── tests/                     # flat pytest suite: 56 test_*.py + postgres_test_support.py
├── feishu_worker_cli.py       # standalone Feishu long-connection worker process entry
├── integration_bootstrap_cli.py / live_run_preflight_cli.py   # CLI tools (JSON to stdout)
├── alembic.ini / pyproject.toml / uv.lock / Dockerfile        # uv-managed deps
└── .data/uploads              # local upload blob storage (runtime artifact)
```

---

## Module Organization

### Layering

| Layer | Responsibility | May import |
|-------|----------------|------------|
| `routers/` | HTTP/WS endpoints, auth wiring, request/response shapes | `services/*`, `models`, `schemas` |
| `services/` | business logic, background loops, event fan-out | `models` (never `routers`) |
| `models/` | ORM tables, engine/session, data seeding | sqlalchemy only |
| `alembic/` | schema migrations — the ONLY schema writer | `models.slock` metadata |

Honest exception: routers also import `models` and run `select()` directly (public_api.py:20-26, agent_api.py:31-36); the service layer is where shared/reusable logic goes, not a mandatory pass-through.

### Startup sequence (main.py lifespan, main.py:27-47)

`assert_schema_at_head(db)` → `create_tables()` (idempotent data seed, seed.py:25-31) → event cursor init → Postgres listener, reminder scheduler, thread summary scheduler; each stopped on shutdown.

### Schema authority chain

- Alembic revisions are the single source of truth for schema; `models/seed.py` seeds data only (docstring, seed.py:1-14).
- Startup refuses to run when the DB revision ≠ the single head (services/schema_readiness.py:18-52, read-only guard).
- Guard tests enforce this: tests/test_schema_authority.py asserts seed sources contain no `create_all`/DDL and both compose files run `uv run alembic upgrade head && uv run uvicorn` (docker-compose.yml:17, docker-compose.prod.yml:18).
- Deployment order is migrate-then-serve, never serve-then-create (docs/migration-workflow.md).

---

## Where New Code Goes

| Adding... | Goes in... |
|-----------|-----------|
| An HTTP/WS endpoint | `routers/` (register in main.py:66-70) |
| Shared business logic / a background loop | `services/` (new module) |
| An ORM table or column | `models/slock.py` + a NEW Alembic revision in `alembic/versions/` (never startup DDL) |
| A response schema | `schemas/` (note: most existing response models are inline in routers; `schemas/` today holds only health) |
| A destructive-migration / real-Postgres test | `tests/` with a `*_postgres*.py` suffix, using `postgres_test_support.py` (per-test throwaway DB) |
| A standalone process entry | backend root (pattern: `feishu_worker_cli.py`) |

---

## Naming Conventions

- Tests: flat `test_*.py`; Postgres-backed tests suffixed `*_postgres.py` / `*_postgres_http.py`.
- Services/routers: singular domain nouns (`task_runs.py`, `daemon_control.py`).
- Module logger: `logger = logging.getLogger(__name__)` (see logging-guidelines.md).
- Deps are managed by uv (pyproject.toml + uv.lock); ruff line-length 120.

---

## Examples

- Endpoint → service → model chain: routers/public_api.py:156 (`create_task_assignment_and_run`) → services/task_runs.py:10 (imports `models`) → models/slock.py tables.
- Event fan-out service: services/public_events.py (LISTEN/NOTIFY, own lifecycle logging).
- Lease enforcement endpoint: routers/agent_api.py:2067-2075 (`add_exclusive` + `lease.revoked` close 4001).
