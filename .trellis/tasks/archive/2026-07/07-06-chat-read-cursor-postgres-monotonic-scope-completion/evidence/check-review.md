# Check Review

Date: 2026-07-06

Channel:

```text
cr-07-06-postgres-monotonic-scope
```

Worker:

```text
check-codex
```

Result:

```text
done
```

## Findings

No blocking findings.

The reviewer confirmed:

- the new tests cross the real ASGI route boundary through
  `httpx.ASGITransport(app=app)` and `AsyncClient.post(...)`;
- the temporary Postgres schema pattern matches the existing harness;
- the DM monotonic test satisfies R1 by proving a retrograde DM cursor write
  keeps `ChannelMember.last_read_seq = 20`;
- the thread monotonic test satisfies R2 by proving a retrograde thread cursor
  write keeps `ChatThreadReadCursor.last_read_seq = 31` and preserves
  `last_seen_message_id`;
- the evidence is honest that this was coverage hardening, not a production code
  fix;
- browser/mobile proof remains explicitly out of scope for this backend slice.

## Reviewer Verification Note

The check worker could not independently reproduce the Postgres test pass in
its sandbox because local Postgres access was blocked there:

```text
Postgres test database is unavailable: [Errno 1] Operation not permitted
```

It did run compile and whitespace checks successfully:

```text
python -m py_compile routers/public_api.py services/chat_read_cursors.py tests/test_chat_read_cursors_postgres_http.py
git diff --check
```

Main-session verification remains authoritative for the real local Postgres
test run:

```text
new focused tests: 2 passed
Postgres HTTP file: 9 passed
combined backend cursor/account/Postgres suite: 83 passed
backend compile: pass
git diff --check: pass
```
