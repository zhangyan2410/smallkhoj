# Plan 020: Frontend deps cleanup — dead WebSocket hook + lockfile consolidation (DX-01, TDA-04)

## Status
- **Priority**: P2, Effort: S, Risk: LOW
- **Depends on**: plan 001 (DONE)
- **Category**: DX / tech-debt

## Why this matters
- `frontend/hooks/use-websocket.ts` is dead code (zero importers across `app/components/hooks/lib`). Real-time path is SSE via `connectRealtimeEvents`. Three npm deps (`react-use-websocket`, `ws`, `@types/ws`) ship only for this dead hook.
- Three lockfiles coexist (`bun.lock`, `package-lock.json`, `pnpm-lock.yaml`), no `packageManager` field. Dockerfile uses Bun. Running `npm install` or `pnpm install` produces a different dep tree than Docker — classic "works on my machine."

## Current state
- `frontend/hooks/use-websocket.ts` — full hook, `export function useChatWebSocket()`.
- `grep -rn "useChatWebSocket\|from.*use-websocket" frontend/{app,components,hooks,lib}` returns ONLY the hook's own definition (zero external importers).
- `frontend/bun.lock`, `frontend/package-lock.json`, `frontend/pnpm-lock.yaml` all exist.
- `frontend/package.json` deps include `react-use-websocket ^4.13.0`, `ws ^8.21.0`, dev deps `@types/ws`.
- `frontend/Dockerfile` uses `bun install --frozen-lockfile` (Bun is canonical).
- No `packageManager` field.

## Scope
**In scope**:
- `frontend/hooks/use-websocket.ts` — DELETE.
- `frontend/package.json` — remove `react-use-websocket`, `ws`, `@types/ws`; add `"packageManager": "bun@<version>"`.
- `frontend/package-lock.json` — DELETE.
- `frontend/pnpm-lock.yaml` — DELETE.
- `bun.lock` will regenerate on `bun install`.

**Out of scope**:
- Backend changes.
- Adding CI (plan 019).
- Resolving any other frontend deps.

## Steps

### Step 1: Confirm dead code one more time
```
grep -rn "useChatWebSocket\|use-websocket\|react-use-websocket" frontend/{app,components,hooks,lib} 2>/dev/null | grep -v "use-websocket.ts:"
```
MUST return empty (or only the file's own internal `import useWebSocket from "react-use-websocket"` line which is inside the file being deleted). If any external importer appears, STOP.

### Step 2: Delete the dead hook
`rm frontend/hooks/use-websocket.ts`.

### Step 3: Remove the three deps from package.json
Edit `frontend/package.json`:
- Remove `"react-use-websocket": "^4.13.0"` from `dependencies`.
- Remove `"ws": "^8.21.0"` from `dependencies`.
- Remove `"@types/ws": "^8.18.1"` from `devDependencies`.
- Add at top level: `"packageManager": "bun@<version>"`. Find the actual installed bun version with `bun --version` and pin it (e.g. `"bun@1.1.0"` — use the real version).

### Step 4: Delete stale lockfiles
```
rm frontend/package-lock.json
rm frontend/pnpm-lock.yaml
```
Keep `frontend/bun.lock`.

### Step 5: Re-install and verify
```
cd frontend && bun install
```
This regenerates `bun.lock` with the deps removed.

**Verify**:
- `cd frontend && bun run build` — exits 0 (no missing imports).
- `cd frontend && bun run lint` — exits 0 (no new lint errors).
- `grep -E "react-use-websocket|\"ws\"" frontend/package.json` — no matches.
- `ls frontend/*lock*` — only `bun.lock`.

## Done criteria
- [ ] `frontend/hooks/use-websocket.ts` does not exist.
- [ ] `frontend/package-lock.json` does not exist.
- [ ] `frontend/pnpm-lock.yaml` does not exist.
- [ ] `grep "packageManager" frontend/package.json` shows `"bun@<version>"`.
- [ ] `grep -E "react-use-websocket|\"ws\":|@types/ws" frontend/package.json` returns no matches.
- [ ] `cd frontend && bun run build` exits 0.
- [ ] `cd frontend && bun run lint` exits 0.
- [ ] `git status` shows only in-scope files modified.

## STOP conditions
- Step 1 reveals an active importer of `useChatWebSocket` — STOP, the hook is not dead; report.
- `bun run build` fails after removing deps — report which file imports the deleted dep; it may need a different fix (probably a missed importer).
- `packageManager` field syntax differs from what bun expects — check bun docs; the form is `"bun@<version>"`.
- Removing `ws` breaks `frontend/server.ts` (the custom server) — report; `server.ts` may use `ws` legitimately, in which case only remove `react-use-websocket` + `@types/ws`, keep `ws`.

## Maintenance notes
- After this lands, `npm install` and `pnpm install` will fail predictably (no lockfile for them) instead of silently producing drift — that's the point.
- Reviewer scrutiny: confirm `frontend/server.ts` (custom server) doesn't depend on `ws` before removing. If it does, keep `ws` and only remove the other two.
- `packageManager` field also tells tools like `corepack`/`Volta` which package manager to use.
