import assert from "node:assert/strict"
import test from "node:test"

import {
  ACTIVITY_UNREAD_STORAGE_KEY,
  AGENT_ACTIVITY_UNREAD_KEY,
  LEGACY_CHAT_UNREAD_STORAGE_KEY,
  TASK_ACTIVITY_UNREAD_KEY,
  activityUnreadByPrefix,
  activityUnreadClearKeysForPath,
  activityUnreadCount,
  activityUnreadKeysForEvent,
  clearActivityUnread,
  clearActivityUnreadMarked,
  incrementActivityUnread,
  readActivityUnreadStore,
  type ActivityUnreadStore,
} from "../lib/activity-unread-state"
import { chatScopeKeys } from "../lib/chat-unread-state"
import type { PublicEventEnvelope } from "../lib/realtime-events"

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

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  }
}

test("increment dedupes by seq high-water mark per key", () => {
  const first = incrementActivityUnread({}, ["task:all"], 10)
  assert.deepEqual(first, { "task:all": { count: 1, lastSeq: 10 } })

  const duplicate = incrementActivityUnread(first, ["task:all"], 10)
  assert.equal(duplicate["task:all"].count, 1)
  const older = incrementActivityUnread(duplicate, ["task:all"], 9)
  assert.equal(older["task:all"].count, 1)
  const newer = incrementActivityUnread(older, ["task:all"], 11)
  assert.equal(newer["task:all"].count, 2)
  assert.equal(newer["task:all"].lastSeq, 11)
})

test("clear only removes existing keys and keeps store identity when unchanged", () => {
  const store: ActivityUnreadStore = { "task:all": { count: 2, lastSeq: 5 } }
  assert.deepEqual(clearActivityUnread(store, ["task:all"]), {})
  assert.equal(clearActivityUnread(store, ["chat:channel:id:x"]), store)
})

test("clearActivityUnreadMarked clears from the latest storage snapshot and broadcasts", () => {
  const storage = memoryStorage({
    [ACTIVITY_UNREAD_STORAGE_KEY]: JSON.stringify({
      "chat:dm:id:dm-1": { count: 4, lastSeq: 30 },
      "task:all": { count: 1, lastSeq: 9 },
    }),
  })
  let notified = 0
  const target = { dispatchEvent: () => (notified += 1) }

  const next = clearActivityUnreadMarked(storage, target as never, ["chat:dm:id:dm-1"])
  assert.deepEqual(next, { "task:all": { count: 1, lastSeq: 9 } })
  // 写回 storage 并广播（同标签页其它 store 实例据此刷新，徽标归零）。
  assert.deepEqual(readActivityUnreadStore(storage), next)
  assert.equal(notified, 1)

  // key 不存在时不写回、不广播，返回最新快照（调用方仍可用它收敛滞后 state）。
  const noop = clearActivityUnreadMarked(storage, target as never, ["chat:dm:id:missing"])
  assert.deepEqual(noop, next)
  assert.equal(notified, 1)
})

test("count helpers take max across keys and sum by prefix", () => {
  const store: ActivityUnreadStore = {
    "chat:channel:id:ch-1": { count: 2, lastSeq: 8 },
    "chat:channel:name:general": { count: 3, lastSeq: 9 },
    "chat:dm:id:dm-1": { count: 1, lastSeq: 4 },
    "task:all": { count: 5, lastSeq: 20 },
  }
  assert.equal(activityUnreadCount(store, ["chat:channel:id:ch-1", "chat:channel:name:general"]), 3)
  assert.deepEqual(activityUnreadByPrefix(store, "chat:"), { count: 6, hasUnread: true })
  assert.deepEqual(activityUnreadByPrefix(store, "memory:"), { count: 0, hasUnread: false })
})

test("legacy chat unread store migrates into unified store with chat: prefix", () => {
  const storage = memoryStorage({
    [LEGACY_CHAT_UNREAD_STORAGE_KEY]: JSON.stringify({
      "channel:id:ch-1": { count: 2, lastSeq: 8 },
      "dm:name:DM @zy": { count: 1, lastSeq: 3 },
      "channel:id:empty": { count: 0, lastSeq: 1 },
    }),
  })
  const store = readActivityUnreadStore(storage)
  assert.deepEqual(store, {
    "chat:channel:id:ch-1": { count: 2, lastSeq: 8 },
    "chat:dm:name:DM @zy": { count: 1, lastSeq: 3 },
  })
  assert.equal(storage.data.get(LEGACY_CHAT_UNREAD_STORAGE_KEY), undefined)
  // 迁移结果写回统一 key，下次读取不再依赖 legacy。
  const persisted = JSON.parse(storage.data.get(ACTIVITY_UNREAD_STORAGE_KEY)!)
  assert.deepEqual(persisted, store)
})

