import type { PublicEventEnvelope } from "./realtime-events"
import type { NotificationDomain, NotificationPreferences } from "./notification-preferences"

/**
 * 实时事件 → 系统通知的纯映射层（任务 07-30-background-notifications R2）。
 * 不碰 Notification API、不碰 i18n：只产结构化的 NotificationPlan，
 * 文案由 tracker 组件用 next-intl 渲染。抑制/节流规则全部为纯函数，单测覆盖。
 *
 * 规则（与 PRD 对齐）：
 * - DM 新消息：通知（最高优先级）；
 * - 频道消息：仅当 payload 能判定 @提及当前用户，判不定则不通知（宁缺毋滥）；
 * - task.created/updated：通知；
 * - memory.*（待审）：通知；
 * - 自己触发的事件不通知；对应路由可见且文档聚焦时不发；
 * - 同 scope 30s 节流折叠（offer/flush 两个纯函数）。
 */

export type NotificationVariant = "dm_message" | "mention" | "task" | "memory"

export type NotificationPlan = {
  domain: NotificationDomain
  variant: NotificationVariant
  /** 节流/折叠键：同 key 的事件 30s 内合并为一条。 */
  throttleKey: string
  /** 点击通知后的落地路由。 */
  href: string
  /** 文案插值参数（发送者、频道名、任务标题等，可为空）。 */
  params: Record<string, string>
}

export type NotificationPlanContext = {
  pathname: string
  currentMemberIds?: readonly string[]
  prefs: NotificationPreferences
  /** document.visibilityState === "visible"。 */
  documentVisible: boolean
}

/** 同 scope 的节流窗口：窗口内只发一条，其余折叠为计数。 */
export const NOTIFICATION_THROTTLE_WINDOW_MS = 30_000

export type NotificationThrottleEntry = { lastNotifiedAt: number; pending: number }
export type NotificationThrottle = Record<string, NotificationThrottleEntry>

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

