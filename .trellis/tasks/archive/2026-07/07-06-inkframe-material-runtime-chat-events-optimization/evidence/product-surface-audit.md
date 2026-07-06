# Product Surface Audit For 07-05 Carry-Over

This audit exists because `07-05-inkframe-product-ui-refactor` is part of the
current `07-06` implementation pass. Runtime/backend work is not enough: the
real product must visibly move to the Inkframe material workbench.

## Audit Contract

For every row below, verify before and after the refactor:

- route is mounted inside the expected shell;
- old pink/dark/dirty background is gone from user-facing product UI;
- clean dry-paper desk background is visible;
- WebGL/background material activation is present or intentionally hidden;
- foreground content remains readable over material/background layers;
- mobile has no overlap or horizontal overflow where applicable.

## Route Matrix

| Route / Surface | Shell | Required Treatment | Current Evidence | Follow-Up |
|---|---|---|---|---|
| `/chat` | Product shell expected | Clean desk background, sidebar entity items, no old root-count emphasis | Pending browser audit | Verify with `./twd` connected tab |
| `/chat/[channel]` | Product shell expected | Full chat object treatment, material-capable messages, backend unread markers | Pending browser audit | Verify active channel/DM/thread cursor clearing |
| `/tasks` | Product shell expected | Task ticket/evidence/review objects, material-capable task surfaces | Pending browser audit | Verify desktop and 390px mobile |
| `/members` | Product shell expected | Shared desk background; full page object redesign deferred | Pending browser audit | Check no old pink/dark route background |
| `/computers` | Product shell expected | Shared desk background; full page object redesign deferred | Pending browser audit | Check no old pink/dark route background |
| `/settings` | Product shell expected | Shared desk background; full page object redesign deferred | Pending browser audit | Check no old pink/dark route background |
| Product landing/dashboard | Product shell expected | Shared desk background; no decorative landing-page regression | Pending browser audit | Identify actual route before verification |
| Chat mobile `390px` | Product shell expected | Message list/composer usable, no overflow, material modes do not steal scroll | Pending browser audit | Verify after connected `./twd` |
| Tasks mobile `390px` | Product shell expected | Active task/status/evidence usable, no overflow | Pending browser audit | Verify after connected `./twd` |

## Visual Guardrails From User Decisions

- Inkframe is the default product direction, not a theme toggle target.
- WebGL material should be meaningfully available for chat/task/background.
- Background should start as clean dry paper, not dirty washed ink, pink, or
  dark theme residue.
- Do not tilt every object.
- Hover motion means the object can be acted on or moved.
- Avatars do not receive decorative stamps/seals and must not obscure status
  dots.
- Short chat messages may tilt subtly; long agent messages remain stable.
- Message toolbar is hidden by default and stays near the message, not at the
  far edge of a full row.
- Task messages inside chat remain ordinary messages for now.
- No backend, localStorage, or IndexedDB persistence for large ink/image blobs.
- Backend stores only lightweight read/unread cursor metadata.

## Old Style Leak Search

Run during implementation:

```bash
rtk rg -n "pink|rose|purple|slate|gradient|background|theme|rotate|tilt|stamp|seal|shadow" frontend/app frontend/components frontend/messages
```

Classify each real match before editing:

- old-style leak to remove;
- semantic status color to keep;
- unrelated dependency/test fixture;
- deferred non-chat/task page treatment.

## Browser Evidence Status

Pending. Current `./twd --compact tabs` has reported no connected tabs, so this
file is a planning and audit scaffold until a browser tab is connected.
