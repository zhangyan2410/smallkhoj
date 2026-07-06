# Implementation Plan / Spec / SOP

## Purpose

Child follow-up task for `06-09-files-surface-and-attachments`. The frontend Files surface is ready; this task adds the missing public upload endpoint.

## Workstream

Backend

## Likely Scope

- `backend/routers/public_api.py` — add `POST /api/v1/files`
- `backend/models/slock.py` — no changes needed (model exists)
- Possibly `backend/main.py` — ensure upload directory exists on startup

## Plan

1. Read `prd.md`, inspect existing `GET /api/v1/files` and `FileEntry` model.
2. Add `POST /api/v1/files` with multipart parsing, validation, and `FileEntry` creation.
3. Ensure upload directory is created on startup.
4. Run lint/type checks.
5. Test with `curl` using a real file.
6. Save evidence under `evidence/`.

## Spec Contract

- Endpoint: `POST /api/v1/files`
- Auth: `X-Account-Token` (session cookie)
- Body: `multipart/form-data` with `file` field
- Query params: `channelId` (required), `messageId` (optional)
- Response: serialized `FileEntry` (same shape as list items)
- Validation: max 50 MB, reject dangerous MIME types

## Real Test SOP

Marker: `REAL_upload_<timestamp>`

1. `curl -F file=@marker.txt -H "X-Account-Token: ..." "http://localhost:8000/api/v1/files?channelId=..."`
2. Verify response contains `id`, `url`, `previewUrl`.
3. Verify `GET /api/v1/files?channelId=...` returns the new file.
4. Screenshot browser Files tab showing the uploaded file.
5. Save evidence.
