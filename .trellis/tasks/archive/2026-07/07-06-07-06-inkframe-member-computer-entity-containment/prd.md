# Inkframe Member And Computer Entity Containment

## Goal

Continue the frontend optimization loop by aligning Members and Computers list
entities with the same "sidebar entity item" vocabulary used by Chat. The user
describes these as prefab-like game UI objects: the chat sidebar member row,
members-page left list row, and computers-page left list row should be one
shared entity class with different data and tones, not unrelated bespoke cards.

This is a child of:

```text
.trellis/tasks/07-05-inkframe-product-ui-refactor
```

It also keeps the previously consolidated task in view:

```text
.trellis/tasks/07-06-inkframe-material-runtime-chat-events-optimization
```

That broader task owns material runtime, background, and persistent chat event
cursor work. This slice does not implement those backend/runtime items; it
hardens the member/computer source hooks and containment so the later refactor
has stable object names to target.

## Current Facts

- Chat already has a shared `SidebarEntityItem` primitive with object hooks,
  title/subtitle containment, active state, and unread event badge support.
- Members list still composes `MemberNameTag` directly for sidebar rows, so the
  row object is visually close but not the same prefab class as chat.
- Computers list still wraps `ComputerInkstone` directly in a raw `Link`, so it
  behaves like a full object card rather than a contained sidebar entity row.
- ProductShell owns the mobile drawer for list/detail pages, but member and
  computer list contents need their own stable roles and `min-w-0` contracts.
- Browser/mobile proof remains dependent on `./twd` connected tabs; no browser
  acceptance may be claimed if the tab bridge is unavailable.

## In Scope

- Add stable mobile/source roles for:
  - `members-list`
  - `member-entity-item`
  - `computers-list`
  - `computer-entity-item`
- Use `SidebarEntityItem` for members list rows so chat/member sidebar entity
  rows share one primitive.
- Use `SidebarEntityItem` for computers list rows while preserving the computer
  icon/status/data meaning.
- Preserve `AvatarObject` for member identities; do not reintroduce direct
  `MemberAvatar` usage in route/list code.
- Keep `ComputerInkstone` for detail/runtime-binding surfaces, not as the
  left-sidebar entity item.
- Harden long names/IDs/status metadata against mobile horizontal overflow.
- Add source contract tests that pin the real list/entity owners.
- Record evidence and run a Trellis check worker after implementation.

## Out Of Scope

- Redesigning member detail tabs or computer detail cards.
- Changing backend APIs, daemon lifecycle actions, or runtime state semantics.
- Implementing backend read cursor persistence.
- Implementing WebGL material runtime changes.
- Launching Chrome or using Playwright.

## Requirements

### R1. Members List Source Contract

`MembersList` must expose a contained list owner:

```text
data-inkframe-mobile-role="members-list"
min-h-0
min-w-0
overflow-x-hidden
```

Each row must expose:

```text
data-inkframe-mobile-role="member-entity-item"
```

and use `SidebarEntityItem` as the row prefab. Member avatars stay inside
`AvatarObject`.

### R2. Computers List Source Contract

The Computers page list owner must expose:

```text
data-inkframe-mobile-role="computers-list"
min-h-0
min-w-0
overflow-x-hidden
overflow-y-auto
```

Each row must expose:

```text
data-inkframe-mobile-role="computer-entity-item"
```

and use `SidebarEntityItem` as the sidebar row prefab. `ComputerInkstone`
remains for detail/runtime object surfaces, not the left list row.

### R3. Prefab Vocabulary

Members, computers, channel rows, and DM rows are all "sidebar entity item"
instances. They may vary by tone, avatar/icon, status, and trailing metadata,
but they should share source hooks and interaction class names.

### R4. Mobile Containment

Long member names, handles, computer names, daemon versions, workspace counts,
and heartbeat text must not widen the shell. The row primitive must own `min-w-0`
and truncation through `SidebarEntityItem`; route code may add containment-only
classes.

### R5. Evidence Honesty

Run `./twd` proof if a browser tab is available. If not, record the blocked
state and do not claim browser/mobile acceptance.

## Acceptance Criteria

- [ ] A source contract test fails before implementation for missing member or
      computer entity/list roles.
- [ ] Members list owner and member entity rows are source-tested.
- [ ] Computers list owner and computer entity rows are source-tested.
- [ ] Members list rows use `SidebarEntityItem` and still use `AvatarObject`.
- [ ] Computers list rows use `SidebarEntityItem`; detail surfaces still use
      `ComputerInkstone`.
- [ ] Focused frontend tests pass.
- [ ] TypeScript and scoped lint pass.
- [ ] `git diff --check` and task validation pass.
- [ ] Trellis check worker reviews the slice, or self-review is recorded if
      worker startup fails.
- [ ] Browser/mobile acceptance is not claimed while `./twd` remains blocked.
