# Implementation Plan

This task is planning-only on main. Implement later on the frontend feature branch after the current frontend work stabilizes.

## Step 1: Refresh Branch Context

- Switch to the frontend feature branch/worktree where chat UI is being actively changed.
- Re-read:
  - `.trellis/spec/frontend/index.md`
  - `.trellis/spec/frontend/product-ui-style.md`
  - `.trellis/spec/frontend/component-guidelines.md`
  - `.trellis/spec/frontend/quality-guidelines.md`
- Inspect the current branch version of `frontend/app/chat/[channel]/channel-client.tsx`.

## Step 2: Build Message Jump Foundation

- Add a reusable route-local primitive or hook for jumping to a message id.
- Move existing `?message=<id>` scroll behavior onto this primitive.
- Support reduced-motion-aware scroll behavior.
- Add temporary target-message highlight state.
- Return/report a clear state when the target message id is not loaded or has no anchor.
- Reuse this foundation for any existing in-page references that jump to messages, such as file/message links when practical.

## Step 3: Add Focused Component

- Create a route-local `ConversationMinimap` component.
- Keep it client-only and prop-driven.
- Derive marker preview text from message content with plain-text truncation.
- Render only above the selected message-count threshold.

## Step 4: Wire Scroll And Active State

- Use existing message anchors.
- Reuse the message jump foundation for minimap marker click behavior.
- Use `IntersectionObserver` to update active marker.

## Step 5: Add Preview Card And Motion

- Implement hover/focus preview with fixed positioning or portal behavior.
- Use SmallKhoj tokens and square ink-border styling.
- Add reduced-motion handling.

## Step 6: Verification

- Use `./twd` for real browser checks.
- Verify:
  - direct message jump primitive works for an existing message id;
  - missing/unloaded message id fails gracefully;
  - existing `?message=<id>` still works through the shared primitive;
  - long thread shows minimap;
  - short thread hides minimap;
  - hover/focus shows preview;
  - click jumps to the right message;
  - clicked message highlights briefly;
  - active marker updates when scrolling;
  - `?message=<id>` still works;
  - mobile/narrow viewport hides or collapses the minimap.

## Likely Files

- `frontend/app/chat/[channel]/channel-client.tsx`
- `frontend/app/chat/[channel]/conversation-minimap.tsx` or `frontend/components/conversation-minimap.tsx`
- `frontend/messages/en.json`
- `frontend/messages/zh-CN.json`
- Relevant frontend tests if the branch has an established pattern

## Review Notes

- Do not use Codex's pure-white visual treatment directly.
- Do not add decorative motion.
- Do not add backend/API scope in the first implementation.
- Do not break existing message anchors or message deep links.
