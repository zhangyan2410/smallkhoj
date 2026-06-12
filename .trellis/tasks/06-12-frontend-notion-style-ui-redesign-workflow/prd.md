# Frontend "Fresh Ocean" UI Redesign Workflow

> Task dir is named `...notion-style...` for historical reasons; the chosen direction is **Fresh Ocean** (beach-inspired blue), not Notion warm-white.

## Goal

Establish a **repeatable, token-driven workflow** that lets a backend engineer (who doesn't write CSS) steadily improve the SmallKhoj frontend toward a polished **"Fresh Ocean" aesthetic** — beach/ocean-inspired, airy light surfaces with a vivid cobalt-blue accent and restrained gradient moments. The deliverable is BOTH a documented workflow AND its first concrete application (tokens + avatar system + 3-column chat layout), so future UI work becomes "pick from options" rather than "hand-tune CSS".

## Reference & Direction (from user)

Two reference images in `D:\kimi-work\`:
- `kimi-参考图.jpg` — earlier Kimi-built chat UI. We **adopt its layout skeleton** but **reject its execution of color** (oversaturated teal slab).
- `灵感图片.jpg` — the **beach inspiration** the user actually wanted: vivid cobalt sky → turquoise sea → pale clear shallows → sandy white. The user wants this cyan-blue gradient feel "done beautifully".

### Why Kimi looked bad (root cause)

The inspiration photo is ~70% **bright, airy light** (clear shallow water); the saturated blue is only the top-third sky. Kimi **inverted the ratio** — painted the entire sidebar in a high-saturation teal gradient → loud and dated. Correct translation: big surfaces stay light/airy; vivid blue is an **accent + small gradient moments** only.

### "Fresh Ocean" palette (extracted from 灵感图片.jpg via PIL sampling)

Preview swatch generated at `D:\kimi-work\palette-preview.png`.

**User constraint (IMPORTANT): NO large blue surfaces.** Big areas (app bg, sidebar, panels, cards) stay **near-white / very light neutral**. Blue appears ONLY on small accents (active nav item, primary button, links, unread badge) and tiny gradient moments (logo mark). Colors here are **provisional — to be tuned live after the app runs** ("后续颜色我们再调"), so the token layer is the single tuning lever.

- **Primary accent** — cobalt `#2c6ad0` (H217 S78); hover `#1f57b8`; soft `#6591e6`. Small areas only.
- **Surfaces** — app bg near-white `#fbfcfe`; sidebar very light `#f6f8fb` (barely-tinted, NOT saturated); panel/hover `#eef2f7`; cards pure white. Airy, lots of whitespace.
- **Muted** — cool grey `#9fb3c9` for secondary text/borders.
- **Ink** — `#0f1a2b` text.
- **Gradient moment** — cobalt→sky, used ONLY on the logo mark (and maybe login hero). NOT on sidebar or any large surface.
- Dark mode: deep ocean-navy surfaces + same cobalt accent (to be derived).

### Layout skeleton to adopt (CONFIRMED: Slack 3-column + icon rail)

- **Col 0 — icon rail** (narrow): global nav icons (search/chat/notifications/saved) + settings/profile at bottom.
- **Col 1 — channel sidebar**: workspace title, Activity/Saved, CHANNELS list, DIRECT MESSAGES list (with colored initial avatars).
- **Col 2 — message area** (center): conversation header (avatar + online status), Chat/Tasks/Files tabs, message stream, composer at bottom.
- **Col 3 — right context panel**: contextual content — members / thread / files / task details. (Chat already has thread + members panels that toggle here; keep/refine.)

## What I already know (from repo inspection)

- Stack: Next.js 16, React 19, **Tailwind v4**, **shadcn**, `@base-ui/react`, `lucide-react` icons.
- `app/globals.css` already has a **full design-token system**: oklch color tokens, light + `.dark` themes, radius scale (`--radius` = 0.5rem with sm→4xl multipliers), sidebar tokens, chart colors, plus a `.markdown-body` component layer.
- Current palette is **blue/cyan** (oklch hues ~218–231) but oversaturated and applied to large surfaces. Target "Fresh Ocean" keeps blue but moves it to accent-only with airy light surfaces.
- App shell: `components/product-shell.tsx` — fixed sidebar (13.5rem) + content grid, nav via lucide icons. Reused across pages.
- Pages: `app/{chat,computers,daemon,dm,login,members,settings,tasks}` + `app/page.tsx` (search/activity home).
- Components: `markdown-message`, `message-composer`, `product-create-panel`, `product-shell`, `product-ui`; `components/ui/` only has **button, card, input, scroll-area** (missing avatar, badge, dialog, tabs, etc.).

## Gaps discovered (the "why it looks bad")

1. **No font is actually loaded.** `--font-sans` is referenced in `@theme` but never defined via `next/font`; app falls back to browser default sans. → flat, generic feel.
2. **No avatar system.** Member/message avatars are ad-hoc inline color blocks (`size-8 bg-primary`, etc.), inconsistent across pages. No deterministic avatar (initials/generated).
3. **Token application is inconsistent.** Pages hardcode one-off colors (e.g. `bg-sky-50 border-sky-200`) instead of always going through semantic tokens → no single lever to restyle.
4. **Palette mis-applied.** Bluish cool tokens are fine in hue but too saturated and used on large fills instead of as accents.

## Assumptions (to validate)

- We restyle by **editing the existing token layer**, not introducing a new CSS framework (shadcn + Tailwind v4 stays).
- "Workflow" should be captured as a doc/spec the user can re-run for each future page, with me (Claude) doing the CSS.
- Dark mode parity is maintained (existing `.dark` block stays in sync).

## Open Questions

- (Q1) Workflow deliverable form — see Q&A below.

## Requirements (evolving)

- R1: Define a "Fresh Ocean" **color token palette** (airy light-blue surfaces + cobalt accent, extracted from the beach photo) for light + dark, replacing current cool blue tokens in `globals.css`. Remove the teal gradient / cyan tint; introduce restrained gradient only at logo/header/login.
- R2: Load a proper **sans font** via `next/font` (e.g. Inter) and wire `--font-sans`.
- R3: Build a reusable **Avatar system** (deterministic initials + hashed soft color) and adopt it everywhere members/users render (sidebar DMs, message author, conversation header).
- R4: Rebuild the **Chat page as the 3-column reference** (icon rail + channel sidebar + message area + right context panel) using the new tokens, spacing, radius, and avatars.
- R5: Capture the above as a **repeatable workflow document** so future pages follow the same 5-step process.

## Acceptance Criteria (evolving)

- [ ] `globals.css` palette reads as airy light-blue "Fresh Ocean" in light mode; no teal slab / oversaturated fills; dark mode stays coherent.
- [ ] A sans font (Inter) is loaded via `next/font` and visibly applied across the app.
- [ ] An `Avatar` component exists (initials + deterministic soft color) and is used in chat sidebar DMs, message authors, conversation header, and members panel.
- [ ] Chat page renders as 4-region layout: icon rail + channel sidebar + message area + right context panel (thread/members), all using new tokens.
- [ ] Chat page reviewed via screenshot against the Fresh Ocean target; dark mode visually checked.
- [ ] A workflow doc exists describing the 5 steps + how to apply tokens to future pages.

## Technical Approach

- **Tokens (R1):** edit `app/globals.css` `:root` + `.dark` oklch values → airy light-blue surfaces + cobalt accent (Fresh Ocean palette). Keep token names; only change values so all token-consuming components restyle automatically. Replace hardcoded one-off colors found in chat (`bg-sky-50 border-sky-200`, `bg-sidebar/80`, `bg-muted/30`) with semantic tokens.
- **Font (R2):** add `next/font/google` Inter in `app/layout.tsx`, expose CSS var, point `--font-sans` at it.
- **Avatar (R3):** new `components/ui/avatar.tsx` — zero-dep, initials from name + hashed soft background color from an ocean-muted palette; size variants. Replace ad-hoc avatar blocks in `channel-client.tsx`.
- **Chat 3-column (R4):** chat already has channel sidebar + message area + right thread/members panel in `channel-client.tsx`. Work = (a) add col-0 icon rail (extract a shared rail or reuse `product-shell` nav), (b) restyle all regions with new tokens + spacing/radius, (c) wire Avatar everywhere.
- **Workflow doc (R5):** capture the 5-step process (pick reference → lock tokens → font → avatar/components → screenshot review) as a doc the user re-runs per page. Location TBD (likely `frontend/docs/ui-workflow.md` or a `.trellis/spec` entry).
- **Review loop:** screenshot via Playwright or kimi-webbridge → compare against `kimi-参考图.jpg` recolored target.

## Decision (ADR-lite)

**Context:** Backend-engineer user finds current cool-blue UI unattractive; supplied a Kimi-built chat reference with good layout but oversaturated teal colors; wants a 3-column chat and a repeatable process.
**Decision:** Keep shadcn + Tailwind v4. Restyle via the existing token layer (Fresh Ocean palette: airy light-blue surfaces + cobalt accent + restrained gradient), add Inter font, add a deterministic Avatar component, and rebuild the Chat page as the 4-region (rail + sidebar + messages + context panel) reference. Document the process as a reusable workflow.
**Consequences:** One-time token edit restyles most components globally (low risk, high leverage). Chat is the proof page; other pages follow later via the workflow (out of scope here). Hardcoded colors must be hunted down and tokenized or they won't follow the theme.

## Implementation Plan (small PRs)

- **PR1 — Tokens + Font foundation:** recolor `globals.css` to Fresh Ocean palette (light + dark), load Inter via `next/font`, wire `--font-sans`. Screenshot-check existing pages don't break.
- **PR2 — Avatar system:** add `components/ui/avatar.tsx` (initials + hashed soft color), adopt in chat sidebar DMs / message authors / header / members panel.
- **PR3 — Chat 3-column reference:** add icon rail, restyle all chat regions with tokens + spacing/radius, polish to Fresh Ocean target, screenshot review (light + dark).
- **PR4 — Workflow doc:** write the reusable 5-step UI workflow doc.

## Definition of Done

- Lint / typecheck / build green.
- **Review method (per user): NO screenshots.** When implementation is done, start the dev services; user reviews the running app manually and we tune colors live afterward.
- Local DB may need a one-time clear (stale old data) — **confirm with user before wiping**, do not auto-clear.
- Dark mode coherent.
- Workflow doc committed.

## Out of Scope (explicit)

- Replacing the component framework (staying on shadcn + Tailwind v4).
- Redesigning every page in this task (only tokens + avatar + 1 reference page; rest follow later via the workflow).
- Backend / API changes.

## Technical Notes

- Token entry point: `app/globals.css` `:root` and `.dark`.
- Color generation: prefer a tool-driven palette (e.g. shadcn theme generator / tweakcn / oklch picker) so values are reproducible, not hand-guessed.
- Avatars: candidate libs — `boring-avatars`, `@dicebear/core`, or pure initials+hashed-color (zero-dep). To decide via research.
- Font: `next/font/google` Inter (or Geist, already referenced via `--font-geist-mono`).
- Review loop: Playwright screenshots already available; can use screenshot → compare against reference.
