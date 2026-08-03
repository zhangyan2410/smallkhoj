import type { PublicEventEnvelope } from "./realtime-events"

/**
 * 通用「未 seen 活动」状态层（任务 07-30-realtime-activity-indicators R1）。
 *
 * 按 域 × scope 两级键管理未读/未 seen 计数，键形如：
 *   chat:channel:id:<id>   chat:dm:name:<name>   chat:thread:id:<root>
 *   task:all               activity:all
 * 域可扩展（新域 = 新前缀），不硬编码聊天概念。聊天域的键派生规则在
 * chat-unread-state.ts（本层的第一个消费方）。
 *
 * 语义：
 * - 由 SSE 事件驱动递增（见 activity-unread-tracker），同实体的消息序号
 *   （messageSeq，频道内单调）高水位去重 —— 同一事件重放不重复计数。
 *   注意不能用全局事件 seq 做 per-key 高水位：它是跨 scope 的 DB Identity，
 *   会让跨频道的合法新消息互相干扰。重连 catch_up 时本地高水位不可信，
 *   由 tracker 先重置（resetHighWaterKeys）再让补发事件参与计数。
 * - localStorage 持久化，跨标签页/刷新可恢复；聊天域另有服务端 read-cursor
 *   校准（chat-unread-state.ts，保持既有行为）。
 * - 进入对应路由后由 tracker 调用 clear（task:all / activity:all）或由聊天
 *   侧栏/频道页按实体清除（chat:*）。
 */

export type ActivityUnreadEntry = {
  count: number
  lastSeq?: number
}

export type ActivityUnreadStore = Record<string, ActivityUnreadEntry>

export const ACTIVITY_UNREAD_STORAGE_KEY = "smallkhoj.activity.unread.v1"
export const ACTIVITY_UNREAD_EVENT = "smallkhoj:activity-unread"

/** 07-30 之前聊天域的独立存储 key；读取时一次性迁移进统一存储。 */
export const LEGACY_CHAT_UNREAD_STORAGE_KEY = "smallkhoj.chat.unread.v1"

/** task 域（/tasks）聚合键。 */
export const TASK_ACTIVITY_UNREAD_KEY = "task:all"
/** activity 域（/daemon agent 活动）聚合键。 */
export const AGENT_ACTIVITY_UNREAD_KEY = "activity:all"
/** chat 域键前缀（AppRail chat 图标的聚合范围）。 */
export const CHAT_ACTIVITY_UNREAD_PREFIX = "chat:"

export function incrementActivityUnread(
  store: ActivityUnreadStore,
  keys: readonly string[],
  seq?: number,
): ActivityUnreadStore {
  if (keys.length === 0) return store
  const next: ActivityUnreadStore = { ...store }
  // 同一实体 id/name 多键共享一个高水位：同一条消息（同一序号）不得
  // 对兄弟键重复计数；历史污染键上的更高水位也要参与去重（否则该键
  // 漏计、兄弟键多计）。高水位基于调用前的 store 快照计算一次，
  // 不能在循环内读 next —— 第一个键写回的新水位会把其余键全部跳过。
  let highWater: number | undefined
  if (typeof seq === "number") {
    for (const key of keys) {
      const existing = store[key]?.lastSeq
      if (typeof existing === "number" && (highWater === undefined || existing > highWater)) {
        highWater = existing
      }
    }
  }
  for (const key of keys) {
    const current = next[key]
    if (typeof highWater === "number" && typeof seq === "number" && seq <= highWater) {
      continue
    }
    next[key] = {
      count: (current?.count ?? 0) + 1,
      lastSeq: seq ?? current?.lastSeq,
    }
  }
  return next
}

export function clearActivityUnread(store: ActivityUnreadStore, keys: readonly string[]): ActivityUnreadStore {
  const existing = keys.filter((key) => key in store)
  if (existing.length === 0) return store
  const next: ActivityUnreadStore = { ...store }
  for (const key of existing) delete next[key]
  return next
}

/** 多键取最大计数（同一实体可能有 id 键与 name 键两份计数）。 */
export function activityUnreadCount(store: ActivityUnreadStore, keys: readonly string[]): number {
  let count = 0
  for (const key of keys) count = Math.max(count, store[key]?.count ?? 0)
  return count
}

/** 前缀聚合（如 chat: 全域），用于 AppRail 图标徽标。返回总和与是否有未读。 */
export function activityUnreadByPrefix(
  store: ActivityUnreadStore,
  prefix: string,
): { count: number; hasUnread: boolean } {
  let count = 0
  for (const key of Object.keys(store)) {
    if (key.startsWith(prefix)) count += Math.max(0, store[key]?.count ?? 0)
  }
  return { count, hasUnread: count > 0 }
}

function migrateLegacyChatStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem">): ActivityUnreadStore {
  try {
    const raw = storage.getItem(LEGACY_CHAT_UNREAD_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, { count?: number; lastSeq?: number }>
    if (!parsed || typeof parsed !== "object") return {}
    const migrated: ActivityUnreadStore = {}
    for (const [legacyKey, entry] of Object.entries(parsed)) {
      if (typeof entry?.count !== "number" || entry.count <= 0) continue
      migrated[`chat:${legacyKey}`] = { count: entry.count, lastSeq: entry.lastSeq }
    }
    storage.removeItem(LEGACY_CHAT_UNREAD_STORAGE_KEY)
    return migrated
  } catch {
    return {}
  }
}

