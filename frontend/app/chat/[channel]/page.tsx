import { ChannelClient } from "./channel-client"
import { API_BASE, type Member } from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

type ChannelInfo = { id: string; name: string; type: string; description?: string }
type DmInfo = {
  id: string
  name: string
  type: "dm"
  displayName: string
  peer?: Member | null
}
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
  const [messagesRes, channelsRes, dmsRes, membersRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/channels/${encodedChannel}/messages?limit=50&threadMode=roots`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/api/v1/channels`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/api/v1/dms`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/api/v1/members`, { headers, cache: "no-store" }),
  ])
  const messagesData = messagesRes.ok ? await messagesRes.json() as { messages?: ChannelMessage[] } : {}
  const channelsData = channelsRes.ok ? await channelsRes.json() as { channels?: ChannelInfo[] } : {}
  const dmsData = dmsRes.ok ? await dmsRes.json() as { dms?: DmInfo[] } : {}
  const membersData = membersRes.ok ? await membersRes.json() as { members?: Member[] } : {}
  const channels = channelsData.channels || []
  const dms = dmsData.dms || []
  const match = channels.find((c) => c.name.replace("#", "") === initialChannel) ?? dms.find((dm) => dm.name === initialChannel)
  const matchedChannelId = match?.id || ""
  const channelMembersRes = matchedChannelId
    ? await fetch(`${API_BASE}/api/v1/channels/${matchedChannelId}/members`, { headers, cache: "no-store" })
    : null
  const channelMembersData = channelMembersRes?.ok ? await channelMembersRes.json() as { members?: Member[] } : {}

  return (
    <ChannelClient
      initialChannel={initialChannel}
      initialMessages={messagesData.messages || []}
      initialMembers={channelMembersData.members || []}
      initialAllMembers={membersData.members || []}
      initialChannels={channels}
      initialDms={dms}
      initialChannelId={matchedChannelId}
      sessionToken={sessionToken}
      currentMemberId={session.member.id}
      initialThreadId={firstParam(query.thread)}
      initialMessageId={firstParam(query.message)}
    />
  )
}
