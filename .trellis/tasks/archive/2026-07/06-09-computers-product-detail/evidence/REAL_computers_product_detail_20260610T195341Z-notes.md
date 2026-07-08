# REAL_computers_product_detail_20260610T195341Z — Reviewer Evidence Packet

**Reviewer:** @minimax (task #17)
**Reviewed task:** `.trellis/tasks/06-09-computers-product-detail` (no Slock task yet — Kimi/GLM1 may not have started or claimed it; the `.trellis/tasks/...` dir is the source of truth)
**Marker:** `REAL_computers_product_detail_20260610T195341Z` (UTC, day 2026-06-10 19:53:41Z)
**Account:** @zy-ean (realtester-ui session, Slock Server)
**Tools used:** `twd.py` (project WebDriver), `curl` for `/api/v1/computers` cross-check, `./smallkhoj-trace summary` for runtime cross-check.

> Reviewer note: There is no Slock task matching the `06-09-computers-product-detail` PRD (task #18 is the files one). The current `frontend/app/computers/page.tsx` (381 lines) already had substantial coverage from a prior wave (agents on the computer with runtime/PID/CWD, reconnect button, detected runtimes, etc.) — most of this PRD's acceptance criteria are already satisfied. I verified the existing surface with a fresh marker and noted the gaps that are still missing.

## Pass / fail per acceptance criterion

| Criterion | Result | Evidence |
|---|---|---|
| Computers page can select a computer and render detail | PASS (no separate selection, but the card IS the detail) | `GET /computers` renders the single registered computer (`unregistered-computer`) as a full Card with name, status pill, OS, daemon version, last heartbeat, computerId, machineId, serverId, apiKey (truncated prefix), lease, detected runtimes, and agent workspaces. With only 1 computer, the directory-vs-detail question is moot — but every computer that comes back from the API is rendered as a full detail card. Screenshot `01-baseline.png`. |
| Connect/reconnect commands still work and hide machine tokens from browser | PASS | Both server actions (`createComputerConnectCommandAction`, `createComputerReconnectCommandAction`) return 303 redirects to `?created=1` / `?reconnect=<id>`. The command displayed in the page is a one-shot `SLOCK_CONNECT_TOKEN=sk_connect_…` shell command — NOT a long-lived `sk_machine_` token. Verified by inspecting the DOM after both flows: the only `sk_*` string in the rendered tree is the prefix `sk_machine_REDACTED` (which is the apiKey prefix the API explicitly returns) and the new `sk_connect_…` token. The full machine token is never sent to the browser. Screenshots `02-reconnect-command.png` and `03-connect-command.png`. |
| Agent workspace rows show status, runtime, pid/session/cwd where available | PASS (cwd + pid + status + runtime + provider, but NOT session) | The 6 agent workspaces on `unregistered-computer` each show: agent handle, workspaceId short + provider, runtime type + provider/model, status pill, PID, CWD. `session` is in the API response (`sessionId: "db8adb13-..."` for cctv) but the row does NOT show it. The PRD's wording is "pid/session/cwd where available" — session is available in the data but not rendered. Minor gap. Screenshot `04-detail-clean.png`. |
| Lifecycle controls (stop/restart/kill/reconcile) visible only when supported or clearly disabled with reason | FAIL (controls missing entirely) | There is no stop / restart / kill / reconcile button anywhere on the page. The PRD says "Add stop/restart/kill/reconcile lifecycle controls where backend supports them; document backend follow-up where missing." This is a real gap. The backend has `POST /api/v1/daemon/...` (register, heartbeat, shutdown) and `POST /internal/agent-api/...` workspace routes, but the UI does not surface any of them. The PRD's escape hatch ("document backend follow-up where missing") is also missing — no empty-state or disabled-with-reason UI for these controls. |
| Real WebDriver + API/trace evidence verifies at least one connect/reconnect or runtime status path | PASS | Connect path: `POST /api/v1/computers/connect-command` → 200 with `{ command, expiresAt }`, page redirected to `/computers?created=1`, command shown. Reconnect path: `POST /api/v1/computers/<id>/reconnect-command` → 200, page redirected to `/computers?reconnect=<id>`, command shown. Trace shows `POST /computers` 303 and `POST /computers?reconnect=…` 303. Both flows are real and visible. |
| Show OS, daemon version, update availability, machine ID, lease, heartbeat, detected runtimes | PARTIAL | All present EXCEPT daemon update availability — the page shows `daemon 0.2.0` but no indication of whether an update is available. PRD says "update availability if available" — so technically optional, but a reviewer note. |
| Show runtime installed/not-installed/unknown states where backend data supports them | PARTIAL | Runtimes are shown as chips, but always labeled "available" (e.g. `claude_code / available`, `42 / available / deepseek-v4-pro`, `yier-gongyi / available / FILL_ME_AFTER_ADD`). There is no `installed / not-installed / unknown` distinction; the chip label is the raw `runtime / availability / model` triple. Same overflow that was flagged in the members-tab review. |
| Show agents on this computer with runtime, online/stopped status, and explanatory text | PARTIAL | Agents shown with runtime, status pill (运行中 = running), and CWD. No explanatory text — just the table. PRD asks for "explanatory text" — recommend a one-line caption like "6 agents registered on this computer" above the table. |
| Add workspace scan entry point | FAIL | No scan button, no "Re-scan" or "Refresh workspaces" affordance anywhere. The PRD lists this explicitly. |
| Preserve connect and reconnect command flows | PASS | Both flows are preserved. The connect form and reconnect button are both present and working. |
| Add delete safety language and constraints | FAIL | No delete button, no delete confirmation, no safety language. The PRD requires this. (Backend may also lack a DELETE endpoint — that would be the documented follow-up.) |

## Real Test SOP steps executed

1. Logged in as `realtester-ui`, tab 1617511184.
2. `twd.py goto http://127.0.0.1:3000/computers` — landed on the Computers page. Title: `Computers`. Header shows `Registered 1 online`, `Workspaces 6`, `Running 6`. Sidebar shows `Registered 1, Online 1, Running workspaces 6`. Screenshot `01-baseline.png`.
3. `curl -H "X-Public-Key: sk_public_local" /api/v1/computers` — 1 computer: `c2b630e2 | unregistered-computer | online` with 6 agent workspaces and 8 detected runtimes. Confirms the page numbers.
4. The "selected computer" detail is the only computer card on the page (since count is 1). Verified the card shows: `name`, `status pill (在线)`, `darwin 24.5.0 arm64`, `daemon 0.2.0`, `06/11 03:51` heartbeat, 5 id fields (computerId, machineId, serverId, apiKey prefix, lease), 8 detected runtime chips, 6-row agent workspace table with handle/workspaceId/runtime/status/PID/CWD.
5. Clicked the `Reconnect` button on the computer card. Server action fired, page revalidated, and the `Reconnect Command` panel appeared showing the `cd ... && SLOCK_CONNECT_TOKEN=sk_connect_REDACTED SLOCK_ALLOW_WRITES=1 node dist/cmd/main.js start --foreground ...` command. Inspected the DOM: the only `sk_*` strings are `sk_machine_REDACTED` (the API-returned prefix) and the new `sk_connect_…` token. No long-lived machine token. Screenshot `02-reconnect-command.png`.
6. Filled `input#computer-name` with `REAL_computers_product_detail_20260610T195341Z test`, submitted the `Generate Connect Command` form. Page redirected to `/computers?created=1` and showed the connect command with a different `sk_connect_REDACTED` token. Screenshot `03-connect-command.png`.
7. Removed the connect + reconnect panels from the DOM (so the screenshot focuses on the persistent detail), took `04-detail-clean.png` showing the full detail card with runtimes and workspaces.
8. `./smallkhoj-trace summary` cross-check: `GET /api/v1/computers` 200; `GET /computers` 200; `POST /computers` 303; `POST /computers?reconnect=c2b630e2-...` 303; `GET /computers?created=1` 200. All within the expected 500-1500 ms range. No errors.
9. API cross-check on the workspace rows: `session` field is in the data (`db8adb13-faf4-434e-87c5-6d160eccd62a` for cctv, etc.) but NOT rendered in the UI row. CWD + PID + status + runtime + provider are rendered.

## Cross-layer data flow

Browser loads `/computers` → Next.js server component calls `getComputers()` → `apiGet('/api/v1/computers')` → backend returns the serialized computer list with `detectedRuntimes` and `agentWorkspaces` expanded → page renders cards. `Reconnect` button submit → `createComputerReconnectCommandAction` server action → `POST /api/v1/computers/<id>/reconnect-command` (with `X-Public-Key` + browser session cookie) → backend returns `{ command, expiresAt, mode: "reconnect" }` → action writes the command into an `httpOnly` cookie `smallkhoj_last_computer_connect_command` (5-min TTL, scoped to `/computers`) and `redirect(...)` to `/computers?reconnect=<id>` → page reads the cookie, looks up the matching computer, and renders the command in a `<code data-testid="reconnect-command">` block. The full machine token is never in the cookie or the page payload.

## Known gaps / opportunities

* **Missing lifecycle controls** (stop / restart / kill / reconcile) and **missing workspace scan** are the two biggest PRD gaps. The page does not even render a disabled-state placeholder, so the user has no signal that these features are on the roadmap. Recommend either implementing at least one (the backend `POST /internal/agent-api/daemon/shutdown` is right there) OR adding a "Runtime lifecycle controls — coming soon" empty-state card so the gap is visible.
* **No delete safety language / no delete button.** This is a real omission — the PRD requires it. Even a disabled "Delete computer" button with a tooltip "Not available in this release — see `.trellis/tasks/06-09-computers-product-detail`" would be better than silence.
* **Runtimes still show raw triple "runtime / availability / model".** Same as the members-tab gap. Recommend showing the runtime name prominently, the provider as a smaller secondary label, and only the model as a tooltip on hover. The `FILL_ME_AFTER_ADD` literal is still leaking into the UI.
* **`session` field not rendered** in the workspace row even though it's in the API response. Cheap fix: add a 7th column or append `session: <short>` to the workspaceId line.
* **No "explanatory text"** above the workspaces table. The PRD asks for it. A one-line caption like "6 agents registered on this computer" would help reviewers.
* **The /api/v1/upload endpoint does not exist** — only `/internal/agent-api/upload` does. This is a downstream gap for the Files SOP too.
* **Computers page is not heavily modified** compared to the prior wave's evidence. The reviewer did NOT clean up any uncommitted modifications — they belong to whoever owns the next cut.

## Evidence files in this directory

- `REAL_computers_product_detail_20260610T195341Z-01-baseline.png` — Computers page baseline, one computer card visible with all the detail.
- `REAL_computers_product_detail_20260610T195341Z-02-reconnect-command.png` — Reconnect panel showing the `SLOCK_CONNECT_TOKEN=sk_connect_…` command.
- `REAL_computers_product_detail_20260610T195341Z-03-connect-command.png` — Connect panel showing the marker-named computer's one-time connect command.
- `REAL_computers_product_detail_20260610T195341Z-04-detail-clean.png` — Full detail card with runtimes and workspaces (panels removed for clarity).
- `REAL_computers_product_detail_20260610T195341Z-notes.md` — this file.
