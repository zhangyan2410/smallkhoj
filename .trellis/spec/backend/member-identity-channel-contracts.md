# Stable Member Identity and Channel Context Contracts

## 1. Scope / Trigger

Use this contract whenever code creates, serializes, resolves, mentions, joins,
removes, or tombstones a Human or Agent, or whenever a runtime receives Channel
member context. These paths cross PostgreSQL, public and Agent APIs, daemon
delivery, and browser projections; a compatibility alias in one layer can
silently reintroduce mutable identity semantics everywhere else.

The product calls the immutable value **Name**. Code and database fields call it
`handle`. `displayName` is optional Human Account presentation only; it is never
an Agent field, lookup key, mention target, or Agent-facing value.

## 2. Signatures

### Domain functions

```python
normalize_handle(raw: object) -> HandleValue       # NFC handle + NFKC/casefold key
normalize_description(raw: object) -> str | None   # Agent-only, trimmed, <= 200
parse_member_reference(token: object) -> ParsedMemberReference
generate_server_handle() -> str                    # s + 4 Crockford Base32 chars
```

### Database identity

```text
Server.server_handle: immutable, unique, ^s[0-9abcdefghjkmnpqrstvwxyz]{4}$
Account.auth_subject: immutable, unique
Account.home_server_id: required, unique
Account.display_name: optional Human presentation
Member.origin_server_id: required, immutable
Member.account_id: required for Human, NULL for Agent
Member.handle / handle_key: required, immutable
Member.description: Agent-only, optional, <= 200 Unicode code points
Member.deleted_at: Agent tombstone marker
Channel.membership_revision: monotonic integer
Message.mentions: Member UUID[]
```

### Public and Agent APIs

```text
GET    /api/v1/auth/name-preview?name=<Name>
GET    /api/v1/members/agents/name-availability?name=<Name>
POST   /api/v1/members/agents
PATCH  /api/v1/members/{memberId}
DELETE /api/v1/members/{agentId}
POST   /api/v1/channels/{channelId}/members
DELETE /api/v1/channels/{channelId}/members/{memberId}
GET    /api/v1/channels/{channelId}/members
POST   /api/v1/channels/{channelName}/messages
GET    /internal/agent-api/channel-members
POST   /api/v1/servers                              # always 410
```

All production Channel membership mutations call
`services.channel_membership.add_channel_member()`,
`remove_channel_member()`, or `remove_agent_from_all_channels()`.

## 3. Contracts

### Name and reference contract

- Store the trimmed NFC Name in `Member.handle`; store its NFKC + case-folded
  lookup key in `Member.handle_key`.
- Names contain 1–32 Unicode `L*`/`Nd` characters with optional internal ASCII
  hyphens. A Name ending in the reserved `-s<four Crockford chars>` grammar is
  rejected so qualified references remain parseable.
- One origin Server has one active Human/Agent Name namespace. A Human Name is
  permanently reserved. An Agent Name is reusable only after tombstoning, and
  reuse inserts a new Member UUID.
- Current Channel membership is the reference scope. A unique Name projects to
  `@name`; every member in a same-Name collision projects to
  `@name-serverHandle`.
- `Message.sender_id` and `Message.mentions` preserve UUID attribution. Message
  content is never rewritten after membership changes.

### Account and Server contract

- One Account bootstraps exactly one home Server, one Human Member, and one
  owner `ServerMembership` in one transaction.
- Joining another Server adds a `ServerMembership` that points to the same Human
  Member UUID. It never creates a Server-local Human copy.
- Agents have an immutable origin Server and can join only Channels belonging
  to it. Agents can never occupy `ServerMembership`.
- Arbitrary Server creation is removed: `POST /api/v1/servers` returns 410.

### Serialization contract

- Generic member payloads use raw `name`/`handle` and contextual `reference`.
- Agent payloads may include `description`; they never contain `displayName` or
  `profile.displayName`.
- Human `displayName` may appear only on explicitly human-facing projections.
  `load_agent_channel_roster()` and every Agent API/runtime/CLI projection must
  avoid selecting or serializing it.
- Notification and task-assignment targeting trust persisted Member UUIDs, not
  body substrings, ASCII mention regexes, or display labels.

### Channel context and event contract

- Entry into one runtime Channel context injects one complete current snapshot.
  Same-Channel Agent Descriptions may appear only in that snapshot.
