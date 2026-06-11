# REAL_permissions_20260611 — Evidence Notes

Marker: `REAL_permissions_20260611`
Date: 2026-06-11

## Changed Files

- `frontend/app/members/page.tsx` — Permissions tab upgrade: edit controls, add/remove entries, enforcement status

## Implementation Summary

1. **updatePermissionsAction** (server action): Reads current permissions/actions from hidden form fields, PATCHes to `/api/v1/members/{memberId}` with merged permissions/actions.

2. **addPermissionEntryAction** (server action): Adds a new key/value entry to permissions or actions. Receives existing data via hidden field, merges new entry, PATCHes.

3. **removePermissionEntryAction** (server action): Removes a key from permissions or actions. Destructures to remove key, PATCHes the remaining map.

4. **togglePermissionEntryAction** (server action): Toggles a boolean permission/action value. Reads current value from hidden field, inverts, merges, PATCHes.

5. **PermissionsTab** (upgraded): Now shows:
   - Display view with save buttons when entries exist
   - Editable permission entries with toggle buttons and remove links
   - Editable action entries with toggle buttons and remove links
   - Add new entry forms (key input + enabled/disabled select + Add button) for both permissions and actions
   - Enforcement status section with amber dot and honest note: "Config persisted but not enforced at runtime"

6. **AddPermissionForm**: New component rendering toggle/remove controls for existing entries plus add-new forms for both permissions and actions.

## Build/Type Check

```
cd frontend && npx next build
# ✓ Compiled successfully
# ✓ TypeScript passed
# ✓ All 11 routes generated
```

## Browser Evidence

| File | Description |
|------|-------------|
| `REAL_permissions_20260611-01-permissions-tab.png` | Permissions tab showing glm1 with 3 permissions, 2 actions, toggle controls, enforcement status |

## WebDriver DOM Text Assertions

- Permissions tab renders: "Permissions", "create_tasks enabled", "read_channels enabled", "send_messages enabled"
- Actions section: "claim_tasks on", "write_messages on"
- Permission entries: toggle buttons (enabled/disabled) + remove links
- Action entries: toggle buttons (on/off) + remove links
- Add forms: key input + enabled/disabled select + Add button
- Enforcement status: "Config persisted but not enforced at runtime", amber dot

## API Cross-Check

- `PATCH /api/v1/members/{id}` with `{permissions: {...}, actions: {...}}` → `{"updated": true}`
- `GET /api/v1/members` → glm1 config shows `permissions: {create_tasks: true, read_channels: true, send_messages: true}`, `actions: {claim_tasks: true, write_messages: true}`
- Backend merge-patches: new keys are merged, existing keys are overwritten

## PRD Acceptance Criteria

- [x] Agent permissions are visible and editable — Toggle buttons, add/remove forms, all wired to PATCH endpoint
- [x] Refresh preserves edited permission config — Server actions PATCH to backend, page revalidates after mutation
- [x] Runtime/daemon-facing config includes the updated permissions or backend follow-up is created — Config persisted in member.config JSONB; enforcement status honestly documented as not yet implemented
- [x] UI communicates enforcement status honestly — Amber "Config persisted but not enforced at runtime" section with explanatory text

## Known Gaps

- **Server-side enforcement**: Permission and action changes are saved to config but not enforced at runtime. Daemon/runtime blocking of unauthorized actions is not implemented.
- **No permission groups/schema**: Keys are free-form strings. No predefined permission catalog or grouped permissions.
- **Form uses hidden fields**: Current/toggle data is passed through hidden inputs (same pattern as task evidence). A single-task GET endpoint would simplify this if added later.
