import type { Metadata } from "next"
import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"

import { ProductShell } from "@/components/product-shell"
import { ChatDataProvider } from "./chat-data-context"
import { ChatSidebar } from "./[channel]/chat-sidebar"
import { mergeChatReadCursorsIntoEntities, type ChatReadCursor } from "@/lib/chat-unread-state"
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
  // auth gate 由上层 app/(app)/layout.tsx 统一负责；这里不再单独 requireCurrentAccount()。
  // 4 个取数走 cache()-wrapped helpers（自带 session、无参）：
  // 同 pass 内若 [channel]/page 也调用 fetchChatMembers/fetchChatDms，会命中 cache、不再多发请求。
  const [channelsRaw, dmsRaw, allMembers, cursorsRaw, t] = await Promise.all([
    fetchChatChannels(),
    fetchChatDms(),
    fetchChatMembers(),
    fetchChatReadCursors(),
    getTranslations("chat"),
  ])
  const cursors = (cursorsRaw ?? []) as ChatReadCursor[]
  const channels = mergeChatReadCursorsIntoEntities(channelsRaw, cursors)
  const dms = mergeChatReadCursorsIntoEntities(dmsRaw, cursors)

  return (
    <ChatDataProvider channels={channels} dms={dms} allMembers={allMembers}>
      <ProductShell
        title={t("landingTitle")}
        description={t("landingDescription")}
        list={<ChatSidebar />}
        listTitle={t("landingTitle")}
        listConfig={CHAT_LIST_WIDTH}
        className="p-0"
        mainScrollable={false}
      >
        {children}
      </ProductShell>
    </ChatDataProvider>
  )
}
