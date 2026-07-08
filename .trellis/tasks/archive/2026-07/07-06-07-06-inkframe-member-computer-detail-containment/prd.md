# Inkframe Member And Computer Detail Containment

## Goal

Run the next frontend optimization loop after member/computer sidebar entity
alignment. This slice hardens the Members and Computers detail areas for
phone-width layouts so selected member profiles, tabs, permission/action rows,
runtime bindings, computer lifecycle controls, reconnect command cards, and
workspace rows do not widen the ProductShell or hide actions.

This remains a child of:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It also preserves the broader product-material umbrella:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

This slice does not implement WebGL runtime or backend cursor work. It prepares
the member/computer surfaces to inherit the Inkframe background/material pass
without layout regressions.

## Current Facts

- The previous slice aligned left-sidebar entity rows through
  `SidebarEntityItem`.
- Members detail still has dense profile, tab, permission, action, workspace,
  and invite-related surfaces that can contain long IDs, handles, cwd paths,
  permission keys, provider names, and runtime values.
- Computers detail still has dense lifecycle controls, reconnect commands,
  runtime chips, workspace rows, cwd values, session IDs, and runtime error
  strings.
- Source hooks are not yet stable for member/computer detail regions, making it
  hard to tell future agents which object set should be adjusted.
- Browser proof may remain blocked by `./twd` no-tab state; evidence must stay
  honest.

## In Scope

- Add stable mobile/source roles for:
  - `member-detail`
  - `member-profile`
  - `member-tab-bar`
  - `member-permission-entry`
  - `member-workspace-binding`
  - `computer-detail`
  - `computer-lifecycle`
  - `computer-reconnect-command`
  - `computer-workspace-list`
  - `computer-workspace-row`
- Harden detail owners with `min-w-0` and `overflow-x-hidden`.
- Make tab strips and action rows horizontally contained without broad page
  clipping.
- Ensure long keys/paths/commands can wrap or truncate inside the object that
  owns them.
- Add source contract tests for the exact detail owners.
- Spawn a check worker after implementation.

## Out Of Scope

- Visual redesign of detail cards.
- Changing backend APIs or server actions.
- Adding WebGL active material controls.
- Backend persistence for ink/material state.
- Browser acceptance when no `./twd` tab is connected.

## Requirements

### R1. Member Detail Contracts

Member detail must expose a contained owner:

```text
data-inkframe-mobile-role="member-detail"
min-w-0
overflow-x-hidden
```

Member profile, tab bar, permission/action entry rows, and workspace binding
must each have stable roles and containment classes so future visual-language
changes can target the right object class.

### R2. Computer Detail Contracts

Computer detail must expose a contained owner:

```text
data-inkframe-mobile-role="computer-detail"
min-w-0
overflow-x-hidden
```

Computer lifecycle controls, reconnect command, workspace list, and workspace
rows must each have stable roles and containment classes.

### R3. Long Text Behavior

Commands, cwd values, session IDs, permission keys, runtime provider names, and
runtime errors must not widen the shell. Use existing atoms/object primitives
where possible and add containment-only classes where the route owns layout.

### R4. Evidence Honesty

Run `./twd` proof if a tab is available. If blocked, record the no-tab status
and do not claim browser/mobile acceptance.

## Acceptance Criteria

- [ ] Source contract test fails before implementation for at least one missing
      detail role or containment class.
- [ ] Member detail roles and containment are source-tested.
- [ ] Computer detail roles and containment are source-tested.
- [ ] Focused frontend tests pass.
- [ ] TypeScript and scoped lint pass.
- [ ] `git diff --check` and task validation pass.
- [ ] Check worker reviews the slice, or self-review is recorded if worker
      startup fails.
- [ ] Browser/mobile acceptance is not claimed while `./twd` remains blocked.
