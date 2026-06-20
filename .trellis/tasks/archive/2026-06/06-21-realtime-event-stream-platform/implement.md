# Realtime Event Stream Platform Implementation Plan

## Phase 0: Read and Confirm Current Flow

- [ ] Read this task's `prd.md` and `design.md`.
- [ ] Inspect `backend/routers/public_api.py` message/task/member/workspace write paths.
- [ ] Inspect `backend/services/daemon_control.py` only to avoid mixing daemon control-plane payloads into browser events.
- [ ] Inspect `frontend/lib/control-plane.ts` for auth/header helpers.
- [ ] Inspect `frontend/app/chat/[channel]/channel-client.tsx` for message state and `loadMessages()`.
- [ ] Inspect `frontend/app/tasks`, `frontend/app/computers`, and member status surfaces for later realtime integration points.

## Phase 1: Chat Vertical Slice

Backend:

- [ ] Add public event envelope type/helper.
- [ ] Add in-process public event hub.
- [ ] Add scoped seq + backend epoch generation.
- [ ] Add `GET /api/v1/events/stream` with public auth.
- [ ] Stream JSON SSE frames plus heartbeat comments.
- [ ] Cleanup subscribers on disconnect.
- [ ] Publish `message.created` after channel message creation.
- [ ] Publish `message.created` after DM message creation if the DM page is touched.

Frontend:

- [ ] Add neutral fetch-based SSE parser.
- [ ] Add realtime event client/hook using existing API headers.
- [ ] Add reconnect with bounded backoff and abort cleanup.
- [ ] Wire chat channel page subscription.
- [ ] Dedupe message events by `message.id`.
- [ ] Append active channel messages or call debounced `loadMessages()`.
- [ ] Keep existing manual send flow working.

Validation:

- [ ] Backend tests for SSE frame/publish path.
- [ ] Frontend tests for parser/dedupe where feasible.
- [ ] Real browser marker appears in chat without reload.

## Phase 2: Ordering, Gap Detection, and Catch-Up

- [ ] Track high-water marks per scope on frontend.
- [ ] Drop duplicate/late events.
- [ ] Detect seq gaps.
- [ ] Detect epoch changes.
- [ ] On gap/epoch change, run scoped catch-up/refetch.
- [ ] Add frontend diagnostics for reconnect/gap/duplicate/catch-up.
- [ ] Add backend logs for stream connect/disconnect/publish/subscriber count.
- [ ] Add tests for duplicate, gap, and epoch behavior.

## Phase 3: Expand Product Surfaces

Tasks:

- [ ] Publish `task.created`.
- [ ] Publish `task.updated`.
- [ ] Wire task board/list to realtime event path with debounced refetch or local patch.

Workspace/runtime/computers:

- [ ] Publish `workspace.updated`.
- [ ] Publish `runtime.updated`.
- [ ] Publish `computer.status.updated`.
- [ ] Wire computers/workspace UI to realtime event path.

Members:

- [ ] Publish `member.status.updated`.
- [ ] Wire member/chat sidebar status updates where visible.

## Phase 4: Fanout Boundary

- [ ] Keep event hub interface separate from in-process implementation.
- [ ] Document local in-process behavior.
- [ ] Keep Redis deferred; do not add Redis as a dependency or required local service.
- [ ] Implement Postgres LISTEN/NOTIFY now if feasible; otherwise document the exact adapter seam, env/config, and test plan behind the interface.
- [ ] If implemented, add simulated two-backend test or documented manual test.
- [ ] If deferred, document the exact seam and env/config needed later.

## Validation Commands

Use commands matching touched files. Likely minimum:

```bash
cd backend && .venv/bin/python -m pytest tests -q
cd frontend && npm run typecheck
cd frontend && npm run lint
```

Real browser verification must use project WebDriver:

```bash
./twd goto --url-match 127.0.0.1:3000 "http://127.0.0.1:3000/chat/all"
./twd --compact eval --url-match 127.0.0.1:3000 "return document.body.innerText.includes('REAL_realtime_event_stream_...')"
```

Use trace when daemon/agent delivery is involved:

```bash
./smallkhoj-trace summary --json
```

## Real Test SOP

Marker:

```text
REAL_realtime_event_stream_<YYYYMMDDHHMMSS>
```

Steps:

1. Start/confirm backend, frontend, and daemon if agent delivery is part of the test.
2. Open `/chat/all` or a chosen channel with `./twd`.
3. Confirm page is loaded and stream is connected through logs or UI diagnostic.
4. Create a message containing the marker through backend API, product UI, or agent path.
5. Do not refresh the browser.
6. Verify the marker appears in visible DOM.
7. Save screenshot under `evidence/`.
8. Save notes with commands, API response, trace excerpts, and pass/fail.

## Risk Points

- Native `EventSource` cannot send current auth headers; use fetch streaming.
- Do not couple browser events to daemon WebSocket/control-plane commands.
- Events must not become the source of truth; DB remains authoritative.
- Dedupe is mandatory because local send and server event can both arrive.
- Gap detection must not silently ignore missed events.
- Avoid one-off page-specific polling loops as the main solution.
- Keep local dev simple; do not require Redis unless production fanout is intentionally implemented.

## Done Definition

The task is done when:

- Chat auto-refresh is proven in a real browser.
- Event envelope and stream endpoint exist.
- Reconnect and cleanup exist.
- Duplicate/gap/epoch behavior is handled or explicitly documented with tests around implemented behavior.
- At least task or workspace status updates use the same event stream path, proving the design is not chat-only.
- Remaining production fanout work, if any, is documented behind the event hub interface rather than left as vague future work.
