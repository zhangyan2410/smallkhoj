"use client"

import { useMemo } from "react"

import {
  activityUnreadByPrefix,
  activityUnreadCount,
} from "@/lib/activity-unread-state"
import { useActivityUnreadStore } from "@/hooks/use-activity-unread-store"

/**
 * 把 R1 状态层注入展示原件（ActivityIndicator / SidebarEntityItem 等）。
 * 两种取数方式二选一：
 * - keys：精确键集合（同一实体多键取最大，如 ["chat:channel:id:x", "chat:channel:name:y"]）
 * - prefix：域前缀聚合（求和，如 "chat:" 用于 AppRail chat 图标）
 * suppressed：当前路由/正在查看时置 true，指示强制隐藏。
 */
export function useActivityIndicator({
  keys,
  prefix,
  suppressed = false,
}: {
  keys?: readonly string[]
  prefix?: string
  suppressed?: boolean
}) {
  const { store, clearKeys, refresh } = useActivityUnreadStore()

  const count = useMemo(() => {
    if (prefix) return activityUnreadByPrefix(store, prefix).count
    if (keys && keys.length > 0) return activityUnreadCount(store, keys)
    return 0
  }, [store, keys, prefix])

  const hasUnread = !suppressed && count > 0

  const clear = () => {
    if (keys && keys.length > 0) clearKeys(keys)
  }

  return { hasUnread, count: hasUnread ? count : 0, clear, refresh }
}