- A real add/remove locks the Channel, increments `membership_revision` once,
  and writes one durable `channel.member_joined` or `channel.member_left` event.
- Compact event payloads contain `channelId`, `rosterRevision`, changed
  `member { memberId, kind, reference }`, and collision `referenceUpdates`.
  They contain no Description, Human displayName, or full roster.
- Daemon registry keys context by Agent launch and Channel, deduplicates event
  ID/revision replays, and refetches on a revision gap.
- Runtime instructions say membership is volatile: keep only the latest working
  roster, replace superseded references, do not turn roster changes into durable
  role/task assumptions, and do not reply merely to acknowledge an update.
- A removed Agent may receive the exact final leave event. The daemon then
  clears that Channel context, queued messages, and scoped sessions; all later
  send/read/event delivery for that Channel fails closed while other Channels
  remain unaffected.

### Clean-reset migration contract

- Revision `0006_stable_member_identity` upgrades or downgrades only when the
  identity tables are empty. Non-empty identity data raises
  `IDENTITY_CLEAN_RESET_REQUIRED`.
- Do not add ORM aliases, migration backfills, seed-time repairs, or tests that
  preserve the old `Member.server_id/display_name` or
  `Account.name/server_id/member_id` model.

## 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Missing, malformed, too-long, or reserved-suffix Name | 400 with stable Name reason code |
| Active origin-Server Name collision | 409; final DB unique constraint is authoritative |
| PATCH attempts `name`, `handle`, or `displayName` | 400 `NAME_IMMUTABLE` |
| Agent self-profile attempts Name, Description, or displayName | 403 |
| Human payload supplies Description | 400 |
| Agent joins a foreign Server Channel | 400 |
| Human lacks active Server membership for a Channel | 403 |
| Strict Channel removal targets missing membership | 404 and no event/revision change |
| Non-owner/admin mutates members | 403 |
| Additional Server creation | 410 |
| Identity migration sees existing identity rows | fail with `IDENTITY_CLEAN_RESET_REQUIRED` |
| Unknown or ambiguous manual `@` token | send succeeds as ordinary text; mention nobody |

## 5. Good / Base / Bad Cases

- Good: `张翰` is stored as NFC, selected by Member UUID, and sent as `@张翰`.
- Good: two `ean` Humans from different origin Servers share a Channel and are
  projected as `@ean-s7k2m` and `@ean-s91qx`.
- Good: deleting Agent `@open2` tombstones the old UUID, preserves historical
  files/messages/tasks, and permits a newly inserted Agent UUID to reuse `open2`.
- Base: a collision disappears; new messages use the remaining bare reference,
  while historical text remains unchanged.
- Bad: resolving `@name` against the full Server roster or `displayName`.
- Bad: hard-deleting an Agent Member and cascading historical attribution.
- Bad: sending the complete roster or Description on every membership update.

## 6. Tests Required

- Unit: Unicode normalization, reserved suffix, Description limit, reference
  parsing/projection, and compact payload field exclusion.
- PostgreSQL: clean head migration, non-empty reset refusal, Human/Agent Name
  uniqueness, cross-origin duplicates, tombstone reuse with a new UUID, composite
  Account/Member/ServerMembership constraints, and concurrent bootstrap.
- API: immutable Name, Agent-only Description, 410 Server creation, foreign Agent
  rejection, Channel-scoped mention UUIDs, owner/admin removal, stale 404, and
  tombstone historical attribution.
- Daemon: snapshot once, Description once, compact join/leave, replay dedupe,
  revision gap reconciliation, zero-tool/zero-visible-reply update turns, final
  leave delivery, and post-removal queue/access cutoff.
- Release gate: run the migration suite against explicitly isolated PostgreSQL
  URLs; a skipped migration suite is not a pass.

## 7. Wrong vs Correct

### Wrong

```python
# Mutable presentation text becomes protocol identity.
target = next(member for member in server_members if member.display_name == token)
db.add(ChannelMember(channel_id=channel.id, member_id=target.id))
```

### Correct

```python
# Resolve within the current Channel and mutate through the event/revision boundary.
target_ids = await resolve_channel_mentions(db, channel_id=channel.id, content=content)
await add_channel_member(
    db,
    channel_id=channel.id,
    member_id=target_member_id,
    actor_id=actor.id,
)
```