function mergeStores(base: ActivityUnreadStore, extra: ActivityUnreadStore): ActivityUnreadStore {
  const next: ActivityUnreadStore = { ...base }
  for (const [key, entry] of Object.entries(extra)) {
    const current = next[key]
    next[key] = {
      count: Math.max(current?.count ?? 0, entry.count),
      lastSeq: Math.max(current?.lastSeq ?? 0, entry.lastSeq ?? 0) || undefined,
    }
  }
  return next
}

export function readActivityUnreadStore(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
): ActivityUnreadStore {
  if (!storage) return {}
  let store: ActivityUnreadStore = {}
  try {
    const raw = storage.getItem(ACTIVITY_UNREAD_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ActivityUnreadStore
      if (parsed && typeof parsed === "object") store = parsed
    }
  } catch {
    store = {}
  }
  const legacy = migrateLegacyChatStore(storage)
  if (Object.keys(legacy).length > 0) {
    store = mergeStores(store, legacy)
    writeActivityUnreadStore(storage, store)
  }
  return store
}

export function writeActivityUnreadStore(
  storage: Pick<Storage, "setItem"> | undefined,
  store: ActivityUnreadStore,
) {
  if (!storage) return
  storage.setItem(ACTIVITY_UNREAD_STORAGE_KEY, JSON.stringify(store))
}

export function notifyActivityUnreadChanged(target?: Pick<Window, "dispatchEvent">) {
  target?.dispatchEvent(new Event(ACTIVITY_UNREAD_EVENT))
}

export function markActivityUnread(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  target: Pick<Window, "dispatchEvent"> | undefined,
  keys: readonly string[],
  seq?: number,
): ActivityUnreadStore {
  const next = incrementActivityUnread(readActivityUnreadStore(storage), keys, seq)
  writeActivityUnreadStore(storage, next)
  notifyActivityUnreadChanged(target)
  return next
}

/**
 * 清除入口（与 markActivityUnread 对称）：基于 localStorage 最新快照清除，
 * 不依赖调用方持有的可能滞后的内存副本——tracker 递增直接写 storage，
 * React state 是异步同步的，基于旧 state 清除会找不到 key（徽标清不掉）。
 * 有实际清除时写回并广播，让同标签页其它 store 实例（AppRail 等）同步。
 */
export function clearActivityUnreadMarked(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  target: Pick<Window, "dispatchEvent"> | undefined,
  keys: readonly string[],
): ActivityUnreadStore {
  const latest = readActivityUnreadStore(storage)
  const next = clearActivityUnread(latest, keys)
  if (next !== latest) {
    writeActivityUnreadStore(storage, next)
    notifyActivityUnreadChanged(target)
  }
  return next
}

/**
 * 仅重置指定键的 lastSeq 高水位（保留 count）。
 * 用于 SSE catch_up（断线重连/追补）：本地高水位是在旧连接上按 messageSeq
 * 推进的，断线期间错过的事件无法判定序号边界，继续用旧水位去重会把补发
 * 事件静默吞掉（计数永久偏小）。清掉高水位后重放事件重新计数——虚高由
 * 进入实体时的清除 + 服务端 read-cursor 校准兜底，好过漏计。
 */
export function resetActivityUnreadHighWater(
  store: ActivityUnreadStore,
  keys: readonly string[],
): ActivityUnreadStore {
  const targets = keys.filter((key) => store[key]?.lastSeq !== undefined)
  if (targets.length === 0) return store
  const next: ActivityUnreadStore = { ...store }
  for (const key of targets) {
    next[key] = { count: next[key].count }
  }
  return next
}

/**
 * resetActivityUnreadHighWater 的 storage 版（tracker 用）：基于最新快照
 * 重置并写回 + 广播。
 */
export function resetActivityUnreadHighWaterMarked(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined,
  target: Pick<Window, "dispatchEvent"> | undefined,
  keys: readonly string[],
): ActivityUnreadStore {
  const latest = readActivityUnreadStore(storage)
  const next = resetActivityUnreadHighWater(latest, keys)
  if (next !== latest) {
    writeActivityUnreadStore(storage, next)
    notifyActivityUnreadChanged(target)
  }
  return next
}

function normalizeSender(value?: string | null) {
  return (value || "").trim().replace(/^@+/, "").toLowerCase()
}

function normalizeMemberId(value?: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim().toLowerCase()
  return normalized || null
}

function payloadString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key]
  return typeof value === "string" && value.trim() ? value : null
}

