# Product UI Style

> SmallKhoj frontend visual identity and product-surface conventions.

---

## Visual Identity

- SmallKhoj should read as a calm cyan/blue product workspace.
- Do not copy Slock's black-border, brutalist, or pink-heavy styling.
- Prefer dense, scannable operational layouts over marketing-style hero sections.
- Product surfaces should feel useful first: navigation, lists, details, status, actions, and evidence must be easy to inspect.

## Layout Conventions

- Use a persistent product shell for main surfaces such as Chat, Tasks, Members, Computers, and Settings.
- Favor full-width work areas, sidebars, tabs, split panes, rows, tables, and inspector panels.
- Use cards only for repeated items, modals, or genuinely framed tools. Do not nest cards inside cards.
- Keep controls stable in size; hover states, status labels, and dynamic counts must not shift the layout.

## Interaction Conventions

- Use icons for familiar actions and pair them with tooltips or visible labels when meaning is not obvious.
- Use tabs for alternate views, segmented controls for modes, toggles for binary settings, and menus for option sets.
- Critical backend mutations should have reliable server-backed submission paths; see `quality-guidelines.md`.
- Empty/loading/error states must explain the state without turning the page into a debug panel.

## Runtime/Product Surfaces

- Activity, event, runtime, daemon, and trace surfaces are product observability UI. They should summarize and link to evidence; they should not expose raw logs as the primary experience.
- Runtime state labels should distinguish user-visible work from telemetry:
  - Working / Thinking / Output / Idle are activity states.
  - Messages, assigned tasks, and targeted thread requests are actionable work.
- When a view mixes UI and backend facts, show both with clear labels instead of implying that backend state alone proves browser behavior.

## Evidence Expectations

For browser-facing work, final evidence should show the actual visible product surface, not only curl output or database rows. Use `project-webdriver-cli` for the browser portion and cross-check API/DB/trace only when those layers matter.
