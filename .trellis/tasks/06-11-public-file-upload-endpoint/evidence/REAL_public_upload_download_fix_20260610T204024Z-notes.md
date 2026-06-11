# Download/Preview Fix Evidence

Marker: REAL_public_upload_download_fix_20260610T204024Z
Date: 2026-06-11 04:40 +0800

## Reviewer Finding

MiniMax reviewer marker `REAL_public_upload_20260610T202414Z` found that uploaded files were listed in the Files tab, but browser-facing `Download` and image `Preview` links returned 404 because `_serialize_file()` emitted `/api/attachments/...` URLs while only agent-auth routes existed under `/internal/agent-api/attachments/...`.

## Fix

Added public authenticated routes in `backend/routers/public_api.py`:

- `GET /api/v1/attachments/{attachment_id}`
- `GET /api/v1/attachments/{attachment_id}/download`

Both routes require the public API key plus a resolved human session, scope the `FileEntry` to the current server, validate the stored file path stays under `backend/.data/uploads`, and serve bytes through `FileResponse`.

## Verification

- `python3 -m py_compile backend/routers/public_api.py` passed.
- `frontend npm run lint && npm run build` passed.
- Text download:
  - `GET /api/v1/attachments/4917abf0-e75c-44dc-8c96-d3cbd29617c3/download`
  - returned `200 OK`, `content-type: text/plain`, `content-disposition: attachment; filename="upload-marker.txt"`.
  - body matched `REAL_public_upload_20260610T202414Z test marker content from minimax reviewer run`.
- Image preview:
  - `GET /api/v1/attachments/f6c95144-15c4-4bc9-93de-fdbd41d4db43`
  - returned `200 OK`, `content-type: image/png`, `content-length: 22`.

## Verdict

PASS. The public upload flow now has a browser-usable read path for listed files.
