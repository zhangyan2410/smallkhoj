# Inkframe Object Desk Product UI Refactor

## Goal

Replace the default SmallKhoj product surface with the Inkframe object-desk
language explored in the local demos. This is no longer a token-only experiment
or a third optional Shui-mo theme. The target product scene is:

> a working desk with xuan paper, inkstone, cinnabar seal, handwritten notes,
> evidence sheets, task tickets, and small desk tools arranged as reusable UI
> objects.

The branch should make the real frontend closer to the demo direction while
leaving enough component structure and tests that later agents cannot easily
drift back to route-local SaaS cards, dirty wet backgrounds, or decorative
one-off effects.

## Requirements

- **R1: Default product language changes.** The dry paper object-desk style must
  be present in the default app state. It must not depend on selecting a hidden
  or experimental theme first.
- **R2: Clean dry paper background.** The app background is a bright xuan-paper
  desk field. It must not be pink, dark, dirty, or a full-page wet ink wash.
- **R3: Shared primitives.** Object language belongs in reusable primitives and
  `globals.css` utilities, not route-local hand-rolled cards. Chat messages,
  tasks, evidence, reviews, memory notes, identity tags, runtime/computer
  surfaces, and entry surfaces must expose stable `data-slot` contracts.
- **R4: Page scope.** User-facing product pages are in scope: home, chat/DM,
  tasks, members, computers, settings, login, and join. Internal operator pages
  `/daemon` and `/control` are out of scope for this product-language pass.
- **R5: Rotation is local.** Only deliberately hand-placed micro objects may
  rotate: short chat slips, review stamps, and similar small accents. Long
  messages, sidebars, lists, task panels, composer, forms, and runtime/computer
  bases stay square and stable.
- **R6: Physical object metaphors.** Components should map to tangible desk
  objects rather than generic cards:
  - chat message = paper slip; short slips may tilt slightly, long slips stay
    stable.
  - message actions = small tools attached near the message, not a row pushed to
    the far right.
  - task = task ticket or working docket.
  - evidence = attached proof sheet.
  - review = cinnabar seal/markup stamp.
  - memory = fixed note.
  - member identity = name tag/signature card; agent identity = identity frame
    around the existing avatar, not a cinnabar stamp on the avatar.
  - computer/runtime = local inkstone/tool base, not a full-width bottom rail.
- **R7: Material restraint.** Cinnabar is reserved for seals or critical accents,
  not page tint. Wet/WebGL material effects are future local enhancements only;
  they must not flood the whole app background.
- **R8: Product usability.** The UI remains a practical workbench: readable text,
  stable layouts, accessible controls, no hidden action bars clipped by paper
  edges, no text overflow, and no decorative motion that obscures state.
- **R9: Guardrails.** Tests must protect the key contracts: one shell background
  owner, no broad rotation, no universal message clips, no legacy route-local
  Tailwind color blocks on user-facing product surfaces, and `/daemon`/`/control`
  excluded from the object-desk pass.
- **R10: Avatar state semantics.** Agent avatars already have a top-right status
  dot whose color changes with runtime/member state. The avatar frame must not
  place a cinnabar stamp, clip, or decoration over that status location.
  Structural paper-frame details such as a folded corner may exist only when
  they avoid the status corner, with left-top preferred for the fold. Review/
  approval stamps remain separate `ReviewStamp` objects, not identity decoration.
- **R11: Avatar prefab consistency.** Agent and human avatars must use the same
  `AvatarObject` prefab with different frame/content variants. The avatar body
  is not required to be a blue circle; fallback initials and generated avatars
  should fill the avatar tile/frame instead of appearing as a colored ball inside
  another box. Agent examples should use the real generated/avatar face content
  when available, not human-style initials as the default representation. Legacy
  blue avatar tint should be treated as replaceable visual debt, not as brand
  truth.
- **R12: Avatar content shape.** The avatar component is not constrained to a
  circular face. The current generated agent avatar uses a rounded-square SVG
  container (`rect` with radius), while some avatar art styles may draw a
  round/organic face blob inside it. The product target should avoid a default
  "square frame containing a separate round face/ball" look; agent face art
  should feel integrated with the avatar tile.
- **R13: Default avatar frame.** The default agent identity frame is option B
  from `evidence/avatar-border-options.html`: `identity-thin` / 轻身份框. It is
  a light identity frame, not a stamp. More expressive variants may be explored
  later, but they should start from this default unless the task explicitly asks
  for a different object metaphor.

## Non-Goals

- Do not spend design time polishing `/daemon` or `/control`; they are internal
  control/observability pages.
- Do not build a landing page or marketing hero.
- Do not reproduce the reference ink engine across the full app background.
  Engine/material work should remain local to future runtime/evidence objects.
- Do not keep the old "third Shui-mo theme" PRD as the source of truth. Existing
  theme mechanics may remain temporarily while the branch is in flight, but they
  do not define success for this refactor.

## Acceptance Criteria

- [ ] The branch exists and isolates the broad frontend refactor from `main`.
- [ ] Default app state renders the dry paper object-desk background.
- [ ] Home, chat/DM, tasks, members, computers, settings, login, and join use the
      shared object primitives where the object language applies.
- [ ] `/daemon` and `/control` do not import the object-desk primitives and are
      not used as acceptance evidence.
- [ ] Short chat messages may tilt, long messages and structural surfaces do not.
- [ ] Chat actions stay visually clustered with their message object.
- [ ] Task/evidence/review/memory surfaces are separate components/slots.
- [ ] Agent avatar frames preserve the existing status dot, do not cover it, and
      do not use cinnabar stamp marks as identity decoration.
- [ ] Agent and human avatar examples use the same `AvatarObject` path, and
      avatars do not render as a blue circular ball inside a square frame unless
      a real uploaded image is circular by itself.
- [ ] Agent avatar examples render generated/avatar face content rather than
      initials-only placeholders, except in explicit fallback/error examples.
- [ ] Avatar examples do not present "square frame + inner round face/ball" as
      the default target shape; agent face content fills or integrates with the
      avatar tile.
- [ ] The default agent avatar frame uses the `identity-thin` direction from the
      avatar border options reference.
- [ ] Computer/runtime surfaces read as local inkstone/tool bases, with no
      product-wide bottom bar.
- [ ] Browser smoke evidence confirms the real local app, not only static files.
- [ ] `npm run lint`, `npx tsc --noEmit`, and focused frontend tests pass.

## Current Reference Files

- `design.md` is the detailed product/design source of truth for this branch.
- `/Users/code/project/inkframe-demo/index.html`
- `/Users/code/project/inkframe-demo/task.html`
- `/Users/code/project/inkframe-demo/chat.html`
- `/Users/code/project/inkframe-demo/interactive-material-demo.html`
