# Local production-shape UI evidence

Run marker: `REAL_audit_delivery_ui_20260723235900`

## Scope

This run used only the disposable local production-shaped stack at
`http://127.0.0.1:19081` through Caddy. It did not access, test, benchmark or
modify the older cloud deployment.

The browser target was explicitly pinned to tab `1617512415`. No Raft, Kimi or
other user tab was read or operated.

## Results

- A new Better Auth account registered successfully against the rebuilt
  frontend image. This closes the reproduced stale-public-key image-cache
  failure; the previous `Invalid API key` redirect did not recur.
- The backend bridge created one account, one active Server, one member and an
  owner membership. Only cookie names/presence were recorded, never values.
- A disposable `#all` channel and 201 Task fixtures proved that the frontend
  consumed the second page after `limit=200`. The `#201` tail was scrolled into
  the visible viewport and captured in the pagination screenshot.
- Two independent authenticated `task.created` probes appeared through the
  shared SSE owner. The clean second probe made exactly two Task GETs (200 plus
  cursor page), zero raw RSC GETs and zero non-prefetch RSC GETs.
- The visible Task delete dialog named the exact `#201` target. After confirm,
  the row disappeared, the URL selection cleared, PostgreSQL had zero matching
  rows, and the `task.deleted` tombstone had a null Task foreign key.
- The normal File delete was issued outside React state. `file.deleted` SSE
  removed the visible row with zero File refetches and zero RSC requests.
- The quarantine branch used an explicit disposable fault injection: the
  uploaded blob was replaced by an empty directory. The real UI delete committed
  the DB removal, returned the quarantined cleanup state, removed the File row,
  and rendered a localized `role=alert` warning.
- The physical SSE invariant held before and after the ProductShell route
  transition: `sseStarts - sseAborts == 1`, `sseActive == 1`, every observed
  response was 200, and `sseErrors == 0`.

## Browser timing note

Chrome suspends `requestAnimationFrame` in a background tab. During the first
pagination capture, Next's streamed Suspense reveal remained in its loading
fallback until the explicitly selected SmallKhoj tab was brought to the front.
After `Page.bringToFront`, the boundary revealed, hydration completed, dynamic
Task UI loaded, React handlers attached and realtime effects started. There was
no JavaScript error, failed chunk, container restart or application defect.

## Evidence files

- `-00-local-prod-preflight.json`: image/container/Caddy smoke facts.
- `-01-auth-me.json` plus login snapshot/screenshot: identity and active Server.
- `-02-task-pagination.*`: 201-item, second-page visible proof.
- `-03-task-targeted.json`: targeted Task refresh and one-SSE facts.
- `-04-task-delete-*`: confirmation/delete before-after and final screenshot.
- `-05-file-targeted.json`: File SSE projection facts.
- `-06-file-quarantine-*`: quarantine dialog/warning before-after and screenshot.
- `-07-api-db.json`: PostgreSQL/event/storage cross-check.
- `-08-network-final.json`: final shared SSE invariant.

The disposable Server/account and injected quarantine directory are cleaned only
after the API/DB/storage evidence above is captured.
