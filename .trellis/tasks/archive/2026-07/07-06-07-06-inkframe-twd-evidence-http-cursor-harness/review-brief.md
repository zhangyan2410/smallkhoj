# Review Brief: Inkframe TWD Evidence And HTTP Cursor Harness

Active task:

```text
.trellis/tasks/07-06-07-06-inkframe-twd-evidence-http-cursor-harness
```

Please review this as the next optimization loop under
`07-05-inkframe-product-ui-refactor`.

## What Changed

Created and activated a new detailed Trellis task:

- `prd.md`
- `design.md`
- `implement.md`
- `implement.jsonl`
- `check.jsonl`

Added evidence:

- `evidence/twd-connectivity.md`
- `evidence/backend-http-harness.md`
- `evidence/2026-07-06-progress.md`

Added backend HTTP route-boundary tests:

- `backend/tests/test_chat_read_cursors_http.py`
- `backend/tests/test_chat_read_cursors_postgres_http.py`

## Backend Tests Added

The new tests use `main.app`, `httpx.ASGITransport`, real HTTP headers, and a
FastAPI dependency override for `public_api.get_db`.

Covered cases:

- channel cursor POST + GET;
- DM cursor POST + GET;
- thread cursor POST + GET;
- monotonic channel cursor write;
- missing account/session -> 401;
- unjoined active server -> 403;
- DM/public channel mismatch -> 400;
- `/api/v1/channels` unread projection counts actual newer message rows, not
  `latestSeq - lastReadSeq`.

The latest addition also adds one representative real-Postgres route-flow test:

- random temporary schema inside the existing local `smallkhoj` database;
- `Base.metadata.create_all` against that schema with `search_path`;
- real SQLAlchemy async sessions and ASGI/FastAPI route calls;
- channel cursor POST/GET plus `/api/v1/channels` unread projection;
- final DB assertion that `ChannelMember.last_read_seq` persisted;
- `DROP SCHEMA ... CASCADE` cleanup in `finally`.

Please check whether this honestly improves over the previous direct-handler
tests, whether the fake-session matrix and real-Postgres representative test
are described accurately, and whether any evidence overstates the broad matrix
as fully real-database coverage. It should not.

## Browser Status

`./twd` is still blocked by no connected browser tab:

```json
{"ok": true, "tabs": [], "count": 0}
```

Additional diagnostic found:

- Chrome installed: yes
- Codex Chrome Extension installed/enabled: yes
- native host manifest correct: yes
- Chrome running: no

Per Chrome-control safety rules, Chrome was not launched without user
permission. Please check that no browser/mobile acceptance is claimed.

## Validation Run

Backend:

```text
rtk env PYTHONPATH=. uv run pytest tests/test_chat_read_cursors.py tests/test_chat_read_cursors_http.py tests/test_chat_read_cursors_postgres_http.py tests/test_server_account_membership.py -q
51 passed in 0.80s
```

Repo:

```text
rtk git diff --check
pass
```

Task JSON:

```text
parent and new child task.json parse with python3 -m json.tool
```

## Review Focus

1. Are the new HTTP tests meaningful and not fake coverage?
2. Does the statement-aware fake session mask any important route behavior?
3. Is the temporary Postgres schema fixture safe, isolated, and cleaned up?
4. Does the evidence distinguish fake-session matrix coverage from the single
   real-Postgres representative path?
5. Are browser/twd claims truthful?
6. Are the task artifacts detailed enough for the next agent to continue?
7. Any small mechanical issues may be fixed in place.

Do not commit, push, pull, merge, or reset.
