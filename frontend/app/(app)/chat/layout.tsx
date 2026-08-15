import type { Metadata } from "next"
import type { ReactNode } from "react"
import { getTranslations } from "next-intl/server"

import { ProductShell } from "@/components/product-shell"
import { canManageActiveServer } from "@/lib/server-permissions"
import { ChatDataProvider } from "./chat-data-context"
import { ChatSidebar } from "./[channel]/chat-sidebar"
import { mergeChatReadCursorsIntoEntities, type ChatReadCursor } from "@/lib/chat-unread-state"
import { cachedCurrentAccount, fetchChatChannels, fetchChatDms, fetchChatMembers, fetchChatReadCursors } from "./chat-server-fetches"

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
  const [channelsRaw, dmsRaw, allMembers, cursorsRaw, t, tSwitcher, account] = await Promise.all([
    fetchChatChannels(),
    fetchChatDms(),
    fetchChatMembers(),
    fetchChatReadCursors(),
    getTranslations("chat"),
    getTranslations("serverSwitcher"),
    cachedCurrentAccount(),
  ])
  const cursors = (cursorsRaw ?? []) as ChatReadCursor[]
  const channels = mergeChatReadCursorsIntoEntities(channelsRaw, cursors)
  const dms = mergeChatReadCursorsIntoEntities(dmsRaw, cursors)
  const canManageServer = canManageActiveServer(account)
  const activeMembership = account?.memberships?.find((item) => item.server.id === account?.server.id)
  const roleLabel = tSwitcher(
    activeMembership?.role === "owner" ? "roleOwner" : activeMembership?.role === "admin" ? "roleAdmin" : "roleMember",
  )
  const serverContextLabel = account
    ? `${account.server.name} · ${roleLabel}${activeMembership?.isDefault ? ` · ${tSwitcher("homeServer")}` : ""}`
    : ""

  return (
    <ChatDataProvider channels={channels} dms={dms} allMembers={allMembers}>
      <ProductShell
        title={t("landingTitle")}
        description={t("landingDescription")}
        list={<ChatSidebar canManageServer={canManageServer} serverContextLabel={serverContextLabel} />}
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
