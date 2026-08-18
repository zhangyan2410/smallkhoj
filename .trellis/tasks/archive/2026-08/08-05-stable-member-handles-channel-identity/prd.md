# Stable member Names and Channel identity

## Goal

Give every Human and Agent a stable product Name (stored and transported as a
protocol handle) that other Channel members can refer to unambiguously, while
giving Agents enough Channel-scoped identity context to use those references
correctly. Add an optional Agent Description so Humans and other Agents can
understand what that Agent is good at.

## Background

The archived Runtime Activity/Aura task deliberately left stable identity as a
separate product and protocol decision. The current product incorrectly models
a mutable `display_name` and then presents it as though it were a stable
handle. The intended identity is an immutable handle such as `ean`, referenced
as `@ean`. A human may additionally have a displayName for frontend
presentation only; an Agent has no displayName. The user also suspects that
the identity context currently supplied to an Agent when it starts or joins a
Channel can mislead it about who is present or how to address them.

The intended tenancy model is one Account with exactly one automatically
created home Server. A person may join other people's Servers, but may not
freely create additional Servers. The current create-Server capability is a
product-model regression, not a capability to preserve.

This task is planning-only until the user approves the final PRD and design.

## Vocabulary

- **Name / 名字** is the only identity term shown in normal product creation
  and profile UI.
- **handle** is the backend/protocol field that stores Name and renders it with
  `@` when used as a reference. Technical docs and code may use `handle`; normal
  product copy may not.
- **displayName** is optional Human-only frontend decoration. It is not Name,
  identity, lookup input, or Agent-visible data.
- **serverHandle** is the hidden immutable system qualifier used only when two
  origin Servers contribute the same Name to one Channel.

## Repository Facts

- Humans and Agents already share one `Member` model. It has no handle column;
  `display_name` is non-null and unique only within a Server, while
  `description` is already optional (`backend/models/slock.py:126-151`).
- A `Server` currently has only an opaque UUID and a mutable, non-unique
  `name`; there is no stable server handle that can safely qualify a member
  reference (`backend/models/slock.py:31-45`).
- `Account.server_id` is only the current/default Server pointer; there is no
  explicit `home_server_id`, `owner_id`, or immutable creator provenance.
  Ownership is inferred from `ServerMembership.role`, while normal membership
  listing defines `isDefault` solely by comparing against `Account.server_id`
  (`backend/models/slock.py:51-93` and
  `backend/services/server_membership.py:76-103`).
- Creating an additional Server produces a new Server, human Member, and owner
  membership but deliberately leaves `Account.server_id` and `member_id`
  unchanged. It creates no default Channel or Agent
  (`backend/services/server_membership.py:108-140` and
  `backend/tests/test_server_account_membership.py:347-379`).
- Historical bootstrap paths may point multiple Accounts at one shared default
  Server, and membership timestamps may have been synthesized during backfill.
  Consequently neither timestamps nor the present membership role can always
  prove who originally created a Server (`backend/routers/public_api.py:348-356,510-557`
  and `backend/models/seed.py:45-123`).
- There is currently no supported Server merge/delete or membership-leave flow.
  Deleting a Server directly would cascade through Server-scoped product data,
  so an automatic destructive migration cannot be considered lossless.
- The backend and frontend currently expose arbitrary additional Server
  creation (`backend/routers/public_api.py:988-1001`,
  `backend/services/server_membership.py:108-137`, and
  `frontend/components/server-switcher.tsx:123-127`). This conflicts with the
  intended one-Account/one-home-Server model.
- Member serialization currently returns `name` and `displayName` from the same
  mutable column and fabricates `handle` as `@${display_name}`
  (`backend/routers/member_serialization.py:54-111`).
- The Agent profile API currently permits `displayName` changes, so today's
  apparent handle is mutable (`backend/routers/agent_api.py:4045-4085`).
- Message mention parsing extracts textual `@token` values, resolves them by
  exact `Member.display_name`, and persists the resulting Member UUIDs. An
  unknown token is silently omitted (`backend/routers/agent_api.py:647-658`).
  Channel membership and message senders already use Member UUID foreign keys,
  so stable storage identity exists even though the human-readable reference
  identity does not.
- The runtime prompt says that each person has a stable name and that mentions
  are Channel-scoped, but a normal inbound Channel message carries sender/actor
  fields rather than a current member roster. An Agent must separately call
  `aura channel members`; server discovery can expose members outside the
  current Channel (`agent/daemon/aaa-daemon/src/runtime/claude-runtime.ts` and
  `agent/daemon/aaa-daemon/src/daemon/daemon.ts:300-401`).
