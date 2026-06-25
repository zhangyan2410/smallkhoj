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
