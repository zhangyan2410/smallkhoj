# Inkframe Mobile Shell Drawer Reachability

## Goal

Make `ProductShell` list/sidebar navigation reachable and source-testable on
mobile. The current three-column shell exposes a collapsed drawer marker but the
list column is hidden below `sm`, so chat/tasks/members/computers can lose their
left-side entity list on phone-sized layouts until real browser proof catches
it.

This is the next frontend hardening loop after
`.trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening`.

## Parent Context

Parent task:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

Related tasks:

- `.trellis/tasks/07-06-07-06-inkframe-mobile-source-contract-hardening`
- `.trellis/tasks/07-06-inkframe-browser-connection-mobile-proof`
- `.trellis/tasks/07-06-07-06-inkframe-selector-driven-twd-proof-runner`

## Current Facts

- Real browser/mobile proof remains blocked because `./twd --compact tabs`
  returns no connected tabs.
- Source tests now protect the chat tab strip from widening the mobile header.
- `ProductShellBody` renders the list column as:

```text
data-inkframe-mobile-role="sidebar-drawer"
data-inkframe-state="collapsed"
className="... hidden ... sm:flex"
```

- There is no source-level guarantee that a mobile user can open or reach this
  drawer.

## In Scope

- Add a mobile drawer toggle/source contract to `ProductShellBody` when `list`
  exists.
- Add stable `data-inkframe-*` markers for the toggle and opened/closed drawer
  state.
- Keep desktop three-column layout unchanged.
- Ensure drawer/list content is still scroll-owned with `min-h-0` /
  `overflow-y-auto`.
- Add or strengthen frontend tests that prove the source contract.
- Record browser gate status truthfully with `twd-inkframe-proof`; no real
  browser/mobile acceptance may be claimed while no tab is connected.

## Out Of Scope

- Full visual redesign of mobile shell.
- Replacing `ProductShell` or changing route ownership.
- Browser screenshots without a connected `./twd` tab.
- Backend work.
- Persisting drawer state across sessions.

## Requirements

### R1. Mobile Drawer Toggle Contract

When `ProductShellBody` is in three-column/list mode, it must expose a mobile
drawer toggle with stable selectors:

```text
data-inkframe-mobile-role="sidebar-drawer-toggle"
aria-controls="<drawer-id>"
aria-expanded="<true|false>"
```

The toggle should be hidden on desktop and visible/reachable on mobile.

### R2. Drawer State Contract

The list drawer must expose:

```text
data-inkframe-mobile-role="sidebar-drawer"
data-inkframe-state="open|collapsed"
```

The drawer must not simply be permanently `hidden` below `sm`; mobile open state
must render the drawer as a reachable element.

### R3. Desktop Compatibility

The existing desktop list column must remain `sm:flex` / three-column owned and
continue to use the resizable panel width.

### R4. Scroll Ownership

The list drawer content must keep:

```text
min-h-0
min-w-0
overflow-y-auto
```

or an equivalent explicit scroll owner. Avoid broad page-level clipping.

### R5. Evidence Honesty

Run or reference `twd-inkframe-proof` after the source pass. If still
`blocked_no_tab`, record that browser/mobile proof remains pending.

## Acceptance Criteria

- [ ] ProductShellBody has a mobile drawer toggle contract.
- [ ] ProductShellBody drawer exposes open/collapsed state through
      `data-inkframe-state`.
- [ ] Source/component test proves the toggle and drawer state markers are
      coupled to mobile reachability.
- [ ] Desktop three-column classes remain present.
- [ ] Scroll ownership remains explicit for drawer content.
- [ ] Focused frontend tests pass.
- [ ] Typecheck/lint or scoped equivalents pass.
- [ ] `git diff --check` and task validation pass.
- [ ] Check-agent review is attempted and findings are fixed or recorded.
- [ ] Real browser/mobile acceptance is not claimed while `./twd` remains
      `blocked_no_tab`.
