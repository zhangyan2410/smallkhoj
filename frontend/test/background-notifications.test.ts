import assert from "node:assert/strict"
import test from "node:test"

import {
  NOTIFICATION_THROTTLE_WINDOW_MS,
  flushThrottledNotifications,
  mentionsCurrentUser,
  offerThrottledNotification,
  planNotificationForEvent,
  type NotificationPlanContext,
} from "../lib/background-notifications"
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFS_STORAGE_KEY,
  readNotificationPreferences,
} from "../lib/notification-preferences"
import type { PublicEventEnvelope } from "../lib/realtime-events"

const ALL_ON = { ...DEFAULT_NOTIFICATION_PREFERENCES }

function event(overrides: Partial<PublicEventEnvelope>): PublicEventEnvelope {
  return {
    id: "evt-1",
    type: "message.created",
    scope: { kind: "server" },
    seq: 1,
    epoch: "e1",
    payload: {},
    ...overrides,
  }
}

function ctx(overrides: Partial<NotificationPlanContext> = {}): NotificationPlanContext {
  return {
    pathname: "/",
    currentMemberNames: ["me", "Me Display"],
    prefs: ALL_ON,
    documentVisible: false,
    ...overrides,
  }
}

test("DM message plans a chat notification with direct route", () => {
  const plan = planNotificationForEvent(
    event({
      scope: { kind: "dm", id: "dm-1", name: "DM @zy" },
      payload: { message: { sender: "zy" } },
    }),
    ctx(),
  )
  assert.deepEqual(plan, {
    domain: "chat",
    variant: "dm_message",
    throttleKey: "dm:DM @zy",
    href: `/chat/${encodeURIComponent("DM @zy")}`,
    params: { sender: "zy" },
  })
})

test("own messages never notify (sender normalized with @ and case)", () => {
  const plan = planNotificationForEvent(
    event({
      scope: { kind: "dm", id: "dm-1", name: "DM @zy" },
      payload: { message: { sender: "@ME" } },
    }),
    ctx(),
  )
  assert.equal(plan, null)
})

test("viewing the same chat route with a focused document suppresses notification", () => {
  const incoming = event({
    scope: { kind: "dm", id: "dm-1", name: "DM @zy" },
    payload: { message: { sender: "zy" } },
  })
  assert.equal(
    planNotificationForEvent(incoming, ctx({ pathname: `/chat/${encodeURIComponent("DM @zy")}`, documentVisible: true })),
    null,
  )
  // 同路由但文档不聚焦（后台标签页）→ 仍然通知。
  assert.notEqual(
    planNotificationForEvent(incoming, ctx({ pathname: `/chat/${encodeURIComponent("DM @zy")}`, documentVisible: false })),
    null,
  )
})

test("channel messages notify only on detectable @mention", () => {
  const mentioned = event({
    scope: { kind: "channel", id: "ch-1", name: "#general" },
    payload: { message: { sender: "zy", content: "hey @me please check" } },
  })
  const plan = planNotificationForEvent(mentioned, ctx())
  assert.equal(plan?.variant, "mention")
  assert.equal(plan?.href, "/chat/general")
  assert.equal(plan?.throttleKey, "channel:general")

  // 无提及 / 无正文 → 宁缺毋滥，不通知。
  const noMention = event({
    scope: { kind: "channel", id: "ch-1", name: "#general" },
    payload: { message: { sender: "zy", content: "hello all" } },
  })
  assert.equal(planNotificationForEvent(noMention, ctx()), null)
  const noContent = event({
    scope: { kind: "channel", id: "ch-1", name: "#general" },
    payload: { message: { sender: "zy" } },
  })
  assert.equal(planNotificationForEvent(noContent, ctx()), null)
})

test("mention detection is case-insensitive and matches display names", () => {
  assert.equal(mentionsCurrentUser("ping @ME", ["me"]), true)
  assert.equal(mentionsCurrentUser("cc @Me Display", ["me display"]), true)
  assert.equal(mentionsCurrentUser("email me@example.com", ["me"]), false)
  assert.equal(mentionsCurrentUser("", ["me"]), false)
  assert.equal(mentionsCurrentUser("@me", []), false)
})

