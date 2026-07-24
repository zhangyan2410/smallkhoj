import { ChannelClient } from "./channel-client"
import { API_BASE, type Member } from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"
import { canManageActiveServer } from "@/lib/server-permissions"

type ChannelMessage = {
  id: string
  shortId?: string
  seq: number
  sender: string
  senderType: string
  content: string
  time: string
  parentId?: string | null
  threadId?: string
  threadShortId?: string | null
  replyCount?: number
  threadSummary?: { summary?: string | null; status?: string | null } | null
}

type DmInfo = {
  id: string
  name: string
  type: "dm"
  displayName: string
  peer?: Member | null
}

function decodeChannelParam(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ channel: string }>
  searchParams: SearchParams
}) {
  const session = await requireCurrentAccount()
  const sessionToken = await getSessionToken()
  const { channel } = await params
  const query = await searchParams
  const initialChannel = decodeChannelParam(channel)
  const encodedChannel = encodeURIComponent(initialChannel)
  const headers = await serverApiHeaders()
  const [messagesRes, membersRes, dmsRes] = await Promise.all([
    fetch(
      `${API_BASE}/api/v1/channels/${encodedChannel}/messages?limit=50&threadMode=roots`,
      { headers, cache: "no-store" }
    ),
    fetch(`${API_BASE}/api/v1/members`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/api/v1/dms`, { headers, cache: "no-store" }),
  ])
  const messagesData = messagesRes.ok ? await messagesRes.json() as { messages?: ChannelMessage[] } : {}
  const membersData = membersRes.ok ? await membersRes.json() as { members?: Member[] } : {}
  const allMembers = membersData.members || []
  const dmsData = dmsRes.ok ? await dmsRes.json() as { dms?: Array<{ id: string; name: string; displayName?: string; peerId?: string | null; peer?: Member | null }> } : {}
  // 服务端就把 DM 的 peer join 好，这样首屏 SSR 标题就是干净的成员名，
  // 不会先闪一下 "DM @<uuid>" 再切成正确名字。
  const initialDms: DmInfo[] = (dmsData.dms || []).map((dm) => {
    const peer = dm.peer ?? (dm.peerId ? allMembers.find((m) => m.id === dm.peerId) ?? null : null)
    return {
      id: dm.id,
      name: dm.name,
      type: "dm",
      displayName: dm.displayName || (peer ? `DM @${peer.profile?.displayName || peer.displayName || peer.name}` : dm.name),
      peer,
    }
  })
  return (
    <ChannelClient
      initialChannel={initialChannel}
      initialMessages={messagesData.messages || []}
      initialAllMembers={allMembers}
      initialDms={initialDms}
      sessionToken={sessionToken}
      activeServerId={session.server.id}
      canManageServer={canManageActiveServer(session)}
      currentMemberId={session.member.id}
      initialThreadId={firstParam(query.thread)}
      initialMessageId={firstParam(query.message)}
    />
  )
}
