"use client"

import { useCallback, useEffect, useState } from "react"

import {
  ACTIVITY_UNREAD_EVENT,
  ACTIVITY_UNREAD_STORAGE_KEY,
  clearActivityUnreadMarked,
  readActivityUnreadStore,
  type ActivityUnreadStore,
} from "@/lib/activity-unread-state"

/**
 * 读取统一活动未读存储（R1 状态层的只读 + 清除入口）。
 * hydration 安全：首渲用空 store，挂载后再读 localStorage；
 * 同源标签页经 ACTIVITY_UNREAD_EVENT、跨标签页经 storage 事件同步。
 */
export function useActivityUnreadStore() {
  const [store, setStore] = useState<ActivityUnreadStore>({})

  const refresh = useCallback(() => {
    setStore(readActivityUnreadStore(typeof window === "undefined" ? undefined : window.localStorage))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0)
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === ACTIVITY_UNREAD_STORAGE_KEY) refresh()
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(ACTIVITY_UNREAD_EVENT, refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(ACTIVITY_UNREAD_EVENT, refresh)
    }
  }, [refresh])

  const clearKeys = useCallback((keys: readonly string[]) => {
    // 基于 localStorage 最新快照清除（React state 经 setTimeout(0) 异步同步，
    // 直接用 previous 会与 tracker 的写入产生竞态，key 找不到就清不掉）。
    // 有实际清除时内部会广播 ACTIVITY_UNREAD_EVENT，其它 hook 实例同步刷新。
    const next = clearActivityUnreadMarked(
      typeof window === "undefined" ? undefined : window.localStorage,
      typeof window === "undefined" ? undefined : window,
      keys,
    )
    setStore(next)
  }, [])

  return { store, clearKeys, refresh }
}
