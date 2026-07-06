# Design: Inkframe Chat Mobile Composer Message Containment

## Contract Shape

This is a source-contract hardening slice, not a visual redesign. The contract
is:

```text
ProductShell
  -> chat-workspace
    -> chat-message-list (scroll owner)
      -> inner message stack
        -> MessageFrame
          -> AvatarObject + message body
          -> MessagePaper content
    -> chat-composer (bottom region)
      -> ChatComposerSurface (wrapping control row)
    -> optional chat-thread-panel
      -> thread message scroller
      -> thread reply composer
```

Every flex/grid container that can receive long text or controls must carry
`min-w-0`; the actual scroll owner must pair `overflow-x-hidden` with
`overflow-y-auto`.

## Why Source Tests

Real mobile/browser proof is still gated by `./twd` tab connection. The
source tests are not a substitute for visual proof, but they prevent the most
common regression while the browser gate is unavailable: a later component
change removes the exact containment classes that keep chat from widening.

## Implementation Notes

- Prefer existing components and classes. Do not add new atoms for this slice.
- Keep route code styling changes limited to layout utilities required by the
  mobile contract.
- Add no palette changes.
- Do not add hover/motion. The user explicitly wants motion to imply movable
  objects; this containment task should stay still.
- Keep `MessageFrame` as the single reusable message prefab. Do not fork chat
  message markup inside the route.

## Prior Chat Unread Task Link

The unread/event task is adjacent but separate:

```text
sidebar/channel/DM/thread unread contract
  -> frontend cursor helpers and real route source anchors
message/composer mobile containment
  -> this task
```

This task's validation should rerun unread/frontend cursor tests so the earlier
Trellis item is visibly included, but it should not alter unread semantics.

## Review Focus

Reviewers should check:

- the source tests assert the element that actually owns the scroll/containment
  class, not a nearby wrapper;
- the composer can wrap on narrow screens without hiding the input or send
  button;
- thread panel containment follows the same grammar as main chat;
- the result does not claim browser acceptance while `./twd` is disconnected.
