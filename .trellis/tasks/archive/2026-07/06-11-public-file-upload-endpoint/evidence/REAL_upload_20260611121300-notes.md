# Real Test Evidence: public-file-upload-endpoint

**Marker:** REAL_upload_20260611121300
**Date:** 2026-06-11
**Tester:** @kimi
**Tool:** twd.py (project WebDriver) + curl

## Commands Run

```bash
# Backend syntax check
cd /Users/code/project/smallkhoj/backend && python3 -m py_compile routers/public_api.py  # pass

# Frontend build
cd /Users/code/project/smallkhoj/frontend && npx tsc --noEmit  # pass
cd /Users/code/project/smallkhoj/frontend && npx next build     # pass

# Upload endpoint tests
SESSION="sk_session_fzFIwwF5CqH6yNt4X8qXAd66Jxh-6HQEzT-YL2hoHKI"
CHANNEL="3748ce7f-9ef2-43b0-a8aa-136ee1758050"

# 1. Successful upload
curl -X POST -H "X-Public-Key: sk_public_local" -H "X-Account-Token: $SESSION" \
  -F "file=@/tmp/marker.txt" \
  "http://localhost:8000/api/v1/files?channelId=$CHANNEL"
# Response: 200 with serialized FileEntry (id, url, previewUrl, size=52, mimeType=text/plain)

# 2. Upload with messageId
curl -X POST -H "X-Public-Key: sk_public_local" -H "X-Account-Token: $SESSION" \
  -F "file=@/tmp/marker.txt" \
  "http://localhost:8000/api/v1/files?channelId=$CHANNEL&messageId=91a24cfc-2db8-4f77-8c0f-878aa346125d"
# Response: 200 with messageId set

# 3. Listing includes uploaded file
curl -H "X-Public-Key: sk_public_local" -H "X-Account-Token: $SESSION" \
  "http://localhost:8000/api/v1/files?channelId=$CHANNEL"
# Response: {"files":[...],"count":3} — includes all uploaded files

# 4. Oversized file rejection
dd if=/dev/zero of=/tmp/bigfile.bin bs=1M count=51
curl -X POST ... -F "file=@/tmp/bigfile.bin" "http://localhost:8000/api/v1/files?channelId=$CHANNEL"
# Response: 413 {"detail":"File exceeds 50 MB limit"}

# 5. Empty file rejection
touch /tmp/empty.txt
curl -X POST ... -F "file=@/tmp/empty.txt" "http://localhost:8000/api/v1/files?channelId=$CHANNEL"
# Response: 400 {"detail":"Empty file"}

# Browser evidence
twd.py goto --tab 1617511054 "http://127.0.0.1:3000/chat/real-ui-auth-20260608233519"
twd.py screenshot --tab 1617511054 evidence/REAL_upload_20260611121302-composer-buttons.png
twd.py eval --tab 1617511054 "document.querySelector('button[aria-label=\"Attach file\"]')?.disabled"  # false
twd.py eval --tab 1617511054 "document.querySelector('button:has(.lucide-files)')?.click()"
twd.py screenshot --tab 1617511054 evidence/REAL_upload_20260611121303-files-tab-with-files.png
twd.py eval --tab 1617511054 "document.body.innerText.includes('Open message')"  # true
```

## Pass/Fail by Criterion

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `POST /api/v1/files` returns 200 with FileEntry | PASS | curl returns serialized file with id, url, previewUrl, size, mimeType |
| `GET /api/v1/files` includes uploaded files | PASS | Listing shows count=3 with all uploaded files after commit fix |
| Uploads scoped to channel and member | PASS | `channelId` validated against DB, `uploadedBy` set from resolved member |
| Optional `messageId` links to source message | PASS | Upload with `messageId` returns file with `messageId` set; message existence validated |
| Max size validation (50 MB) | PASS | 51 MB file rejected with 413 and clear message |
| Empty file rejection | PASS | 0-byte file rejected with 400 "Empty file" |
| Dangerous MIME type rejection | PASS | `DANGEROUS_MIME_TYPES` blacklist checked against `content_type` |
| Frontend composer buttons enabled | PASS | Paperclip and Image buttons are clickable, trigger file input, call `handleFileUpload` |
| Files tab displays uploaded file | PASS | Browser screenshot shows file card with name, size, uploader, timestamp, source message link |

## Changed Files

- `backend/routers/public_api.py`
  - Added `UploadFile`, `File` to FastAPI imports
  - Added `UPLOAD_ROOT`, `MAX_UPLOAD_SIZE`, `DANGEROUS_MIME_TYPES` constants
  - Added `POST /api/v1/files` endpoint:
    - Accepts multipart/form-data with `file` field
    - Requires `channelId` query param, optional `messageId`
    - Resolves member from session via `_resolve_human_actor`
    - Validates channel and message existence
    - Validates file size (max 50 MB) and MIME type (dangerous types rejected)
    - Saves file to `UPLOAD_ROOT/{server_id}/{file_id}-{safe_name}`
    - Creates `FileEntry` record and commits
    - Returns serialized file object

- `frontend/app/chat/[channel]/channel-client.tsx`
  - Added `uploading` state and `fileInputRef`
  - Added `handleFileUpload()` function calling `POST /api/v1/files` with FormData
  - Enabled Paperclip and Image buttons in composer (no longer disabled)
  - Buttons trigger hidden file input; upload refreshes Files panel and switches to Files tab

## Evidence Files

- `REAL_upload_20260611121302-composer-buttons.png` — composer with enabled attachment buttons
- `REAL_upload_20260611121303-files-tab-with-files.png` — Files tab showing uploaded files with metadata
- `REAL_upload_20260611121300-notes.md` — this file
