# Plan 006 (Direction): Reconcile DESIGN.md with the shipped tri-theme reality

> **Executor instructions**: This is a **design/docs reconciliation plan**,
> not a build-everything task. The goal is to make the design system doc
> match what actually shipped so future agents (impeccable, improve, and
> human contributors) stop optimizing toward a stale spec. Read the plan
> fully, gather the listed evidence, then propose the rewritten sections
> for operator approval BEFORE editing committed docs.

## Status

- **Priority**: P3
- **Effort**: M (mostly writing; one decision needed)
- **Risk**: LOW (docs-only; the only failure mode is reverting the shipped
  theme by mistake)
- **Depends on**: none
- **Category**: direction / docs
- **Planned at**: commit `47848e8`, 2026-07-19

## Why this matters

`DESIGN.md` declares itself "the visual anchor; any color/texture change
defers to it" (`DESIGN.md:3`). It specifies a **light-first single-color
mid-sea-blue** theme with hue 200–225 and explicitly forbids the purple-blue
hue 260+ band. But the app has shipped a **three-theme system** (`water` /
`dark` / `shuimo`) where `shuimo` is a hue-260 ink-wash theme that
`DESIGN.md` never mentions. The repo also carries
`FRONTEND_OPTIMIZATION_HANDOFF.md` (19KB) describing the purple→sea-blue
migration as in-flight, when it has in fact been superseded.

Consequence: any future design pass (impeccable, improve, or a human
contributor) reads `DESIGN.md` as the contract and either (a) reverts the
shipped `shuimo` theme, or (b) treats the handoff doc as live work and
re-does a migration that's already been abandoned. The design system's
authority is eroded by being wrong about its own product.

## Current state

**`DESIGN.md:53-60`** — the "待办（落地阶段）" section lists five unchecked
items assuming the light-first migration is still pending:

```markdown
## 待办（落地阶段）

- [ ] 将 light 设为默认（`layout.tsx` 默认不挂 `.dark`）
- [ ] 替换 `globals.css` 的 `:root` 与 `.dark` 色板为上表
- [ ] 移除/重定义旧渐变变量（`--gradient-primary` 蓝紫等），改为单色中海蓝 + 光晕方案
- [ ] 主按钮 variant 改为实色 + hover 光晕
- [ ] 用 `./twd` 做真实截图校验对比度与光感
```

**`frontend/app/layout.tsx:36-50`** — the shipped theme logic implements
THREE themes, not two:

```javascript
/* 三主题：'dark' | 'shuimo' | null(=water，默认，不加任何 class)。
   只加一个 class，避免 .dark/.shuimo 叠加。 */
if (theme === 'dark') {
  document.documentElement.classList.add('dark');
} else if (theme === 'shuimo') {
  document.documentElement.classList.add('shuimo');
}
```

**`frontend/components/theme-switcher.tsx:24-31`** — exposes a three-theme
switcher grounded in `.trellis/tasks/06-30-ink-wash-theme-exploration/`, a
task DESIGN.md was never updated to reflect.

**`frontend/app/globals.css`** (per audit) — still contains
`--accent-purple-soft: oklch(0.693 0.071 269)` and `--ink: oklch(0.21 0.03 264)`
(hue ~260, the band DESIGN.md forbids), and the `.shuimo` block sets
`--primary: oklch(0.28 0.015 260)`.

**`FRONTEND_OPTIMIZATION_HANDOFF.md:32-34`** — describes the purple→sea-blue
migration as an "absolute prohibition" still to be enforced, when the
shipped `shuimo` theme is itself hue-260.

## Scope

**In scope** (the only files to modify, AFTER operator approval of the
proposed rewrites):

- `DESIGN.md` — update the color table, the "光感规则", and the "待办"
  section to describe the shipped tri-theme system. Mark the original
  light-first-only plan as superseded by `06-30-ink-wash-theme-exploration`.
- `FRONTEND_OPTIMIZATION_HANDOFF.md` — either archive (rename to
  `FRONTEND_OPTIMIZATION_HANDOFF.archived.md` and add a deprecation
  header) or rewrite to reflect the shipped state. **Do NOT delete** — it
  contains useful historical context.
- (Optional) `PRODUCT.md` "Brand Personality" section — confirm it still
  matches the shipped aesthetic; update if not.

**Out of scope**:

- Any change to `globals.css`, `layout.tsx`, or `theme-switcher.tsx`. The
  shipped theme is correct; the DOC is wrong, not the code.
