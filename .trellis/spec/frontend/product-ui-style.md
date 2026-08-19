# Product UI Style

> SmallKhoj frontend visual identity: **dry xuan-paper object desk** (Inkframe language).
> Revised 2026-08 to match the shipped code (`globals.css`, `theme-switcher.tsx`,
> `app-rail.tsx`) and the completed `06-30-ink-wash-theme-exploration` decisions.
> Where this file disagrees with `DESIGN.md`, this file wins; update `DESIGN.md` to match.
> Where this file disagrees with the code, the code is examined first — either the code
> is debt listed in §Known Debt, or this spec is wrong and must be fixed in the same PR.

---

## Visual Identity

SmallKhoj reads as a **bright working desk** with three signature materials:

1. **Dry xuan paper (the desk)** — `--paper` `#f6f1e2` with the faint fiber/grid
   `--desk-paper-bg`. Warm off-white with a mineral undertone; never pure white,
   never pink, never a full-page wet ink wash.
2. **Warm soot ink (structure)** — `--ink` `oklch(0.205 0.028 78)`. All text and all
   2px hard borders share this ink. Straight corners, offset hard shadows. This is
   the "made by hand, not by template" signal, unified with the Croodles avatar stroke.
3. **Cinnabar seal (restraint accent)** — `--cinnabar` `oklch(0.50 0.17 32)`.
   Reserved for seals, review stamps, and critical emphasis. Never a page tint.

The product surface has three layers, and each layer has different freedom:

| Layer | Content | Freedom |
|---|---|---|
| Desk environment | global background (`--desk-paper-bg`) | none — clean, bright, no state color, no wet ink |
| Working sheets | shell, list column, main area, sidebars (`--sheet-paper-bg`) | subtle paper depth only; square and stable |
| Hand objects | messages, evidence, review stamps, task tickets, attachments, runtime material | personality lives here: short slips may tilt, stamps act, hover may lift a sheet |

### What this replaces

- The 2026-06 "sunlight through water + sand" direction (mid-sea blue light-first
  with glow halos) is **superseded**; `--primary` keeps a restrained mid-sea blue
  only as a legacy brand accent on primary buttons/links/focus.
- The water-texture icon rail (`rail-water-texture.png`) is **removed**. The rail is
  now a paper binding spine (`.sk-rail-bg`: `--sand-deep`/`--paper` mix, ink edge,
  stitch line). No water imagery anywhere in the app chrome.
- The old "future `.theme-ink` / `localStorage.theme='ink'`" contract never shipped
  and is void; the real theme contract is below.

---

## Theme System (actual implementation)

`components/theme-switcher.tsx` offers three themes, persisted via `localStorage.theme`:

| Theme | `<html>` class | localStorage | Character |
|---|---|---|---|
| `water` (default) | none | `null` (key removed) | Default desk: dry paper + ink + full B/C six-hue accent system |
| `dark` | `.dark` | `"dark"` | Blue-gray dark (not pure black); brand hue 215 lifted one step |
| `shuimo` | `.shuimo` | `"shuimo"` | Bright sheng-xuan paper + warm soot ink + cinnabar; accents stay readable as low-chroma "color through ink" (indigo 255 / dai-purple 290 / cinnabar 32 / moss 150 / amber 74) |

Rules:

- SSR snapshot is always `water`; hydration-safe switching uses
  `useSyncExternalStore`. Do not add theme reads inside effects.
- Naming debt is acknowledged: the default theme is called `water` for historical
  reasons while its content is the paper desk. Renaming is a compatibility change
  (switcher + storage migration + settings copy) — do it completely or not at all.
- `.shuimo` must keep accent hues **distinguishable** (the "color through ink"
  rule). Pressing all six accents to plain ink was tried and reverted; do not
  reintroduce it.

---

## Border Language (handcraft ink-border)

Verified against `components/ui/{card,button,input,dialog}.tsx` — this is the
current code, not an aspiration.

| Element | Border | Radius | Shadow |
|---|---|---|---|
| Card / dialog / modal panel | `2px solid var(--ink)` | `0` (square) | `2px 2px 0 var(--ink)` hard offset (`sk-hard-shadow`) |
| Info block / message bubble | `2px solid var(--ink)` | `0` | none (`.sk-panel`) |
| Button | `2px solid var(--ink)` | `0` | none; hover adds hard shadow / 1px lift |
| Input / Select / Textarea | `2px solid var(--ink)` | `0` | `focus` border → `--ring` |
| Status pill | `1px solid var(--ink)` | `0` | none; filled status color bg |
| Small dot / status indicator | — | `rounded-full` (allowed) | none |

