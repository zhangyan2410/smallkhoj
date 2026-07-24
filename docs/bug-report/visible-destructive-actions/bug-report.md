# Task and File deletion have no complete visible contract

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | Real PostgreSQL Task/File delete APIs are correct, but users have no consistent authorized, localized, accessible confirmation/rollback UI. Expected: named consequence, pending state, success projection removal and actionable failure with the item retained. |
| **2. Evidence** | Task details and file rows expose no Task/File delete control. Existing channel deletion uses `window.confirm`, which does not provide the required failure/focus/status contract. Backend route tests already prove owner/admin, denial, tombstone and compensation semantics. |
| **3. Confirmed root cause** | Schema work repaired transaction semantics first, while frontend state remained server-rendered and no shared destructive-action state machine owned confirmation, request and recovery. |
| **4. Diagnostic strategy** | Write component/action REDs for authorization, target/consequence copy, cancel, keyboard/dialog labels, double-submit, 401/403/404/409/500, success callback and failure retention/focus. Then wire canonical `apiDelete` and targeted invalidation. |
| **5. Timeout strategy** | Bound the request; timeout is a visible failure and leaves the item present. Never assume success after an interrupted response. |
| **6. Warning strategy** | Reject optimistic permanent removal, raw `window.confirm`, full browser reload, hidden unauthorized buttons, or success copy when storage cleanup reports a non-terminal condition. |
| **7. User-visible correction** | Authorized owners/admins can safely delete a named Task/File and understand consequences; failures preserve data and offer retry. |
| **8. Acceptance** | Component/API integration tests plus `./twd` prove authorized success, denied/failed retention, localized copy, focus/status accessibility and correct task/file projections. |
