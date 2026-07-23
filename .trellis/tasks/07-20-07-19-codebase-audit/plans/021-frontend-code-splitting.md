# Plan 021: Frontend code-splitting + loading/error boundaries (TDA-02, FRONTEND-02)

## Status
- **Priority**: P2, Effort: M, Risk: LOW–MED
- **Depends on**: plan 001 (DONE)
- **Category**: performance / frontend correctness

## Why this matters
- Heavy deps (`react-markdown`/`remark-gfm`/`unified` ~80-100KB gz; `@dnd-kit` 3 pkgs ~30-40KB; `@dicebear/core` + a full style) load on first paint of `/`, `/chat/[channel]`, `/tasks` even when the user never opens a thread, drags a task, or needs an agent avatar. Zero `next/dynamic` usage in source.
- No `loading.tsx`/`error.tsx`/`Suspense` anywhere — server components do `Promise.all` of 3-7 fetches, any slow one blocks the whole page; failures are silently swallowed by `res.ok ? ... : {}`.

## Current state
- `frontend/app/page.tsx:20` statically imports `MemberAvatar` → pulls dicebear.
- `frontend/app/chat/[channel]/channel-client.tsx:35,38` statically imports `MarkdownMessage` (react-markdown chain) and `TaskBoard` (dnd-kit chain).
- `frontend/app/tasks/page.tsx:33` statically imports `TaskDndBoard` → TaskBoard (same dnd-kit chain).
- `find frontend/app -name 'loading.tsx' -o -name 'error.tsx'` → zero results.
- Only `Suspense` import: `frontend/app/members/page.tsx`.

## Scope
**In scope**:
- `frontend/app/page.tsx` — dynamic-import dicebear-backed avatar on landing.
- `frontend/app/chat/[channel]/channel-client.tsx` — dynamic-import `MarkdownMessage` and `TaskBoard` with `ssr:false`.
- `frontend/app/tasks/page.tsx` — dynamic-import `TaskDndBoard` with `ssr:false`.
- New: `frontend/app/loading.tsx`, `frontend/app/error.tsx` (route-segment level).
- Optionally per-card `<Suspense>` in `frontend/app/page.tsx` and `frontend/app/chat/[channel]/page.tsx`.

**Out of scope**: backend changes; `channel-client.tsx` full split (TDA-05, separate plan).

## Steps

### Step 1: Dynamic-import MarkdownMessage + TaskBoard in chat route
At the top of `frontend/app/chat/[channel]/channel-client.tsx`, replace:
```tsx
import { MarkdownMessage } from "@/components/markdown-message";
import { TaskBoard } from "@/components/task-board";
```
with:
```tsx
import dynamic from "next/dynamic";
const MarkdownMessage = dynamic(() => import("@/components/markdown-message").then(m => ({ default: m.MarkdownMessage })), { ssr: false });
const TaskBoard = dynamic(() => import("@/components/task-board").then(m => ({ default: m.TaskBoard })), { ssr: false });
```
(Adjust the import path and named/default export to match the actual modules — read each file first.)

**Verify**: `cd frontend && bun run build` → exit 0; bundle report (if Next.js shows one) shows react-markdown/dnd-kit moved out of the main chunk.

### Step 2: Same for tasks page
In `frontend/app/tasks/page.tsx`, dynamic-import `TaskDndBoard` (same pattern).

### Step 3: Dynamic-import avatar on landing page
In `frontend/app/page.tsx` or wherever `MemberAvatar` is used, dynamic-import it:
```tsx
const MemberAvatar = dynamic(() => import("@/lib/member-avatar").then(m => ({ default: m.MemberAvatar })), { ssr: false });
```
If `MemberAvatar` is server-rendered for SEO/first-paint reasons, consider generating the avatar data URI in a server component or API route instead, and only hydrate the croodles style on the client. Pick the simpler approach.

### Step 4: Add route-segment loading.tsx + error.tsx
Create `frontend/app/loading.tsx`:
```tsx
export default function Loading() {
  return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Loading…</div>;
}
```
Create `frontend/app/error.tsx`:
```tsx
"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <p className="text-destructive">Something went wrong.</p>
      <button onClick={reset} className="...">Try again</button>
    </div>
  );
}
```
(Adjust styling to match DESIGN.md tokens.)

### Step 5: Per-card Suspense (optional, if practical)
In `frontend/app/page.tsx`, if it does `Promise.all([a, b, c, ...])`, split into per-card `<Suspense fallback={<Skeleton/>}>` so a slow `/activity` doesn't block the agents panel. Skip if the page is structurally one big fetch — leaving for TDA-05 channel-client split.

**Verify**: `cd frontend && bun run build` → exit 0. `./twd` screenshot per AGENTS.md shows loading state visible during initial render.

## Done criteria
- [ ] `grep -rn "next/dynamic" frontend/app/page.tsx frontend/app/chat/[channel]/channel-client.tsx frontend/app/tasks/page.tsx` shows dynamic imports.
- [ ] `frontend/app/loading.tsx` and `frontend/app/error.tsx` exist.
- [ ] `cd frontend && bun run build` exits 0.
- [ ] `cd frontend && bun run lint` exits 0.
- [ ] No source file still has a bare `import { MarkdownMessage }` / `import { TaskBoard }` that could be dynamic.

## STOP conditions
- `dnd-kit` doesn't work with `ssr:false` dynamic import (some libs need SSR for hydration) — report; fall back to a route-level code split (move TaskBoard to a separate route) or accept the bundle cost for now.
- The landing page's `MemberAvatar` is rendered in a server component and dynamic import changes hydration semantics — report; use the server-component-side data URI approach instead.
- Adding `<Suspense>` per card reveals the cards share state and can't render independently — skip Step 5, leave for TDA-05.

## Maintenance notes
- `ssr:false` dynamic imports add a client-side waterfall for the first paint of the dynamic component. For above-the-fold content, prefer server components + RSC streaming; for below-the-fold interactive widgets (markdown editor, drag-drop board), `ssr:false` is the standard pattern.
- Reviewer scrutiny: confirm the loading skeleton matches DESIGN.md tokens; an unstyled skeleton is worse than no skeleton.
