# message actions thread reactions saved

## Goal

Make message-level actions feel product-grade: reply in thread, react, save/bookmark, convert to task, copy/open message menu.

## Requirements

* Show stable action controls for each message without layout shift.
* Keep thread action wired to the thread panel.
* Add reaction UI with backend integration or a clearly scoped backend follow-up.
* Add save/bookmark UI and a Saved surface integration.
* Add "As Task" action that starts task creation from message context.
* Add copy-link/menu affordance for message operations.

## Acceptance Criteria

* [ ] Message action controls are visible on hover/focus and accessible by keyboard.
* [ ] Reply in thread works for root messages.
* [ ] Save/bookmark changes visible saved state.
* [ ] Reaction action persists or records a documented backend gap.
* [ ] As Task links to task creation with message context.

## Real Test SOP

Use marker `REAL_msg_actions_<timestamp>`.

1. Send marker in a channel.
2. Use reply, save, reaction, and as-task actions.
3. Verify visible DOM and API state for each supported action.
4. Save screenshot/API evidence under `evidence/`.

## Context

* Parent research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/slock-product-surface.md`
* Chat base task: `.trellis/tasks/06-09-chat-product-surface/prd.md`
