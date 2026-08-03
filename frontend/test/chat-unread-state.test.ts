import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import {
  chatLatestSeqDetailFromEvent,
  chatReadCursorRequestForThread,
  chatReadCursorKey,
  chatReadCursorRequestForEntity,
  chatEntityKeys,
  chatScopeKeys,
  clearChatUnreadForEntity,
  deriveChatUnreadView,
  hasUnreadThreadActivity,
  incrementChatUnreadForScope,
  mergeChatReadCursorsIntoEntities,
  type ChatUnreadStore,
} from "../lib/chat-unread-state"

test("chat unread keys include stable id and route name fallbacks", () => {
  assert.deepEqual(chatEntityKeys({ id: "ch-1", name: "#general", type: "public" }), [
    "chat:channel:id:ch-1",
    "chat:channel:name:general",
  ])
  assert.deepEqual(chatEntityKeys({ id: "dm-1", name: "DM @zy", type: "dm" }), [
    "chat:dm:id:dm-1",
    "chat:dm:name:DM @zy",
    // 旧后端把 DM 事件 scope.kind 标成 channel 的历史别名键，清除时必须带上。
    "chat:channel:id:dm-1",
    "chat:channel:name:DM @zy",
  ])
  assert.deepEqual(chatScopeKeys({ kind: "channel", id: "ch-1", name: "#general" }), [
    "chat:channel:id:ch-1",
    "chat:channel:name:general",
  ])
})

test("local pending unread augments server unread but active entity stays quiet", () => {
  const store: ChatUnreadStore = {
    "chat:channel:id:ch-1": { count: 2, lastSeq: 8 },
    "chat:channel:name:general": { count: 1, lastSeq: 9 },
  }

  assert.deepEqual(
    deriveChatUnreadView({ id: "ch-1", name: "#general", type: "public", unreadCount: 3 }, store, "other"),
    { hasUnread: true, unreadCount: 3 },
  )

  assert.deepEqual(
    deriveChatUnreadView({ id: "ch-1", name: "#general", type: "public", unreadCount: 3 }, store, "general"),
    { hasUnread: false, unreadCount: undefined },
  )
})

test("realtime message events increment and clear local unread store by entity", () => {
  const store = incrementChatUnreadForScope({}, { kind: "dm", id: "dm-1", name: "DM @zy" }, 12)
  assert.equal(store["chat:dm:id:dm-1"].count, 1)
  assert.equal(store["chat:dm:name:DM @zy"].count, 1)
  assert.equal(store["chat:dm:id:dm-1"].lastSeq, 12)

  const next = incrementChatUnreadForScope(store, { kind: "dm", id: "dm-1", name: "DM @zy" }, 13)
  assert.equal(next["chat:dm:id:dm-1"].count, 2)
  assert.equal(next["chat:dm:name:DM @zy"].count, 2)

  assert.deepEqual(clearChatUnreadForEntity(next, { id: "dm-1", name: "DM @zy", type: "dm" }), {})
})

test("replayed realtime events do not inflate local unread counts", () => {
  const first = incrementChatUnreadForScope({}, { kind: "channel", id: "ch-1", name: "#general" }, 21)
  const duplicate = incrementChatUnreadForScope(first, { kind: "channel", id: "ch-1", name: "#general" }, 21)
  const older = incrementChatUnreadForScope(duplicate, { kind: "channel", id: "ch-1", name: "#general" }, 20)
  const newer = incrementChatUnreadForScope(older, { kind: "channel", id: "ch-1", name: "#general" }, 22)

  assert.equal(first["chat:channel:id:ch-1"].count, 1)
  assert.equal(duplicate["chat:channel:id:ch-1"].count, 1)
  assert.equal(older["chat:channel:name:general"].count, 1)
  assert.equal(newer["chat:channel:id:ch-1"].count, 2)
  assert.equal(newer["chat:channel:name:general"].lastSeq, 22)
})

test("dm entity clear also removes legacy channel-kind keys from the pre-fix backend", () => {
  // 后端修复前 DM 事件 scope.kind=channel，计数写在 chat:channel:* 下。
  const polluted: ChatUnreadStore = {
    "chat:channel:id:dm-1": { count: 4, lastSeq: 30 },
    "chat:channel:name:DM @zy": { count: 4, lastSeq: 30 },
    "chat:dm:id:dm-1": { count: 1, lastSeq: 31 },
  }
  // 未读视图能读到历史污染计数（徽标显示的 4）。
  const view = deriveChatUnreadView({ id: "dm-1", name: "DM @zy", type: "dm" }, polluted, "other")
  assert.equal(view.unreadCount, 4)
  // 进 DM 页清除后 channel 别名键一并清空，徽标归零。
  assert.deepEqual(clearChatUnreadForEntity(polluted, { id: "dm-1", name: "DM @zy", type: "dm" }), {})
})

