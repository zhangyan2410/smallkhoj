# frontend cyan blue design system

## Goal

Create a cohesive SmallKhoj frontend visual system that is product-grade, cyan/blue, and distinct from Slock's black-border/brutalist style.

## Requirements

* Define cyan/blue theme tokens in the existing Tailwind/CSS variable setup.
* Standardize app surfaces: shell, sidebar row, toolbar, tabs, status badge, runtime chip, message row, task card, member row, computer row, empty state, loading state, error state.
* Keep layouts dense and operational rather than decorative.
* Prefer lucide icons already used in the app.
* Avoid Slock's exact brutal black borders/pink accents.
* Avoid one-note blue-only UI by using neutral surfaces and a small set of semantic colors.
* Preserve accessibility contrast and keyboard/focus states.

## Acceptance Criteria

* [ ] Core design tokens are documented and used by shared UI patterns.
* [ ] Chat/Tasks/Members/Computers can reuse the same status/chip/list-row patterns.
* [ ] UI text does not overflow in key rows/cards on desktop or mobile.
* [ ] Real screenshots show a coherent cyan/blue SmallKhoj identity.

## Real Test SOP

Use marker `REAL_design_<timestamp>`.

1. Open key routes with `twd.py`: `/`, `/tasks`, `/members`, `/computers`.
2. Capture screenshots after the design system is applied.
3. Verify no obvious overlap, unreadable text, or Slock-copy styling.
4. Record notes and screenshot paths under `evidence/`.

## Context

* Design reference: `zy-think/khoj-design-spec.md`
* Parent research: `.trellis/tasks/06-09-product-maturity-gap-decomposition/research/slock-product-surface.md`
* Frontend specs: `.trellis/spec/frontend/`