test("legacy migration merges with existing unified store by max", () => {
  const storage = memoryStorage({
    [ACTIVITY_UNREAD_STORAGE_KEY]: JSON.stringify({
      "chat:channel:id:ch-1": { count: 5, lastSeq: 12 },
    }),
    [LEGACY_CHAT_UNREAD_STORAGE_KEY]: JSON.stringify({
      "channel:id:ch-1": { count: 2, lastSeq: 8 },
    }),
  })
  const store = readActivityUnreadStore(storage)
  assert.deepEqual(store, { "chat:channel:id:ch-1": { count: 5, lastSeq: 12 } })
})

const chatKeys = (scope: PublicEventEnvelope["scope"]) => chatScopeKeys(scope)

test("message.created increments chat keys except own messages and the open route", () => {
  const incoming = event({
    scope: { kind: "channel", id: "ch-1", name: "#general" },
    payload: { message: { sender: "zy" } },
  })
  const options = { pathname: "/tasks", currentMemberNames: ["me"], chatScopeKeys: chatKeys }
  assert.deepEqual(activityUnreadKeysForEvent(incoming, options), [
    "chat:channel:id:ch-1",
    "chat:channel:name:general",
  ])

  // 自己发的不计（@ 前缀与大小写归一）。
  assert.deepEqual(
    activityUnreadKeysForEvent(incoming, { ...options, currentMemberNames: ["@ZY"] }),
    [],
  )
  // 正在查看该频道时不计。
  assert.deepEqual(
    activityUnreadKeysForEvent(incoming, { ...options, pathname: "/chat/general" }),
    [],
  )
  // 无发送者信息（系统消息）按未读计。
  assert.deepEqual(
    activityUnreadKeysForEvent(event({ scope: { kind: "dm", id: "dm-1", name: "DM @zy" }, payload: {} }), options),
    ["chat:dm:id:dm-1", "chat:dm:name:DM @zy"],
  )
})

test("task events increment task:all unless the user is on /tasks", () => {
  const taskEvent = event({ type: "task.updated", scope: { kind: "task", id: "t-1" } })
  assert.deepEqual(
    activityUnreadKeysForEvent(taskEvent, { pathname: "/", chatScopeKeys: chatKeys }),
    [TASK_ACTIVITY_UNREAD_KEY],
  )
  assert.deepEqual(
    activityUnreadKeysForEvent(taskEvent, { pathname: "/tasks", chatScopeKeys: chatKeys }),
    [],
  )
})

test("member activity increments activity:all unless the user is on /daemon", () => {
  const memberEvent = event({ type: "member.status.updated", scope: { kind: "member", id: "m-1" } })
  assert.deepEqual(
    activityUnreadKeysForEvent(memberEvent, { pathname: "/", chatScopeKeys: chatKeys }),
    [AGENT_ACTIVITY_UNREAD_KEY],
  )
  assert.deepEqual(
    activityUnreadKeysForEvent(memberEvent, { pathname: "/daemon", chatScopeKeys: chatKeys }),
    [],
  )
  // 其它事件类型不产生未读键。
  assert.deepEqual(
    activityUnreadKeysForEvent(event({ type: "reaction.updated" }), { pathname: "/", chatScopeKeys: chatKeys }),
    [],
  )
})

test("route visit clears task/activity domain keys but never chat keys", () => {
  assert.deepEqual(activityUnreadClearKeysForPath("/tasks"), [TASK_ACTIVITY_UNREAD_KEY])
  assert.deepEqual(activityUnreadClearKeysForPath("/daemon"), [AGENT_ACTIVITY_UNREAD_KEY])
  assert.deepEqual(activityUnreadClearKeysForPath("/chat/general"), [])
  assert.deepEqual(activityUnreadClearKeysForPath("/"), [])
})