test("backend chat read cursor keys match sidebar entity keys", () => {
  assert.equal(chatReadCursorKey({ scope: { kind: "channel", channelId: "ch-1" }, memberId: "m-1", lastReadSeq: 8 }), "chat:channel:id:ch-1")
  assert.equal(chatReadCursorKey({ scope: { kind: "dm", channelId: "dm-1" }, memberId: "m-1", lastReadSeq: 9 }), "chat:dm:id:dm-1")
  assert.equal(
    chatReadCursorKey({ scope: { kind: "thread", rootMessageId: "root-1" }, memberId: "m-1", lastReadSeq: 10 }),
    "chat:thread:id:root-1",
  )
})

test("backend read cursors derive server unread without replacing local pending overlay", () => {
  const entities = [
    { id: "ch-1", name: "#general", type: "public", latestSeq: 12 },
    { id: "dm-1", name: "DM @zy", type: "dm", latestSeq: 5 },
  ]
  const merged = mergeChatReadCursorsIntoEntities(entities, [
    { scope: { kind: "channel", channelId: "ch-1" }, memberId: "m-1", lastReadSeq: 10 },
    { scope: { kind: "dm", channelId: "dm-1" }, memberId: "m-1", lastReadSeq: 5 },
  ])

  assert.deepEqual(merged[0], {
    id: "ch-1",
    name: "#general",
    type: "public",
    latestSeq: 12,
    unreadCount: 2,
    hasUnread: true,
  })
  assert.deepEqual(merged[1], {
    id: "dm-1",
    name: "DM @zy",
    type: "dm",
    latestSeq: 5,
    unreadCount: 0,
    hasUnread: false,
  })
})

test("backend projected unread counts remain the source of truth when present", () => {
  const merged = mergeChatReadCursorsIntoEntities(
    [{ id: "ch-1", name: "#general", type: "public", latestSeq: 100, unreadCount: 1, hasUnread: true }],
    [{ scope: { kind: "channel", channelId: "ch-1" }, memberId: "m-1", lastReadSeq: 90 }],
  )

  assert.equal(merged[0].unreadCount, 1)
  assert.equal(merged[0].hasUnread, true)
})

test("cursor fallback clamps missing or negative sequence values to quiet zero", () => {
  const merged = mergeChatReadCursorsIntoEntities(
    [
      { id: "ch-negative", name: "#negative", type: "public", latestSeq: -5 },
      { id: "dm-missing", name: "DM @missing", type: "dm" },
    ],
    [
      { scope: { kind: "channel", channelId: "ch-negative" }, memberId: "m-1", lastReadSeq: -10 },
      { scope: { kind: "dm", channelId: "dm-missing" }, memberId: "m-1", lastReadSeq: 12 },
    ],
  )

  assert.deepEqual(merged[0], {
    id: "ch-negative",
    name: "#negative",
    type: "public",
    latestSeq: -5,
    unreadCount: 0,
    hasUnread: false,
  })
  assert.deepEqual(merged[1], {
    id: "dm-missing",
    name: "DM @missing",
    type: "dm",
    unreadCount: 0,
    hasUnread: false,
  })
})

test("active sidebar entities build backend cursor write requests", () => {
  assert.deepEqual(chatReadCursorRequestForEntity({ id: "ch-1", name: "#general", type: "public", latestSeq: 18 }), {
    scope: { kind: "channel", channelId: "ch-1" },
    lastReadSeq: 18,
  })
  assert.deepEqual(chatReadCursorRequestForEntity({ id: "dm-1", name: "DM @zy", type: "dm", latestSeq: 7 }), {
    scope: { kind: "dm", channelId: "dm-1" },
    lastReadSeq: 7,
  })
  assert.equal(chatReadCursorRequestForEntity({ id: "ch-1", name: "#empty", type: "public" }), null)
})

test("open thread builds backend cursor write request from visible thread messages", () => {
  assert.deepEqual(
    chatReadCursorRequestForThread({
      rootMessageId: "root-1",
      messages: [
        { id: "root-1", seq: 10 },
        { id: "reply-1", seq: 14 },
        { id: "reply-2", seq: 12 },
      ],
    }),
    {
      scope: { kind: "thread", rootMessageId: "root-1" },
      lastReadSeq: 14,
      lastSeenMessageId: "reply-1",
    },
  )

  assert.equal(chatReadCursorRequestForThread({ rootMessageId: "", messages: [{ id: "reply-1", seq: 1 }] }), null)
})

