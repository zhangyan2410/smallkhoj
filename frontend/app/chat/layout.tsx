import type { Metadata } from "next"
import type { ReactNode } from "react"

import { ProductShell } from "@/components/product-shell"
import { ChatDataProvider } from "@/app/chat/chat-data-context"
import { ChatSidebar } from "@/app/chat/[channel]/chat-sidebar"
import { mergeChatReadCursorsIntoEntities, type ChatReadCursor } from "@/lib/chat-unread-state"
import { requireCurrentAccount } from "@/lib/server-auth"
import { fetchChatChannels, fetchChatDms, fetchChatMembers, fetchChatReadCursors } from "./chat-server-fetches"

export const metadata: Metadata = {
  title: "Chat - SmallKhoj",
}

const CHAT_LIST_WIDTH = {
  storageKey: "smallkhoj.chat.listWidth",
  defaultWidth: 260,
  min: 220,
  max: 380,
} as const

export default async function ChatLayout({ children }: { children: ReactNode }) {
  const session = await requireCurrentAccount()
  // 4 个取数走 cache()-wrapped helpers（自带 session、无参）：
  // 同 pass 内若 [channel]/page 也调用 fetchChatMembers/fetchChatDms，会命中 cache、不再多发请求。
  const [channelsRaw, dmsRaw, allMembers, cursorsRaw] = await Promise.all([
    fetchChatChannels(),
    fetchChatDms(),
    fetchChatMembers(),
    fetchChatReadCursors(),
  ])
  const cursors = (cursorsRaw ?? []) as ChatReadCursor[]
  const channels = mergeChatReadCursorsIntoEntities(channelsRaw, cursors)
  const dms = mergeChatReadCursorsIntoEntities(dmsRaw, cursors)

  return (
    <ChatDataProvider channels={channels} dms={dms} allMembers={allMembers}>
      <ProductShell
        active="chat"
        title="Chat"
        description="Conversations with the agent team"
        session={session}
        list={<ChatSidebar />}
        listTitle="Chat"
        listConfig={CHAT_LIST_WIDTH}
        className="p-0"
        mainScrollable={false}
      >
        {children}
      </ProductShell>
    </ChatDataProvider>
  )
}
