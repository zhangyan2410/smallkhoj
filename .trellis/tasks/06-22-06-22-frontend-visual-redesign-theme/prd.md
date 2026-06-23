# Frontend Visual Redesign — Theme & Design System

## Goal

Replace the flat Notion-style visual language with a consumer-grade AI-native aesthetic: dark-default with layered gradients, richer color palette, rounder corners. Must look compelling in a promo video. This task is **foundational** — all other redesign tasks depend on it landing first.

## Confirmed Decisions (design session 2026-06-22)

- Dark theme as default; light theme remains switchable
- Gradient strategy: subtle bg gradient + vibrant gradients on key elements (buttons, brand, agent-active states); no large flat solid-color blocks
- Corner radius: `0.625rem` → `0.875rem`
- Color palette: extend beyond single blue; add agent-identity stripe colors

## Requirements

### globals.css

- Set `--radius: 0.875rem`
- Switch default render to dark: apply `.dark` class on `<html>` in root `layout.tsx` by default; remove when user selects light
- Add subtle radial/directional gradient to dark `--background` (e.g. radial from `oklch(0.22 0.035 260)` at top-left to `oklch(0.18 0.022 250)` base) — visible depth, not distracting
- Define gradient CSS variables in `@theme inline`:
  - `--gradient-primary`: `135deg, oklch(0.60 0.18 260), oklch(0.55 0.20 290)` (blue→purple)
  - `--gradient-active`: `135deg, oklch(0.60 0.18 260), oklch(0.65 0.18 200)` (blue→cyan)
  - `--gradient-brand`: same as `--gradient-primary`
- Define 6 agent-identity hue variables for per-agent stripe colors (cycling):
  - `--agent-color-1` … `--agent-color-6`: distinct oklch hues (blue, violet, cyan, emerald, amber, rose)

### Primary Button

- `.variant-default` Button: replace flat `bg-primary` with `background: linear-gradient(var(--gradient-primary))`
- Hover: brightness/opacity shift on the gradient

### Navigation Rail (`product-shell.tsx`)

- Active rail item: 2px left accent bar (gradient-colored) in addition to current tint
- Brand `<Sparkles>` button: standardize to use `--gradient-brand`

### Card borders

- Add `ring-1 ring-primary/20` on agent cards and context panels in dark mode

## Acceptance Criteria

- [ ] Dark theme is the default; page renders dark without user action
- [ ] Page background in dark mode has visible but subtle gradient (not flat solid)
- [ ] Primary buttons use blue→purple gradient; hover state differs visibly
- [ ] `--radius` is `0.875rem`; corners visibly rounder
- [ ] `--gradient-primary`, `--gradient-active`, `--gradient-brand`, `--agent-color-1..6` defined and usable
- [ ] Light mode toggle still works and renders cleanly
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] Browser check via `./twd`: dark default, gradients visible

## Out of Scope

- Per-page layout changes, agent status animations, i18n, GPT-image-2 avatars

## Dependencies

None — must land before all other redesign tasks.