**Principles**:
- Square corners everywhere except tiny dots. Rotation is a local property of
  hand-placed micro objects (short chat slips, stamps, tape) — never of sheets.
- Hard shadows are offset-only (no blur) — "paper cutout", not "floating glass".
- `--radius: 0.875rem` remains in `:root` only as shadcn compatibility residue.
  Product atoms are `rounded-none`; new code must not build rounded containers
  from `--radius`.

### Forbidden border/shadow patterns
- `rounded-lg` / `rounded-xl` / `rounded-md` on containers (use `rounded-none`).
- `shadow-sm` / `shadow-md` / `shadow-lg` / `shadow-xl` (soft SaaS shadows).
- `border + shadow-sm` pairing (ghost-card).
- `backdrop-blur` decorative glass.
- `bg-clip-text` gradient text.

---

## Color — Single Source of Truth

All colors are tokens in `globals.css`. Never hardcode a color in a component or page.

### Core surface tokens

| Role | Token | Current value | Notes |
|---|---|---|---|
| Paper / page background | `--paper`, `--background` | `#f6f1e2` | xuan paper |
| Cool paper field | `--paper-cool`, `--sand` | `#f1efe8` | list column / main field |
| Paper shadow | `--paper-deep`, `--sand-deep` | `#e2dac7` | sidebar / depth |
| Ink text + borders | `--ink`, `--foreground`, `--paper-ink`, `--sand-ink` | `oklch(0.205 0.028 78)` | warm soot ink |
| Muted ink text | `--sand-muted` | `oklch(0.43 0.026 78)` | ≥4.5:1 on paper |
| Brand accent (legacy, restrained) | `--primary` | `oklch(0.62 0.13 215)` | primary buttons, links, focus |
| Seal accent | `--cinnabar` | `oklch(0.50 0.17 32)` | seals/critical only |
| Material accents | `--moss`, `--amber` | `oklch(0.48 0.088 150)`, `oklch(0.66 0.12 74)` | restrained material/status |
| Desk backgrounds | `--desk-paper-bg`, `--sheet-paper-bg`, `--slip-paper-bg` | composite gradients | shell surfaces must consume these |

### Status colors

`--success` / `--warning` / `--info` / `--danger` (+ `-fg` pairs). They flow
through `badgeClass()` / `dotClass()` / `StatusPill` only. See
`component-guidelines.md` for the single-source rule.

### Category colors

`--cat-info/success/warning/danger/neutral` (+ `-fg`) are for classification
labels (RuntimeChip etc.): light tint + deep text + ink edge. Category ≠ status.

### Accent system (B/C dual-tone)

Functional/section colors use a **dual-tone** system. Each hue has two variants:

- **solid** (C) — high-saturation, paired with light text. Active tabs, active
  nav ticks, selected items, primary chips.
- **soft** (B) — low-saturation tint, paired with dark text. Inactive tabs,
  section backgrounds, count badges, role labels.

Utility classes `.sk-accent-<hue>{,-soft}`, `.text-accent-<hue}`,
`.border-accent-<hue>` live in the `@layer components` design-system block with
`!important` where they must override atom defaults — plain selectors outside
Tailwind layers can be omitted from the compiled sheet.

| Hue | solid (light) | soft (light) | Semantic use |
|---|---|---|---|
| blue | `oklch(0.52 0.15 251)` | `oklch(0.78 0.11 241)` | chat, search, links |
| rose | `oklch(0.58 0.21 26)` | `oklch(0.80 0.11 3)` | tasks, safety, saved |
| mint | `oklch(0.56 0.15 166)` | `oklch(0.80 0.10 166)` | members, activity |
| green | `oklch(0.62 0.18 148)` | `oklch(0.86 0.10 148)` | computers, files |
| purple | `oklch(0.50 0.15 299)` | `oklch(0.78 0.09 269)` | control |
| yellow | `oklch(0.83 0.17 89)` | `oklch(0.90 0.10 90)` | accents only (no gold/amber section color) |

Functional assignments (nav color = function color):
- **icon rail ticks**: search/chat=blue, tasks=rose, members=mint,
  computers=green, control=purple, activity=mint (`sk-rail-active-<accent>`).
- **chat tabs**: chat=blue, tasks=rose, memory=mint, files=green, activity=purple.
- **chat sidebar sections**: 关注=rose, 频道=blue, 私信=mint, 运行中=purple.

