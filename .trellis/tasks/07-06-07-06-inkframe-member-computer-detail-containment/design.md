# Design

## Strategy

Add stable source hooks and containment classes at the exact region owners:
detail card, profile object, tab strip, entry rows, lifecycle block, reconnect
command, and workspace table/list. Keep styling in existing object primitives
where possible; route code only adds layout containment and roles.

## Role Map

Members:

- `member-detail` — selected member detail card/content owner.
- `member-profile` — top identity/profile object.
- `member-tab-bar` — horizontal tab strip.
- `member-permission-entry` — permission/action row forms.
- `member-workspace-binding` — bound computer / workspace material block.

Computers:

- `computer-detail` — selected computer detail owner.
- `computer-lifecycle` — lifecycle controls block.
- `computer-reconnect-command` — reconnect command paper.
- `computer-workspace-list` — agent workspace list/table owner.
- `computer-workspace-row` — individual workspace row.

## Validation

Use source tests in `frontend/test/material-surface.test.tsx` to pin the exact
owners. This matches the current mobile-hardening approach while `./twd` remains
blocked by no connected tab.
