# Reference-project prior art

## Scope

Read-only comparison of the local `agent-platform`, `clowder-ai`, and `multica`
repositories before designing SmallKhoj member identity and Channel/runtime
contracts. These projects are prior art, not sources to copy.

## Useful patterns

### Stable IDs stay separate from human-readable references

- Clowder keeps `catId` as the registry key, rejects duplicate registration,
  and resolves aliases separately. Ambiguous partial matches return candidates
  instead of picking one (`/Users/code/project/clowder-ai/packages/shared/src/registry/CatRegistry.ts:17-60`
  and `/Users/code/project/clowder-ai/packages/shared/src/registry/normalize-cat-id.ts:62-92`).
- Multica renders typed, UUID-backed mention links such as
  `mention://agent/<UUID>` while showing `@Name`; routing does not depend on the
  displayed text (`/Users/code/project/multica/server/internal/handler/squad_briefing.go:66-70,274-278`
  and `/Users/code/project/multica/packages/ui/markdown/Markdown.tsx:180-200`).
- Agent Platform team/work participation uses composite stable IDs rather than
  mutable names (`/Users/code/project/agent-platform/control-plane/migrations/001_init.sql:844-889`).

**SmallKhoj decision:** persist Member IDs in sender/mention relationships and
keep `@Name` as a contextual projection. Autocomplete selections bind an ID;
ambiguous text never chooses an arbitrary member.

### Expertise belongs in initial member context, not routing authority

- Clowder's generated teammate list includes a preferred mention, model,
  strengths, and cautions in the initial system prompt
  (`/Users/code/project/clowder-ai/assets/system-prompts/system-prompt-l0.md:1-18`).
- Clowder stores richer role/capability metadata separately from registry IDs
  (`/Users/code/project/clowder-ai/packages/api/src/routes/cats.ts:137-158,431-475`).
- Multica Agent metadata also separates `name`, `description`, `instructions`,
  runtime configuration, visibility, and skills
  (`/Users/code/project/multica/packages/core/types/agent.ts:234-313`).

**SmallKhoj decision:** the 200-character Description tells same-Channel Agents
what an Agent is good at. It is supplied once in the Channel entry member-list
snapshot, is not a permission/routing rule, and is not repeated in later
membership-change notifications.

### Small change events, authoritative current-state query

- Multica WebSocket messages are small typed envelopes, while runtime-profile
  changes tell the daemon to fetch authoritative state over HTTP
  (`/Users/code/project/multica/server/pkg/protocol/messages.go:9-79`).
- Multica member realtime events carry the changed member or removed ID rather
  than a repeated workspace member list
  (`/Users/code/project/multica/packages/core/types/events.ts:188-202`).
- Clowder categorizes current participants and routability from current state,
  but does not provide a membership event stream to copy
  (`/Users/code/project/clowder-ai/packages/api/src/routes/thread-cats-core.ts:13-73`).

**SmallKhoj decision:** send one complete Channel member snapshot on entry,
then compact join/leave and collision-reference changes. `aura channel members`
remains the authoritative on-demand current list.

### Scope is bound before lookup

- Multica resolves and authorizes workspace context before handlers consume
  member data; task tokens cannot widen their bound workspace
  (`/Users/code/project/multica/server/internal/middleware/workspace.go:47-163`).
- Agent Platform scopes OAuth tokens by normalized server origin, but that
  origin is an external OAuth concept rather than member identity
  (`/Users/code/project/agent-platform/control-plane/src/services/mcp-oauth.ts:107-122`).

**SmallKhoj decision:** mention lookup and autocomplete are always bound to the
current Channel first. Origin Server is used only to qualify colliding member
Names, never to widen visibility.

## Patterns deliberately not adopted

- Clowder supports multiple human-friendly aliases and partial display-name
  matching. SmallKhoj has one immutable Name and no `@displayName` alias.
- Clowder's structured `targetCats` shows why routing IDs are safer than free
  text, but SmallKhoj will extend its existing Message mention-ID relationship
  instead of introducing Clowder-specific routing fields
  (`/Users/code/project/clowder-ai/docs/features/F055-a2a-mcp-structured-routing.md:14-68`).
- Multica typed mention URIs are useful evidence for ID-backed rendering, but
  SmallKhoj keeps authored plain `@Name` content and does not rewrite historical
  text into Markdown links.
- Agent Platform's Slack connector only filters `ch.is_member` and handles bot
  IDs; it has no reusable member-name, autocomplete, or join/leave contract
  (`/Users/code/project/agent-platform/channel-gateway/src/routes/connectors.ts:145-164`
  and `/Users/code/project/agent-platform/channel-gateway/src/connectors/slack.ts:326-348`).
- None of the three references implements a member identity qualifier equivalent
  to `@name-s7k2m`. SmallKhoj must own and test this contract end to end.