Rules:
- Don't mix `sk-cat-*` (category) with `sk-accent-*` (function) on the same role.
- Yellow is accent-only; never a section/nav color. No amber/gold.
- To recolor the app, change only the `--accent-*` tokens.

### The purple rule, corrected

The old "purple hues 250-265 forbidden" rule described the **rejected purple-blue
gradient brand theme** and is no longer accurate as a blanket ban. Current rule:

- **Forbidden**: purple-blue as *brand identity* — gradients, glass, glow, or a
  hue-250-265 wash as page/surface identity (the old rejected theme).
- **Allowed**: purple as a *functional accent* in the B/C system above (control
  surfaces, hue 299 solid / 269 soft), and the readable dai-purple in `.shuimo`.
- **Still forbidden**: purple in the **agent identity palette**
  (`--agent-color-1..6` stay in hue 155-230 + coral; avatar identity must not
  collide with the retired brand).
- `--accent-blue` at hue 251 sits at the edge of the old forbidden band but is an
  accepted functional accent; keep it clearly separated from `--primary` (215) so
  brand and function never read as the same color.

### Forbidden colors
- Purple/blue-violet as brand identity or gradient (see above).
- Tailwind palette literals: `bg-emerald-500`, `bg-amber-50`, `text-sky-700`,
  `border-rose-200`, etc. Use tokens.
- `bg-white` as a surface (too cold against paper). Use `--sand-card`/`--paper`.
- Pure `#000` text — ink is the only near-black.

---

## Object Language

The desk is populated by object metaphors; components map to tangible desk
objects, not generic cards. The full taxonomy, alignment grammar (anchor /
primary / meta / state / actions / evidence slots), and page object matrix live
in `.trellis/tasks/archive/2026-07/06-30-ink-wash-theme-exploration/design.md` —
treat it as the object-language appendix of this spec.

Core mappings:

- chat message = paper slip (`MessagePaper`); short slips may tilt, long stay square
- message actions = small desk tools clustered with the message, not pushed to the row edge
- task = task ticket (`TaskMaterialSurface`); evidence = attached proof sheet (`EvidenceSurface`)
- review = cinnabar stamp (`ReviewStamp`); memory = fixed note (`MemoryFixedNote`)
- member identity = name tag + avatar prefab (`AvatarObject`, default frame `identity-thin`)
- computer/runtime = inkstone/tool base; connect command = proof/instruction sheet
  (`AttachmentSheet` + `ObjectField`)

Shared primitives expose `data-slot` (component contract) and `data-object`
(product object class). Browser evidence compares like with like through these
attributes. Object language belongs in shared primitives and `globals.css`
utilities — never route-local hand-rolled cards.

Avatar rules (from the same task): one `AvatarObject` prefab for humans and
agents with different frame/content variants; the top-right status dot must
never be covered by frame decoration (folds go left-top); cinnabar stamps are
review objects, not identity decoration; avoid "square frame + separate round
face ball" as the default look.

---

## Chat Message Markdown (`markdown-body`)

Single renderer: `components/markdown-message.tsx` (react-markdown + remark-gfm +
mention rehype plugin), used only by `chat/[channel]/message-list.tsx`. All chat
markdown styling lives in the `.markdown-body` block of `globals.css` — never
hand-roll per-route markdown styles.

Conventions (landed in 08-18-frontend-beauty-agent-reply):

- **Code blocks** render through a custom `pre` component (`CodeBlock`) producing
  `.sk-codeblock` = ink-bordered slip with a **header strip** (uppercase language
  label + copy button) over a **soft body**. The body tint is
  `color-mix(in oklch, var(--accent-mint-soft) 38%, var(--paper))` — never full
  `accent-mint-soft` (too loud for long code). Header strip uses
  `paper-deep 55% × paper`. Keep the copy button's i18n keys (`common.copy` /
  `common.copied`) in both message files.
- **Blockquotes** are a 4px `--accent-rose` left bar over a
  `rose-soft 30% × paper` tint — no full ink frame, no hard shadow, no saturated
  fill. Full-bleed rose backgrounds were tried and read as louder than the code.
- **Lists** use hanging indent (`list-disc/decimal` + `pl-5`, `li` gets `pl-0.5`);
  `list-inside` is forbidden (wrapped lines collide with the marker).
