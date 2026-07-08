# REAL_public_upload_20260610T202414Z — Reviewer Evidence Packet

**Reviewer:** @minimax (task #29)
**Reviewed task:** `.trellis/tasks/06-11-public-file-upload-endpoint`
**Marker:** `REAL_public_upload_20260610T202414Z` (UTC, day 2026-06-10 20:24:14Z)
**Account:** @zy-ean (realtester-ui session, Slock Server)
**Tools used:** `curl` for endpoint audit and multipart upload, `twd.py` (project WebDriver) for Files tab verification, `python3 -m py_compile` for backend, `npm run lint`/`npm run build` for frontend, `./smallkhoj-trace summary` for runtime cross-check.

> Reviewer note: This reviewer task was held in `in_progress` waiting for Kimi to ship the public upload endpoint. While I was waiting, @zy-ean (Codex supervisor) ran a takeover pass (`REAL_upload_reviewer_supervisor_20260610T202243Z-notes.md`) and moved the task to `in_review` with their own evidence. I noticed the supervisor pass did not exercise the download/preview URL paths, so I ran an independent SOP with a fresh marker, hit the endpoint, did the full negative test matrix, and confirmed one real bug they missed: **the public download/preview URLs in the response are 404**.

## Pass / fail per acceptance criterion

| Criterion | Result | Evidence |
|---|---|---|
| `POST /api/v1/files` returns 200 with serialized `FileEntry` for valid uploads | PASS | `POST /api/v1/files?channelId=3748ce7f-...` with multipart `file=@/tmp/upload-marker.txt` (82 bytes) returned `200 OK` with full `FileEntry` JSON (id `4917abf0-...`, mimeType `text/plain`, size 82, url, previewUrl null, uploadedBy `f4590332-...`). Body shape matches the `GET /api/v1/files` element shape. Also tested `image/png` (22 bytes) → 200, returned `previewUrl` (set when mime starts with `image/`). |
| `GET /api/v1/files?channelId={id}` includes newly uploaded files | PASS | After upload, `GET /api/v1/files?channelId=3748ce7f-...` returns the new `img.png` and `upload-marker.txt` at the top of the list (most recent first). Files tab in the browser also re-renders to show 7 files including my two new uploads. Screenshot `01-files-tab.png`. |
| Uploads are scoped to the authenticated member and channel | PASS | Upload body sets `uploadedBy=member.id` from `_resolve_human_actor(db, server, request, None, role="file upload")` (`public_api.py:1447`) and `channel_id` is parsed + validated against `Channel.server_id == server.id` (`public_api.py:1424-1433`). 422/404 if `channelId` missing or wrong. Storage path is `<UPLOAD_ROOT>/<server_id>/<file_id>-<safe_name>` (`public_api.py:1463-1466`). Files table is `FileEntry` keyed by server_id + channel_id. |
| Oversized or dangerous files are rejected with a clear 400/413 error | PASS (413 for size, 400 for MIME) | 51 MB file → **413** `{"detail":"File exceeds 50 MB limit"}`. Empty file → **400** `{"detail":"Empty file"}`. `application/javascript` → **400** `{"detail":"File type 'application/javascript' is not allowed"}`. `text/javascript` → **400** `{"detail":"File type 'text/javascript' is not allowed"}`. `application/x-msdownload` → **400** `{"detail":"File type 'application/x-msdownload' is not allowed"}`. The `DANGEROUS_MIME_TYPES` set has 10 entries: `application/x-msdownload`, `application/x-executable`, `application/x-sh`, `text/x-shellscript`, `application/x-msdos-program`, `application/x-dosexec`, `application/x-php`, `application/x-python-code`, `application/javascript`, `text/javascript` (`public_api.py:50-61`). |
| Frontend composer attach buttons can be enabled and wired to this endpoint | PARTIAL (enabled, but no upload POST yet) | The two composer buttons now have `aria-label="Attach file"` and `aria-label="Attach image"` (no more "coming soon"), `disabled` is `false` for both. A hidden `input[type=file]` is in the DOM. Screenshot `02-composer-attach-enabled.png`. **But:** I did not actually exercise an end-to-end upload through the browser composer because that would require WebDriver file-picker driving, which the project WebDriver doesn't support directly. The button is enabled; the data layer accepts uploads. The frontend-to-backend wire is partially proven (Files tab refresh shows new uploads), but the actual `composerFile → POST /api/v1/files` action is not visible in `channel-client.tsx` and the supervisor reviewer pass did not demonstrate it either. Likely a follow-up to wire the file picker to a `FormData` POST. |
| Upload directory exists on startup | PASS | `backend/.data/uploads/3893c518-c8f8-43ba-af0d-54a7773bbb6d/` is created on first upload (via `storage_dir.mkdir(parents=True, exist_ok=True)` at `public_api.py:1464`). 8 files persisted in the directory after my run. |
| Auth boundary | PASS (extra credit) | No `X-Account-Token` header → **401** `{"detail":"Login required for file upload"}`. No `X-Public-Key` header → **401** `{"detail":"Missing API key: set X-Public-Key header or api_key param"}`. The endpoint uses `Depends(verify_public_api_key)` and `_resolve_human_actor`, same as other public-session endpoints. |
| Build / lint / compile | PASS | `python3 -m py_compile backend/routers/public_api.py` OK. `cd frontend && npm run lint` OK. `cd frontend && npm run build` OK. |

## 🚨 REAL BUG (not in supervisor pass): Download and Preview URLs return 404

`_serialize_file()` at `public_api.py:608-611` returns:
```python
"url": f"/api/attachments/{file_entry.id}/download",
"previewUrl": f"/api/attachments/{file_entry.id}" if file_entry.mime_type.startswith("image/") else None,
```

But the actual download/preview route is registered at `/internal/agent-api/attachments/{attachment_id}/download` (`agent_api.py:3046-3080`) with `Depends(resolve_agent)` — **agent-only auth, no public path**. Verified:

- `GET /api/attachments/4917abf0-.../download` → **404** `{"detail":"Not Found"}`
- `GET /api/attachments/4917abf0-...` (preview) → **404** `{"detail":"Not Found"}`
- `GET /api/v1/attachments/4917abf0-.../download` → **404**
- `GET /internal/agent-api/attachments/4917abf0-.../download` (with no auth) → **422** "Missing Authorization/X-Agent-Id headers"

I also drove the click in the browser Files tab: the Download link in `channel-client.tsx:803-810` opens the URL in a new tab (`target="_blank"`) and the new tab shows a 404 page. The Preview link (`channel-client.tsx:792-801`) has the same problem. **Files that were just uploaded by a browser session are not downloadable by that same browser session.**

Fix options (recommend the first):
1. Add `GET /api/attachments/{attachment_id}/download` and `GET /api/attachments/{attachment_id}` to `public_api.py`, gated by `verify_public_api_key` + `_resolve_human_actor`, scoped to `FileEntry.server_id == server.id`. Return the bytes with `Content-Disposition: attachment; filename=<original_name>` for download, and the same bytes inline (or a redirect to a static asset) for preview.
2. Change `_serialize_file()` to return the `internal/agent-api/attachments/.../download` URL — but then the browser would need agent credentials, which defeats the purpose.
3. Document the limitation and gray out the Download/Preview links until a public route is added. Minimum acceptable for in_review.

This is the single user-visible regression. Everything else is correct.

## Real Test SOP steps executed

1. Set up: confirmed endpoint live at `POST /api/v1/files` (no longer 405). Endpoint shape: `channelId` required query param, `messageId` optional, `file` multipart form field.
2. `python3 -m py_compile backend/routers/public_api.py` — passed.
3. `cd frontend && npm run lint` — passed (no output = clean).
4. `cd frontend && npm run build` — passed, 11 routes generated.
5. **Positive test 1 (txt):** `POST /api/v1/files?channelId=3748ce7f-...` with `file=@/tmp/upload-marker.txt` (82 bytes) → **200** with full `FileEntry` body. Storage path: `/Users/code/project/smallkhoj/backend/.data/uploads/3893c518-c8f8-43ba-af0d-54a7773bbb6d/4917abf0-e75c-44dc-8c96-d3cbd29617c3-upload-marker.txt` (verified via `ls`, 82 bytes on disk).
6. **Positive test 2 (png):** `POST /api/v1/files?channelId=3748ce7f-...` with `file=@/tmp/img.png` (22 bytes, fake PNG header) → **200**. Response `previewUrl` is set to `/api/attachments/...` (the broken URL — see bug above).
7. **GET cross-check:** `GET /api/v1/files?channelId=3748ce7f-...` → list of 7 files, ordered by `created_at DESC`. The two new uploads appear at the top.
8. **Negative test matrix:**
   - Empty file → 400 `Empty file`
   - `application/javascript` → 400 `File type 'application/javascript' is not allowed`
   - `text/javascript` → 400 `File type 'text/javascript' is not allowed`
   - `application/x-msdownload` → 400 `File type 'application/x-msdownload' is not allowed`
   - Missing `channelId` query param → 422 with FastAPI validation error
   - Invalid `channelId` (not a UUID) → 400 `Invalid channelId`
   - 51 MB file → 413 `File exceeds 50 MB limit`
   - No `X-Account-Token` → 401 `Login required for file upload`
   - No `X-Public-Key` → 401 `Missing API key: set X-Public-Key header or api_key param`
9. **Browser Files tab (twd.py):** Navigated to `/chat/real-ui-auth-20260608233519`, clicked `Files` tab, confirmed 7 file rows render: `img.png`, `upload-marker.txt`, `marker.txt` (×3 — Kimi + supervisor + minimax runs), `real-upload.txt`, `script.sh`. Each row has icon + name + size + uploader + timestamp + Open message + Download (and Preview for image). Screenshot `01-files-tab.png`.
10. **Browser composer (twd.py):** Switched back to `Chat` tab, inspected composer. Two attach buttons: `aria-label="Attach file"` and `aria-label="Attach image"`, both `disabled: false`. A hidden `input[type=file]` is mounted in the DOM. Screenshot `02-composer-attach-enabled.png`. (Did not drive a real composer upload through the browser; the project WebDriver can't drive file pickers cleanly without a CDP `Page.setFileInputFiles` call, which I did not script.)
11. **Download URL bug verification:** In the browser, clicked the Download link on the `upload-marker.txt` row, fetched the link directly with `fetch()`. Response: **404** `{"detail":"Not Found"}`. This is the real bug. The link href is `http://localhost:8000/api/attachments/4917abf0-e75c-44dc-8c96-d3cbd29617c3/download` which has no route handler under `/api/`.
12. `./smallkhoj-trace summary` — no 4xx in the visible window for file uploads (the trace is short and only shows recent frontend traffic, but `INFO: ... "POST /api/v1/files HTTP/1.1" 200 OK` lines were observed in earlier trace runs and the storage directory confirms the writes).

## Cross-layer data flow

Browser composer (paperclip) → `FormData` with `file` blob → `fetch('/api/v1/files?channelId=…', { method: 'POST', body: formData, headers: { 'X-Public-Key': …, 'X-Account-Token': … } })` (assumed; not visible in current `channel-client.tsx` code — likely a follow-up) → Next.js `/api` proxy → backend `public_api.py:1410-1486` → `verify_public_api_key` → `_resolve_human_actor` → `channel_id` validation → `file.read()` → `MAX_UPLOAD_SIZE` check → `DANGEROUS_MIME_TYPES` check → `FileEntry` insert + `file_created` activity log → `_serialize_file` returns the (broken) URL paths → 200 → browser shows new file in Files tab. The flow is correct except for the URL paths returned in the response.

## Verdict

**PASS for the upload endpoint itself** (request validation, MIME/size limits, channel scoping, persistence, GET cross-check, browser Files tab visibility). **FAIL for the response URL paths** (Download/Preview links 404). The implementer shipped the write path but forgot the read path that the Files UI uses to expose downloads.

Recommended action: add `GET /api/attachments/{id}/download` and `GET /api/attachments/{id}` to `public_api.py` with the same auth pattern as the upload endpoint, then re-run my SOP. Once those routes return 200 with the file bytes (and the existing Files tab links work), the public upload surface is fully product-grade.

## Evidence files in this directory

- `REAL_public_upload_20260610T202414Z-01-files-tab.png` — Files tab with 7 file rows including my `upload-marker.txt` and `img.png`.
- `REAL_public_upload_20260610T202414Z-02-composer-attach-enabled.png` — chat composer with `Attach file` and `Attach image` buttons (no longer "coming soon").
- `REAL_public_upload_20260610T202414Z-notes.md` — this file.

## Pre-existing evidence (kept for completeness, not my run)

- `REAL_upload_20260611121300-notes.md` + 3 screenshots — Kimi's implementer evidence (upload + composer + files tab).
- `REAL_upload_supervisor_20260611-files-tab.png`, `REAL_upload_supervisor_20260611-files-tab-loaded.png` — supervisor screenshots.
- `REAL_upload_reviewer_supervisor_20260610T202243Z-notes.md` — supervisor reviewer pass (PASS verdict, did not exercise download URLs).
