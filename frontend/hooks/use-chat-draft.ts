"use client"

import { useCallback, useEffect, useState } from "react"

import {
  CHAT_DRAFT_EVENT,
  CHAT_DRAFT_STORAGE_KEY,
  clearChatDraft,
  readChatDraft,
  setChatDraft,
} from "@/lib/chat-draft-state"

/**
 * 按作用域键（channel / thread）读写聊天草稿。
 *
 * hydration 安全：首渲固定返回空串（避免服务端/客户端不一致的水合警告），
 * 挂载后再从 localStorage 读取真实草稿。同标签页经 CHAT_DRAFT_EVENT 同步，
 * 跨标签页经 storage 事件同步——这样在 A 标签页清空后，B 标签页也会更新。
 *
 * setDraft 直接写 localStorage 并广播；发送成功后调用 clearDraft 清除。
 */
export function useChatDraft(scopeKey: string) {
  const [draft, setDraftState] = useState("")

  const refresh = useCallback(() => {
    setDraftState(
      readChatDraft(
        typeof window === "undefined" ? undefined : window.localStorage,
        scopeKey,
      ),
    )
  }, [scopeKey])

  useEffect(() => {
    const timer = window.setTimeout(refresh, 0)
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === CHAT_DRAFT_STORAGE_KEY) refresh()
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(CHAT_DRAFT_EVENT, refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(CHAT_DRAFT_EVENT, refresh)
    }
  }, [refresh])

  const setDraft = useCallback(
    (value: string) => {
      setChatDraft(
        typeof window === "undefined" ? undefined : window.localStorage,
        typeof window === "undefined" ? undefined : window,
        scopeKey,
        value,
      )
      setDraftState(value.slice(0, 10_000))
    },
    [scopeKey],
  )

  const clearDraft = useCallback(() => {
    clearChatDraft(
      typeof window === "undefined" ? undefined : window.localStorage,
      typeof window === "undefined" ? undefined : window,
      scopeKey,
    )
    setDraftState("")
  }, [scopeKey])

  return { draft, setDraft, clearDraft }
}
