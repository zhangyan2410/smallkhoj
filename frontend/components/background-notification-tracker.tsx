"use client"

import { useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import { useRealtimeSubscription } from "@/components/realtime-provider"
import {
  NOTIFICATION_THROTTLE_WINDOW_MS,
  flushThrottledNotifications,
  offerThrottledNotification,
  planNotificationForEvent,
  type NotificationPlan,
  type NotificationThrottle,
} from "@/lib/background-notifications"
import { readNotificationPreferences } from "@/lib/notification-preferences"

/**
 * 后台系统通知 tracker（任务 07-30-background-notifications R2/R3，无 UI）。
 * 与 ActivityUnreadTracker 并列挂在 (app) layout 的 RealtimeProvider 内，
 * 复用同一条 SSE 连接（禁止独立连接）；事件 → planNotificationForEvent →
 * 30s 同 scope 节流折叠 → Notification API。点击通知 window.focus + 路由直达。
 * 权限未授予 / 浏览器不支持 / 对应域开关关闭时静默降级。
 */
export function BackgroundNotificationTracker({
  currentMemberNames = [],
}: {
  currentMemberNames?: readonly string[]
}) {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations("notifications")

  const pathnameRef = useRef(pathname)
  const routerRef = useRef(router)
  const tRef = useRef(t)
  const memberNamesRef = useRef(currentMemberNames)
  const throttleRef = useRef<NotificationThrottle>({})
  const plansRef = useRef(new Map<string, NotificationPlan>())
  const flushTimerRef = useRef<number | null>(null)

  useEffect(() => {
    pathnameRef.current = pathname
    routerRef.current = router
    tRef.current = t
    memberNamesRef.current = currentMemberNames
  }, [pathname, router, t, currentMemberNames])

  useEffect(() => {
    return () => {
      if (flushTimerRef.current != null) window.clearTimeout(flushTimerRef.current)
    }
  }, [])

  useRealtimeSubscription(({ event, decision }) => {
    // 重放/重连的重复事件由 high-water 判定为 drop，不重复通知。
    if (decision.action === "drop") return
    if (typeof window === "undefined" || typeof Notification === "undefined") return
    if (Notification.permission !== "granted") return

    const fire = (plan: NotificationPlan, count: number) => {
      const translate = tRef.current
      const title = translate(`${plan.variant}.title`, plan.params)
      const body =
        count > 1
          ? translate(`${plan.variant}.summary`, { ...plan.params, count })
          : translate(`${plan.variant}.body`, plan.params)
      try {
        const notification = new Notification(title, { body, tag: `smallkhoj:${plan.throttleKey}` })
        notification.onclick = () => {
          window.focus()
          routerRef.current.push(plan.href)
          notification.close()
        }
      } catch {
        // 静默降级：构造失败（如无安全上下文）不打扰用户。
      }
    }

    const scheduleFlush = () => {
      if (flushTimerRef.current != null) return
      flushTimerRef.current = window.setTimeout(() => {
        flushTimerRef.current = null
        const { throttle, flushed } = flushThrottledNotifications(throttleRef.current, Date.now())
        throttleRef.current = throttle
        for (const { key, count } of flushed) {
          const plan = plansRef.current.get(key)
          plansRef.current.delete(key)
          if (plan) fire(plan, count)
        }
        if (Object.values(throttleRef.current).some((entry) => entry.pending > 0)) scheduleFlush()
      }, NOTIFICATION_THROTTLE_WINDOW_MS)
    }

    const plan = planNotificationForEvent(event, {
      pathname: pathnameRef.current,
      currentMemberNames: memberNamesRef.current,
      prefs: readNotificationPreferences(window.localStorage),
      documentVisible: document.visibilityState === "visible",
    })
    if (!plan) return

    const { throttle, action } = offerThrottledNotification(throttleRef.current, plan.throttleKey, Date.now())
    throttleRef.current = throttle
    plansRef.current.set(plan.throttleKey, plan)
    if (action === "now") fire(plan, 1)
    scheduleFlush()
  })

  return null
}