- **Tables**: 1.5px ink outer frame, 1px `--sand-border` inner lines,
  `paper-deep 55% × paper` header with left-aligned text (matches body cells).
- **Headings** carry top margin (`mt-4`/`mt-3`, `first:mt-0`) so sections
  separate from the preceding paragraph inside a bubble.
- **Inline code** keeps the mint chip semantics but with a 1px ink edge; 1.5px
  reads clumsy at 0.85em.

Dark/shuimo themes: all of the above consume tokens, so they adapt — verify by
screenshot when touching this block (dark mint/rose softs are deep variants and
must stay readable on paper).

---

## Layout Conventions

### Three-column "Slack" mode (list-detail pages)
Pages with a list+detail structure (Tasks, Members, Computers, Chat) use
`<ProductShell list={...}>`:
- **Col 0 — tool spine** (`.sk-rail`, fixed `w-14`, paper binding-spine material)
- **Col 1 — list column** (`bg-sand-deep`, resizable via `useResizablePanel`, width in localStorage)
- **Col 2 — main area** (paper field)
- **Col 3 — optional right sidebar** (detail/stats, `bg-sand-deep/60`)

### Single-column dashboard mode
Pages without a list (Home, Control, Settings, Daemon) omit the `list` prop.
`ProductShell` stays backward-compatible: no `list` = single column.

### Container rules
- Use `<Card>` for primary framed containers; `<Panel>` for borderless-density blocks.
- Do NOT nest cards inside cards. Use section headings + spacing, not border boxes.
- Keep controls stable in size; hover/status/counts must not shift layout.
- Full-width work areas, sidebars, tabs, split panes, tables — prefer these over hero sections.

### Shell-owned material desk coverage (07-06)
- All product routes inherit the desk background from the `(app)` layout:
  `app/(app)/layout.tsx` mounts `InkMaterialRuntimeScript` + `AppDeskBackground`
  exactly once. Routes must NOT mount their own desk background or a second
  material runtime script; per-route variation is done inside the main region,
  never by re-owning the desk.
- `/login` and `/join/[token]` are deliberate exceptions: clean xuan-paper
  entrances outside `ProductShell` and outside the `(app)` group — no rail, no
  desk material layer, no `data-inkframe-surface="app-background"`. Do not pull
  them into the shell, and do not add desk material to other non-`(app)` routes
  without extending the shell-coverage proof routes in
  `tools/twd-guard/twd-inkframe-proof.mjs` (`PRODUCT_SHELL_PROOF_ROUTES`).

---

## Interaction Conventions

- Icons for familiar actions; pair with tooltip/label when meaning isn't obvious.
- Tabs for alternate views, segmented controls for modes, toggles for binary, menus for option sets.
- One tab style app-wide (do not hand-roll a third tab variant per page).
- Critical backend mutations use native `<form action={serverAction}>` (see `quality-guidelines.md`).
- Empty/loading/error states must explain the state AND offer a next action, not just show gray text.
- **Unread density is asymmetric (06-22-notifications, anti notification-anxiety)**:
  DM unread = count badge (`EventBadge` with `count`) + emphasized row; channel
  unread = small dot only (`ActivityDot`, no count, no emphasis). Never give
  channels per-message counters or bolding — a channel accumulating "99+" is
  noise, not information. Unread is volatile local state (see the
  Domain × Scope Unread Activity Layer in `state-management.md`): entering the
  entity clears it; it is not durable design data and must not drive layout.

---

## Runtime / Observability Surfaces

- Activity, event, daemon, trace views are observability UI: summarize + link to evidence.
- Distinguish user-visible work (messages, assigned tasks) from telemetry (events, status).
- Runtime state labels: Working/Thinking/Output/Idle are activity; messages/tasks are work.
- Never let self-authored runtime activity look like a new inbound message.
- `/daemon` and `/control` are internal operator pages: they are excluded from the
  object-desk product-language pass and must not be used as style acceptance evidence.

---

## Memory & Recovery Surfaces

- Channel Memory and Task Recovery are post-compaction recovery surfaces, not debug dumps.
- Group memory by product meaning (channel knowledge, task outputs, proposals), not one flat list.
- Task Recovery: show brief, plan, progress, output/evidence, summary, breakdown, provenance.
- Artifacts render as typed viewers (image previews, `<video controls>`, labeled evidence rows).
- Show version/hash compactly for audit; do not let hashes dominate hierarchy.

---

## Material Runtime (WebGL ink surfaces)