function routeSegment(name: string) {
  return encodeURIComponent(name.replace(/^#/, ""))
}

function messagePayload(event: PublicEventEnvelope): Record<string, unknown> {
  const nested = event.payload?.message
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : event.payload
}

function senderIdOf(event: PublicEventEnvelope): string {
  const message = messagePayload(event)
  const senderId = message.senderId ?? event.payload.senderId ?? event.payload.actorId
  return typeof senderId === "string" ? senderId : ""
}

function senderLabelOf(event: PublicEventEnvelope): string {
  const message = messagePayload(event)
  const sender = message.sender ?? event.payload.sender
  return typeof sender === "string" ? sender.trim().replace(/^@+/, "") : ""
}

/**
 * Message mentions are an ID contract. Never infer delivery from authored
 * text, a mutable Human display name, or a bare-handle prefix.
 */
export function eventMentionsCurrentMember(
  event: PublicEventEnvelope,
  currentMemberIds: readonly string[],
): boolean {
  const rawMentions = messagePayload(event).mentions ?? event.payload.mentions
  if (!Array.isArray(rawMentions) || currentMemberIds.length === 0) return false
  const currentIds = new Set(currentMemberIds)
  return rawMentions.some((memberId) => typeof memberId === "string" && currentIds.has(memberId))
}

function isOwnMessage(event: PublicEventEnvelope, currentMemberIds: readonly string[]): boolean {
  const senderId = senderIdOf(event)
  return Boolean(senderId && currentMemberIds.includes(senderId))
}

function scopeLabel(event: PublicEventEnvelope): string {
  return (event.scope.name || event.scope.id || "").replace(/^#/, "")
}

/**
 * 把一条实时事件投影为通知计划；null = 不通知。
 * 调用方（tracker）已按 high-water 跳过 decision.action === "drop" 的重放事件。
 */
export function planNotificationForEvent(
  event: PublicEventEnvelope,
  context: NotificationPlanContext,
): NotificationPlan | null {
  const { pathname, prefs, documentVisible } = context
  const currentMemberIds = context.currentMemberIds ?? []

  if (event.type === "message.created" && (event.scope.kind === "dm" || event.scope.kind === "channel")) {
    if (!prefs.chat) return null
    if (isOwnMessage(event, currentMemberIds)) return null
    const name = scopeLabel(event)
    if (!name) return null
    // 正在查看该频道/DM 且窗口聚焦时不发。
    if (documentVisible && chatRouteNameFromPath(pathname) === name) return null
    if (event.scope.kind === "dm") {
      return {
        domain: "chat",
        variant: "dm_message",
        throttleKey: `dm:${name}`,
        href: `/chat/${routeSegment(name)}`,
        params: { sender: senderLabelOf(event) || name.replace(/^DM @/, "") },
      }
    }
    // 频道消息：只信后端持久化的 Message.mentions UUID。
    if (!eventMentionsCurrentMember(event, currentMemberIds)) return null
    return {
      domain: "chat",
      variant: "mention",
      throttleKey: `channel:${name}`,
      href: `/chat/${routeSegment(name)}`,
      params: { channel: name, sender: senderLabelOf(event) },
    }
  }

  if (event.type === "task.created" || event.type === "task.updated") {
    if (!prefs.tasks) return null
    // 任务页可见且聚焦时，看板本身已实时刷新，不再弹通知。
    if (documentVisible && pathname.startsWith("/tasks")) return null
    const task = event.payload?.task as { id?: unknown; title?: unknown } | undefined
    const taskId = typeof task?.id === "string" ? task.id : event.scope.id
    if (!taskId) return null
    return {
      domain: "tasks",
      variant: "task",
      throttleKey: `task:${taskId}`,
      href: `/tasks?task=${encodeURIComponent(taskId)}`,
      params: { title: typeof task?.title === "string" ? task.title : "" },
    }
  }

  if (event.type.startsWith("memory.")) {
    if (!prefs.memory) return null
    const name = scopeLabel(event)
    if (event.scope.kind === "channel" || event.scope.kind === "dm") {
      if (!name) return null
      if (documentVisible && chatRouteNameFromPath(pathname) === name) return null
      return {
        domain: "memory",
        variant: "memory",
        throttleKey: `memory:${event.scope.kind}:${name}`,
        href: `/chat/${routeSegment(name)}`,
        params: { channel: name },
      }
    }
    if (event.scope.kind === "task" && event.scope.id) {
      if (documentVisible && pathname.startsWith("/tasks")) return null
      return {
        domain: "memory",
        variant: "memory",
        throttleKey: `memory:task:${event.scope.id}`,
        href: `/tasks?task=${encodeURIComponent(event.scope.id)}`,
        params: {},
      }
    }
    // 其它 scope 的 memory 事件落到活动页。
    if (documentVisible && pathname.startsWith("/daemon")) return null
    return {
      domain: "memory",
      variant: "memory",
      throttleKey: `memory:${event.scope.kind}:${event.scope.id ?? "all"}`,
      href: "/daemon",
      params: {},
    }
  }

  return null
}

/**
 * 节流入口：窗口外（或首次）→ "now" 立即通知；
 * 窗口内 → "queued" 折叠计数，等待 flush 汇总。
 */
export function offerThrottledNotification(
  throttle: NotificationThrottle,
  key: string,
  now: number,
): { throttle: NotificationThrottle; action: "now" | "queued" } {
  const entry = throttle[key]
  if (!entry || now - entry.lastNotifiedAt >= NOTIFICATION_THROTTLE_WINDOW_MS) {
    return { throttle: { ...throttle, [key]: { lastNotifiedAt: now, pending: 0 } }, action: "now" }
  }
  return { throttle: { ...throttle, [key]: { ...entry, pending: entry.pending + 1 } }, action: "queued" }
}

/**
 * 收集窗口已到期的折叠计数（每条汇总成一条「N 条新消息」通知），
 * 已 flush 的 key 重新开始一个窗口（lastNotifiedAt = 窗口起点 + 一个周期）。
 */
export function flushThrottledNotifications(
  throttle: NotificationThrottle,
  now: number,
): { throttle: NotificationThrottle; flushed: Array<{ key: string; count: number }> } {
  const flushed: Array<{ key: string; count: number }> = []
  const next: NotificationThrottle = { ...throttle }
  for (const [key, entry] of Object.entries(throttle)) {
    if (entry.pending <= 0) continue
    if (now - entry.lastNotifiedAt < NOTIFICATION_THROTTLE_WINDOW_MS) continue
    flushed.push({ key, count: entry.pending })
    next[key] = { lastNotifiedAt: entry.lastNotifiedAt + NOTIFICATION_THROTTLE_WINDOW_MS, pending: 0 }
  }
  return { throttle: next, flushed }
}