- Runtime warmup currently asks the Agent to run `aura server info`; neither
  warmup nor the normal inbound runtime envelope contains a Channel member list
  (`agent/daemon/aaa-daemon/src/daemon/daemon.ts:388-401,1473-1484,2190-2207`).
- `aura channel members` already reaches a Channel-scoped backend endpoint, but
  its current CLI projection is based on the mutable fields `name`, `role`,
  `type`, `status`, and `description`; it has no stable handle/reference or
  roster revision contract (`agent/daemon/aaa-daemon/src/cli/output.ts:217-251`
  and `agent/daemon/aaa-daemon/src/cli/index.ts:737-747`).
- Agent self-service Channel join/leave records an `EventRecord`, but the event
  does not carry a complete target-member identity projection. Public/admin
  add/remove and several bootstrap/DM membership paths mutate `ChannelMember`
  without emitting the corresponding membership event
  (`backend/routers/agent_api.py:3132-3205` and
  `backend/routers/public_api.py:5370-5445`). The daemon currently has no
  runtime member-list snapshot/change injection path or membership revision marker.
- Agent Description is partially implemented already: it is stored and
  serialized, and the Members profile displays it. Agent creation and profile
  editing currently provide no Description input
  (`frontend/components/create-agent-form.tsx:44-176` and
  `frontend/app/(app)/members/page.tsx:158-207`).
- The frontend's configured locales are exactly `zh-CN` and `en`, with
  `zh-CN` as `defaultLocale`; the create form already consumes the `chat`
  translation namespace (`frontend/i18n/config.ts:5-8` and
  `frontend/components/create-agent-form.tsx:45-46`).
- Current Better Auth signup collects email, password, and optional displayName,
  then one backend bridge transaction creates the SmallKhoj Account, personal
  Server, Human Member, owner membership, and application session before
  redirecting into the app. There is no separate onboarding/completion state
  (`frontend/app/login/page.tsx:27-97,132-191` and
  `backend/routers/public_api.py:566-630,971-984`).
- A user following an invitation signs up through that same bridge, receives a
  personal Server first, and then returns to accept membership in the invited
  Server. This order already matches the one-home-Server identity model
  (`frontend/app/join/[token]/page.tsx:58-139` and
  `backend/services/server_invites.py:198-219`).
- The human/admin member PATCH endpoint already permits an owner or admin to
  update `description`, but performs no length/type normalization. Separately,
  an authenticated Agent with the default-enabled `updateProfile` capability
  can currently rewrite its own description
  (`backend/routers/public_api.py:4416-4476`,
  `backend/routers/agent_api.py:4056-4087`, and
  `backend/services/agent_permissions.py:3-33`).
- Description is stored on the shared `Member` model even though the proposed
  product feature is Agent-specific. Current read serialization therefore does
  not itself enforce an Agent-only semantic
  (`backend/models/slock.py:126-151` and
  `backend/routers/member_serialization.py:65-77`).
- The chat composer has no mention picker/autocomplete. Some downstream code
  independently regex-parses `@...`, with grammar that differs from the
  backend parser (`frontend/app/(app)/chat/[channel]/composer.tsx:18-95` and
  `frontend/app/(app)/chat/[channel]/channel-client.tsx:837-854`).
- The backend mention tokenizer currently captures only ASCII letters, digits,
  underscore, dot, and hyphen and resolves the captured value by exact,
  case-sensitive `Member.display_name`. The Markdown renderer separately
  accepts Chinese characters, while notification matching lowercases and uses
  substring matching. Qualified handles can therefore be treated atomically by
  one path but accidentally match a bare-handle prefix in another
  (`backend/routers/agent_api.py:472,631-657`,
  `frontend/components/markdown-message.tsx:29-53`, and
  `frontend/lib/background-notifications.ts:45-81`).
- Current creation paths do not share a member-name grammar: Account names use
  an ASCII validator, human display names may contain Chinese and spaces, and
  Agent names are nearly unvalidated. PostgreSQL's present unique constraint is
  case-sensitive, so case variants can coexist even though at least one resolver
  performs a case-insensitive lookup (`backend/routers/public_api.py:177,383-470,695-703,5068-5129`
  and `backend/models/slock.py:126-151`).
- The human-facing Channel list endpoint is already visibility-filtered within
  the active Server: it returns public Channels plus private Channels where the
  current member belongs, and excludes DMs. Channel names and `#` references are
  resolved only in that active Server context; there is no cross-Server Channel
  reference or cross-Server same-name ambiguity in the product contract
  (`backend/routers/public_api.py:1872-1918` and
  `backend/models/slock.py:252-280`).
