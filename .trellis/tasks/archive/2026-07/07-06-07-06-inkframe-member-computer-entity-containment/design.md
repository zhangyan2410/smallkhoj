# Design

## Approach

Use the existing `SidebarEntityItem` primitive as the source of truth for
left-sidebar entity rows. This keeps the user's prefab language concrete:
"member item", "computer item", "channel item", and "DM item" become instances
of one product primitive with different props.

## Source Hooks

- Members list owner: `data-inkframe-mobile-role="members-list"`
- Member row: `data-inkframe-mobile-role="member-entity-item"`
- Computers list owner: `data-inkframe-mobile-role="computers-list"`
- Computer row: `data-inkframe-mobile-role="computer-entity-item"`

## Component Boundaries

- `SidebarEntityItem` remains in `frontend/components/inkframe-object-ui.tsx`.
- `MembersList` composes `SidebarEntityItem` with `AvatarObject`.
- `ComputersPage` composes `SidebarEntityItem` with a computer icon and compact
  status metadata.
- `ComputerInkstone` remains the detail/runtime-binding metaphor.

## Validation Strategy

Use source tests because the browser bridge may be unavailable. The tests should
pin actual owners, not a nearby string:

- match the MembersList owner wrapper;
- match the `SidebarEntityItem` call inside `renderItem`;
- match the Computers list scroll owner;
- match `ComputerListRow` using `SidebarEntityItem`;
- verify computer detail still contains `ComputerInkstone`.

Browser evidence is attempted through the project `./twd` guard and recorded as
blocked if no tab is connected.
