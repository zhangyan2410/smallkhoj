"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { usePathname } from "next/navigation"

import type { Member } from "@/lib/control-plane"

export type ChannelInfo = {
  id: string
  name: string
  type: string
  description?: string | null
  latestSeq?: number
  unreadCount?: number
  hasUnread?: boolean
}
export type DmInfo = {
  id: string
  name: string
  type: "dm"
  displayName: string
  peer?: Member | null
  latestSeq?: number
  unreadCount?: number
  hasUnread?: boolean
}

type ChatData = {
  channels: ChannelInfo[]
  dms: DmInfo[]
  allMembers: Member[]
  currentChannelName: string
}

const ChatDataContext = createContext<ChatData | null>(null)

export function ChatDataProvider({
  channels,
  dms,
  allMembers,
  children,
}: {
  channels: ChannelInfo[]
  dms: DmInfo[]
  allMembers: Member[]
  children: ReactNode
}) {
  const pathname = usePathname() ?? ""
  const value = useMemo<ChatData>(() => {
    const segment = pathname.replace(/^\/chat\//, "").replace(/\?.*$/, "")
    let currentChannelName = ""
    try {
      currentChannelName = segment ? decodeURIComponent(segment) : ""
    } catch {
      currentChannelName = segment
    }
    return { channels, dms, allMembers, currentChannelName }
  }, [pathname, channels, dms, allMembers])
  return <ChatDataContext.Provider value={value}>{children}</ChatDataContext.Provider>
}

export function useChatData(): ChatData {
  const value = useContext(ChatDataContext)
  if (!value) {
    throw new Error("useChatData must be used inside <ChatDataProvider>")
  }
  return value
}