- Message content currently has no persisted Channel-reference IDs or backend
  `#` parser. Markdown only highlights `#name` as non-clickable text. The
  composer already guards Enter during IME composition and its parent has both
  current-Channel members and visible Channel data available to pass into a
  suggestion component (`frontend/components/markdown-message.tsx:7-65`,
  `frontend/app/(app)/chat/[channel]/composer.tsx:18-95`, and
  `frontend/app/(app)/chat/[channel]/channel-client.tsx:202-323,1412-1419`).
- Agent deletion currently hard-deletes the Member after explicitly deleting
  authored messages and tasks and nulling/cascading other references. `Member`
  has no `deleted_at`/tombstone, so the per-Server unique name becomes available
  for reuse and part of the historical record disappears
  (`backend/routers/public_api.py:4498-4572` and
  `backend/models/slock.py:126-150,274-307,394-435,679-738`).
- There is no corresponding Account deletion lifecycle or reusable identity
  tombstone. Existing membership `status` is not an identity-deletion contract.
- A public Channel-member removal endpoint already exists and requires the
  active Server's owner/admin role, but it commits the membership deletion
  without an activity/event push. The chat member panel has an Agent-only
  hover trash icon that calls this endpoint directly, but it is not permission
  gated, has no confirmation or user-visible failure state, and is easy to miss
  (`backend/routers/public_api.py:5407-5450` and
  `frontend/app/(app)/chat/[channel]/channel-client.tsx:1031-1038,1535-1614`).

## Requirements

### R0 — One Account, one home Server

- An Account has exactly one home Server, created automatically with the
  Account. Users cannot create additional owned Servers.
- A human may join any number of other Servers through the membership/invite
  flow. Joining another Server does not create or replace the Account's home
  Server.
- Cross-Server membership is Human-only. An Agent is permanently owned and
  scoped by the Server where it was created and may join only Channels in that
  Server. Agents can never be invited, transferred, shared, or joined into a
  foreign Server; this is a lasting product invariant, not an MVP deferral.
- The home Server's human-facing name follows the person's human-facing name;
  when that optional presentation value is absent, the handle is sufficient.
  Neither value is the stable cross-Server Server qualifier.
- A member exposed in another Server/Channel retains enough origin identity to
  construct an unambiguous qualified handle.
- Existing APIs/UI that permit arbitrary Server creation must be removed or
  rejected.
- Existing local and cloud product data is disposable for this change. The
  rollout will reset and recreate the database rather than attempting an
  in-place migration of historical Accounts, Servers, Members, Channels,
  Agents, or messages.
- No legacy multi-Server ownership preservation, Server merge/transfer,
  display-name-to-handle backfill, or mention compatibility alias is required.
  The clean database must enforce the new tenancy and identity model from its
  first row.

### R1 — Stable member handle

- Every human member and Agent has a unique, immutable handle.
- A Server is not the handle namespace. Humans can join other people's
  Servers, and a Channel can contain members originating from different
  Servers; tenant-local uniqueness cannot make a bare `@handle` unambiguous.
- Each home Server nevertheless owns one shared local canonical-name namespace
  for its Human owner and all active Agents. The Human and an active Agent
  cannot share a normalized lookup key, nor can two active Agents. Creation and
  availability APIs enforce this same namespace for both member kinds.
- A foreign Human keeps the namespace and identity of their own home Server;
  joining another Server does not reserve or rename that name in the foreign
  Server's origin namespace. Any collision is resolved contextually in the
  Channel with the serverHandle qualifier.
- Local handles may repeat across Servers. The qualified identity form is
  the single mention token `@handle-serverHandle`, for example
  `@ean-s7k2m`.
- Each home Server receives a short, unique, immutable serverHandle such as
  `s7k2m`, generated automatically by the backend when the home Server is
  created. Users do not choose or edit it, and normal product surfaces need
  not show it unless disambiguation is required.
- The suffix form `-s<fixed-length alphanumeric code>` is reserved for system
  qualification. A normal local handle may contain hyphens but may not be
  registered with a suffix matching that reserved pattern. The exact code
  length and alphabet are technical design details, but parsing must remain
  unambiguous.
- Local handles support Chinese characters. A common Chinese name such as
  `张翰` is a valid canonical handle and must work as `@张翰` everywhere that an
  ASCII handle works, including message parsing, lookup, frontend rendering,
  notifications, daemon/CLI projections, and Agent runtime context.
