# Plan 015: Streaming file upload with size cap

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. Touch only the files listed as scope. If any STOP condition
> occurs, stop immediately and report.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-pytest-baseline.md`
- **Category**: security
- **Planned at**: commit `47848e8`, 2026-07-19 (deferred from plan 002)

## Why this matters

Both file-upload endpoints do `data = await file.read()` — reading the
**entire** body into memory before any size check:

- `backend/routers/agent_api.py:3439` — NO size check at all.
- `backend/routers/public_api.py:3407-3411` — checks size only AFTER reading
  the whole body, so the bytes are already buffered in RAM.

A daemon token (or any agent) can DoS the backend by streaming a multi-GB
body — `await file.read()` allocates the full blob before any limit is
checked. Avatar uploads (`agent_api.py:3815`) are also uncapped.

The fix: stream-and-cap via chunked reads against `MAX_UPLOAD_SIZE`,
aborting with 413 the moment the cap is exceeded, before touching disk.

## Current state

**`backend/routers/agent_api.py:3437-3445`**:
```python
data = await file.read()
if not data:
    raise HTTPException(400, "Empty file")
```

**`backend/routers/public_api.py:3407-3411`**:
```python
data = await file.read()
if not data:
    raise HTTPException(400, "Empty file")
if len(data) > MAX_UPLOAD_SIZE:
    raise HTTPException(413, f"File exceeds {MAX_UPLOAD_SIZE // (1024 * 1024)} MB limit")
```

**`backend/routers/agent_api.py:3815`** — avatar upload, no size check.

**`MAX_UPLOAD_SIZE`** is already defined in public_api.py (find its exact
location with `grep -n MAX_UPLOAD_SIZE backend/routers/public_api.py`).
Agent_api.py may or may not have its own constant — reuse public_api's.

## Repo conventions to match

- Error responses: `raise HTTPException(status, detail)`.
- Uploads use FastAPI's `UploadFile` (which wraps SpooledTemporaryFile).
- `MAX_UPLOAD_SIZE` is the existing cap constant.

## Scope

**In scope**:
- `backend/routers/agent_api.py` — file upload (~3437) + avatar upload (~3815).
- `backend/routers/public_api.py` — file upload (~3407).
- New test: `backend/tests/test_file_upload_size_cap.py`.

**Out of scope**:
- Changing `MAX_UPLOAD_SIZE` value.
- Virus scanning / content-type validation — defer.
- Moving storage to object storage (S3 etc.) — separate architecture work.

## Steps

### Step 1: Add a streaming read helper

In `backend/routers/public_api.py` (or a shared `routers/_uploads.py` if you
prefer — but public_api.py is fine for a single helper):

```python
async def _read_capped(file: UploadFile, *, max_bytes: int) -> bytes:
    """Read an upload in chunks, aborting with 413 the moment the cap is exceeded."""
    chunks: list[bytes] = []
    total = 0
    chunk_size = 64 * 1024  # 64 KB
    while True:
        chunk = await file.read(chunk_size)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(413, f"File exceeds {max_bytes // (1024 * 1024)} MB limit")
        chunks.append(chunk)
    data = b"".join(chunks)
    if not data:
        raise HTTPException(400, "Empty file")
    return data
```

(If you add it to a shared module, import it in both routers. Otherwise
define it in public_api.py and import into agent_api.py, or duplicate —
the helper is small.)

### Step 2: Replace `await file.read()` in both upload paths

In `backend/routers/public_api.py:3407`:
```python
data = await _read_capped(file, max_bytes=MAX_UPLOAD_SIZE)
```
Remove the now-redundant `if len(data) > MAX_UPLOAD_SIZE: raise 413` check
(the helper already enforces it).

In `backend/routers/agent_api.py:3439`:
```python
from routers.public_api import _read_capped, MAX_UPLOAD_SIZE  # at top of file
...
data = await _read_capped(file, max_bytes=MAX_UPLOAD_SIZE)
```
(Agent-api had NO size check before — this is a behavior tightening. Note
in the commit message that daemon uploads are now capped at
`MAX_UPLOAD_SIZE`, same as public uploads.)

### Step 3: Cap the avatar upload

In `backend/routers/agent_api.py:3815`, apply the same `_read_capped` call.
Use a smaller cap for avatars if appropriate (e.g.
`max_bytes=MAX_AVATAR_SIZE = 2 * 1024 * 1024`); otherwise reuse
`MAX_UPLOAD_SIZE`.

**Verify**: write `backend/tests/test_file_upload_size_cap.py`:
- Upload under cap → succeeds.
- Upload exactly at cap → succeeds.
- Upload one byte over cap → 413, and the helper aborts BEFORE reading the
  whole body (assert by mocking `file.read` to track call count / total
  bytes consumed).

`cd backend && uv run pytest tests/test_file_upload_size_cap.py -q` → pass.

## Done criteria

- [ ] `grep -n "await file\.read()" backend/routers/agent_api.py backend/routers/public_api.py`
      shows no bare full reads in the upload paths (chunked `_read_capped` is used).
- [ ] Avatar upload has a size cap.
- [ ] `cd backend && uv run pytest -q` exits 0.
- [ ] New `test_file_upload_size_cap.py` asserts the over-cap case aborts
      early (not after buffering the whole body).
- [ ] `git status` shows only in-scope files + new test.

## STOP conditions

- An existing test uploads a file larger than `MAX_UPLOAD_SIZE` and expects
  success (i.e. the cap was never enforced) — report; either raise the cap
  or fix the test, but do NOT silently disable the check.
- `MAX_UPLOAD_SIZE` is not defined where the plan assumes — find the actual
  constant; do not invent a new one.
- The avatar upload path uses a different `UploadFile` shape that
  `_read_capped` doesn't handle — report; adapt the helper or write a
  sibling.

## Maintenance notes

- **The cap is a DoS guardrail, not a product limit.** If legitimate uploads
  exceed it, raise `MAX_UPLOAD_SIZE` — don't weaken the streaming.
- **Reviewer scrutiny**: the over-cap test must prove early abort. A test
  that just asserts "413 returned" without checking bytes-consumed proves
  nothing (the old code also returned 413, just after buffering
  everything).
- **Follow-up**: if uploads grow beyond ~10MB regularly, consider streaming
  straight to disk (temp file) instead of accumulating in memory.
