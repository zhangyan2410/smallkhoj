# Chat conversation minimap navigator

## Goal

Add a lightweight conversation minimap to long SmallKhoj chat threads so operators can see conversation structure, preview historical turns, and jump to an earlier message without manually scrolling through the entire channel.

This is a planning-only task. Implementation should happen later on the frontend feature branch after the current branch UI work settles, not as a direct main-branch edit.

## Background

The operator referenced a Codex Desktop interaction pattern: a thin side rail with animated message markers, click-to-jump behavior, and a small hover card showing a truncated conversation turn. The requested SmallKhoj version should learn from that pattern but keep SmallKhoj's product/control-room identity.

Related upstream references:

- OpenAI Codex issue: "Codex Desktop: Add conversation turn navigator with jump-to-response support" — `https://github.com/openai/codex/issues/20651`
- OpenAI Codex issue: "In-thread conversation outline for long sessions" — `https://github.com/openai/codex/issues/15858`
- OpenAI Codex issue: "Conversation block-level navigation" — `https://github.com/openai/codex/issues/17536`
- Codex changelog for related long-thread/navigation fixes — `https://developers.openai.com/codex/changelog`

## Confirmed Local Evidence

- The Chat route already has a scroll container ref: `frontend/app/chat/[channel]/channel-client.tsx:282`.
- Existing deep-link jump to a message already uses `data-testid="message-${initialMessageId}"` and `scrollIntoView`: `frontend/app/chat/[channel]/channel-client.tsx:449`.
- The chat message list already has a stable container test id: `frontend/app/chat/[channel]/channel-client.tsx:1471`.
- Each rendered message already has a stable message anchor: `frontend/app/chat/[channel]/channel-client.tsx:1479`.
- The message frame already exposes sender, role, and time rendering structure: `frontend/components/message-frame.tsx:55`.
- Frontend visual style requires the SmallKhoj sand/ink product language, not Codex's pure white minimalism: `.trellis/spec/frontend/product-ui-style.md`.

## Product Requirements

- **R0: Message jump foundation.** Before building the minimap UI, the frontend needs a reusable bottom-layer capability for jumping to a specific message by id. The minimap, file/message references, task source links, search results, saved messages, and future conversation outline should all call the same primitive instead of each feature hand-rolling DOM lookup and scroll behavior.
- **R1: Long-thread navigation.** Users must be able to jump to a previous chat message from a compact side rail.
- **R2: Preview before jump.** Hovering or focusing a marker must show a compact preview with sender, time, and truncated content.
- **R3: Active position.** The minimap must show which message or turn is currently near the viewport.
- **R4: Preserve existing deep links.** Existing `?message=<id>` navigation must continue to work.
- **R5: Product-safe motion.** Motion should communicate hover, active, and jump state only. It must be subtle, 150-250ms, and respect `prefers-reduced-motion`.
- **R6: No short-thread noise.** The minimap should appear only when it adds value, for example above a message-count threshold.
- **R7: Mobile-safe behavior.** The minimap should hide or collapse on narrow screens instead of crowding the message list.
- **R8: Branch-safe delivery.** This should be implemented later on the active frontend branch; main should only carry this planning task for now.

## UX Requirements

- Message jump should be available as a consistent behavior before the minimap exists: given a message id, the UI should scroll to the message, focus it when appropriate, and briefly highlight it.
- Message jump should handle unavailable messages gracefully, for example when a message is not loaded in the current limited page of history.
- Place the minimap in or near the chat message scroll area, not in the global navigation rail.
- Markers should be thin horizontal ticks, visually similar to the Codex reference but adapted to SmallKhoj's tokens.
- Marker variants should distinguish at least:
  - human/member message;
  - agent/assistant message;
  - current viewport message;
  - saved or task-linked message if that metadata is already available without extra backend calls.
- Hover/focus preview should include:
  - sender name;
  - compact timestamp when available;
  - 1-3 line content excerpt;
  - optional badge for saved/task-linked messages.
- Clicking a marker should scroll the corresponding message into view and briefly highlight it.
- Keyboard access must exist: markers should be buttons or equivalent focusable controls with useful labels.

## Non-Goals

- Do not build a full conversation search UI in the first iteration.
- Do not implement block-level navigation inside one markdown response in the first iteration.
- Do not fetch older history pages unless the current chat API already supports it cleanly.
- Do not redesign the whole chat layout.
- Do not copy Codex visual styling directly.

## Acceptance Criteria

- [ ] A reusable message jump primitive exists for chat surfaces: given a message id, it scrolls the message into view, focuses it when appropriate, and applies a temporary highlight.
- [ ] Existing message deep-link behavior and any current in-page message references use or remain compatible with that message jump primitive.
- [ ] Missing/unloaded message ids fail gracefully with an actionable state rather than a silent no-op.
- [ ] Long chat threads display a compact conversation minimap on desktop.
- [ ] Short chat threads do not show an unnecessary minimap.
- [ ] Hovering/focusing a marker shows a preview card with sender, time, and truncated content.
- [ ] Clicking a marker scrolls to the exact message and briefly highlights it.
- [ ] Current viewport message is reflected in the minimap active marker.
- [ ] Existing `?message=<id>` deep-link behavior still works.
- [ ] The minimap respects `prefers-reduced-motion`.
- [ ] The minimap is hidden or collapsed on mobile/narrow layouts.
- [ ] Implementation uses SmallKhoj frontend tokens/components and does not introduce soft SaaS shadows, rounded card styling, gradient text, or decorative motion.
- [ ] Browser-facing verification uses the project WebDriver wrapper `./twd`, with evidence for hover preview, click jump, active marker, and mobile hiding.

## Open Questions

- Should the message jump foundation load older history when the target message is not in the current `limit=50` payload, or only report that the target is not loaded? Recommended first pass: report/not-load gracefully; history pagination can be a follow-up.
- Should the first implementation use index-based marker spacing, or DOM-offset-based marker spacing? Recommended MVP: index-based for stability, then refine if long responses make spacing misleading.
- Should the click update the URL `?message=<id>` immediately, or only scroll in-place? Recommended MVP: scroll in-place first, then add URL sync in a later pass.