test("thread cursor request ignores missing sequence rows and returns null for unreadable threads", () => {
  assert.deepEqual(
    chatReadCursorRequestForThread({
      rootMessageId: "root-2",
      messages: [
        { id: "root-2" },
        { id: "reply-unknown", seq: null },
        { id: "reply-visible", seq: 3 },
      ],
    }),
    {
      scope: { kind: "thread", rootMessageId: "root-2" },
      lastReadSeq: 3,
      lastSeenMessageId: "reply-visible",
    },
  )

  assert.equal(
    chatReadCursorRequestForThread({
      rootMessageId: "root-empty",
      messages: [{ id: "root-empty" }, { id: "reply-empty", seq: null }],
    }),
    null,
  )
})

test("chat route code writes backend read cursors instead of only clearing local decoration", () => {
  const sidebarSource = readFileSync(new URL("../app/(app)/chat/[channel]/chat-sidebar.tsx", import.meta.url), "utf8")
  const channelSource = readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8")

  assert.match(sidebarSource, /apiPost\(["']\/api\/v1\/chat\/read-cursors/)
  assert.match(sidebarSource, /chatReadCursorRequestForEntity/)
  assert.match(sidebarSource, /clearUnreadKeys\(chatEntityKeys\(activeEntity\)\)/)
  assert.match(sidebarSource, /setClearedServerReadSeq/)
  assert.match(sidebarSource, /unreadCount: 0, hasUnread: false/)
  assert.match(channelSource, /chatReadCursorRequestForThread/)
  assert.match(channelSource, /apiPost\(["']\/api\/v1\/chat\/read-cursors/)
  assert.match(channelSource, /threadUnreadCount: 0,\s+hasThreadUnread: false/)
  assert.match(channelSource, /setThreadUnreadRootIds/)
})

test("thread markers can derive from backend projection or local realtime overlay", () => {
  const localRoots = new Set(["root-local"])

  assert.equal(hasUnreadThreadActivity({ id: "root-1", hasThreadUnread: true }, new Set()), true)
  assert.equal(hasUnreadThreadActivity({ id: "root-2", threadUnreadCount: 2 }, new Set()), true)
  assert.equal(hasUnreadThreadActivity({ id: "root-local" }, localRoots), true)
  assert.equal(hasUnreadThreadActivity({ id: "root-3", threadId: "root-local" }, localRoots), true)
  assert.equal(hasUnreadThreadActivity({ id: "root-4", hasThreadUnread: false, threadUnreadCount: 0 }, localRoots), false)
})

test("chatLatestSeqDetailFromEvent extracts per-channel message seq for live cursor writes", () => {
  assert.deepEqual(
    chatLatestSeqDetailFromEvent({
      scope: { kind: "channel", id: "ch-1", name: "#general" },
      payload: { seq: 12, channel: "#general" },
    }),
    { channelId: "ch-1", channelName: "general", messageSeq: 12 },
  )
  // messageSeq 别名 + 字符串数字。
  assert.deepEqual(
    chatLatestSeqDetailFromEvent({
      scope: { kind: "dm", id: "dm-1" },
      payload: { messageSeq: "7" },
    }),
    { channelId: "dm-1", channelName: undefined, messageSeq: 7 },
  )
  // 无序号/无标识的事件不产生推进（不会误回写 read-cursor）。
  assert.equal(
    chatLatestSeqDetailFromEvent({ scope: { kind: "channel", id: "ch-1" }, payload: {} }),
    null,
  )
  assert.equal(
    chatLatestSeqDetailFromEvent({ scope: {} as { kind: string }, payload: { seq: 3 } }),
    null,
  )
})

test("sidebar advances live latestSeq from realtime events before writing read cursors", () => {
  const sidebarSource = readFileSync(new URL("../app/(app)/chat/[channel]/chat-sidebar.tsx", import.meta.url), "utf8")
  const channelSource = readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8")

  // sidebar 监听当前频道序号推进事件，回写用 live 序号而非 SSR 静态 latestSeq。
  assert.match(sidebarSource, /CHAT_LATEST_SEQ_EVENT/)
  assert.match(sidebarSource, /liveLatestSeqRef/)
  // channel-client 收到当前频道消息时广播序号推进。
  assert.match(channelSource, /notifyChatLatestSeq/)
  assert.match(channelSource, /chatLatestSeqDetailFromEvent/)
})
