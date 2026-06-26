# chat product surface

## Goal

Make Chat the main SmallKhoj collaboration surface with Slock-like workflow depth: activity, saved items, channels, DMs, conversation tabs, message actions, threads, files, and task creation.

## Requirements

* Add Activity and Saved sections to the Chat sidebar.
* Show Channels and Direct Messages with counts/status and stable sorting.
* Add conversation header tabs: Chat, Tasks, Files.
* Keep current send-message and thread behavior working.
* Add visible message actions: reply in thread, reaction, save, as task, copy/open menu.
* Add composer actions for attaching image/file where backend supports it or create explicit disabled/future states.
* Integrate task creation from message/thread.
* Use real browser tests for channel and DM paths.

## Acceptance Criteria

* [x] Chat route shows Activity, Saved, Channels, and Direct Messages.
* [x] A DM and a channel both support sending a unique marker.
* [x] Message action controls are visible and do not overlap content.
* [x] Thread replies still persist and render.
* [x] As Task creates a task linked back to message/thread source.
* [x] Real WebDriver evidence verifies visible DOM and API state.

## Real Test SOP

Use marker `REAL_chat_<timestamp>`.

1. Open `/chat/<channel>` with `twd.py`.
2. Send marker in a channel and verify it appears.
3. Open a thread on that marker, reply with marker suffix, verify root and reply.
4. Convert marker message to task and verify `/tasks` shows it.
5. Repeat the send/visible check in a DM.
6. Save screenshots and API responses under `evidence/`.

## Context

* Existing code: `frontend/app/chat/[channel]/channel-client.tsx`
* Parent research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/slock-product-surface.md`
* Frontend specs: `.trellis/spec/frontend/`
