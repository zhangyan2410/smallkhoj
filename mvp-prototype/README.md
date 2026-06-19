# MVP Prototype (Archive)

This directory contains the original MVP verification code that was embedded in the Next.js frontend.
It has been moved here to separate prototype concerns from production frontend/backend code.

## Contents

| File/Dir | Original Location | Purpose |
|----------|-------------------|---------|
| `daemon-store/` | `frontend/lib/daemon-store/` | In-memory DaemonStore with hardcoded seed data (3 agents, 2 channels, 3 tasks) |
| `daemon-auth.ts` | `frontend/lib/daemon-auth.ts` | Hardcoded token mapping (`sk_test_aaa -> aaa`) |
| `internal/agent-api/` | `frontend/app/internal/agent-api/` | 7 Next.js API route handlers (server, send, events, history, stream, tasks/claim, tasks/update-status) |

## Why This Was Moved

These files served as a "fake backend" to verify the daemon → server communication chain works end-to-end.
They will be replaced by the real FastAPI + PostgreSQL backend as described in `zy-think/archived/_archived-slock-backend-architecture.md`.
