# Frontend Chat — Message Identity & Agent Color Stripes

## Goal

Make agent messages visually distinct from human messages in chat/DM. Each agent gets a consistent identity color (cycling from a 6-color palette). Agent messages render with a colored left-border stripe. Multiple agents in the same channel are visually differentiable at a glance.

## Confirmed Decisions (design session 2026-06-22)

- Keep flat/linear layout (Slack-style, not bubbles) for both DM and channel
- Agent messages: colored left-border stripe (2–3px), color derived from agent identity
- Human messages: no stripe, subtle background tint difference
- Color source: `--agent-color-1..6` variables (from theme task), assigned by hashing agentId

## Requirements

### `lib/agent-color.ts` (new file)

- Export `getAgentColor(agentId: string): string` — returns a CSS variable name (e.g. `"var(--agent-color-3)"`) by hashing the agentId mod 6
- Export `getAgentColorClass(agentId: string): string` — returns a Tailwind-compatible inline style or class

### `MessageFrame` component (`components/message-frame.tsx`)

- Accept optional `agentId?: string` prop
- When `senderType === "agent"` and `agentId` is provided: render a 2px colored left border on the message container using `getAgentColor(agentId)`
- Stripe implementation: `border-l-2` with `borderLeftColor: getAgentColor(agentId)` as inline style (or via CSS variable)
- Human messages: no stripe; keep current layout unchanged
- Add subtle left padding (`pl-2`) inside the stripe so content doesn't touch the border

### `channel-client.tsx`

- Pass `agentId` (from `message.sender` when `message.senderType === "agent"`) to `MessageFrame`
- Look up the matching `Member` from `allMembers` to get the stable `member.id` for color hashing (use `member.id`, not `message.sender` string, for stability)

### Role badge

- Current `assistant` badge: upgrade to use the agent's identity color as background tint (e.g. `background: color-mix(in oklch, var(--agent-color-N) 15%, transparent)`)
- Human messages: keep existing muted badge

## Acceptance Criteria

- [ ] Agent messages in channel and DM show a colored left border stripe
- [ ] Same agent always gets the same color across page refreshes (deterministic hash)
- [ ] Different agents in the same channel show different stripe colors
- [ ] Human messages have no stripe
- [ ] Role badge for agents uses the agent's identity color tint
- [ ] Layout/readability not degraded on narrow viewports
- [ ] `npm run lint` and `npx tsc --noEmit` pass
- [ ] Browser check via `./twd`: channel with 2+ agents shows distinct stripe colors

## Out of Scope

- Bubble-style messages
- Per-agent color picker (color is auto-assigned)
- Thread/reply panel stripe (can follow in a later pass)

## Dependencies

- `06-22-frontend-visual-redesign-theme` (for `--agent-color-1..6`)