/** 事件载荷里的频道内消息序号（后端 details 里的 seq/messageSeq，频道内单调递增）。 */
function chatMessageSeqFromEvent(event: PublicEventEnvelope): number | undefined {
  const raw = event.payload?.messageSeq ?? event.payload?.seq
  const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/**
 * 判断事件是否当前用户自己发出（不应计未读）。
 * 真实事件载荷（public_api.py `_record_activity` details）只有扁平的
 * senderId/actorId，没有嵌套 message.sender —— 早期按 message.sender 匹配
 * 从未命中，自己发的消息被错误地计入未读（计数口径不可信的主因之一）。
 */
function isOwnMessageEvent(
  event: PublicEventEnvelope,
  currentMemberIds: readonly string[],
  currentMemberNames: readonly string[],
): boolean {
  const senderId =
    normalizeMemberId(event.payload?.senderId) ??
    normalizeMemberId(event.payload?.actorId) ??
    normalizeMemberId(event.payload?.memberId)
  if (senderId) {
    return currentMemberIds.some((id) => normalizeMemberId(id) === senderId)
  }
  // 兼容旧格式：payload.message.sender = "@name"
  const message = event.payload?.message as { sender?: unknown } | undefined
  const sender = normalizeSender(typeof message?.sender === "string" ? message.sender : null)
  if (!sender) return false
  return currentMemberNames.some((name) => normalizeSender(name) === sender)
}

function chatRouteNameFromPath(pathname: string): string | null {
  if (!pathname.startsWith("/chat/")) return null
  const segment = pathname.slice("/chat/".length).split("/")[0]
  if (!segment) return null
  try {
    return decodeURIComponent(segment).replace(/^#/, "")
  } catch {
    return segment.replace(/^#/, "")
  }
}

/**
 * 把一条实时事件投影为「应该递增哪些未读键」。空数组 = 不递增。
 * 纯函数，tracker 与单测共用。规则：
 * - message.created（channel/dm scope）：自己发的（payload.senderId/actorId
 *   与当前 memberId 匹配）、当前正在查看的频道/DM 不计；其余递增聊天域键
 *   （键派生复用 chat-unread-state 的规则，由调用方传入）。
 * - task.*：正在 /tasks 时不计，否则递增 task:all。
 * - member.status.updated / member.updated（agent 活动代理）：正在 /daemon 时不计，
 *   否则递增 activity:all。
 */
export function activityUnreadKeysForEvent(
  event: PublicEventEnvelope,
  options: {
    pathname: string
    currentMemberNames?: readonly string[]
    currentMemberIds?: readonly string[]
    chatScopeKeys: (scope: PublicEventEnvelope["scope"]) => string[]
  },
): string[] {
  const { pathname, currentMemberNames = [], currentMemberIds = [], chatScopeKeys } = options

  if (event.type === "message.created" && (event.scope.kind === "channel" || event.scope.kind === "dm")) {
    if (isOwnMessageEvent(event, currentMemberIds, currentMemberNames)) return []
    const routeName = chatRouteNameFromPath(pathname)
    const scopeName = event.scope.name?.replace(/^#/, "")
    if (routeName && scopeName && routeName === scopeName) return []
    return chatScopeKeys(event.scope)
  }

  if (event.type.startsWith("task.")) {
    if (pathname.startsWith("/tasks")) return []
    return [TASK_ACTIVITY_UNREAD_KEY]
  }

  if (event.type === "member.status.updated" || event.type === "member.updated") {
    if (pathname.startsWith("/daemon")) return []
    return [AGENT_ACTIVITY_UNREAD_KEY]
  }

  return []
}

/**
 * 事件用于未读计数时的去重序号。
 * 聊天消息用频道内 messageSeq（同 scope 单调递增，重放/乱序可被高水位正确去重）；
 * 不能用全局事件 seq —— 它是跨 scope 的 DB Identity，同频道两条消息之间隔着其它
 * 频道的全局 seq，per-key 高水位会让跨频道的合法新消息互相干扰/吞计数。
 * 其它域（task:all / activity:all）本就是跨 scope 聚合，继续用全局事件 seq。
 */
export function activityUnreadSeqForEvent(event: PublicEventEnvelope, keys: readonly string[]): number | undefined {
  if (keys.some((key) => key.startsWith(CHAT_ACTIVITY_UNREAD_PREFIX))) {
    return chatMessageSeqFromEvent(event)
  }
  return event.seq
}

/**
 * SSE 断线重连/追补（catch_up）时本地高水位的处理。
 * 返回 true 表示本地 lastSeq 高水位已不可信（可能吞掉补发事件的计数），
 * 调用方应清除相关键的高水位，让补发/重放事件重新参与计数。
 */
export function activityUnreadHighWaterCompromisedOnCatchUp(
  event: PublicEventEnvelope,
): boolean {
  return event.scope.kind === "channel" || event.scope.kind === "dm"
}

/**
 * 进入某路由后应清除的域键（R3「访问后清除」语义）。
 * 聊天域不按路由整域清除 —— 它由侧栏/频道页按实体清除 + 服务端 read-cursor 校准。
 */
export function activityUnreadClearKeysForPath(pathname: string): string[] {
  const keys: string[] = []
  if (pathname.startsWith("/tasks")) keys.push(TASK_ACTIVITY_UNREAD_KEY)
  if (pathname.startsWith("/daemon")) keys.push(AGENT_ACTIVITY_UNREAD_KEY)
  return keys
}
