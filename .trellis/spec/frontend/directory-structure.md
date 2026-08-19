# Frontend Directory Structure

> How frontend code is organized. Maps directly to the three-layer component model
> in `component-guidelines.md`. Read both together.

---

## Overview

The frontend is a Next.js App Router app in `frontend/`. The directory layout
enforces the component layers: **where a file lives determines what it may import
and what it may style.**

```
frontend/
├── app/                          # Layer 3 — Pages & routes (App Router)
│   ├── layout.tsx                #   root layout (html/body/intl/theme) — public, no auth
│   ├── (app)/                    #   route group (URL-less) — authenticated app shell
│   │   ├── layout.tsx            #     mounts chrome ONCE: rail + AppDeskBackground +
│   │   │                          #     InkMaterialRuntimeScript + requireCurrentAccount()
│   │   ├── page.tsx              #   Home / search dashboard
│   │   ├── tasks/                #   Tasks route (three-column)
│   │   ├── members/              #   Members route
│   │   ├── computers/            #   Computers route
│   │   ├── chat/                 #   Chat route (channel-client + sidebar)
│   │   ├── control/              #   Control plane / observability
│   │   ├── settings/, daemon/, dm/
│   ├── login/, join/[token]/     #   public routes — OUTSIDE (app), no shell, no auth gate
│   └── globals.css               #   Layer 0 — tokens & utilities (THE source of truth)
│
├── components/                   # Layer 2 — Product primitives (compose atoms + product semantics)
│   ├── app-rail.tsx              #   icon rail (client): active from usePathname(), ServerSwitcher
│   ├── product-shell.tsx         #   body-only shell: header + three-column body (P2 slimmed)
│   ├── product-shell-body.tsx    #   client body: resizable list column + main + sidebar
│   ├── product-ui.tsx            #   StatusPill, RuntimeChip, Toolbar, EmptyState, ProductRow
│   ├── task-board.tsx            #   task board/list (composes Card, StatusPill)
│   ├── task-list-panel.tsx       #   three-column Col 1 list
│   ├── task-form-dialogs.tsx     #   create/update dialogs (composes Dialog, Select)
│   ├── message-frame.tsx         #   chat message row
│   ├── realtime-refresh.tsx      #   SSE-driven router refresh
│   ├── language-switcher.tsx
│   ├── ...
│   │
│   └── ui/                       # Layer 1 — Atoms (NO product knowledge, own base styling)
│       ├── button.tsx            #   <Button> + buttonVariants cva
│       ├── card.tsx              #   <Card> + CardHeader/Title/Content/Footer
│       ├── input.tsx             #   <Input>
│       ├── form.tsx              #   <FieldLabel>, <Select>, <Textarea>
│       ├── panel.tsx             #   <Panel>, <PanelTitle> (borderless-density block)
│       ├── dialog.tsx            #   <Dialog> + parts
│       ├── avatar.tsx            #   <Avatar>
│       └── scroll-area.tsx
│
├── hooks/                        # Reusable client hooks
│   └── use-resizable-panel.ts    #   pointer/keyboard resize + localStorage
│
├── lib/                          # Framework-agnostic logic & single-source helpers
│   ├── control-plane.ts          #   API client + types + statusKind()/badgeClass()/dotClass()
│   ├── server-auth.ts            #   server-side session
│   ├── realtime-events.ts        #   SSE connection
│   ├── agent-color.ts            #   agent identity color from id
│   ├── smallkhoj-agent-avatar.ts #   Croodles-style avatar SVG generator
│   └── utils.ts                  #   cn() and misc
│
├── messages/                     # i18n strings (en.json etc.)
└── public/                       # static assets
    └── rail-water-texture.png    #   LEGACY: unreferenced since the rail became a
                                  #   paper binding spine (see product-ui-style.md);
                                  #   safe to delete in a cleanup pass
```

---

## Import Rules (enforced by layering)

| Layer | May import | May NOT import |
|---|---|---|
| **Layer 0** (globals.css tokens) | nothing (it IS the source) | — |
| **Layer 1** (`components/ui/*`) | tokens (via CSS vars), `lib/utils` | any `components/*` (non-ui), `lib/control-plane`, app code |
| **Layer 2** (`components/*`) | Layer 1 atoms, tokens, `lib/*` | `app/*` page internals |
| **Layer 3** (`app/*`) | Layer 1 + 2, `lib/*`, `hooks/*` | re-defining styles/components locally |

A Layer 1 atom that needs `badgeClass()` is a red flag — it's leaking product
semantics down. Promote the concept or pass the resolved class as a prop.

---

## Where New Code Goes

| You're adding... | It goes in... |
|---|---|
| A new token / utility class | `app/globals.css` (Layer 0) |
| A generic styled element (no product meaning) | `components/ui/` (Layer 1) |
| A product-aware composite (uses status/runtime/task concepts) | `components/` (Layer 2) |
| A reusable client behavior (resize, debounce, fetch) | `hooks/` |
| A pure helper / type / API mapping | `lib/` |
| Something used by exactly one route | inline in that route's page, OR `components/<feature>/` if it grows |
| A new authenticated route (requires login) | under `app/(app)/` so it inherits the shared shell + auth gate |
| A new public route (no login, e.g. landing/invite) | directly under `app/` (NOT in `(app)/`) |

### The `(app)` route group

`app/(app)/layout.tsx` is the **authenticated app shell**. Next route groups are
URL-less, so moving a route into `(app)/` does not change its URL — it only makes
it inherit this layout, which mounts the workbench chrome (icon rail +
`AppDeskBackground` + `InkMaterialRuntimeScript`) **once for the whole session** and
calls `requireCurrentAccount()`. This is why switching pages no longer rebuilds the
shell. Public surfaces (`/login`, `/join/[token]`) must stay outside `(app)/` or
they would suddenly require auth and gain a rail they should not have.

---

## Naming Conventions

- **Files**: `kebab-case.tsx` for components (`task-list-panel.tsx`); `kebab-case.ts` for libs/hooks.
- **Components**: `PascalCase` (`StatusPill`, `ProductShell`).
- **Hooks**: `use-thing.ts` exporting `useThing`.
- **Tokens**: `--kebab-case` CSS vars (`--sand-deep`, `--success-fg`).
- **Utility classes**: `sk-*` prefix for handcraft system classes (`sk-panel`, `sk-status-success`).

---

## The `globals.css` Contract

`app/globals.css` holds **all** design tokens and the handcraft utility classes.
It is the only file where colors/radii/shadows are defined as values. Everything
else references them.

Structure inside globals.css:
1. `@theme inline` — Tailwind theme mapping (font, breakpoints).
2. `:root` — light theme tokens (background, primary, ink, sand*, success*, ...).
3. `.dark` — dark theme overrides (same token names).
4. `@layer utilities` — handcraft classes (`sk-*`, `bg-sand-*`, `bg-success`, ...).
5. `@layer components` — `.sk-rail*` (paper binding-spine rail; the water-material texture is retired and `public/rail-water-texture.png` is an unreferenced legacy asset), resize handle, base styles.

**Do not** add component-specific styles here unless they're truly app-wide
utilities. Component styles belong in the component (via Tailwind classes) or
a co-located CSS module if truly necessary.
