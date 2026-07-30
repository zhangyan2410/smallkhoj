# Upload resource-envelope and cleanup violations

## Bug diagnosis capsule

| Field | Content |
|---|---|
| **1. Symptom** | Public attachments, agent attachments, and avatars can read an entire upload into application memory; two agent paths have no effective size cap. Failure paths do not share a proven close/rollback/unlink contract. Expected: explicit ingress, parser/spool, application-memory/read, temporary-disk, and durable-storage budgets, with exactly one terminal state and no residue after rejection or abort. |
| **2. Evidence** | The three route implementations use `await file.read()` before or without an application size check. Starlette `UploadFile` may already spool the multipart part to a temporary file, so replacing the call with chunked reads does not prove network-level early rejection. Existing code writes final durable paths directly and has route-specific error handling. Advisor plan 015 collects chunks and joins them, which still buffers the complete allowed payload in application memory and covers only the 413 happy failure. |
| **3. Confirmed root cause** | Resource ownership is implicit and split across FastAPI multipart parsing, `UploadFile`, route-local byte buffering, filesystem writes, and database commit. The implementation has no shared upload state machine or compensation boundary, and the audit conflated an application read cap with reverse-proxy/parser rejection. |
| **4. Diagnostic strategy** | Exercise all three real routes at limit/over limit with misleading content length, multiple chunks, interrupted reads, invalid metadata, write/flush/commit failures, and cancellation. Observe `UploadFile.close`, staging/final files, database rows, and rollback. Probe the supported local-prod Caddy path separately to distinguish ingress 413 from application 413. |
| **5. Timeout strategy** | If Caddy or Starlette does not expose a locally configurable/provable parser limit, stop claiming ingress rejection, retain the application defense-in-depth cap, and document the uncovered layer explicitly. Do not manufacture proxy evidence with a helper-only test. |
| **6. Warning strategy** | Reject `chunks.append(...)` plus `b"".join(...)` as “streaming to durable storage,” content-length-only trust, direct final-path writes without compensation, committed rows whose blobs are absent, partial files after cancellation, or reports that collapse proxy, spool, memory, and storage budgets into one number. |
| **7. User-visible correction** | Oversized uploads receive a stable 413; invalid or interrupted uploads do not leave phantom attachments, broken avatars, or disk residue. Supported uploads retain their existing response shape. |
| **8. Acceptance** | All three routes pass at-limit and reject over-limit cases. Oversized/interrupted/invalid/write/flush/commit/cancel paths close the upload, rollback, and leave zero committed rows and zero partial/staging files. A local-prod probe records whether rejection happened at Caddy/parser or application level. |

## Report

- **Reporter:** Independent re-audit of finding 015 on 2026-07-23.
- **Reproduction:** Send large/chunked multipart bodies and inject failures at every persistence boundary for public attachment, agent attachment, and avatar routes.
- **Root cause:** The routes treat upload bytes, temporary files, durable files, and database rows as unrelated operations without explicit ownership/compensation.
- **Repair direction:** Centralize size/read policy, stage durable writes, use atomic rename where supported, close in all outcomes, and compensate filesystem/database failures.
- **Verification:** Route-level tests for all three entrances plus supported local-prod Caddy evidence and filesystem/database residue assertions.

## Advisor disposition

- Plan 015 correctly identifies full-memory reads and missing caps.
- Its proposed chunk accumulator is insufficient as the terminal design because it still retains the full permitted object in memory.
- Its claim that the helper rejects before touching disk is inaccurate for Starlette multipart uploads, which may already have spooled to temporary disk before the route runs.
- Cleanup, persistence failure, cancellation, avatar-specific behavior, and ingress/proxy proof are added to the required scope.

## TDD evidence

### RED

Five focused route-contract tests failed for the intended ownership reasons:

- agent attachment and avatar accepted a nine-byte body despite an eight-byte
  test cap and used an unbounded `read(-1)`;
- public upload returned 413 only after the complete unbounded read and did not
  close the `UploadFile`;
- a forced attachment commit failure did not call rollback and left the final
  durable blob behind;
- invalid public `channelId` metadata raised 400 without closing the upload.

```bash
cd backend
uv run pytest -q tests/test_upload_resource_envelope.py
# 5 failed in 0.44s (intended RED)
```

### GREEN

All three routes now use the same `UPLOAD_MAX_BYTES` policy and shared staging
service. The route reads `UPLOAD_READ_CHUNK_BYTES` at a time, writes a hidden
same-directory staging file, flushes/fsyncs, adds and flushes the DB row, then
atomically promotes before commit. Any read/write/flush/promote/commit failure
or cancellation removes staging/final residue; persistence failures run a
bounded rollback; every terminal path closes the parser-owned upload handle.

The focused matrix covers exact limit, one byte over, public/agent/avatar
entrypoints, invalid metadata, interrupted read, `CancelledError`, local write
failure, forced commit failure in all three entrypoints, atomic promotion, and
a real migrated PostgreSQL/ASGI public upload. The PostgreSQL case accepts the
exact-limit file, rejects the next file at 413, and observes exactly one row and
one durable blob with no `.uploading` residue.

```bash
cd backend
SMALLKHOJ_MIGRATION_TEST_ADMIN_URL=postgresql://.../postgres \
SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://.../audit_remediation_test \
  uv run pytest -q tests/test_upload_resource_envelope.py
# 14 passed in 1.27s

uv run --with ruff ruff check \
  config.py services/upload_storage.py routers/agent_api.py \
  routers/public_api.py tests/test_upload_resource_envelope.py
# All checks passed!

SMALLKHOJ_MIGRATION_TEST_ADMIN_URL=postgresql://.../postgres \
SMALLKHOJ_MIGRATION_TEST_DATABASE_URL=postgresql+asyncpg://.../audit_remediation_test \
  uv run pytest -q
# 401 passed in 24.11s
```

The tracked production Caddyfile validates with the official Caddy 2 image.
An isolated Docker probe used that exact built Caddy image, a reachable dummy
`backend:8000`, and `SMALLKHOJ_UPLOAD_REQUEST_BODY_MAX=1KB`:

```text
512-byte POST  -> HTTP 200 from the backend
2048-byte POST -> HTTP 413 from Caddy
```

This is ingress evidence only. Separately, Starlette 0.47.3 reports a current
`MultiPartParser.spool_max_size` of 1 MiB, and the application test proves a
50 MiB file cap/64 KiB read budget. Documentation keeps those proxy, parser
temporary-disk, application-read, and durable-storage boundaries distinct.

## Final integrated gate

The final full-scope backend gate retained the real PostgreSQL upload case and
all cleanup/compensation regressions:

```text
421 passed in 37.52s
Ruff: All checks passed!
docker compose -f docker-compose.prod.yml config --no-interpolate --quiet: passed
```

The Caddy 413 probe remains separate ingress evidence; it is not represented as
proof that the application rejects before Starlette parses or spools a body.
