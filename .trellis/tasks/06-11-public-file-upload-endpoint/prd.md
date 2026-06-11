# Public file upload endpoint

## Goal

Add a browser-accessible file upload endpoint to `public_api.py` so the Files surface can persist uploads.

## Background

Task `06-09-files-surface-and-attachments` built the frontend Files tab and composer affordances. The backend already has:
- `GET /api/v1/files` — listing endpoint (`public_api.py:1335-1357`)
- `FileEntry` SQLAlchemy model with all metadata fields (`backend/models/slock.py:355-381`)
- `_serialize_file()` helper

What is missing: a `POST` handler on the same path (or a dedicated upload path) that accepts multipart/form-data from browser session auth (`X-Account-Token`).

## Requirements

1. Add `POST /api/v1/files` (or `POST /api/v1/channels/{id}/files`) to `public_api.py`.
2. Accept `multipart/form-data` with a single file field.
3. Require `channel_id` (query param or path segment) to scope the file to a channel/DM.
4. Optionally accept `message_id` to link the file to a source message.
5. Store the uploaded file via `FileEntry`:
   - Generate UUID `id`
   - Set `server_id` from the singleton server
   - Set `channel_id`, `message_id`, `uploaded_by` from the resolved account session
   - Set `file_name`, `original_name`, `mime_type`, `size` from the uploaded file
   - Set `storage_path` to a local path (e.g. `uploads/{server_id}/{channel_id}/{file_id}`)
   - Set `metadata_json` to `{}` or basic extracted metadata
   - Set `created_at` to `datetime.now(timezone.utc)`
6. Return the serialized file object (same shape as `GET /api/v1/files` items).
7. Add safe validation:
   - Max file size (e.g. 50 MB)
   - Reject dangerous MIME types (e.g. `application/x-msdownload`, `application/x-executable`)
   - Reject empty files
8. Ensure the upload directory exists on startup (create if missing).

## Acceptance Criteria

- [x] `POST /api/v1/files` returns 200 with serialized `FileEntry` for valid uploads.
- [x] `GET /api/v1/files?channelId={id}` includes newly uploaded files.
- [x] Uploads are scoped to the authenticated member and channel.
- [x] Oversized or dangerous files are rejected with a clear 400/413 error.
- [x] Frontend composer attach buttons can be enabled and wired to this endpoint.

## Dependencies

- `06-09-files-surface-and-attachments` (frontend surface)

## Context

- `backend/routers/public_api.py` — add endpoint here
- `backend/models/slock.py` — `FileEntry` model already exists
- `backend/routers/agent_api.py:3007-3016` — reference `agent_api.upload_attachment` for storage pattern, but note it lacks MIME/size validation