- Chinese handle support is an explicit identity decision independent of the
  separate Chinese-first UI localization requirement.
- A local handle contains 1–32 Unicode characters after NFC normalization. It
  may contain Unicode letters, Han characters, decimal digits, and internal
  ASCII hyphens. It may not contain whitespace, `@`, underscore, dot, emoji, or
  other punctuation, and a hyphen may not be first or last.
- The persisted presentation handle is NFC-normalized. Uniqueness and lookup
  use a separately persisted NFKC + Unicode case-folded key, so case variants
  and compatibility-width variants cannot register as separate identities.
  Canonical product/Agent output always renders the saved NFC handle form.
- Human onboarding and Agent creation validate the shared grammar in the UI as
  the user types, show the canonical `@handle` preview, and check availability
  only after local syntax succeeds. The backend repeats authoritative
  validation and performs the final atomic uniqueness check on submit.
- UI validation covers length, allowed characters, leading/trailing hyphens,
  the reserved `-s<code>` suffix, normalization collisions, and unavailable
  handles. Every hint and error is available in Chinese and English, with
  Chinese as the default.
- Within a specific Channel, `@handle` may be used as a context-local shorthand
  only when exactly one current Channel member has that local handle. When a
  collision exists, every ambiguous member must be represented by the
  qualified form.
- The handle is the canonical identity used when one Channel member refers to
  another and the only member-name field with protocol semantics.
- A human explicitly chooses their handle during first-account onboarding.
  Existing login/profile data may be used only to suggest an available value;
  it must not silently become the permanent handle without confirmation.
- The existing Sign Up form is that onboarding step: Name is required in Sign
  Up mode and absent in Sign In mode. No separate skippable onboarding wizard
  is introduced.
- After Name passes final validation, the auth bridge commits the SmallKhoj
  Account, home Server, serverHandle, Human identity, and owner membership as
  one application bootstrap. An authenticated Better Auth user whose bootstrap
  failed remains in retryable Name setup and cannot enter the app incomplete.
- Invitation signup completes this home identity bootstrap before returning to
  accept membership in the invited Server.
- The creator explicitly chooses an Agent Name in the Agent creation flow; the
  submitted value is stored as that Agent's immutable protocol handle.
- A human keeps the same home identity and handle when joining another Server;
  joining does not create a Server-specific alias or second handle.
- An Agent's origin Server never changes. Its Computer/runtime binding,
  permissions, Description, lifecycle controls, and handle namespace remain
  governed by that Server.
- Human and Agent handles become immutable as soon as their respective
  creation flow succeeds.
- A deleted Human's canonical name and lookup key remain permanently reserved
  and can never be registered by another Account.
- Agent names are reusable after the prior Agent has been deleted. Active Agent
  names still share the Server's normal member namespace and remain unique;
  disabled, offline, or disconnected does not count as deletion and does not
  release the name.
- Deleting an Agent preserves a historical tombstone and its Member ID so old
  messages/tasks do not need to be erased merely to release the active-name
  constraint. Historical surfaces can distinguish the deleted identity even
  when a later active Agent uses the same visible name.
- Registering a previously deleted Agent name creates a completely new Agent
  and Member ID; it never revives the tombstone. The new identity inherits no
  Computer/runtime binding, provider/model configuration, permissions, keys,
  Description, status, membership, task state, or other configuration from the
  deleted Agent.
- `handle` is an implementation/protocol term, not the product's form label. In
  product semantics this identity is the member's Name. Human signup labels the
  field `名字` / `Name`; Agent creation labels it `智能体名称` / `Agent name`.
  Helper copy may explain that the name is used as `@name` and cannot be changed
  after creation, but the UI must not ask a normal user to "enter a handle."
- Creation forms do not present Name and displayName as two competing name
  fields. Optional Human displayName is not collected during signup; if the
  frontend keeps it, it can be set later as non-essential profile decoration.
- The stored handle is rendered and addressed as `@handle`, for example
  member `ean` is displayed/referenced as `@ean` where identity syntax matters.
- A human may have a mutable displayName for frontend presentation, but it is
  optional and unnecessary for a complete member experience. Handle alone is a
  sufficient Human label in every Server and Channel.
- displayName is Account-local presentation decoration, not a cross-Server
  member field that must be replicated or synchronized. A joined Server may
  render only the Human handle, and its functionality must not depend on the
  presence or freshness of displayName.
- displayName is not unique identity, cannot be mentioned, and is never used
  for member lookup, message targets, Channel membership, events, permissions,
  Agent context, or any other business rule.
- An Agent has no displayName. Agent surfaces display its handle and may show
  its optional Description separately.
