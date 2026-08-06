# Component Guidelines

> How components are built and layered in SmallKhoj. Read before writing or editing any UI.

The single most important rule: **never hardcode styles in page/feature code.**
Components own their styling; pages compose components and pass data. This is
what lets a visual change (border color, radius, status color) propagate from
one place to the whole app.

---

## The Three-Layer Component Model

Every piece of UI must live in exactly one of these layers. Choose by asking
"does this need to know about product data or just about rendering?"

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3 — Pages / Features (app/**, feature comps)     │  knows product data
│    compose Layer 1+2, pass data, never style            │  NO hardcoded styles
├─────────────────────────────────────────────────────────┤
│  Layer 2 — Product primitives (components/**)           │  knows product concepts
│    StatusPill, ProductRow, Toolbar, EmptyState,         │  styling allowed
│    ProductShell, TaskListPanel, MessageActions...       │  (referencing Layer 1)
├─────────────────────────────────────────────────────────┤
│  Layer 1 — Atoms (components/ui/**)                     │  knows nothing about product
│    Card, Button, Input, Select, Textarea, Panel,        │  owns base styling
│    Dialog, Avatar, ScrollArea, Tabs, FieldLabel         │  references tokens only
├─────────────────────────────────────────────────────────┤
│  Layer 0 — Tokens & utilities (globals.css :root)       │  the single source of truth
│    --ink, --sand*, --primary, --success*, sk-* classes  │  change here → app follows
└─────────────────────────────────────────────────────────┘
```

### Layer 0 — Tokens (globals.css)
Colors, radii, shadows live ONLY here. Never write `oklch(...)`, `#hex`, or
Tailwind palette colors (`bg-emerald-500`, `bg-sky-200`, ...) in a component
or page. Reference tokens: `bg-primary`, `border-[var(--ink)]`, `bg-success`.

### Layer 1 — Atoms (components/ui/*)
Own their base styling and reference tokens only. They must NOT import product
code (`lib/control-plane`, feature components). A `<Card>` knows nothing about
tasks or members — it just renders a bordered box.

`Tabs` (`components/ui/tabs.tsx`) is the shared accessible tab atom. It owns
`role="tablist"`/`role="tab"`/`role="tabpanel"`, roving keyboard focus, and the
ink-border active/inactive surface. Feature pages provide values and content;
they must not hand-roll a second tab style or render an unselected panel's
copyable command text.

### Layer 2 — Product primitives (components/*, not in ui/)
Compose atoms + reference product concepts (status, runtime). Styling is allowed
but must reuse Layer 1 atoms and Layer 0 tokens. Example: `StatusPill` wraps a
`<span>` with `badgeClass()` (which reads status tokens) — it does NOT redefine
colors.

### Layer 3 — Pages & features (app/**)
Compose Layer 1 + 2. **Never style here.** No `className="rounded-md border bg-..."`,
no `bg-emerald-500`, no local `<select>`/`<button>` with hardcoded classes. If you
need a styled element, use an atom; if the atom doesn't exist, add it to Layer 1.

---

## The Single-Source Rule (critical)

For any visual concern, there must be exactly ONE source of truth:

| Concern | Single source | How to change app-wide |
|---|---|---|
| Brand/primary color | `--primary` token | edit globals.css |
| Border color (handcraft) | `--ink` token | edit globals.css |
| Status colors | `--success/--warning/--info/--danger` + `badgeClass()` | edit globals.css OR statusKind() mapping |
| Card border/radius/shadow | `Card` component | edit components/ui/card.tsx |
| Button variant | `buttonVariants` cva | edit components/ui/button.tsx |
| Input border/focus | `Input` component | edit components/ui/input.tsx |

**If you find yourself changing the same style in 3+ files, the architecture is
wrong** — promote it to a token, a utility class, or an atom. Then revert the
scattered changes and let the single source drive them.

---

## Forbidden in Page/Feature Code

These are the patterns that cause "change one place, nothing propagates":

- ❌ Raw `<select>`, `<textarea>`, `<input type=text>` with hardcoded Tailwind classes.
  Use `<Select>`, `<Textarea>`, `<Input>` from `@/components/ui/form` / `input`.
- ❌ Raw `<button className="bg-primary ...">`. Use `<Button variant size>`.
- ❌ `<div className="rounded-md border bg-background p-3">` (hand-rolled card).
  Use `<Card>`, `<Card size="sm">`, or `<Panel>`.
- ❌ Hardcoded palette colors: `bg-emerald-500`, `text-rose-700`, `border-sky-200`,
  `bg-amber-50`, any `oklch()`/`#hex` literal. Use status tokens / `badgeClass()`.
- ❌ Local re-definitions of `dotClass`/`badgeClass`/`statusLabel`/`StatusBadge`
  in a page. Import from `@/lib/control-plane` and `@/components/product-ui`.
- ❌ Local re-definitions of `Field`, `FieldLabel`, `Select`. Import shared ones.
- ❌ `rounded-lg`/`rounded-xl`/`rounded-md` on containers (handcraft = `rounded-none`).
  Only `rounded-full` is allowed, for small dots/status indicators.

### When a raw element is unavoidable
If an atom genuinely can't express what you need (e.g. a controlled `<select>`
with `onChange`), keep the raw element but apply handcraft utility classes:
`rounded-none border-2 border-[var(--ink)] bg-transparent`. Then file a note to
extend the atom. Never hardcode colors.

---

## Composition Patterns

### Variants via cva (class-variance-authority)
Atoms with multiple looks use `cva` (see `button.tsx`). Pages pick a `variant`,
never override classes. Adding a variant = editing one cva map.

### `className` passthrough
Every atom accepts `className` and merges it via `cn()` (tailwind-merge). Pages
can add layout utilities (`mb-4`, `w-full`) but must NOT override the atom's
signature styling (border, radius, color). `cn()` ensures later wins, so signature
classes are listed first.

### `<Card>` vs `<Panel>` vs raw section
- `<Card>` — primary framed container, with handcraft border + hard shadow.
- `<Panel variant="default">` — same border, NO shadow (message bubbles, dense info blocks).
- `<Panel variant="raised">` — border + hard shadow but lighter framing than Card.
- Raw `<section>`/`<div>` with no border — for layout-only containers (grids, flex).

---

## Adding a New Component — Decision Tree

1. Is it pure presentation, no product knowledge? → **Layer 1** (`components/ui/`).
2. Does it wrap an atom with product semantics (status, runtime)? → **Layer 2** (`components/`).
3. Does it only compose existing components + data for one route? → **Layer 3** (inline in page, or `components/<feature>/` if reused).

Before creating a new component, grep for an existing one that does 80% of the
job. Duplicate components are the #1 cause of style drift.

---

## Accessibility

- Interactive elements must have `focus-visible` styling (atoms already provide this).
- Icon-only buttons need `aria-label`.
- Never remove the focus ring to "clean up"; style it via the token.
- Color is never the only signal — pair status color with a label or icon.

---

## Layout Region Hooks (`data-region`)

**Why:** When a reviewer says "the box left of the input" or circles a spot in a
screenshot, there must be a deterministic path from screen pixels → DOM → source.
Without it, the agent guesses by class-name string and frequently points at the
wrong element.

**Rule:** Every named region of a multi-panel page must carry a stable
`data-region="<kebab-case-name>"` on its outermost container. A "named region" is
any panel/column/zone a person would point at: sidebar, message list, composer,
thread panel, members panel, header bar, detail pane, etc. Layout-only wrappers
(grids, flex parents) do not need one — only regions a user identifies as a unit.

Conventions:
- The value is **semantic and stable**: `data-region="composer"`, not
  `data-region="bottom-input-thing"`. It must not change when styling changes.
- It lives on the **same element** that owns the region's background/border, so
  inspecting the region also reveals its container styling.
- `data-testid` is for test selectors (can be verbose/specific);
  `data-region` is for **human↔code locality** and stays coarse.
- Atoms inside a region do not repeat the region name — they keep their own
  `data-slot` (e.g. `data-slot="member-avatar"`).

Current regions (chat): `chat-main`, `message-list`, `composer`,
`thread-panel`, `members-panel`. Add equivalents on other multi-panel routes
(tasks board, control, daemon) when you touch them.

**Verification:** `[data-region]` must be queryable from the browser. The test
SOP should assert that each named region exists and is visible rather than
relying on brittle class-name matches.

---

## Common Mistakes (observed in this codebase)

1. **Re-defining StatusBadge/dotClass per page** → caused 4 different "done" colors.
   Fixed: single source in `lib/control-plane.ts`. Don't reintroduce.
2. **Hand-rolled `rounded-md border bg-background p-3` everywhere** → couldn't change
   card style globally. Fixed: `<Card>`/`<Panel>`. Don't reintroduce.
3. **Hardcoded emerald/amber/sky/rose for status** → bypassed theme. Fixed: status
   tokens. Any new status UI must use `badgeClass()`/`dotClass()`/`StatusPill`.
4. **Two copies of the icon rail** (ProductShell + channel-client) → diverged styling.
   Rule: **one rail, in `app/(app)/layout.tsx`** (the `AppRail` component). Chat must
   compose it, not rebuild it. (Historically the rail lived inside `ProductShell`, but
   P2 of `07-24-chat-transition-fast-path` lifted it into the shared `(app)` layout so
   the shell chrome persists across route changes instead of being rebuilt per page.
   `ProductShell` is now body-only — header + three-column body — and does NOT mount
   the rail, `AppDeskBackground`, or `InkMaterialRuntimeScript`.)
5. **No `data-region` on layout panels** → a screenshot or "the box left of the
   input" couldn't be mapped back to source; the agent pointed at the wrong
   element repeatedly. Fixed: chat regions now carry `data-region`. Don't add a
   multi-panel page without tagging its regions (see Layout Region Hooks above).
6. **Blaming the WebGL ink background for transition jank without measuring**
   (task `07-24-chat-transition-fast-path`) → an initial diagnosis claimed
   "WebGL re-init on every route change is the main cost." This was **wrong**: both
   `AppDeskBackground` and the chat desk `MaterialSurface` default to `mode="static"`,
   in which mode no `<canvas>` is mounted and the surface effect early-returns before
   any GL call; the activation event `APP_DESK_MATERIAL_EVENT` has **zero dispatchers**
   in the frontend, and the chat desk activates only via explicit button clicks.
   **WebGL cost on the route-transition path is exactly zero.** Before naming a
   renderer/init as a perf root cause, prove it with a profile or a render-count probe —
   do not infer it from "there's a canvas component in the tree."
