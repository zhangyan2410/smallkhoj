# Inkframe Product UI Refactor

## Goal

Make Inkframe the default SmallKhoj product UI language for the product
workspace. The demo is no longer an isolated experiment: its clean paper/desk
background, object metaphor, and WebGL material engine become the foundation for
the real app.

This refactor must preserve product usability. Inkframe is a working desk
material system, not decorative water/ink noise. The result should feel like a
handmade AI collaboration workbench: messages, tasks, evidence, reviews, and
runtime actions are physical objects on paper; WebGL ink/water is a first-class
material capability; the UI remains readable, fast enough, and usable on mobile.

## Product Position

The new direction replaces the current default frontend style if it succeeds.
Do not maintain three long-lived themes or hide the new work behind a decorative
"experimental skin". A fallback is allowed only for capability constraints:
WebGL unavailable, reduced motion, low-power/mobile constraints, or test
isolation. The fallback must still use the same Inkframe object language through
static paper/ink snapshots.

## In Scope

- Global product background refactor: every product page should sit on the
  Inkframe desk background by default, with the ability to activate/render the
  background material where the shell allows it.
- Real SmallKhoj `chat` page visual and interaction refactor.
- Real SmallKhoj `tasks` page visual and interaction refactor.
- Shared Inkframe component/object vocabulary for chat/task and future pages.
- Integration of the validated WebGL material demo into reusable frontend code.
- Clean demo background adoption: dry paper / xuan-paper desk instead of pink or
  dirty washed background.
- Background image readiness:
  - background can later receive imported images and turn them into material;
  - imported background images must use the same visual/restore/source resource
    model as the demo;
  - foreground content must remain readable over image/material backgrounds.
- WebGL material engine support for:
  - interactive desk/background painting;
  - water injection;
  - image-to-ink import with improved fidelity;
  - keep/collapse and re-render restore;
  - static visual snapshots;
  - source-color restore for imported images;
  - viewport-correct static desk layer.
- Chat message redesign:
  - readable message paper;
  - short messages may have slight handmade angle;
  - long messages stay stable;
  - message actions hidden by default and shown near the message;
  - task messages remain normal messages with future navigation, not embedded
    task panels;
  - mentions, paths, code, timestamps, author metadata, and paragraphs remain
    legible.
- Task page redesign:
  - Task Material Surface;
  - Evidence Surface;
  - Review Markup;
  - state transitions expressed through material language where practical.
- Mobile layout for chat/task:
  - no overlapping buttons;
  - composer remains usable;
  - sidebars collapse predictably;
  - WebGL interaction does not steal scroll unintentionally;
  - static fallback is acceptable on mobile if needed.
- Previously recorded design debts that affect chat/task:
  - background color mismatch after desk keep/restore;
  - pink/dark dirty background;
  - action toolbar detached from short messages;
  - unread/event indicator plan for channel/DM/thread messages;
  - avatar frame direction: default option B, no stamp on avatar, status dot not
    obstructed;
  - component vocabulary alignment for member/sidebar/chat items where touched
    by chat refactor;
  - React Markdown `<marker>` tag issue must not regress if message rendering is
    touched.
- Previously created Trellis task `07-02-chat-event-unread-indicators` is part
  of this refactor scope. The chat unread/event work should be implemented with
  the new sidebar/message object primitives instead of as a separate visual
  patch.
- Previously created Trellis task `07-04-ink-material-card-restore-resource` is
  part of this refactor scope as the material-runtime prerequisite. Its resource
  lifecycle, restore, image-fidelity, and tests should be preserved when
  productizing the material runtime.

## Out of Scope For This Task

- Full object-language refactor of `members`, `computers`, `settings`, and
  `control` pages. They should receive the global Inkframe background, and may
  receive shared tokens/components if needed, but the full object acceptance
  target is chat + tasks.
- Backend persistence for ink images.
- IndexedDB persistence.
- Cross-browser or cross-restart restoration of ink state.
- A complete public drawing application.
- Global "everything is editable WebGL" behavior.
- Long-lived multi-theme architecture.

## Product Decisions

- Every product page gets the Inkframe desk background as the default visual
  foundation.
- Chat and task are the first real product surfaces with full object-level WebGL
  material interactivity.
- WebGL is a core material system, not a minor decorative layer.
- Runtime model must be engineered: do not create one permanent WebGL context
  per message/card/task. Use active surface + snapshot/restore mechanics.
- The demo's improved background and material behavior is the baseline visual
  direction.
- Image-to-ink must preserve source color and visual clarity better than the
  first single-channel restore path.
- Background-to-ink must preserve page tint and viewport positioning. Rendering
  or keeping the background must not accidentally turn the page into chat-card
  paper tint.
- Mobile is not optional; it is part of the refactor definition.

## User Experience Requirements

### Global Background

- All main product routes should inherit a clean Inkframe desk background.
- The background must be capable of WebGL activation/rendering by default, but
  implementation may expose editing controls only where product UX allows them.
- Static view must still look like the same material; no route should fall back
  to the old pink/dark/dirty background.
- A kept background must display through a fixed viewport layer, not `body`
  document-height background painting, so it does not shift or scale when the
  page scrolls.
- Background tint is an owner-level property:
  - app desk/background uses desk tint;
  - message/card surfaces use paper tint;
  - task/evidence/review surfaces may define their own tints;
  - keep/restore must not mix these tints.
