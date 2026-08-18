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
  activityUnreadSeqForEvent,
  clearActivityUnread,
  clearActivityUnreadMarked,
  incrementActivityUnread,
  readActivityUnreadStore,
  resetActivityUnreadHighWater,
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

test("multi-key increment shares one high-water across sibling keys", () => {
  // 同一实体的 id/name 双键：同一条消息（同一 messageSeq）不得计两次。
  const keys = ["chat:channel:id:ch-1", "chat:channel:name:general"]
  const first = incrementActivityUnread({}, keys, 5)
  assert.equal(first[keys[0]].count, 1)
  assert.equal(first[keys[1]].count, 1)

  const replayed = incrementActivityUnread(first, keys, 5)
  assert.equal(replayed[keys[0]].count, 1)
  assert.equal(replayed[keys[1]].count, 1)

  // 历史污染场景：name 键带着旧后端留下的更高 lastSeq，新事件
  // 也不能只对 id 键计数 —— 兄弟键共享最大高水位。
  const polluted = incrementActivityUnread(
    {
      "chat:channel:id:ch-1": { count: 1, lastSeq: 5 },
      "chat:channel:name:general": { count: 3, lastSeq: 99 },
    },
    keys,
    90,
  )
  assert.equal(polluted[keys[0]].count, 1)
  assert.equal(polluted[keys[1]].count, 3)

  const newer = incrementActivityUnread(polluted, keys, 100)
  assert.equal(newer[keys[0]].count, 2)
  assert.equal(newer[keys[1]].count, 4)
  assert.equal(newer[keys[0]].lastSeq, 100)
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

test("own messages are excluded by flat senderId/actorId payload (real backend shape)", () => {
  // 真实后端事件载荷只有扁平 senderId，没有嵌套 message.sender ——
  // 这是修复前「自己发的消息也计未读」的回归用例。
  const own = event({
    scope: { kind: "channel", id: "ch-1", name: "#general" },
    payload: { senderId: "m-self", sender: "@Me" },
  })
  const other = event({
    scope: { kind: "channel", id: "ch-1", name: "#general" },
    payload: { senderId: "m-other" },
  })
  const options = {
    pathname: "/tasks",
    currentMemberIds: ["M-SELF"], // 大小写不敏感
    currentMemberNames: ["me"],
    chatScopeKeys: chatKeys,
  }
  assert.deepEqual(activityUnreadKeysForEvent(own, options), [])
  assert.deepEqual(activityUnreadKeysForEvent(other, options), [
    "chat:channel:id:ch-1",
    "chat:channel:name:general",
  ])

  // actorId 回退（agent_api 事件用 actorId）。
  const ownActor = event({
    scope: { kind: "dm", id: "dm-1", name: "DM @me" },
    payload: { actorId: "m-self" },
  })
  assert.deepEqual(activityUnreadKeysForEvent(ownActor, options), [])
})

test("unread seq for chat events uses per-channel messageSeq, not global event seq", () => {
  const chatKeysForScope = ["chat:channel:id:ch-1", "chat:channel:name:general"]
  const chatEvent = event({
    scope: { kind: "channel", id: "ch-1", name: "#general" },
    seq: 900, // 全局事件 seq —— 不得用于 per-key 去重
    payload: { seq: 12, senderId: "m-other" }, // 频道内消息序号
  })
  assert.equal(activityUnreadSeqForEvent(chatEvent, chatKeysForScope), 12)

  const messageSeqAlias = event({
    scope: { kind: "dm", id: "dm-1" },
    seq: 901,
    payload: { messageSeq: 7 },
  })
  assert.equal(activityUnreadSeqForEvent(messageSeqAlias, ["chat:dm:id:dm-1"]), 7)

  // 非聊天键继续用全局事件 seq。
  assert.equal(activityUnreadSeqForEvent(chatEvent, [TASK_ACTIVITY_UNREAD_KEY]), 900)
  // 聊天事件没有消息序号时退回 undefined（不做水位去重，只递增）。
  const noSeq = event({ scope: { kind: "channel", id: "ch-1" }, payload: {} })
  assert.equal(activityUnreadSeqForEvent(noSeq, chatKeysForScope), undefined)
})

test("resetActivityUnreadHighWater keeps counts and drops seq watermark", () => {
  const store: ActivityUnreadStore = {
    "chat:channel:id:ch-1": { count: 3, lastSeq: 42 },
    "chat:channel:name:general": { count: 3, lastSeq: 42 },
    "task:all": { count: 1, lastSeq: 9 },
  }
  const next = resetActivityUnreadHighWater(store, [
    "chat:channel:id:ch-1",
    "chat:channel:name:general",
    "chat:dm:id:missing",
  ])
  assert.deepEqual(next["chat:channel:id:ch-1"], { count: 3 })
  assert.deepEqual(next["chat:channel:name:general"], { count: 3 })
  assert.deepEqual(next["task:all"], { count: 1, lastSeq: 9 })
  // 无水位可清时保持 store 引用（调用方据此判断是否需要写回/广播）。
  assert.equal(resetActivityUnreadHighWater(store, ["chat:dm:id:missing"]), store)

  // 重置后重放事件重新参与计数（catch_up 兜底语义）。
  const recounted = incrementActivityUnread(next, ["chat:channel:id:ch-1", "chat:channel:name:general"], 40)
  assert.equal(recounted["chat:channel:id:ch-1"].count, 4)
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

test("message.created for the open DM is suppressed by currentChatChannelId", () => {
  // DM 的 scope.name 是内部名 dm:{idA}-{idB}，与路由名 /chat/<handle> 永远
  // 不相等——修复前「正在查看的 DM」每条消息都递增本地未读，切走时积累的
  // 角标显形。currentChatChannelId（chat-sidebar 注册）按 id 精确抑制。
  const incoming = event({
    scope: { kind: "dm", id: "dm-1", name: "dm:111-222" },
    payload: {},
  })
  const options = {
    pathname: "/chat/ee",
    currentMemberNames: ["me"],
    chatScopeKeys: chatKeys,
  }
  assert.deepEqual(activityUnreadKeysForEvent(incoming, options), [
    "chat:dm:id:dm-1",
    "chat:dm:name:dm:111-222",
  ])
  // 注册当前会话 id 后抑制。
  assert.deepEqual(
    activityUnreadKeysForEvent(incoming, { ...options, currentChatChannelId: "dm-1" }),
    [],
  )
  // 注册的是其它会话时不抑制。
  assert.deepEqual(
    activityUnreadKeysForEvent(incoming, { ...options, currentChatChannelId: "dm-other" }),
    ["chat:dm:id:dm-1", "chat:dm:name:dm:111-222"],
  )
  // 频道也能走 id 抑制（name 缺失时的兜底）。
  assert.deepEqual(
    activityUnreadKeysForEvent(
      event({ scope: { kind: "channel", id: "ch-9" }, payload: {} }),
      { ...options, pathname: "/chat/unknown-route", currentChatChannelId: "ch-9" },
    ),
    [],
  )
})
