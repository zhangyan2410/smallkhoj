# Real Test Evidence — Members Page Redesign (Agent Gallery)

> Task: `06-22-06-22-frontend-members-page-redesign`
> Date: 2026-06-22 (system clock)

## Changes

All scoped to `frontend/app/members/page.tsx` + `app/members/create-agent-card.tsx`:

1. **Removed** the top stat-card grid (Total / Humans / Agents Bound) and the
   single `Member Directory` card with kind filter. Counts now live in section
   headings (`Agents (N)` / `Humans (N)`).
2. **Agent gallery**: new `AgentCard` renders in a responsive grid
   (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4`). Each card shows
   `MemberAvatar size="xl"` with live status, name, `getStatusLabel()` status,
   a 1-line description snippet, and contextual controls.
3. **AgentControls**: native `<form action={controlAgentLifecycleAction}>`
   bound to a new server action that POSTs
   `/api/v1/workspaces/{workspaceId}/lifecycle` with `{action}`. Per
   `quality-guidelines.md`, critical mutations use native form submission so a
   hydration gap can't silently fail.
   - Start: shown only when bucket is OFFLINE/ERROR
   - Stop: shown only when bucket is ACTIVE/THINKING/STARTING
   - Restart: shown for any bound agent
4. **Humans section**: new compact `HumanRow` (avatar + name + handle + status
   pill) in a responsive list below the agent gallery.
5. **CreateAgentCard**: restyled as a dashed-border "add" card
   (`border-dashed border-primary/30`) that sits as the final grid cell in the
   agent gallery.
6. New server action `controlAgentLifecycleAction` (reuses the Computers-page
   lifecycle endpoint pattern); unused `KindFilter` / `filteredMembers` /
   `MemberRow` / `CardDescription` / `Plus` removed.

## Browser verification (`./twd`)

```
TAB=1617511467  URL=http://127.0.0.1:3000/members

sectionHeadings : ["Agents", "Humans", "Member Groups"]   ← gallery + humans + sidebar
agentCards      : 5                                         ← all 5 agents as cards
createCards     : 2 (includes the dashed Create Agent card)
firstCard       : {
  avatars: 1,
  formCount: 2,                       ← 2 native forms (Start + Restart)
  controlButtons: ["Start","Restart"], ← Stop correctly hidden (agent offline)
  statusLabel: "离线"                  ← getStatusLabel() 中文输出
}
cardNames       : ["minimmm","laogou","mini","REALTEST_SYNC_AGENT","REAL_TEST_AGENT_1782145314"]
humansHeading   : present, 2 rows
```

### Screenshots

- `evidence/01-agent-gallery.png` — full Members page: agent card gallery + create card + humans list

### Notable behavior confirmed

- Start vs Stop gating works: offline agent shows `["Start","Restart"]`; Stop
  is hidden because the agent is not in ACTIVE/THINKING/STARTING.
- Native form controls (not client `onSubmit`) satisfy the
  `Critical Backend Mutations Use Native Form Submission` convention in
  `quality-guidelines.md`.

## Quality gates

- `npm run lint` — clean
- `npx tsc --noEmit` — clean

## Out of scope (per PRD)

- Did not implement the slide-over detail panel (kept the existing inline
  `MemberDetail` with tab structure — the PRD's "or modal" was optional and
  the inline panel still opens without a full-page reload via the
  `?member=` query).
- Computers page redesign, skill config, avatar generation — out of scope.