- `@displayName` is not a compatibility alias for `@handle`.
- Because rollout resets all data, the new handle contract does not need an
  in-place `display_name` migration or `@displayName` compatibility period.

### R2 — Channel-scoped identity context

- Agents receive accurate, Channel-scoped information about the people and
  Agents they can address in that Channel.
- Every Agent-facing Channel surface identifies humans and Agents by immutable
  handle (and an opaque Member ID where correlation requires it). A Human's
  optional displayName or other presentation-profile value is never disclosed
  to an Agent; the canonical product Name/handle is disclosed by definition.
- Channel-context disambiguation is an Agent protocol rule, not merely a UI
  rendering rule. The daemon and Agent-facing APIs/CLI must emit `@handle` when
  it is unique among current Channel members and `@handle-serverHandle` when
  that Channel contains a collision.
- This handle-only projection applies consistently to inbound message
  envelopes, `aura channel members`, initial/member context, join/leave events,
  mention resolution results, and any Channel-scoped memory metadata exposed
  to a runtime.
- Human-facing frontend surfaces may still render a human displayName; that
  presentation data must not leak into the Agent-facing projection.
- Identity context must not imply that every Server member is present in the
  Channel, nor teach an Agent an ambiguous addressing form.
- Membership changes must have a defined update path so long-running Agents do
  not continue using a stale Channel member list.
- A membership change can alter the contextual reference of members who were
  already present: adding a second local `ean` changes both members from a
  possible bare `@ean` projection to qualified projections. Any update contract
  must therefore refresh every affected identity, not merely describe the one
  member who joined or left.
- When an Agent first enters a Channel runtime context, it receives one complete
  snapshot of the current Channel member list. It must not receive the full
  Server member list.
- That complete snapshot, including other Agents' Descriptions, is sent only
  once for that Channel entry. It is not repeated with ordinary messages or
  automatically resent wholesale after every membership change.
- Each member's Agent-facing reference is precomputed from the entry snapshot:
  bare when unique in the Channel, qualified when ambiguous. `aura channel
  members` remains the on-demand source for a fresh current member list.
- Every later join or leave produces one compact Channel membership-change
  notification. It contains the changed Member ID, member kind, current
  canonical reference, and every already-present member reference altered by a
  newly created or removed name collision. It contains no Description and does
  not repeat unaffected members.
- Channel runtime instructions tell the Agent that membership is volatile: keep
  the latest entry snapshot plus compact changes as its current working member
  list, replace superseded reference forms, and call `aura channel members`
  whenever uncertain. Frequent changes are expected and must not become durable
  role, task, or identity assumptions.
- Message text is immutable after send. If a later membership change creates or
  removes a collision, historical `@handle` text is never visually or
  Agent-facing rewritten into a qualified or bare form. The persisted Member
  ID keeps the historical target unambiguous, while current member-list context tells
  an Agent which forms to use in new messages.
- Only messages created after a roster change use the newly computed contextual
  references. If the collision later disappears, historical qualified tokens
  also remain exactly as authored.

### R3 — Optional Agent Description

- An Agent can have an optional Description explaining what it is good at and
  what kinds of help it can provide. It is capability/expertise guidance, not a
  fixed job assignment, permission, or routing rule.
- Description is Agent-only; a Human does not have a Description.
- Human APIs, serializers, and UI must reject or omit Description rather than
  relying only on frontend hiding; the Agent-only rule is enforced server-side.
- The Agent creator may set Description during creation. After creation, only
  an owner or admin of the Agent's home Server may edit it.
- An Agent cannot edit its own Description, including through the otherwise
  available `updateProfile` capability. Description is trusted human-managed
  capability/expertise metadata, not Agent-authored self-description.
- Humans may read Description on Agent profile surfaces. Another Agent receives
  it only for Agents in the same current Channel, through the one-time Channel
  member snapshot (`Channel 成员名单快照`) sent on entry; Description is not
  repeatedly pushed after that and discovery must not expose the full Server
  member list.
- Description is not a second member name and has no lookup, mention, or
  identity semantics.
- Description is optional plain text limited to 200 Unicode characters. It may
  contain line breaks, is trimmed at both ends, and an all-whitespace value is
  stored as absent. It is never parsed as Markdown or HTML. The create/edit UI
  shows a localized `0/200` character counter and the backend enforces the same
  limit.
- The Chinese placeholder explains expertise rather than assignment, for
  example `例如：擅长后端排障和数据库迁移`; the English copy conveys the same
  meaning without describing Description as a fixed role.

### R4 — Create Agent Description layout

