import type { Metadata } from "next"
import type { ReactNode } from "react"

import { ProductShell } from "@/components/product-shell"
import { ChatDataProvider, type ChannelInfo, type DmInfo } from "@/app/chat/chat-data-context"
import { ChatSidebar } from "@/app/chat/[channel]/chat-sidebar"
import { API_BASE, type Member } from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

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
  const headers = await serverApiHeaders()
  const [channelsRes, dmsRes, membersRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/channels`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/api/v1/dms`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/api/v1/members`, { headers, cache: "no-store" }),
  ])
  const channelsData = channelsRes.ok ? await channelsRes.json() as { channels?: ChannelInfo[] } : {}
  const dmsData = dmsRes.ok ? await dmsRes.json() as { dms?: DmInfo[] } : {}
  const membersData = membersRes.ok ? await membersRes.json() as { members?: Member[] } : {}
  const channels = channelsData.channels || []
  const dms = dmsData.dms || []
  const allMembers = membersData.members || []

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
