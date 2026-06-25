import { ChannelClient } from "./channel-client"
import { API_BASE, type Member } from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

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
  const [messagesRes, membersRes] = await Promise.all([
    fetch(
      `${API_BASE}/api/v1/channels/${encodedChannel}/messages?limit=50&threadMode=roots`,
      { headers, cache: "no-store" }
    ),
    fetch(`${API_BASE}/api/v1/members`, { headers, cache: "no-store" }),
  ])
  const messagesData = messagesRes.ok ? await messagesRes.json() as { messages?: ChannelMessage[] } : {}
  const membersData = membersRes.ok ? await membersRes.json() as { members?: Member[] } : {}
  return (
    <ChannelClient
      initialChannel={initialChannel}
      initialMessages={messagesData.messages || []}
      initialAllMembers={membersData.members || []}
      sessionToken={sessionToken}
      currentMemberId={session.member.id}
      initialThreadId={firstParam(query.thread)}
      initialMessageId={firstParam(query.message)}
    />
  )
}
