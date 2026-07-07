"use client"

import { useCallback, useEffect, useState } from "react"

import {
  CHAT_UNREAD_EVENT,
  CHAT_UNREAD_STORAGE_KEY,
  clearChatUnreadForEntity,
  readChatUnreadStore,
  writeChatUnreadStore,
  type ChatUnreadEntity,
  type ChatUnreadStore,
} from "@/lib/chat-unread-state"

export function useChatUnreadStore() {
  const [store, setStore] = useState<ChatUnreadStore>({})

  const refresh = useCallback(() => {
    setStore(readChatUnreadStore(typeof window === "undefined" ? undefined : window.localStorage))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0)
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === CHAT_UNREAD_STORAGE_KEY) refresh()
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(CHAT_UNREAD_EVENT, refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(CHAT_UNREAD_EVENT, refresh)
    }
  }, [refresh])

  const clearEntity = useCallback((entity: ChatUnreadEntity) => {
    setStore((previous) => {
      const next = clearChatUnreadForEntity(previous, entity)
      writeChatUnreadStore(typeof window === "undefined" ? undefined : window.localStorage, next)
      return next
    })
  }, [])

  return { store, clearEntity, refresh }
}