The ink-material layer (`components/inkframe/material-surface.tsx`,
`material-resource.ts`, `material-surface-store.ts`, `app-desk-background.tsx`)
follows hard runtime rules from the 07-06 material task family:

- **At most one active WebGL surface app-wide, static by default.** Every
  material surface (desk background, chat desk, task material) defaults to
  `mode="static"`, which mounts no `<canvas>` at all — zero GL cost on load and
  on route transitions. Activation is an explicit user action (chat desk
  button), coordinated through `materialSurfaceCoordinator`: one active record
  per region, and activating a new owner in a region deactivates the previous
  one (`app-background` is owned by `AppDeskBackground`, owner-id
  `global-desk`).
- **Resources are session-local, in-memory only.** `MaterialResource` blobs
  live in a module-level tracked set with `URL.createObjectURL` object URLs,
  revoked on page lifecycle/discard. Persisting visual/restore/source blobs to
  `localStorage` or `IndexedDB` is forbidden — material state is ephemeral desk
  theater, not user data.
- **Three URLs per resource, for fidelity.** `visualObjectUrl` (what is
  displayed), `restoreObjectUrl` (the base a restore returns to),
  `sourceObjectUrl` (the original upload). Keep uses the current resource;
  discard returns to the owner-clean default via `discardMaterialResource`.
  Never collapse the three into one URL — restore quality and provenance
  depend on the separation.
- **Keep/discard must fall back to a clean owner resource, without tint drift.**
  Each resource carries its own `tint` (`desk` | `paper` | `task` | `evidence`
  | `review`); after keep or discard the surface must still report the owner's
  expected `data-inkframe-tint`. A discarded surface silently inheriting the
  previous resource's tint is a bug, not a weather effect.

---

## Known Debt & Improvement Directions

This section lists verified gaps between spec and code, plus recommended
directions. Items here are **not yet rules** — they become rules when a task
lands them.

1. **Theme naming drift** — default theme is called `water` but is the paper
   desk. Recommended: rename to `desk` (or `paper`) with a full storage
   migration, or accept the name and document it (done here). Pick one in the
   next theme-touching task.
2. **Rail active accent is too weak** — `sk-rail-active-{blue,rose,mint,green,purple}`
   currently differ only in the 3px `::before` tick and a 76%-ink-mixed shadow
   tint; at a glance all active items read as the same ink tile. The planning
   task `08-04-frontend-beautification` targets this. Recommended: fill the
   active tile with the hue's **soft** variant and keep the ink border + solid
   tick — enough hue recognition without breaking the ink signature.
3. **Shadcn residue tokens are off-palette** — `:root` still carries water-era
   blue-grays that leak into atoms: `--popover: oklch(1 0 0)` (pure white),
   `--muted-foreground: oklch(0.55 0.03 225)` (blue-gray vs warm ink),
   `--border`/`--input: oklch(0.91 0.015 220)` (light blue-gray vs ink).
   Recommended: repoint these to paper/ink derivatives (`--popover` → `--paper`,
   `--muted-foreground` → `--sand-muted`, `--border` → `--sand-border`) so atoms
   that consume shadcn defaults stop drifting cool.
4. **`--radius` legacy** — `0.875rem` survives for shadcn internals while the
   product language is square. Keep the token, but lint against new rounded
   containers; do not let radius grow back via component libraries.
5. **Popover/dropdown surfaces** — pure-white popovers on a paper desk read as
   foreign objects. With debt #3 fixed, popovers become paper sheets with ink
   borders and hard shadows, matching dialogs.
6. **Shuimo accent aliasing** — `.shuimo` aliases `--accent-green` to
   `var(--moss)` while mint and green collapse onto the same hue family;
   members/activity (mint) and computers (green) become hard to distinguish.
   Recommended: separate them (moss ≈ 150 for one, a deeper pine ≈ 165-170 for
   the other) at low chroma to preserve the ink-wash feel.
7. **Dual maintenance of accent blocks** — accents are defined per theme
   (`:root`, `.dark`, `.shuimo`) by hand. When adding a hue, update all three
   blocks in the same commit; a missing block silently falls back to the wrong
   theme's color. Consider a comment checklist at each block head.

---

## Evidence Expectations

For browser-facing work, final evidence shows the actual visible product surface,
not only curl/DB rows. Use `project-webdriver-cli` (`./twd`) for the browser portion;
cross-check API/DB/trace only when those layers matter. Evidence must show the
real app (list/detail surfaces visible enough to prove it is not just token
replacement).
