import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Hash, MessageSquare } from "lucide-react"
import { redirect } from "next/navigation"

import { AvatarObject, ChannelDivider } from "@/components/inkframe-object-ui"
import { EmptyState } from "@/components/product-ui"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { API_BASE, type Member } from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"
import { DmStarter } from "./dm-starter"

type Channel = {
  id: string
  name: string
  type: string
  description?: string | null
}

type DmInfo = {
  id: string
  name: string
  type: "dm"
  displayName: string
  peer?: Member | null
}

function channelPathSegment(name: string) {
  return encodeURIComponent(name.replace(/^#/, ""))
}

function dmAvatarMember(dm: DmInfo): Member {
  return dm.peer ?? {
    id: dm.id,
    name: dm.name,
    displayName: dm.displayName,
    kind: "human",
    status: "offline",
  }
}

export default async function ChatPage() {
  await requireCurrentAccount()
  const t = await getTranslations("chat")
  // 注意：这是服务端组件，必须用 serverApiHeaders() 从 cookie 读 session token。
  // 不能用 apiGet() 不带 token 的形式——那会落到 browserSessionToken()，
  // 在服务端拿不到浏览器 localStorage 的 token，导致请求被当作匿名，返回空列表。
  const headers = await serverApiHeaders()
  const [channelsRes, dmsRes, membersRes] = await Promise.all([
    fetch(`${API_BASE}/api/v1/channels`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/api/v1/dms`, { headers, cache: "no-store" }),
    fetch(`${API_BASE}/api/v1/members`, { headers, cache: "no-store" }),
  ])
  const channelsData = channelsRes.ok ? await channelsRes.json() as { channels?: Channel[] } : {}
  const dmsData = dmsRes.ok ? await dmsRes.json() as { dms?: DmInfo[] } : {}
  const membersData = membersRes.ok ? await membersRes.json() as { members?: Member[] } : {}
  const channels = channelsData.channels || []
  const dms = dmsData.dms || []
  const allMembers = membersData.members || []
  const agents = (allMembers || []).filter((m: Member) => m.kind === "agent").sort(
    (a: Member, b: Member) => (a.displayName || a.name).localeCompare(b.displayName || b.name)
  )

  // 落地页已被移除：直接进入第一个频道，回退到第一个 DM，
  // 都没有时才展示一个最小空状态，引导用户创建会话。
  const firstChannel = channels[0]
  if (firstChannel) {
    redirect(`/chat/${channelPathSegment(firstChannel.name)}`)
  }
  const firstDm = dms[0]
  if (firstDm) {
    redirect(`/chat/${channelPathSegment(firstDm.name)}`)
  }

  return (
    <div className="grid gap-4 p-4 sm:p-6 xl:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Hash className="size-4 text-primary" />
            {t("channels")}
          </CardTitle>
          <CardDescription>{t("openChannelDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {channels.map((channel) => (
            <Link
              key={channel.id}
              href={`/chat/${channelPathSegment(channel.name)}`}
              className="sk-list-object flex min-h-11 items-center gap-2 rounded-none border-2 border-[var(--ink)] px-3 text-sm"
            >
              <ChannelDivider kind="channel" active={false} className="px-2 py-1">
                <Hash className="size-4" />
              </ChannelDivider>
              <span className="min-w-0 flex-1 truncate font-medium">{channel.name}</span>
              <span className="text-xs text-muted-foreground">{channel.type}</span>
            </Link>
          ))}
          {channels.length === 0 && <EmptyState title={t("noChannels")} description={t("noChannelsDesc")} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="size-4 text-primary" />
            {t("directMessage")}
          </CardTitle>
          <CardDescription>{t("continueDmDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {dms.map((dm) => (
            <Link
              key={dm.id}
              href={`/chat/${channelPathSegment(dm.name)}`}
              className="sk-list-object flex min-h-11 items-center gap-2 rounded-none border-2 border-[var(--ink)] px-3 text-sm"
            >
              <AvatarObject member={dmAvatarMember(dm)} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {dm.peer?.displayName || dm.displayName}
              </span>
              <span className="text-xs text-muted-foreground">{t("dms")}</span>
            </Link>
          ))}
          {dms.length === 0 && <EmptyState title={t("noDms")} description={t("noDmsDesc")} />}
          <DmStarter agents={agents} />
        </CardContent>
      </Card>
    </div>
  )
}
