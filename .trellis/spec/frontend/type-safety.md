# Type Safety

> Type ownership and validation patterns for the frontend.

The frontend is TypeScript-first. Shared API-facing types live in
`frontend/lib/control-plane.ts` until a generated/shared API contract exists.
Route files may define local view models, but they should not invent duplicate
API shapes that drift from `control-plane.ts`.

---

## Type Organization

| Type kind | Location | Example |
| --- | --- | --- |
| API/resource shape reused across pages | `frontend/lib/control-plane.ts` | `Member`, `Computer`, `TaskRunTemplate` |
| Route-only view model | route file or route-local component | `TaskEvidence` in tasks page |
| Component props | same file as component, near export | `ProductShellBody` props |
| i18n copy object | route helper function with inferred return type | `type ComputersCopy = ReturnType<typeof makeComputersCopy>` |

Do not create second copies of `Member`, `Computer`, runtime status, or task-run
template shapes inside pages.

---

## API Response Rules

Current helpers return typed JSON with fallback defaults:

```ts
apiGet<{ members: Member[] }>("/api/v1/members", { members: [] })
```

Until runtime schemas exist, callers must:

- provide a safe fallback for list/detail endpoints
- optional-chain backend fields that are not guaranteed
- handle unknown enum/status strings with a default visual bucket
- avoid treating truthy/falsy optional backend fields as authoritative

If a UI decision is security-sensitive or destructive, add a backend/API schema
or a narrow runtime guard before rendering the action.

---

## FormData and Search Params

Server actions receive `FormData`; normalize every field at the boundary:

```ts
const memberId = String(formData.get("memberId") || "").trim()
if (!memberId) redirect("/members?error=Missing%20member")
```

Search params may be `string | string[] | undefined`; normalize once with a
helper before use. Do not pass raw `searchParams.foo` deeply into components.

---

## Forbidden Patterns

- `any` for API responses, component props, or event payloads.
- Blind casts such as `response.json() as Task[]`.
- Duplicating API types inside multiple pages.
- Template-string class/variant lookup from backend data, for example
  `` `sk-status-${status}` ``. Use explicit mapping functions such as
  `badgeClass()`, `dotClass()`, and `statusLabel()`.
- Passing an entire translation object or function-heavy object across a
  server-to-client boundary. Pass plain string fields.

---

## Correctness Checklist

- [ ] API/resource types are imported from the shared source when reused.
- [ ] Unknown backend enum/status values render a safe default.
- [ ] FormData and URL params are normalized at the boundary.
- [ ] Client component props are serializable when crossing server-to-client.
- [ ] No `any`, unchecked casts, or duplicate status/color mappings.

