# Dev Script Mac Auto Startup

## Goal

Make `dev.sh` work on both Windows Git Bash and macOS/Linux by detecting the host environment and choosing the right process, port, and Python startup commands automatically.

## What I Already Know

* Current `dev.sh` is written for Windows Git Bash.
* It starts backend with `backend/.venv/Scripts/python.exe main.py`.
* It stops processes with Windows `taskkill`.
* On macOS, backend should start with `uv run python main.py` or equivalent.
* On this machine, local Postgres `5432` exists but does not have the `smallkhoj` role; the working local SmallKhoj database is on `55432`.
* Frontend starts successfully with `npm run dev` / `npx next dev` on `3000`.

## Assumptions

* Keep the public CLI unchanged: `./dev.sh start|stop|restart|status|logs`.
* Preserve Windows behavior where possible.
* On macOS/Linux, prefer `DATABASE_URL` if already set; otherwise respect `SMALLKHOJ_DB_PORT`, then prefer the local `55432` SmallKhoj DB tunnel when it is listening, falling back to `5432`.
* Do not require Docker for macOS startup if an existing database is available.

## Requirements

* Detect OS/runtime environment automatically.
* Use Windows process/port handling on Git Bash/MSYS/Cygwin.
* Use Unix process/port handling on macOS/Linux.
* Start backend on macOS/Linux with `uv run python main.py`, falling back to `.venv/bin/python main.py` then `python main.py` if needed.
* Set backend `DATABASE_URL` automatically on macOS/Linux when not already provided.
* Keep logs under `.dev-logs/` and pids under `.dev-pids/`.
* `status`, `stop`, and `restart` should work across platforms.

## Acceptance Criteria

* [x] `./dev.sh status` runs on macOS without Windows command errors.
* [x] `./dev.sh start` can start backend and frontend on macOS, or reuse already-running healthy services.
* [x] `./dev.sh stop` has macOS/Linux process handling for script-managed backend and frontend.
* [x] Windows Git Bash behavior remains represented by the existing command paths.
* [x] Script syntax passes `bash -n dev.sh`.

## Definition Of Done

* Update `dev.sh`.
* Run shell syntax validation.
* Run at least `status`; run `start` against currently running services without disrupting them.

## Out Of Scope

* Rewriting the dev manager in Python/Node.
* Changing docker-compose.
* Adding a packaged daemon launcher.

## Technical Notes

* Impacted file: `dev.sh`.
* Current frontend/backend ports: `3000` / `8000`.
* Working database URL observed on this machine: `postgresql+asyncpg://smallkhoj:smallkhoj@localhost:55432/smallkhoj`.
