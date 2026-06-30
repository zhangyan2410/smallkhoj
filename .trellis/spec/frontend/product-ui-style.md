# Product UI Style

> SmallKhoj frontend visual identity: "sunlight through mid-ocean water + warm sand",
> expressed with a handcraft ink-border language. This spec overrides any older note
> that said "avoid black borders / brutalism" — that guidance predates the Croodles
> avatar + raft-style decision below.

---

## Visual Identity

SmallKhoj reads as a **calm, handcrafted** product workspace with three signature
materials:

1. **Water (the icon rail)** — a real generated water texture (`rail-water-texture.png`)
   with sunlight-shaft + caustic ripples. The rail is the only place water appears.
2. **Warm sand (list column + main area)** — `--sand` / `--sand-deep` / `--sand-card`.
   Calm, warm, the canvas for content.
3. **Ink handcraft borders** — `--ink` (`#111827`), shared with the Croodles avatar
   stroke. Straight corners, 2px hard borders, offset hard shadows. This is the
   "made by hand, not by template" signal.

The brand accent is **mid-sea blue** (`--primary`, hue ~210) — used sparingly on
primary buttons, links, focus rings. Never purple (hue 250-265 is forbidden).

### Future theme: water-ink / Shui-mo

The user clarified that the desired monochrome direction is **not black-and-white**.
It should be a deliberate **water-ink (水墨) product theme**: rice paper, layered
ink wash, handmade edges, and a small amount of seal/mineral accent. This is a
future frontend implementation direction, not an accidental fallback for missing
tokens.

Design intent:

- The app should still feel like a practical work tool. Ink-wash is the material
  language, not a decorative landing-page treatment.
- The physical scene is a handmade operating desk: xuan-paper surface, damp ink
  settling into paper fibers, blue-black text, and one restrained cinnabar seal
  accent for important state.
- Preserve the current handcraft frame language. Square ink borders and hard
  offset shadows can remain, but the surfaces around them should feel like paper
  and wash, not plain gray UI.
- Use real or generated bitmap texture for paper/ink material if texture is
  needed. Do not fake it with sketchy SVG doodles, diagonal stripes, or gradient
  blobs.

Required palette qualities:

- **Paper base:** warm xuan-paper off-white with a faint green/yellow mineral
  undertone; never pure white.
- **Ink text:** deep blue-black or soot ink; never browser black as the only
  identity.
- **Ink wash surfaces:** several low-chroma wash layers for sidebars, selected
  rows, hover, and panels. These should vary by lightness and chroma, not by
  generic grayscale steps.
- **Cinnabar accent:** restrained red/orange-red for critical emphasis, current
  selection accents, or confirmation marks. Use sparingly, like a seal stamp.
- **Mineral accent:** muted blue-green or green-gray may support runtime/member
  categories. It should feel like mineral pigment beside ink, not SaaS teal.

Implementation contract for the future frontend agent:

- Add the theme as an explicit class such as `.theme-ink` and persist selection
  with `localStorage.theme = "ink"` or an equivalent user preference.
- Keep the existing water+sand identity available unless the product decision is
  to replace the default theme. Do not silently overwrite the default with an
  incomplete grayscale theme.
- Override the same tokens used by the app today: `--background`,
  `--foreground`, `--card`, `--sand`, `--sand-deep`, `--sand-card`, `--paper`,
  `--paper-ink`, `--sand-ink`, `--sand-muted`, `--sand-border`, `--ink`,
  `--primary`, `--ring`, `--accent-*`, and status tokens.
- Define project utility selectors in the `@layer components` design-system
  block, not as loose selectors that Tailwind/Next may omit from the compiled
  sheet.
- The icon rail may use an ink-wash material variant, or the existing water
  texture may be toned into ink wash with a deliberate CSS treatment. It should
  not look like a broken/disabled water image.
- Text contrast remains product-grade: body text >= 4.5:1 and important labels
  readable on all wash surfaces.
- Browser evidence must include the real app in the ink theme, with the server
  switcher/list/detail surfaces visible enough to prove it is not just token
  replacement.

Forbidden interpretations:

- Do not implement the theme as plain black text on white background.
- Do not implement it as a generic dark mode, desaturated grayscale, or missing
  CSS fallback.