test("task events plan task notifications unless viewing /tasks focused", () => {
  const taskEvent = event({
    type: "task.updated",
    scope: { kind: "task", id: "t-1" },
    payload: { task: { id: "t-1", title: "Ship it" } },
  })
  const plan = planNotificationForEvent(taskEvent, ctx())
  assert.deepEqual(plan, {
    domain: "tasks",
    variant: "task",
    throttleKey: "task:t-1",
    href: "/tasks?task=t-1",
    params: { title: "Ship it" },
  })
  assert.equal(planNotificationForEvent(taskEvent, ctx({ pathname: "/tasks", documentVisible: true })), null)
  assert.notEqual(planNotificationForEvent(taskEvent, ctx({ pathname: "/tasks", documentVisible: false })), null)
})

test("memory events plan review notifications routed by scope", () => {
  const channelMemory = planNotificationForEvent(
    event({ type: "memory.proposal.created", scope: { kind: "channel", id: "ch-1", name: "#general" } }),
    ctx(),
  )
  assert.equal(channelMemory?.domain, "memory")
  assert.equal(channelMemory?.href, "/chat/general")

  const taskMemory = planNotificationForEvent(
    event({ type: "memory.proposal.created", scope: { kind: "task", id: "t-9" } }),
    ctx(),
  )
  assert.equal(taskMemory?.href, "/tasks?task=t-9")

  const serverMemory = planNotificationForEvent(
    event({ type: "memory.updated", scope: { kind: "server", id: "srv-1" } }),
    ctx(),
  )
  assert.equal(serverMemory?.href, "/daemon")
})

test("domain toggles suppress their events", () => {
  const dmEvent = event({
    scope: { kind: "dm", id: "dm-1", name: "DM @zy" },
    payload: { message: { sender: "zy" } },
  })
  assert.equal(planNotificationForEvent(dmEvent, ctx({ prefs: { ...ALL_ON, chat: false } })), null)

  const taskEvent = event({ type: "task.created", scope: { kind: "task", id: "t-1" }, payload: {} })
  assert.equal(planNotificationForEvent(taskEvent, ctx({ prefs: { ...ALL_ON, tasks: false } })), null)

  const memoryEvent = event({ type: "memory.updated", scope: { kind: "server", id: "s" } })
  assert.equal(planNotificationForEvent(memoryEvent, ctx({ prefs: { ...ALL_ON, memory: false } })), null)

  // 未知事件类型不产生通知。
  assert.equal(planNotificationForEvent(event({ type: "reaction.updated" }), ctx()), null)
})

test("throttle folds same-scope events into one summary per window", () => {
  let throttle = {}
  let result = offerThrottledNotification(throttle, "dm:zy", 1_000)
  assert.equal(result.action, "now")
  throttle = result.throttle

  result = offerThrottledNotification(throttle, "dm:zy", 2_000)
  assert.equal(result.action, "queued")
  throttle = result.throttle
  result = offerThrottledNotification(throttle, "dm:zy", 3_000)
  assert.equal(result.action, "queued")
  throttle = result.throttle

  // 窗口未到期不 flush。
  let flush = flushThrottledNotifications(throttle, 10_000)
  assert.deepEqual(flush.flushed, [])

  // 到期后折叠为一条计数通知。
  flush = flushThrottledNotifications(flush.throttle, 1_000 + NOTIFICATION_THROTTLE_WINDOW_MS)
  assert.deepEqual(flush.flushed, [{ key: "dm:zy", count: 2 }])

  // flush 后窗口向后顺延一个周期：紧邻的事件仍折叠，跨过新窗口才重新立即通知。
  result = offerThrottledNotification(flush.throttle, "dm:zy", 1_000 + NOTIFICATION_THROTTLE_WINDOW_MS + 5)
  assert.equal(result.action, "queued")
  result = offerThrottledNotification(result.throttle, "dm:zy", 1_000 + 2 * NOTIFICATION_THROTTLE_WINDOW_MS + 5)
  assert.equal(result.action, "now")

  // 不同 scope 互不干扰。
  result = offerThrottledNotification(throttle, "channel:general", 2_500)
  assert.equal(result.action, "now")
})

test("notification preferences read defaults, persist, and tolerate garbage", () => {
  const storage = (() => {
    const data = new Map<string, string>()
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      data,
    }
  })()

  assert.deepEqual(readNotificationPreferences(undefined), ALL_ON)
  assert.deepEqual(readNotificationPreferences(storage), ALL_ON)

  storage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify({ chat: false, bogus: 1, tasks: "no" }))
  assert.deepEqual(readNotificationPreferences(storage), { chat: false, tasks: true, memory: true })

  storage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, "{not json")
  assert.deepEqual(readNotificationPreferences(storage), ALL_ON)
})
