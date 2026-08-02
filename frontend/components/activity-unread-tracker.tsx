"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

import { useRealtimeSubscription } from "@/components/realtime-provider"
import {
  activityUnreadClearKeysForPath,
  activityUnreadKeysForEvent,
  clearActivityUnread,
  markActivityUnread,
  notifyActivityUnreadChanged,
  readActivityUnreadStore,
  writeActivityUnreadStore,
} from "@/lib/activity-unread-state"
import { chatScopeKeys } from "@/lib/chat-unread-state"

/**
 * 活动未读跟踪器（R1 状态层的 SSE 驱动端，无 UI）。
 * 挂在 (app) layout 的 RealtimeProvider 内，复用全局唯一 SSE 连接：
 * 事件 → activityUnreadKeysForEvent 投影 → 统一未读存储递增（seq 高水位去重，
 * 重放/重连不重复计数）。进入 /tasks、/daemon 路由时清除对应域键。
 */
export function ActivityUnreadTracker({ currentMemberNames = [] }: { currentMemberNames?: readonly string[] }) {
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  const memberNamesRef = useRef(currentMemberNames)

  useEffect(() => {
    pathnameRef.current = pathname
    memberNamesRef.current = currentMemberNames
  }, [pathname, currentMemberNames])

  useEffect(() => {
    const keys = activityUnreadClearKeysForPath(pathname)
    if (keys.length === 0) return
    const store = readActivityUnreadStore(window.localStorage)
    const next = clearActivityUnread(store, keys)
    if (next !== store) {
      writeActivityUnreadStore(window.localStorage, next)
      notifyActivityUnreadChanged(window)
    }
  }, [pathname])

  useRealtimeSubscription(({ event, decision }) => {
    if (decision.action === "drop") return
    const keys = activityUnreadKeysForEvent(event, {
      pathname: pathnameRef.current,
      currentMemberNames: memberNamesRef.current,
      chatScopeKeys,
    })
    if (keys.length === 0) return
    markActivityUnread(
      typeof window === "undefined" ? undefined : window.localStorage,
      typeof window === "undefined" ? undefined : window,
      keys,
      event.seq,
    )
  })

  return null
}