- Do not cover the UI with decorative ink splashes that reduce scanability.
- Do not introduce purple-blue gradients, glass panels, soft SaaS shadows, or
  round-card redesigns under the name "artistic".

### What this replaces
Earlier guidance said "do not copy Slock's black-border brutalist style." That is
**superseded**: SmallKhoj now intentionally uses ink-black hard borders as its
signature, aligned with the Croodles avatar family. The rule that still holds:
no glassmorphism, no gradient text, no neon glow, no soft SaaS shadows.

---

## Border Language (handcraft ink-border)

This is the core visual rule. Every framed element follows it.

| Element | Border | Radius | Shadow | Source |
|---|---|---|---|---|
| Card / dialog / modal panel | `2px solid var(--ink)` | `0` (square) | `2px 2px 0 var(--ink)` (hard offset) | `<Card>`, `.sk-panel-raised` |
| Info block / message bubble | `2px solid var(--ink)` | `0` | none (dense, no noise) | `<Panel>`, `.sk-panel` |
| Button | `2px solid var(--ink)` | `0` | none; `hover` adds hard shadow | `<Button>` |
| Input / Select / Textarea | `2px solid var(--ink)` | `0` | none; `focus` border → `--ring` (mid-sea blue) | `<Input>`, `<Select>`, `<Textarea>` |
| Status pill | `1px solid var(--ink)` | `0` | none; filled status color bg | `<StatusPill>`, `.sk-status-*` |
| Small dot / status indicator | — | `rounded-full` (allowed) | none | `dotClass()` |

**Principles**:
- Square corners everywhere except tiny dots.
- Borders express structure; do NOT pair border + soft shadow (the old "ghost-card").
- Hard shadows are offset-only (no blur) — they read as "paper cutout", not "floating glass".
- Avatar stroke (`#111827`, 3.5px in Croodles) and UI borders (`#111827`, 2px) share
  the same ink — this is the unified visual signature.

### Forbidden border/shadow patterns
- `rounded-lg` / `rounded-xl` / `rounded-md` on containers (use `rounded-none`).
- `shadow-sm` / `shadow-md` / `shadow-lg` / `shadow-xl` (soft SaaS shadows).
- `border + shadow-sm` pairing (ghost-card).
- `backdrop-blur` decorative glass.
- `bg-clip-text` gradient text.

---

## Color — Single Source of Truth

All colors are tokens in `globals.css`. Never hardcode a color in a component or page.

| Role | Token | Notes |
|---|---|---|
| Brand / primary | `--primary` (mid-sea blue ~210) | buttons, links, focus |
| Handcraft border | `--ink` (`#111827`) | all borders |
| Page background | `--sand` | main area, chat |
| List column | `--sand-deep` | three-column Col 1 |
| Card surface | `--sand-card` / `--card` | raised content |
| Text | `--foreground` / `--sand-ink` / `--muted-foreground` | |
| Status success | `--success` / `--success-fg` | |
| Status warning | `--warning` / `--warning-fg` | |
| Status info | `--info` / `--info-fg` | (same hue family as primary) |
| Status danger | `--danger` / `--danger-fg` | |

Status colors flow through `badgeClass()` / `dotClass()` / `StatusPill` only.
See `component-guidelines.md` for the single-source rule.

### Accent system (B/C dual-tone)

Functional/section colors use a **dual-tone** accent system. Each hue has two
variants so any usage is contrast-safe:

- **solid** (C, storybook) — high-saturation, paired with white text.
  Active tabs, active nav, selected items, primary chips.
- **soft** (B, watercolor) — low-saturation tint, paired with dark text.
  Inactive tabs, section backgrounds, count badges, role labels.

Tokens in `globals.css`: `--accent-<hue>`, `--accent-<hue>-fg`,
`--accent-<hue>-soft`, `--accent-<hue>-soft-fg`. Utility classes
`.sk-accent-<hue>{,-soft}`, `.text-accent-<hue>`, `.border-accent-<hue>`
are defined in the `@layer components` design-system block with `!important`
where they must override atom defaults. Do not rely on plain CSS selectors
outside Tailwind layers for these project utility names; Next/Tailwind v4 dev
builds can omit them from the generated sheet, which makes the app look like
the theme disappeared even though the tokens still exist.