- This task does not redesign the complete Create Agent flow. Existing
  Computer, Runtime, Provider, dialog actions, and runtime-selection behavior
  remain in place unless another identity requirement directly changes them.
- The supplied second image is a focused reference for adding a visibly
  optional, multi-line Description field and adjusting the surrounding form
  layout. It is not a field specification and does not require a single-column
  rewrite, Model selector, More disclosure, new Cancel action, black brutalist
  styling, or pink action styling.
- The existing Agent Name control remains user-facing `智能体名称` / `Agent
  name`, while its submitted value becomes the immutable canonical handle in
  the data contract. Description is added near that identity control with clear
  optional copy and an expertise-oriented placeholder.
- The exact responsive row/span placement of Name, Description, Computer,
  Runtime, and Provider is deliberately minimal. At the desktop breakpoint,
  row one is Name + Computer, Description spans both columns on row two, and
  Runtime + Provider remain on row three. At narrow widths the form stacks in
  that same semantic order: Name, Computer, Description, Runtime, Provider.
- The shared create form is used by both the Members surface and the Chat DM
  dialog, so the revised layout and validation must stay consistent across both
  entry points while preserving context-specific submit copy.
- The adjusted form must remain keyboard accessible, focus-managed,
  responsive, and complete for loading, disabled, error, and success states.
- SmallKhoj is Chinese-first and bilingual. Every new or changed label,
  optional marker, placeholder, validation message, accessibility label, and
  submit/error string in this flow must use the existing Chinese and English
  translation resources. Chinese is the default locale; reference-image
  English must never be hard-coded into the component.
- Chinese-first UI and Chinese Name protocol support are both required: product
  strings default to `zh-CN`, while canonical Names follow the Unicode grammar
  in R1 and therefore accept names such as `张翰`.

### R5 — Composer member and Channel suggestions

- The chat composer gains a suggestion surface for both `@` and `#` triggers.
  `@` suggests addressable members; `#` suggests Channels.
- `@` suggestions are strictly scoped to current Channel membership. Human
  rows are complete with the canonical contextual handle alone and may show an
  available displayName only as secondary frontend decoration; Agent rows show
  the Agent handle and optional Description. Selection is bound to Member ID
  and inserts only the contextual reference (`@handle` when unique or
  `@handle-serverHandle` when ambiguous).
- When a collision requires qualified references, the human-facing suggestion
  row shows the canonical qualified name as its primary value and may show the
  origin Server's mutable presentation name as secondary orientation. This
  secondary label appears only for collisions, never enters the message token
  or lookup contract, and is never exposed to an Agent. If presentation names
  are absent or identical, the serverHandle remains authoritative.
- Suggestion filtering and selection always work by handle. Neither the
  selected message token nor any Agent-facing payload may depend on or expose a
  Human displayName.
- `#` suggestions list the current Server's visible non-DM Channels: all public
  Channels plus private Channels the current human has joined. They never
  search or qualify Channels across Servers.
- Selecting a Channel inserts the existing plain `#channel-name` token and uses
  the current non-clickable highlight rendering. This task does not add
  automatic join/navigation, clickable links, or persisted Channel-reference
  IDs.
- Suggestions support Chinese handle/name input and IME composition without
  prematurely committing a result. Keyboard users can move through results,
  select, dismiss, and return to typing; pointer and touch interactions have the
  same result.
- The popup is anchored to the active composer context, avoids dialog/scroll
  clipping, handles empty/loading/error states, and remains usable on narrow
  screens. It uses existing SmallKhoj typography, spacing, border, focus,
  selected-state, avatar/icon, and surface tokens rather than introducing a new
  visual language.
- Suggestions insert an atomic token plus an appropriate trailing separator.
  Direct manual entry remains supported and the backend remains authoritative
  for resolution.
- Manual `@` handling stays deliberately minimal. A token produces a mention
  only when it uniquely resolves to one current Channel member. Unknown or
  ambiguous bare tokens remain ordinary message text, mention nobody, and do
  not block sending or produce a warning/error protocol. The autocomplete is
  the intended path for inserting ambiguous qualified references.
- Existing syntax-level message highlighting may remain independent from
  delivery semantics; this task does not add resolved/unresolved visual states
  or `unresolvedMentions` response metadata.
- All suggestion labels, empty states, accessibility instructions, and errors
  are bilingual with Chinese as the default locale.

### R6 — Remove Agent from Channel

- The human-facing Channel UI provides an action to remove an Agent from the
  current Channel. The product currently lacks this control even though a
  backend Channel-member removal endpoint exists.