- Future background images must be planned for:
  - image import becomes material through source/restore/visual resources;
  - text-bearing foreground surfaces need enough opacity/contrast over image
    backgrounds;
  - background images must not compete with product content;
  - mobile must avoid heavy always-on background interaction.

### Chat

- The first viewport is the actual chat workspace, not a landing page or
  explanation surface.
- The chat background reads as clean dry paper/desk material.
- Messages are object-like paper pieces, not generic cards.
- Short messages can tilt subtly; long messages must not be steeply tilted.
- Hover motion means "this object can be moved or acted on" only when that is
  true. Decorative hover motion is not allowed.
- Message actions are hidden by default and appear adjacent to the message,
  preferably in the author/tool strip area or aligned to the message top edge.
- Typography must improve paragraph scanning for long agent output:
  - clear paragraph gaps;
  - code/path treatments;
  - readable mentions;
  - timestamps and metadata secondary but accessible.
- Thread/task references inside chat remain normal messages in this task. Future
  navigation can be added after the object model stabilizes.
- Channel/DM sidebar items should use shared "sidebar entity item" vocabulary
  with hover/active/unread states, not divergent bespoke list items.

### Tasks

- Task items are task tickets, not the same paper as chat messages.
- Evidence surfaces have a distinct material treatment from task tickets and
  memory notes.
- Review markup keeps the stamp/annotation feeling where it is useful, but
  stamps must not be applied blindly to avatars or unrelated controls.
- State changes should be represented with restrained material behavior:
  - review = more pronounced / marked;
  - done = settled/faded/solidified;
  - blocked = denser/darker/held tension;
  - running = active wet/ink flow only where it helps.

### WebGL Material

- The desk/background can be activated, painted, watered, kept, and re-rendered.
- The default app background is part of the material system, not a static CSS
  afterthought.
- After keeping desk/background, static display must match the rendered viewport
  coordinate system. It must not shift, scale against the document height, or
  change to chat/card tint accidentally.
- If desk/background tint is user-selectable or page-specific, keep/restore must
  preserve the selected tint and not collapse to the chat card tint.
- Image-to-ink import must support:
  - higher source texture fidelity than the dye grid;
  - visual snapshot for static display;
  - restore map for editable ink/fixed fields;
  - source image restore for color fidelity;
  - no pure-black degradation after keep/re-render.
- Static fallback must use the same visual snapshot/resource model.
- When background images exist, content legibility must be protected through
  surface tokens or a material overlay. Do not rely on arbitrary darkening that
  makes the page dirty.

### Chat Event / Unread Indicators

This task includes the existing `07-02-chat-event-unread-indicators` scope:

- Stop foregrounding total root-message counts such as `{count} 条根消息`.
- Channel and DM sidebar entities can show unread/event attention marks.
- Thread replies can mark the corresponding root message/thread affordance.
- Opening/viewing the channel, DM, or thread clears the attention state when the
  relevant content is visible.
- Use the new `SidebarEntityItem`, `EventBadge`, and message object language;
  do not add an unrelated notification style.
- If server-side read cursors are too large for this 12-hour pass, implement a
  clear local/read-cursor adapter and write the server-side persistence follow-up
  explicitly.

### Mobile

- At phone widths, chat must prioritize:
  - message list;
  - composer;
  - current channel/DM identity;
  - access to sidebar through drawer/tab/sheet.
- At phone widths, tasks must prioritize:
  - active task/ticket;
  - status/action controls;
  - evidence/review access through tabs or stacked sections.
- Canvas material interaction on mobile must be deliberate:
  - scroll should remain natural;
  - drawing/water mode should require an explicit tool/mode before pointer events
    capture the page;
  - reduced-motion / WebGL unavailable path should remain usable.

## Acceptance Criteria

- Chat and tasks use the Inkframe object UI as their default product appearance.
- All product pages use the clean Inkframe desk background by default.
- The app background can be activated/rendered and kept without tint drift.
- Demo background is integrated into product tokens/layout without pink or dirty
  washed background.
- Chat and task surfaces have no obvious overlap, clipped toolbar, or detached
  action row on desktop and mobile.
- WebGL material layer works in the real chat/task environment, not only in the
  static evidence demo.
- Background/desk keep then re-render preserves tint and position.
- Image-to-ink keep then re-render preserves color source and does not degrade
  into pure black ink.
- One active WebGL material surface per workspace region unless explicitly
  justified; no unbounded context growth.
- Static snapshots restore visual state when inactive.
- Mobile chat/task pass browser checks at representative widths.
- Existing auth/navigation/chat/task core flows still work.
- Chat unread/event indicators replace low-value message counts and align with
  the new object language.
- `message-cards-ink.test.html` or successor tests remain green for the material
  engine behaviors.
- The earlier `07-04` keep/restore/resource lifecycle assertions remain covered:
  re-render restores kept ink, restored ink is editable, discard clears private
  resources, and repeated keep does not grow per-card resource state.
- Real app browser evidence is collected with `./twd`; no screenshot-only claims.

## Non-Goals / Guardrails

- Do not imitate the demo by copying one-off CSS into pages. Extract reusable
  tokens, atoms, and product primitives.
- Do not make every page and every item tilt.
- Do not use WebGL as an always-on per-card context.
- Do not let artistic texture reduce readability.
- Do not let background images overpower foreground product objects.
- Do not put stamps or seals on avatars by default.
- Do not hide product facts behind material effects.
