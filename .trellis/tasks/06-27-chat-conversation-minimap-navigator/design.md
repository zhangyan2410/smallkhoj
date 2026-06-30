# Design: chat conversation minimap navigator

## Surface

Primary target: `frontend/app/chat/[channel]/channel-client.tsx`.

The minimap belongs to the chat message viewport, not the global app rail. It should appear only for the `chat` tab and only when the current loaded message list is long enough to benefit from navigation.

## Message Jump Foundation

Implement a reusable message jump primitive before the minimap UI.

The primitive should own:

- resolving a message id to the current DOM anchor;
- scrolling the message into view with reduced-motion-aware behavior;
- focusing the message when appropriate;
- setting and clearing a temporary highlighted message id;
- returning a status when the message is not currently loaded.

Suggested shape:

```ts
type MessageJumpResult =
  | { ok: true; messageId: string }
  | { ok: false; messageId: string; reason: "not-loaded" | "missing-anchor" }

type JumpToMessageOptions = {
  block?: ScrollLogicalPosition
  updateUrl?: boolean
  focus?: boolean
}
```

Initial placement can be route-local inside `channel-client.tsx` or a small hook next to the chat route. Extract only when at least two surfaces use it. The minimap must call this primitive instead of duplicating DOM query and highlight logic.

## Component Shape

Recommended component:

```ts
type ConversationMinimapMarker = {
  id: string
  index: number
  sender: string
  senderType?: string | null
  time?: string | null
  preview: string
  isSaved?: boolean
  isTaskLinked?: boolean
}
```

Possible file placement:

- `frontend/components/conversation-minimap.tsx` if this becomes reusable.
- `frontend/app/chat/[channel]/conversation-minimap.tsx` if it remains chat-specific.

Given the current branch churn, start route-local unless another surface immediately needs it.

## Behavior

- Build markers from the currently loaded root `messages`.
- Render no minimap below a threshold, for example fewer than 12 messages.
- Use message IDs as stable anchors.
- Click/focus action:
  - call the shared message jump primitive;
  - preserve the same jump/highlight behavior used by deep links and other message references.
- Use `IntersectionObserver` on visible message nodes to update the active marker. Avoid heavy scroll handlers.
- For MVP, distribute marker positions by message index. This avoids measuring dynamic markdown heights and keeps the component deterministic.
- If later needed, add an offset-based mode using `offsetTop / scrollHeight`.

## Preview Card

The preview card should be a fixed-position or portal-rendered element so it is not clipped by the scroll container.

Content:

- compact sender label;
- compact timestamp;
- preview text clamped to 2-3 lines;
- optional small saved/task badges.

Style:

- SmallKhoj product language: square card, ink border, sand surface.
- No soft shadow. If depth is needed, use the established hard offset shadow token/class.
- Keep the card narrow enough that it does not cover the message being inspected.

## Motion

Motion is state communication only:

- marker expands/fills on hover/focus;
- active marker has stronger contrast;
- preview card fades/translates in 150-200ms;
- clicked target message gets a brief background pulse.

Reduced motion:

- no smooth scroll;
- no pulse animation;
- preview appears/disappears instantly or with a simple opacity transition.

## Accessibility

- Markers are buttons with `aria-label`, for example: `Jump to message 14 from Alice`.
- Preview content should not be the only accessible label; the button label must stand alone.
- Keyboard focus should show a clear focus ring using existing focus token/style.
- The minimap should not trap focus.

## Compatibility

- Preserve existing message deep-link behavior in `channel-client.tsx`.
- Replace or wrap the current ad hoc `document.querySelector(...).scrollIntoView(...)` path with the shared message jump primitive.
- Do not change the message API contract in the first implementation.
- Do not assume all content is plain text; markdown should be summarized as plain text for preview.
- Avoid adding new backend dependencies.

## Risks

- Long markdown responses can make index-based spacing less visually exact.
- Hover preview can be clipped if rendered inside an overflow container.
- Scroll synchronization can become expensive if implemented with raw scroll handlers.
- Frontend branch drift may move chat layout; implementation should re-check current branch before editing.

## Rollback

This should be additive. If problems appear, hide the component behind the message-count threshold or a local feature flag without changing message rendering.
