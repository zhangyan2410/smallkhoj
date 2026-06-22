# Frontend Members Page Redesign — Card Gallery

## Goal

Transform the Members page from an admin CRUD layout into a product-quality agent gallery. Agents are displayed as cards with avatar, status animation, and quick-action controls (start/stop/restart). The page should look compelling in a promo video.

## Confirmed Decisions (design session 2026-06-22)

- Agent list: card gallery view (not a table/list)
- Each agent card: avatar + status animation + name + description snippet + start/stop/restart buttons
- Human members: simpler row list (not cards) — they don't need the same visual treatment
- Detail panel: keep existing tab-based detail (profile/permissions/workspace) but upgrade visual styling
- Control operations: start/stop/restart accessible directly from agent card (not only from Computers page)

## Requirements

### Agent Cards Grid

- Replace `MemberRow` for agents with `AgentCard` component
- Grid layout: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4`
- Each `AgentCard`:
  - `MemberAvatar` at `size="lg"` centered at top
  - Agent name (bold, truncated)
  - Status label (from `getStatusLabel()`) with status dot animation
  - Description snippet (1 line, muted, truncated)
  - Quick actions row: Start / Stop / Restart buttons (small, icon+label)
    - Start: only shown when status is OFFLINE/ERROR
    - Stop: only shown when status is ACTIVE/THINKING/STARTING
    - Restart: always shown for bound agents
  - Card uses `ring-1 ring-primary/20` border in dark mode (from theme task)
  - Card hover: subtle `scale-[1.02]` transition

### Human Members

- Keep as a compact list (not cards) below the agent gallery
- Slightly upgraded styling: better spacing, avatar, status pill

### Page Layout

- Remove top stat cards (Total / Humans / Agents Bound) — move count to section headings
- Section heading "Agents (N)" above agent grid
- Section heading "Humans (N)" above human list
- Keep `CreateAgentCard` form but style it as a dashed-border "add" card in the grid

### Control Actions (Server Actions)

- Add `startAgentAction`, `stopAgentAction`, `restartAgentAction` server actions
- These call the backend `/api/v1/members/:id/start` (or equivalent) — check existing API
- Buttons are disabled and show spinner while pending
- On success: `revalidatePath("/members")`

### Detail Panel

- Keep existing tab structure but upgrade card styling to use new theme variables
- Open in a slide-over panel or modal instead of inline (reduces layout shift)

## Acceptance Criteria

- [ ] Agents render as cards in a responsive grid
- [ ] Each card shows avatar with live status animation
- [ ] Start/Stop/Restart buttons visible on card; contextually shown based on status
- [ ] Human members shown as compact list below agent grid
- [ ] `CreateAgentCard` is styled as an "add" card in the grid
- [ ] Detail panel opens without full-page reload
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] Browser check via `./twd`

## Out of Scope

- Computers page redesign
- Agent skill configuration
- GPT-image-2 avatar generation

## Dependencies

- `06-22-frontend-visual-redesign-theme`
- `06-22-frontend-agent-status-system` (for `getStatusLabel`, bucket mapping)
