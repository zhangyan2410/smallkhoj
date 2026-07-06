# Chat event unread indicators

## Goal

Replace low-value message-count display in chat with an event/unread indicator
system that helps the user know where attention is needed.

The desired behavior is not "show how many total messages exist." It is:

- show which channel or DM has new activity since the user last viewed it;
- clear that attention state when the user opens/views the relevant item;
- show thread-level new-message state on the corresponding root message in the
  chat timeline;
- express these states in the Inkframe object language rather than as generic
  analytics counters.

## User Value

The current "40 条根消息" style count tells the user the size of a conversation,
but not whether anything needs attention. For a collaboration workbench, the
important question is:

```text
Where did something new happen that I have not seen yet?
```

The UI should guide the user to unread events, then become quiet after the user
has viewed them.

## Evidence

- Screenshot of the current low-value root-message count:
  `evidence/current-root-message-count.png`
- Reference screenshot for a compact event badge:
  `evidence/activity-unread-badge-reference.png`

Repository anchors:

- [frontend/app/chat/[channel]/channel-client.tsx](/Users/code/project/smallkhoj-inkframe-object-ui/frontend/app/chat/[channel]/channel-client.tsx:991)
  currently renders `rootMessages` in the chat header from `messages.length`.
- [frontend/messages/zh-CN.json](/Users/code/project/smallkhoj-inkframe-object-ui/frontend/messages/zh-CN.json:73)
  defines `rootMessages` as `{count} 条根消息`.
- [frontend/app/chat/[channel]/chat-sidebar.tsx](/Users/code/project/smallkhoj-inkframe-object-ui/frontend/app/chat/[channel]/chat-sidebar.tsx:67)
  renders channel sidebar entity items without unread/event state.
- [frontend/app/chat/[channel]/chat-sidebar.tsx](/Users/code/project/smallkhoj-inkframe-object-ui/frontend/app/chat/[channel]/chat-sidebar.tsx:98)
  renders DM sidebar entity items without unread/event state.
- [frontend/app/chat/chat-data-context.tsx](/Users/code/project/smallkhoj-inkframe-object-ui/frontend/app/chat/chat-data-context.tsx:8)
  defines current `ChannelInfo` / `DmInfo` without unread metadata.
- [frontend/app/chat/[channel]/channel-client.tsx](/Users/code/project/smallkhoj-inkframe-object-ui/frontend/app/chat/[channel]/channel-client.tsx:651)
  already connects to realtime events and handles `message.created`.
- [frontend/app/chat/[channel]/channel-client.tsx](/Users/code/project/smallkhoj-inkframe-object-ui/frontend/app/chat/[channel]/channel-client.tsx:1239)
  renders root-message thread affordances where thread unread state should be
  attached.
- [frontend/app/chat/[channel]/channel-client.tsx](/Users/code/project/smallkhoj-inkframe-object-ui/frontend/app/chat/[channel]/channel-client.tsx:1350)
  renders the thread panel; opening/viewing it should participate in read-state
  clearing.

## Product Language

Use the object-language terms from
`../06-30-ink-wash-theme-exploration/visual-language-map.md` and
`../06-30-ink-wash-theme-exploration/object-language-alignment.md`.

Recommended vocabulary:

- `EventBadge / 事件徽标`: compact attention badge, similar to the Activity `14`
  reference, but adapted to the desk style.
- `UnreadMark / 未读标记`: the local mark that says this object has unseen
  activity.
- `SidebarEntityItem`: channel and DM list rows. They are the same base class
  with different content.
- `MessagePaper`: root messages in the chat timeline.
- `ThreadMarker / 线程标记`: the thread affordance on a root `MessagePaper`.

Visual principles:

- Do not use total root-message count as the main status.
- Unread state is an attention mark, not an analytics metric.
- The badge should be near the entity it describes, not floating at page level.
- New activity may make an object visually stronger, but should not use hover
  lift unless the object is actually movable.
- After the user views the object, the unread mark should disappear or settle
  into a quiet read state.

## Requirements

### R1. Replace root-message count with attention state

The chat header should stop foregrounding total root-message count such as
"40 条根消息".

Acceptable replacements:

