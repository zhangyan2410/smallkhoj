import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { Hash, MessageSquare } from "lucide-react"
import { redirect } from "next/navigation"

import { AvatarObject, ChannelDivider } from "@/components/inkframe-object-ui"
import { EmptyState } from "@/components/product-ui"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Member } from "@/lib/control-plane"
import { requireCurrentAccount } from "@/lib/server-auth"
import { DmStarter } from "./dm-starter"
import { fetchChatChannels, fetchChatDms, fetchChatMembers } from "./chat-server-fetches"

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
  // 注意：这是服务端组件，fetch helpers 内部用 cache() 包装的 currentAccount/getSessionToken
  // 从 cookie 读 session token（per-request 单例），因此这里不再单独 serverApiHeaders()。
  // redirect 决定只需要 channels + dms。members 只有落到空状态分支（既无频道也无 DM）
  // 时才被 <DmStarter> 需要，因此延迟到 redirect 未触发时才取，避免无谓请求。
  // helpers 自带 session（内部 cache），无需传 headers。
  const [channels, dms] = await Promise.all([
    fetchChatChannels(),
    fetchChatDms(),
  ])

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

  // 只有走到这里（既无频道也无 DM）才需要 members 来填 <DmStarter> 的 agent 列表。
  // 同一 pass 内 layout 也会取 members，cache() 命中、不再多发一次请求。
  const allMembers = await fetchChatMembers()
  const agents = (allMembers || []).filter((m: Member) => m.kind === "agent").sort(
    (a: Member, b: Member) => (a.displayName || a.name).localeCompare(b.displayName || b.name)
  )

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
