import { ChannelClient } from "./channel-client"
import { API_BASE, type Member } from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"
import { fetchChatDms, fetchChatMembers } from "../chat-server-fetches"

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
  // messages 是频道专属、必须单独取；members/dms 与 chat/layout 重复，
  // 改走 cache()-wrapped helpers（自带 session、无参）——
  // 同 pass 内 layout 已取过则命中缓存、不再发请求。
  const [messagesRes, allMembers, dmsRaw] = await Promise.all([
    fetch(
      `${API_BASE}/api/v1/channels/${encodedChannel}/messages?limit=50&threadMode=roots`,
      { headers, cache: "no-store" }
    ),
    fetchChatMembers(),
    fetchChatDms(),
  ])
  const messagesData = messagesRes.ok ? await messagesRes.json() as { messages?: ChannelMessage[] } : {}
  // 服务端就把 DM 的 peer join 好，这样首屏 SSR 标题就是干净的成员名，
  // 不会先闪一下 "DM @<uuid>" 再切成正确名字。
  // 注意：后端 DM 响应可能带 peerId（用于在 peer 未直接内联时按 id 查成员），
  // 但 ChatDataProvider 的 DmInfo 类型不声明它，这里按原始载荷读取。
  const initialDms: DmInfo[] = (dmsRaw || []).map((dm) => {
    const rawPeerId = (dm as DmInfo & { peerId?: string | null }).peerId
    const peer = dm.peer ?? (rawPeerId ? allMembers.find((m) => m.id === rawPeerId) ?? null : null)
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