- The action removes only that Agent's membership in the current Channel. It
  does not delete or disable the Agent, stop its runtime globally, change its
  Computer/configuration, remove it from other Channels, or release its Name.
- The action requires an owner/admin Human and is hidden from unauthorized
  members. It remains in the Channel member panel but becomes discoverable
  rather than hover-only, and requires clear bilingual confirmation that names
  the Agent and current Channel. Loading, success, permission-denied,
  stale-membership, and failure states use the existing Channel member UI
  patterns.
- On success, the current member list and `@` suggestions update immediately.
  Each successful removal creates exactly one durable logical
  `channel.member_left` notice stating that the removed Agent no longer belongs
  to the Channel; transport replay of that same event must be deduplicated
  before it becomes a second runtime turn. The notice contains no Description
  or full member list. After that narrow final notice, all later
  message/event delivery to that Agent for the removed Channel stops. The same
  compact leave notification/collision-reference update is published to the
  remaining Channel Agents.
- Removing the Agent does not rewrite historical messages or tasks. The Agent
  may be added back later as the same Agent identity through the normal Channel
  membership flow.

## Confirmed Constraints

- This work is independent from the archived
  `08-04-repair-codex-opencode-runtime-gates` task.
- Do not solve Channel identity by injecting the full Server member list into every
  runtime.
- Stable message references and any `seq`-replacement protocol are a separate
  design topic unless a minimal compatibility hook is strictly required here.
- STOP/mute behavior is not part of this task.

## Acceptance Criteria

- [ ] Two human/Agent members cannot acquire the same canonical handle within
      the agreed uniqueness scope.
- [ ] One home Server's Human and active Agents share a single normalized local
      name namespace in backend constraints and both creation UIs; only a fully
      deleted Agent releases its name for a new Agent ID.
- [ ] An Account has one automatically created home Server, cannot create a
      second owned Server, and can still join other Servers.
- [ ] Human invitation/membership flows preserve the Human's home identity,
      while every UI/API path rejects inviting, transferring, or joining an
      Agent into a foreign Server.
- [ ] Members originating from different Servers remain unambiguously
      addressable when they share one Channel.
- [ ] Handle validation rejects local handles that collide with the reserved
      `-s<code>` qualification grammar while continuing to allow ordinary
      hyphenated handles.
- [ ] Human onboarding and Agent creation provide matching live Unicode handle
      validation, canonical preview, and availability feedback, while a final
      backend transaction remains authoritative under concurrent registration.
- [ ] NFC presentation plus NFKC/case-folded lookup prevents case and
      compatibility-width duplicates without changing the canonical handle
      emitted to humans or Agents.
- [ ] `@张翰` and equivalent valid Unicode handles resolve atomically and
      consistently across backend mentions, frontend rendering/notifications,
      daemon/CLI output, and Agent-facing Channel snapshots.
- [ ] The server qualifier in `@handle-serverHandle` is stable and
      unambiguous; changing a Server's presentation name cannot break member
      references.
- [ ] In a collision-free Channel, humans and Agents may use the short
      `@handle` form; in a colliding Channel, daemon/runtime context and all
      Agent-facing member/message projections use `@handle-serverHandle` for
      every ambiguous member.
- [ ] Once assigned, a handle cannot be changed through supported UI or API
      flows.
- [ ] Deleted Human names and serverHandles remain permanently reserved;
      deleting an Agent releases its name only for a later Agent registration,
      while preserving the old Agent's historical identity and attribution.
- [ ] Re-registering a deleted Agent name creates a new Member ID with no
      inherited runtime, permissions, credentials, Description, membership, or
      state; historical rows remain bound to the tombstoned Agent ID.
- [ ] Human onboarding requires explicit confirmation of an available Name,
      Agent creation requires an explicit Agent Name, both are stored as
      immutable protocol handles, and joining another Server preserves the
      Human's existing identity.
- [ ] Sign Up requires Name and atomically bootstraps the complete home identity
      before app access; Sign In has no Name field, failed bootstrap is
      retryable, and invitation return-to resumes only after bootstrap succeeds.
- [ ] Signup and Agent creation call the canonical identity `名字` / `Name` in
      product copy, never `Handle`; they do not show a competing displayName
      field, and clearly explain immutable `@name` behavior.
- [ ] A human displayName can change without changing handle resolution,
      mentions, historical attribution, or Agent-visible identity.
- [ ] A missing or stale Human displayName does not impair any joined-Server,
      Channel, roster, suggestion, mention, permission, or Agent-facing flow;
      the handle is always a sufficient Human label.
