# Local completion acceptance supplement — 2026-08-06

## Candidate

- Worktree: `/Users/code/project/smallkhoj`
- Branch / HEAD: `main` / `7dd800649bb2`
- Frontend: `http://127.0.0.1:3000` and the isolated auth origin
  `http://localhost:3000`
- Backend: `http://127.0.0.1:8000`
- Daemon: `0.2.6`, diagnostics `http://127.0.0.1:60049`
- OpenCode Agent: `@open2`, Member ID
  `baab150d-7494-4217-a088-6cce86b9c59e`

The product flows below used the disposable local database authorized for this
task. Evidence queries were executed in read-only transactions after each UI
mutation.

## 1. Persistent narrow viewport and real touch selection — PASS

The connected Quark tab was held in one debugger attachment while applying a
real CDP mobile/touch override:

```text
viewport: 390 x 844
mobile: true
maxTouchPoints: 5
pointer: coarse
```

The Create Agent form had no horizontal overflow and stacked in the required
semantic order:

```text
Name        top 281, width 338
Computer    top 369, width 338
Description top 435, width 338
Runtime     top 587, width 338
Provider    top 653, width 338
```

`Input.dispatchTouchEvent` selected the `@open2` suggestion. It inserted the
atomic token `@open2 `, closed the suggestion list, and retained composer
focus. Screenshot: `REAL_narrow_create_agent_390x844_20260806.png`.

## 2. Real cross-origin same-Name collision — PASS

A second Human chose the same immutable Name `张翰` during real signup, received
their own home Server, followed a real invitation, and joined the target
Server without changing identity:

```text
Account ID:       c9d769ef-7e60-4bf5-96b0-e1e873b97228
Human Member ID:  49609515-2833-4fcf-ba63-0ee3457c0b62
Home Server ID:   a942ed63-e9a3-42d8-bbb0-8e59a9c8acd4
serverHandle:     st6e4
Target Server ID: 9a023433-bace-466d-9185-529e23b8b0bd
```

The real `#identity-test` Channel roster became:

```text
@张翰-s8db6  owner Human
@open2       Agent
@张翰-st6e4  foreign Human
```

The `@` suggestion popup showed those exact canonical references. Touch/pointer
selection of the foreign Human inserted `@张翰-st6e4 `; no Human displayName or
Server presentation name entered the token. Screenshot:
`REAL_collision_suggestions_20260806.png`.

Durable backend evidence for `event_records.seq = 31`:

```text
eventType: channel.member_joined
channelId: 0397e5a6-6750-4aae-a989-32734bf43b3e
rosterRevision: 7
member: { kind: human, memberId: 49609515-2833-4fcf-ba63-0ee3457c0b62,
          reference: @张翰-st6e4 }
referenceUpdates:
  [{ memberId: 2ba90564-fa70-4b81-ad07-5295cefcacd8,
     reference: @张翰-s8db6 }]
```

The compact event contained no Description, Human displayName, Server
presentation name, or full roster. OpenCode processed the update in session
`ses_02cac6835ffexJWhOwHzcCW900`; a read-only message query after the event
timestamp found no visible acknowledgement message in the Channel.

## 3. Second-Channel continuity baseline — PASS

Real UI creation produced Channel `#remove-continuity-20260806`, ID
`5629cf3f-99bf-46ee-83bc-1572a3e305bd`, with Human `张翰` and Agent `open2` as
members. Before removal from `#identity-test`, the real provider round-trip was:

```text
Human: @open2 REAL_SECOND_CHANNEL_202608060310 ...
Agent: REAL_SECOND_CHANNEL_202608060310_ACK
```

Both message rows and their sender Member IDs were verified in a read-only
database transaction. This Channel remains prepared for the post-removal
continuity marker.

## 4. Better Auth success / SmallKhoj bootstrap retry — PASS

An isolated `localhost` cookie scope used a deliberately incorrect frontend
`AUTH_BRIDGE_SECRET` while leaving the current backend unchanged. Real signup
used Name `重试用户` and a unique email.

After Better Auth signup succeeded, the bridge returned
`Invalid auth bridge secret`. The browser redirected to:

```text
/login?returnTo=%2Fmembers&mode=setup&error=Invalid+auth+bridge+secret
```

The setup form contained only hidden `returnTo`, hidden `mode=setup`, and the
prefilled Name `重试用户`; it contained no email or password input. The only
submit action was `完成设置`. A read-only database transaction proved this
intermediate state:

```text
Better Auth users for the email: 1
SmallKhoj accounts for that Better Auth subject: 0
```

Screenshot: `REAL_bootstrap_retry_setup_20260806.png`.

The frontend was then restarted with the correct bridge secret. The same
Better Auth session reloaded directly into setup, still with only the Name
field. Submitting `完成设置` redirected to `/members`. Final read-only evidence:

```text
Better Auth users:      1
SmallKhoj accounts:     1
home Servers:           1
Human Members:          1
home memberships:       1
Name:                   重试用户
serverHandle:           s0rct
```

No duplicate Better Auth user or SmallKhoj Account was created. Screenshot:
`REAL_bootstrap_retry_success_20260806.png`.

## Remaining local provider acceptance

Only the user-observed removal sequence remains:

1. Remove `open2` from `#identity-test` in the prepared owner UI.
2. Confirm the member row and `@` suggestion disappear immediately.
3. Confirm one Description-free final leave context update causes no visible
   acknowledgement reply.
4. Send a fresh marker in `#identity-test` and prove no later delivery.
5. Send a fresh marker in `#remove-continuity-20260806` and prove `open2` still
   replies there.