- current conversation type only, such as `频道` / `私信`;
- unread/new activity status when there is unseen activity;
- quiet metadata that supports navigation without pretending total message
  count is meaningful.

### R2. Sidebar channel unread/event indicators

Each channel `SidebarEntityItem` should be able to show whether new messages or
events arrived since the user last viewed that channel.

Expected behavior:

- if channel has unseen activity, show an `EventBadge` / `UnreadMark`;
- badge should show a count only when the count is meaningful and bounded;
- active/opened channel should clear its unread mark after the view catches up;
- read state should survive normal refreshes, not flicker away only because the
  component remounted.

### R3. Sidebar DM unread/event indicators

DM rows should use the same unread/event system as channels.

Expected behavior:

- DM row unread state is not a separate visual species from channel unread
  state;
- DM content still differs through avatar/identity, but the event badge grammar
  is shared;
- opening the DM clears its unread state after the relevant messages are viewed.

### R4. Thread unread markers on root messages

If a thread receives new replies while the user is not viewing that thread, the
root `MessagePaper` in the main chat timeline should show a local thread
attention mark.

Expected behavior:

- the mark belongs to the root message's `ThreadMarker`, not to the whole page;
- opening the thread clears the marker after thread data is viewed;
- if the thread panel is already open for that root message, new replies should
  either appear live or settle as read once visible;
- the root message should remain readable and not become a noisy notification
  card.

### R5. Event source should be real, not fake local decoration

The implementation should use actual message/realtime/backend state or a
well-defined local read cursor. It should not hard-code decorative badges.

Minimum acceptable mechanism for implementation:

- a per-channel/DM read cursor such as last seen message sequence/time/event id;
- a per-thread read cursor such as last seen reply sequence/time/event id;
- derived unread counts or boolean unread state from those cursors.

### R6. New visual primitive

Introduce or reuse a shared primitive for the attention badge so channel rows,
DM rows, activity entry points, and thread markers can stay visually aligned.

This should not become a one-off pink rectangle in one route.

## Acceptance Criteria

- [ ] The chat header no longer foregrounds `rootMessages` / `{count} 条根消息`
      as the primary conversation metadata.
- [ ] Channel sidebar rows can show a new/unread event badge when unseen messages
      exist.
- [ ] DM sidebar rows can show the same class of new/unread event badge.
- [ ] Opening/viewing a channel clears that channel's unread marker after the
      messages have been loaded/viewed.
- [ ] Opening/viewing a DM clears that DM's unread marker after the messages
      have been loaded/viewed.
- [ ] A root message with unseen thread replies shows a local thread marker on
      or near its thread affordance.
- [ ] Opening the thread clears that root message's thread unread marker after
      replies have been loaded/viewed.
- [ ] Realtime `message.created` events can update active chat state without a
      full page reload, and out-of-scope channel/DM events can update sidebar
      attention state.
- [ ] Unread/event badges use a shared object-language primitive and do not
      introduce unrelated card styles.
- [ ] Tests cover unread derivation and clearing behavior at least at component
      or utility level.
- [ ] Real UI verification captures the sidebar badge and thread marker states
      with `./twd`.

## Out Of Scope

- Full notification center design.
- Push notifications, OS notifications, email, or mobile notification behavior.
- Changing `/daemon` or `/control` operator pages.
- Reworking the entire Activity page.
- Message search ranking or conversation analytics.
- Decorative-only unread badges without backed state.

## Technical Notes For Later Design

This likely needs a small design pass before implementation because the current
data types do not carry read/unread metadata:

- `ChannelInfo` and `DmInfo` may need unread fields or a separate unread map.
- The backend may need read cursor endpoints, or the frontend may begin with a
  local storage cursor if product scope accepts local-only read state.
- Realtime currently refreshes sidebar lists for events outside the active
  channel, but there is no recorded unread semantic yet.
- Thread unread state should probably be keyed by root message id or thread id,
  not by visual position in the message list.

## Open Questions

1. Should unread/read state be persisted server-side per user/member, or is a
   local-browser read cursor acceptable for the first implementation?

Recommended answer: server-side is the correct product model, because chat
attention is user/member state and should survive browser/device changes.
However, a local-browser cursor may be acceptable as a first spike if the goal is
to validate the visual language quickly.
