# Member Identity, Suggestions, and Removal UI Contracts

## 1. Scope / Trigger

Use this contract for signup, Agent create/edit, member lists, Channel composer
suggestions, notifications, task creation from messages, and Channel member
management. The UI is Chinese-first and bilingual. The product label is
`名字` / `Name`; do not expose the implementation term `handle` as a competing
field.

## 2. Signatures

```typescript
validateMemberName(raw: string): MemberNameValidation
activeComposerToken(text: string, caret: number): ComposerToken | null
replaceComposerToken(text: string, token: ComposerToken, value: string): string
mentionedAgentHandle(memberIds: string[], channelMembers: Member[], fallback: Member[]): string | null
markChannelMemberRemoved(barrier, channelId, memberId): void
markChannelMemberPresent(barrier, channelId, memberId): void
filterRemovedChannelMembers(barrier, channelId, members): Member[]
```

Relevant actions and requests:

```text
signup -> Better Auth -> POST /api/v1/auth/better-auth/bridge { name }
create Agent -> POST /api/v1/members/agents { name, description?, ...runtime fields }
send message -> { content, mentionMemberIds: string[] }
remove Agent -> DELETE /api/v1/channels/{channelId}/members/{agentId}
```

## 3. Contracts

### Name and Description UI

- Sign Up requires Name and shows immutable `@name` preview/availability. Sign In
  has no Name field. Bootstrap failure remains retryable without repeating the
  Better Auth signup.
- Agent creation has one Agent Name field, not separate Name/handle/displayName
  concepts. Name + Computer occupy row one, Description spans row two, and
  Runtime + Provider occupy row three; narrow layouts preserve that semantic
  order.
- Description is visibly optional, plain text, expertise-oriented, and shows a
  localized `0/200` counter. Human surfaces never submit it.
- Agent labels render canonical `name`/`handle`; Human displayName may be a
  secondary decoration only. Agent displayName is not an API/UI concept.

### Runtime and Provider options are detected, not hardcoded

- The create-Agent Runtime select is built by
  `runtimeOptionsFromDetected(computers, filters)` (`frontend/lib/runtime-options.ts`)
  from `computer.detectedRuntimes` — the same data source as the Provider
  dropdown (`detectedProviderOptions`, also `detectedRuntimes`). One source,
  two controls; they must never diverge.
- Option states: detected runtime → selectable; known-but-undetected
  (`claude_code`, `codex`) → rendered as a disabled "unavailable" item
  (`disabled: !opt.available` in `components/create-agent-form.tsx`), not
  hidden; `custom` always selectable; bundled Pi always selectable with the
  bundled marker. `not_installed` entries are presence evidence, not
  availability — they must not make an option selectable.
- Hardcoding a runtime or provider list in a form, or making an undetected
  item selectable "for testing", is a contract violation: users would pick a
  runtime no connected computer can run.

### Composer and targeting

- `@` suggestions contain only current Channel members. Selection is bound to
  Member UUID and inserts the server-provided contextual `reference`.
- `#` suggestions contain authorized, current-Server, non-DM Channels only.
  Channels never gain cross-Server qualification.
- Keyboard, pointer/touch, Escape, narrow layouts, scroll containment, and
  Chinese IME composition use the shared suggestion surface.
- Notifications and “create task from message” use persisted `mentions` Member
  UUIDs. They never scan body substrings, use an ASCII-only mention regex, or
  compare displayName.

### Remove Agent UI

- Only owner/admin humans see the action; DMs, Humans, and unauthorized viewers
  do not render it.
- The action is visible without hover, names both `@agent` and the current
  Channel in confirmation, and states that it removes only Channel membership.
- The shared destructive dialog owns pending, retryable failure, stale 404,
  success, focus, and non-dismissible in-flight states with bilingual copy.
- Success immediately removes the member from the panel and therefore from `@`
  suggestions, then refetches the authoritative roster.
- A Channel-scoped removal barrier filters late/stale roster responses so they
  cannot resurrect the removed row. A confirmed local or realtime rejoin clears
  that barrier. The same Member ID in another Channel is unaffected.

### Admin-only entries hide by role, not by 403

- Server-management entries are gated by `canManageActiveServer(session)`
  (`frontend/lib/server-permissions.ts`): an **active** owner/admin membership
  for the **currently selected** Server. An owner role on another Server never
  grants access, and status must be `active`.
- Unauthorized users must not render the entry at all — hide it, never show it
  and fail with 403 after the click (08-13 R3). Rendering-then-rejecting leaks
  that the surface exists and produces dead-end errors.
- Any newly added admin-only entry must ship its role gate in the same change;
  an ungated render is a security regression, not a styling follow-up.

## 4. Validation & Error Matrix

| Condition | Required UI result |
| --- | --- |
| Invalid Name syntax/length/reserved suffix | localized inline error; submit disabled |
| Name availability pending | explicit pending state; no optimistic availability claim |
| Backend Name conflict | localized retryable error from authoritative response |
| Description over 200 code points | localized error and disabled submit |
| IME composition active | Enter does not commit a suggestion or send |
| No matching `@` or `#` suggestions | localized empty state; typing remains possible |
| Remove request pending | dialog remains open and cannot be dismissed |
| Remove returns 403/404/network error | visible retryable dialog failure; row remains |
| Remove succeeds | row/suggestion disappears immediately; success state is announced |
| Stale GET resolves after successful removal | removed row remains filtered |

## 5. Good / Base / Bad Cases

- Good: Chinese-default Agent creation accepts `排障专家` and an optional
  expertise Description without changing runtime/provider behavior.
- Good: selecting a colliding member inserts `@ean-s7k2m` while selection state
  records its UUID.
- Good: remove succeeds, a previously in-flight roster GET returns the old row,
  and the removal barrier keeps the row hidden.
- Base: no collision; suggestions and messages use compact `@ean`.
- Bad: showing Agent `displayName` as a second editable or preferred label.
- Bad: parsing `/@[A-Za-z0-9_-]+/` to decide notifications or task assignees.
- Bad: optimistic removal followed by an unguarded `setMembers(response.members)`.

## 6. Tests Required

- Shared fixture parity for backend/frontend Unicode Name validation.
- Signup Sign Up/Sign In field separation, immutable preview, bootstrap retry,
  and safe invite `returnTo`.
- Shared Agent form in Members and Chat entry points, bilingual Description,
  counter, responsive order, loading/disabled/error states.
- Composer caret replacement, contextual qualified reference, Member UUID
  submission, Channel scope, keyboard/touch/IME, and empty/error states.
- Notification and task-assignee tests proving only persisted Member IDs target a
  member, including Chinese Agent Names.
- Removal authorization/source contract, destructive dialog states, immediate
  update, stale roster barrier, and explicit rejoin recovery.
- Browser evidence uses `./twd` with exact URL/DOM and screenshots only when the
  visible UI changes.

## 7. Wrong vs Correct

### Wrong

```typescript
const mentioned = content.match(/@[A-Za-z0-9_-]+/g)
const agent = allMembers.find((item) => item.displayName === mentioned?.[0])
setMembers(await fetchRoster()) // may resurrect a just-removed Agent
```

### Correct

```typescript
const assignee = mentionedAgentHandle(message.mentions ?? [], members, allMembers)
markChannelMemberRemoved(removalBarrier.current, channelId, agentId)
setMembers((current) => current.filter((member) => member.id !== agentId))
setMembers(filterRemovedChannelMembers(removalBarrier.current, channelId, await fetchRoster()))
```
