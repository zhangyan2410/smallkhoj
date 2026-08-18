"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

import { useRealtimeSubscription } from "@/components/realtime-provider"
import {
  activityUnreadClearKeysForPath,
  activityUnreadHighWaterCompromisedOnCatchUp,
  activityUnreadKeysForEvent,
  activityUnreadSeqForEvent,
  clearActivityUnread,
  markActivityUnread,
  notifyActivityUnreadChanged,
  readActivityUnreadStore,
  resetActivityUnreadHighWaterMarked,
  writeActivityUnreadStore,
} from "@/lib/activity-unread-state"
import { chatScopeKeys } from "@/lib/chat-unread-state"
import { currentChatChannelId } from "@/lib/current-chat-view"

/**
 * 活动未读跟踪器（R1 状态层的 SSE 驱动端，无 UI）。
 * 挂在 (app) layout 的 RealtimeProvider 内，复用全局唯一 SSE 连接：
 * 事件 → activityUnreadKeysForEvent 投影 → 统一未读存储递增。
 * 去重序号：聊天消息用频道内 messageSeq（activityUnreadSeqForEvent），
 * 全局事件 seq 只用于 task/activity 聚合键。catch_up（断线重连）时先
 * 重置该 scope 键的本地高水位，避免补发事件被旧水位静默吞掉。
 * 进入 /tasks、/daemon 路由时清除对应域键。
 */
export function ActivityUnreadTracker({
  currentMemberNames = [],
  currentMemberIds = [],
}: {
  currentMemberNames?: readonly string[]
  currentMemberIds?: readonly string[]
}) {
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  const memberNamesRef = useRef(currentMemberNames)
  const memberIdsRef = useRef(currentMemberIds)

  useEffect(() => {
    pathnameRef.current = pathname
    memberNamesRef.current = currentMemberNames
    memberIdsRef.current = currentMemberIds
  }, [pathname, currentMemberNames, currentMemberIds])

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
      currentMemberIds: memberIdsRef.current,
      // 每条事件实时读取：chat-sidebar 随路由切换即时更新注册表
      currentChatChannelId: currentChatChannelId(),
      chatScopeKeys,
    })
    if (keys.length === 0) return
    const storage = typeof window === "undefined" ? undefined : window.localStorage
    const target = typeof window === "undefined" ? undefined : window
    if (decision.action === "catch_up" && activityUnreadHighWaterCompromisedOnCatchUp(event)) {
      // 断线期间的序号边界不可信：先重置该实体键的高水位，让补发事件参与计数。
      resetActivityUnreadHighWaterMarked(storage, target, keys)
    }
    markActivityUnread(storage, target, keys, activityUnreadSeqForEvent(event, keys))
  })

  return null
}
