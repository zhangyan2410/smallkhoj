/**
 * 后台通知的用户偏好（任务 07-30-background-notifications R1）。
 * localStorage 持久化，默认全开；拒绝授权后功能静默降级（tracker 读不到
 * granted 就直接不发，不报错不骚扰）。
 */

export type NotificationDomain = "chat" | "tasks" | "memory"

export type NotificationPreferences = Record<NotificationDomain, boolean>

export const NOTIFICATION_PREFS_STORAGE_KEY = "smallkhoj.notifications.v1"

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  chat: true,
  tasks: true,
  memory: true,
}

const DOMAINS: NotificationDomain[] = ["chat", "tasks", "memory"]

export function readNotificationPreferences(
  storage: Pick<Storage, "getItem"> | undefined,
): NotificationPreferences {
  if (!storage) return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  try {
    const raw = storage.getItem(NOTIFICATION_PREFS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_NOTIFICATION_PREFERENCES }
    const parsed = JSON.parse(raw) as Partial<Record<NotificationDomain, unknown>>
    const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES }
    for (const domain of DOMAINS) {
      if (typeof parsed?.[domain] === "boolean") prefs[domain] = parsed[domain]
    }
    return prefs
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFERENCES }
  }
}

export function writeNotificationPreferences(
  storage: Pick<Storage, "setItem"> | undefined,
  prefs: NotificationPreferences,
) {
  if (!storage) return
  storage.setItem(NOTIFICATION_PREFS_STORAGE_KEY, JSON.stringify(prefs))
}