- Re-litigating the design direction. The tri-theme is the shipped reality;
  this plan reconciles the doc, it does not propose a fourth theme.
- Touching `.trellis/tasks/06-30-ink-wash-theme-exploration/` — it's the
  source of truth for the new direction; leave it.

## Steps

### Step 1: Gather the complete shipped-theme evidence

Read and excerpt (do not edit yet):

- `frontend/app/globals.css` — the `:root`, `.dark`, and `.shuimo` blocks
  in full. Capture every OKLCH token and its hue.
- `frontend/components/theme-switcher.tsx` — the three theme names and
  their storage semantics.
- `.trellis/tasks/06-30-ink-wash-theme-exploration/prd.md` — the rationale
  for the ink-wash direction (this is the new design authority).
- `PRODUCT.md` — the "Brand Personality" and "Anti-references" sections.

**Verify**: produce a single Markdown brief with these excerpts, side by
side with the current `DESIGN.md` claims. This is the evidence the operator
will approve before any doc edits.

### Step 2: Propose the rewritten DESIGN.md sections

Draft (do not commit) the new:

- **色板（OKLCH）** table — one row per token PER theme (water / dark /
  shuimo), with the actual shipped values from `globals.css`.
- **光感规则** — describe what shipped (the water light-gradient + glow halo
  on primary buttons; the shuimo ink-wash surface), not what was planned.
- **待办（落地阶段）** — replace the stale checklist with the actual open
  items. Likely candidates (confirm each is real before listing):
  - Audit `globals.css` for residual `--accent-purple-soft` and `--ink`
    hue-260 tokens that no longer belong in any shipped theme.
  - Verify `shuimo` meets the contrast ≥ 4.5:1 requirement stated in
    DESIGN.md's "质感边界" section.
  - Screenshot-verify all three themes with `./twd` (per AGENTS.md).
- **方向反转声明** — add a new note that the original light-first-only
  plan was superseded by `06-30-ink-wash-theme-exploration` on its date.

**Verify**: operator reviews the proposed rewrite and either approves,
requests changes, or defers. Do not edit `DESIGN.md` until approved.

### Step 3: Archive or rewrite `FRONTEND_OPTIMIZATION_HANDOFF.md`

Decide (with the operator) between:

- **Archive (recommended)**: rename to
  `FRONTEND_OPTIMIZATION_HANDOFF.archived.md`, prepend a header:
  ```markdown
  > **STATUS: SUPERSEDED (2026-07-19).** The purple→sea-blue migration
  > described here was replaced by the tri-theme system (water/dark/shuimo)
  > from `.trellis/tasks/06-30-ink-wash-theme-exploration/`. Kept for
  > historical context; do not execute any checklist items from this file.
  ```
- **Rewrite**: update the handoff to describe the actual shipped state and
  the remaining open items (from Step 2's evidence brief).

**Verify**: the chosen file's first paragraph clearly communicates
"this is historical, not live" so a future agent does not pick up a stale
task list.

## Done criteria

- [ ] `DESIGN.md` color table matches the actual `globals.css` values for
      all three themes (water, dark, shuimo).
- [ ] `DESIGN.md` "待办" section contains no items already shipped.
- [ ] `DESIGN.md` references the `06-30-ink-wash-theme-exploration` task as
      the source of the new direction.
- [ ] `FRONTEND_OPTIMIZATION_HANDOFF.md` is either archived with a clear
      SUPERSEDED header or rewritten to match shipped state.
- [ ] No source code (`globals.css`, `layout.tsx`, `theme-switcher.tsx`)
      was modified.
- [ ] `plans/README.md` status row for plan 006 updated to DONE.

## STOP conditions

- The operator does not approve the proposed rewrite — STOP and report;
  do not edit committed docs without sign-off.
- Step 1 reveals that `globals.css` is itself in an inconsistent state
  (e.g. `shuimo` references tokens not defined anywhere) — STOP; that's a
  code finding, not a doc finding, and belongs in a separate plan.
- The `06-30-ink-wash-theme-exploration` task directory does not exist or
  is not the source of the shipped theme — report; find the real source
  before rewriting DESIGN.md.

## Maintenance notes

- Going forward, `DESIGN.md` should be updated IN THE SAME PR that ships a
  theme change. The drift happened because a theme shipped without a doc
  update; closing that loop prevents recurrence.
- The `impeccable` skill reads `DESIGN.md` as its anchor — keeping it
  accurate is what makes future design passes useful instead of
  destructive.
