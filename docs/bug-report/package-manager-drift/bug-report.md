# Frontend package-manager truth is split

## Bug diagnosis capsule

| Field | Content |
| --- | --- |
| **1. Symptom** | Bun Docker builds coexist with `bun.lock`, `package-lock.json`, `pnpm-lock.yaml` and README instructions for npm/Yarn/pnpm/Bun. Expected: one reproducible Bun install contract. |
| **2. Evidence** | Intended RED was the committed source state: all three lockfiles were tracked, `package.json` lacked `packageManager`, README listed four startup commands, and the delivery contract rejected that split authority. CodeGraph/source inventory found no importer of `useChatWebSocket`, while `frontend/server.ts` genuinely imports `ws`. |
| **3. Confirmed root cause** | Historical package-manager artifacts were retained without declaring an authority. Advisor plan 020 also grouped the dead browser hook with the still-live custom-server `ws` dependency. |
| **4. Diagnostic strategy** | Assert only `bun.lock` exists, `packageManager` pins the installed Bun version, README/CI use Bun, the dead hook/react dependency disappear, and `ws` plus its type package remain while `server.ts` imports them. |
| **5. Timeout strategy** | If frozen install or build breaks after cleanup, stop and identify the actual importer rather than regenerating alternate lockfiles. |
| **6. Warning strategy** | Reject removing `ws` merely because the browser hook is dead, or keeping npm/pnpm instructions without running those paths in CI. |
| **7. User-visible correction** | Contributors and CI install the same dependency graph as the production Docker build. |
| **8. Acceptance** | GREEN on 2026-07-23: Bun 1.3.14 frozen install checked 788 installs across 890 packages with `no changes`; frontend tests passed 168/168; ESLint, TypeScript and the production standalone Next build passed. Only `bun.lock` remains, `packageManager` and both Docker stages pin Bun 1.3.14, the dead hook/dependency are gone, and live `ws` plus `@types/ws` remain. |

## Corrected advisor boundary

The original broad cleanup suggestion was unsafe if interpreted as removing every
WebSocket package. The removed browser hook used `react-use-websocket` and had no
callers, but the custom frontend server still imports the separate `ws` package.
The implemented boundary is therefore:

- delete the unreferenced hook and `react-use-websocket`;
- keep runtime `ws` and its development-only type package;
- keep Bun as the only dependency authority and remove npm/pnpm lock artifacts;
- pin the same Bun version in package metadata and both Docker stages.
