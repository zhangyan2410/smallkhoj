# Frontend Agent Status System

## Goal

Replace the current ad-hoc status dot colors with a structured, extensible bucket-mapping system. New business states (searching, writing, summarizing, etc.) can be added by declaring which bucket they belong to — zero UI changes required.

## Confirmed Decisions (design session 2026-06-22)

- 6 semantic buckets with distinct colors + animations
- New states map to a bucket via a single config object
- Display text (label) per state is overridable

## Status Buckets

| Bucket | Color | Animation | Example states |
|--------|-------|-----------|----------------|
| OFFLINE | gray `#6b7280` | none (static) | offline, disconnected |
| IDLE | green `oklch(0.62 0.20 145)` | none (static) | idle, ready, online |
| STARTING | orange `oklch(0.72 0.16 50)` | progress bar pulse | start, starting, pending_start, loading |
| THINKING | amber `oklch(0.75 0.18 80)` | dot pulse | thinking, planning, analyzing |
| ACTIVE | blue→purple gradient | ring spin | working, searching, writing, summarizing, busy, running |
| ERROR | red `oklch(0.58 0.24 27)` | none (static) | error, failed, crashed, timeout, stopped |

## Requirements

### `lib/agent-status.ts` (new file)

- Export `StatusBucket` type: `"OFFLINE" | "IDLE" | "STARTING" | "THINKING" | "ACTIVE" | "ERROR"`
- Export `STATUS_BUCKET_MAP: Record<string, StatusBucket>` — maps raw status strings to buckets
  - Include all currently known states from `member-avatar.ts` / control-plane usage
- Export `STATUS_LABELS: Record<string, string>` — Chinese display labels per state (e.g. `working: "执行中"`, `thinking: "思考中"`, `idle: "待命"`)
- Export `getStatusBucket(status: string): StatusBucket` — returns bucket, defaults to OFFLINE for unknown
- Export `getStatusLabel(status: string): string` — returns Chinese label

### `lib/member-avatar.ts`

- Replace current `statusDotClass(status)` with one that delegates to `getStatusBucket()` from `agent-status.ts`
- Bucket → Tailwind class mapping:
  - OFFLINE: `bg-gray-500`
  - IDLE: `bg-emerald-500`
  - STARTING: `bg-orange-400 animate-pulse`
  - THINKING: `bg-amber-400 animate-pulse`
  - ACTIVE: gradient ring + spin animation (use `bg-gradient-to-br from-indigo-500 to-violet-500 animate-spin` on the outer ring; inner dot stays solid)
  - ERROR: `bg-red-500`

### `MemberAvatar` component

- ACTIVE bucket: render a spinning gradient ring around the status dot (small `ring-2` wrapper with `animate-spin`, slowed via `animation-duration: 2s`)
- All other buckets: current dot rendering (no ring)

### `globals.css`

- Add `@keyframes status-spin` with slower rotation (3s) if Tailwind `animate-spin` speed is too fast
- Add `@keyframes status-pulse` for STARTING/THINKING subtle scale pulse

## Acceptance Criteria

- [ ] `lib/agent-status.ts` exists with exported bucket map, labels, and helper functions
- [ ] All current statuses (`offline`, `idle`, `working`, `thinking`, `starting`, `error`, `failed`, `crashed`, `stopped`, `busy`, `running`, `pending_start`) map to correct buckets
- [ ] Adding a new state requires only one line in `STATUS_BUCKET_MAP`
- [ ] ACTIVE status shows animated gradient ring on avatar dot
- [ ] STARTING and THINKING show pulse animation
- [ ] OFFLINE and IDLE are static dots
- [ ] ERROR is static red dot
- [ ] Chinese labels exported and used in tooltip / aria-label
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] Browser check via `./twd`: at least one agent in each state shows correct dot style

## Out of Scope

- Active agents panel in DM sidebar (separate task: dm-channel-notifications)
- Backend status changes
- GPT-image-2 avatars

## Dependencies

- `06-22-frontend-visual-redesign-theme` (for `--agent-color-*` variables and dark theme)