| Hue | solid | soft | Semantic use |
|---|---|---|---|
| blue | C `#1e6fb8` | B mist `#5b9bc9` | chat, links, primary action |
| rose | C red `#d63838` | B rose `#d98a9e` | tasks, safety, saved, danger-emphasis |
| mint | — | B `#6fb89a` | members, runtime, memory |
| green | C `#2fa84f` | — | computers, files |
| purple | C `#6b4ba0` | B lav `#8a9bc9` | control, activity |
| yellow | C `#f2c12e` | — | accents only (no gold/amber) |

Functional assignments (so nav color = function color):
- **icon rail**: chat=blue, tasks=rose, members=mint, computers=green,
  control=purple, activity=mint (`.sk-rail-active-<accent>`).
- **chat tabs**: chat=blue, tasks=rose, memory=mint, files=green, activity=purple.
- **chat sidebar sections**: 关注=rose, 频道=blue, 私信=mint, 运行中=purple.

Rules:
- Don't mix `sk-cat-*` (category) with `sk-accent-*` (function) on the same role.
- Yellow is accent-only (highlight/warning tint); never a section/nav color.
- No amber/gold. The `cat-warning`/`--warning` status tokens cover warm states.
- To recolor the whole app, change only the `--accent-*` tokens.

### Forbidden colors
- Purple/blue-violet hues 250-265 (the old theme; user rejected).
- Tailwind palette literals: `bg-emerald-500`, `bg-amber-50`, `text-sky-700`,
  `border-rose-200`, etc. Use status tokens.
- `bg-white` as a surface (too cold against sand). Use `--sand-card`.

---

## Layout Conventions

### Three-column "Slack" mode (list-detail pages)
Pages with a list+detail structure (Tasks, Members, Computers, Chat) use
`<ProductShell list={...}>`:
- **Col 0 — icon rail** (water material, fixed `w-14`)
- **Col 1 — list column** (`bg-sand-deep`, resizable via `useResizablePanel`, width in localStorage)
- **Col 2 — main area** (`bg-sand`)
- **Col 3 — optional right sidebar** (detail/stats, `bg-sand-deep/60`)

### Single-column dashboard mode
Pages without a list (Home, Control, Settings, Daemon) omit the `list` prop.
`ProductShell` stays backward-compatible: no `list` = single column.

### Container rules
- Use `<Card>` for primary framed containers; `<Panel>` for borderless-density blocks.
- Do NOT nest cards inside cards. Use section headings + spacing, not border boxes.
- Keep controls stable in size; hover/status/counts must not shift layout.
- Full-width work areas, sidebars, tabs, split panes, tables — prefer these over hero sections.

---

## Interaction Conventions

- Icons for familiar actions; pair with tooltip/label when meaning isn't obvious.
- Tabs for alternate views, segmented controls for modes, toggles for binary, menus for option sets.
- One tab style app-wide (do not hand-roll a third tab variant per page).
- Critical backend mutations use native `<form action={serverAction}>` (see `quality-guidelines.md`).
- Empty/loading/error states must explain the state AND offer a next action, not just show gray text.

---

## Runtime / Observability Surfaces

- Activity, event, daemon, trace views are observability UI: summarize + link to evidence.
- Distinguish user-visible work (messages, assigned tasks) from telemetry (events, status).
- Runtime state labels: Working/Thinking/Output/Idle are activity; messages/tasks are work.
- Never let self-authored runtime activity look like a new inbound message.

---

## Memory & Recovery Surfaces

- Channel Memory and Task Recovery are post-compaction recovery surfaces, not debug dumps.
- Group memory by product meaning (channel knowledge, task outputs, proposals), not one flat list.
- Task Recovery: show brief, plan, progress, output/evidence, summary, breakdown, provenance.
- Artifacts render as typed viewers (image previews, `<video controls>`, labeled evidence rows).
- Show version/hash compactly for audit; do not let hashes dominate hierarchy.

---

## Evidence Expectations

For browser-facing work, final evidence shows the actual visible product surface,
not only curl/DB rows. Use `project-webdriver-cli` (`./twd`) for the browser portion;
cross-check API/DB/trace only when those layers matter.