- [ ] No Agent-facing Channel API, CLI result, runtime envelope, membership
      event, or context payload exposes a Human displayName or other
      presentation-profile value; each uses the canonical product Name/handle.
- [ ] Agent create/edit/read APIs and Agent product surfaces do not accept or
      expose an Agent displayName.
- [ ] Humans and Agents can unambiguously identify another member in a shared
      Channel using the agreed `@handle` syntax.
- [ ] An Agent's initial Channel context contains only relevant Channel members
      and uses the canonical handle contract.
- [ ] Entering a Channel runtime context supplies exactly one complete current
      Channel member snapshot, including same-Channel Agent expertise
      Descriptions, without sending a full Server member list.
- [ ] Ordinary messages and later membership mutations never trigger repeated
      full member snapshots or repeated Description injection; an Agent can use
      `aura channel members` to request the current list on demand.
- [ ] Every join/leave path emits a compact notification with the changed member
      and all collision-affected reference updates, but no Description or
      unrelated member-list repetition; Channel instructions tell Agents to
      retain only the latest volatile membership state.
- [ ] Joining or leaving cannot rewrite historical message content in the human
      UI, runtime replay, or memory; stored Member IDs retain attribution and
      only newly authored messages use the latest contextual reference forms.
- [ ] Agent Description is optional, editable by an authorized actor, readable
      on agreed product surfaces, and safely represented in Agent context.
- [ ] Human create/edit/read APIs, serializers, and UI reject or omit
      Description; Agent-only ownership is enforced server-side.
- [ ] Description accepts at most 200 Unicode characters of plain text, uses
      matching frontend/backend validation and a bilingual counter, and treats
      trimmed empty input as absent.
- [ ] Agent creation preserves its existing runtime/provider behavior, keeps
      the user-facing Agent Name label while mapping it to the canonical handle,
      and adds a clearly optional multi-line Description without pretending that
      the reference image specifies the whole form.
- [ ] The revised shared form behaves consistently in Members and Chat DM entry
      points, remains usable at narrow viewport heights/widths, and exposes
      accessible focus, validation, loading, disabled, and error states.
- [ ] Desktop creation layout is Name + Computer, full-width Description,
      Runtime + Provider; narrow layouts stack those controls in semantic order.
- [ ] Chinese is the default Create Agent locale, every new identity or
      Description string has complete Chinese and English translations, and
      Chinese canonical Names such as `张翰` work independently of locale.
- [ ] Typing `@` offers only current Channel members and inserts the correct
      bare or qualified canonical handle; Human displayName never enters the
      inserted token or any Agent-facing projection.
- [ ] Conflicting Human-facing suggestions show origin Server presentation as
      optional secondary context without adding it to the token, identity
      lookup, or Agent-facing roster; collision-free suggestions stay compact.
- [ ] A manually typed `@` token mentions exactly one member only when uniquely
      resolvable in the current Channel; unknown or ambiguous tokens send as
      ordinary text without notifying any member or blocking the message.
- [ ] Typing `#` offers only authorized Channels under the agreed visibility
      scope in the current Server and inserts a consistently highlighted plain
      `#channel-name`, with no cross-Server qualification behavior.
- [ ] The suggestion UI handles keyboard, pointer, touch, Chinese IME, scrolling,
      clipping, empty/loading/error states, and narrow layouts using the existing
      SmallKhoj visual system in both Chinese and English.
- [ ] An owner/admin Human can discover and remove an Agent from the current
      Channel with clear bilingual confirmation; unauthorized members never see
      the action, and permission/stale/failure states are visible. Success
      changes only Channel membership, updates the UI immediately, permits one
      final Description-free `channel.member_left` notice to the removed Agent,
      then stops all later delivery for that Channel, and emits the compact
      leave/collision update without deleting the Agent or history.
- [ ] A clean database bootstrap creates exactly one home Server for each new
      Account and contains no path for creating an additional owned Server.
- [ ] The reset rollout is documented and verified for both local and cloud
      environments; no application-data preservation or compatibility backfill
      is expected.
- [ ] Tests cover handle uniqueness/immutability, clean bootstrap tenancy,
      Channel-scoped identity delivery, mention/reference behavior, and optional
      Description behavior.

## Notes

- Historical source:
  `.trellis/tasks/archive/2026-08/08-04-repair-codex-opencode-runtime-gates/handoff.md`
  section 5.4.
- `trellis mem` did not surface an earlier complete handle/Description design;
  OpenCode history is not readable by the current memory adapter. Product
  decisions must therefore be established explicitly in this interview.
