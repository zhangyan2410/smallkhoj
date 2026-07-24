import Link from "next/link"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import {
  Activity,
  ArrowRight,
  Bookmark,
  Bot,
  CheckSquare,
  FileText,
  Hash,
  MessageSquare,
  Plus,
  Search,
  User,
} from "lucide-react"

import { AgentSealMark, EvidenceSurface, MemberNameTag, ObjectMetric } from "@/components/inkframe-object-ui"
import { MemberAvatar } from "@/components/member-avatar"
import { ProductShell } from "@/components/product-shell"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { TaskDashboardProjection } from "@/components/task-dashboard-projection"
import { TaskProjectionProvider } from "@/components/task-projection-provider"
import { EmptyState, RuntimeChip, Toolbar } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { API_BASE, apiGet, apiGetCritical, formatTime, type Computer, type Member } from "@/lib/control-plane"
import { fetchAllTaskPages, type TaskCursorPage } from "@/lib/cursor-pagination"
import { getStatusBucket, getStatusLabel } from "@/lib/agent-status"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"
import type { TaskProjectionTask as Task } from "@/lib/task-projection"

type Channel = {
  id: string
  name: string
  type: string
  description?: string
}

type ActivityItem = {
  id: string
  type: string
  description: string
  agentName?: string | null
  timestamp?: string | null
  details?: Record<string, unknown>
}

type SearchResult = {
  id: string
  type: "message" | "task" | "member" | "channel" | "file" | string
  title: string
  content?: string | null
  description?: string | null
  href?: string | null
  channel?: string | null
  sender?: string | null
  handle?: string | null
  kind?: string | null
  status?: string | null
  taskNumber?: number
  channelType?: string | null
  mimeType?: string | null
  size?: number | null
  downloadUrl?: string | null
  previewUrl?: string | null
  timestamp?: string | null
  createdAt?: string | null
}

type SavedItem = SearchResult & {
  id: string
  itemType: string
  itemId: string
}

function channelPathSegment(name: string) {
  return encodeURIComponent(name.replace(/^#/, ""))
}

async function getChannels(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ channels: Channel[] }>("/api/v1/channels", { channels: [] }, sessionToken, activeServerId)
}

async function getMembers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ members: Member[] }>("/api/v1/members", { members: [] }, sessionToken, activeServerId)
}

async function getTasks(sessionToken?: string | null, activeServerId?: string | null) {
  const tasks = await fetchAllTaskPages<Task>((path) => (
    apiGetCritical<TaskCursorPage<Task>>(path, sessionToken, activeServerId)
  ))
  return { tasks }
}

async function getComputers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] }, sessionToken, activeServerId)
}

async function getActivity(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ activity: ActivityItem[]; count: number }>("/api/v1/activity?limit=30", { activity: [], count: 0 }, sessionToken, activeServerId)
}

async function getSavedItems(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ saved: SavedItem[]; count: number }>("/api/v1/saved?limit=8", { saved: [], count: 0 }, sessionToken, activeServerId)
}

async function getSearchResults(query?: string, sessionToken?: string | null, activeServerId?: string | null) {
  const trimmed = (query || "").trim()
  if (!trimmed) return { results: [], count: 0 }
  return apiGet<{ results: SearchResult[]; count: number }>(
    `/api/v1/search?q=${encodeURIComponent(trimmed)}&limit=20`,
    { results: [], count: 0 },
    sessionToken,
    activeServerId,
  )
}

async function createChannelAction(formData: FormData) {
  "use server"
  const name = formData.get("channelName") as string
  if (!name) return
  await fetch(`${API_BASE}/api/v1/channels`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ name, description: formData.get("channelDescription") || "" }),
  })
  revalidatePath("/")
}

async function createDmAction(formData: FormData) {
  "use server"
  const peer = formData.get("peer") as string
  if (!peer) return
  const response = await fetch(`${API_BASE}/api/v1/dm`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ peer }),
  })
  revalidatePath("/")
  if (response.ok) {
    const data = await response.json()
    if (data.channel?.name) {
      redirect(`/chat/${channelPathSegment(data.channel.name)}`)
    }
  }
}

function resultIcon(type: string) {
  if (type === "message") return MessageSquare
  if (type === "task") return CheckSquare
  if (type === "member") return User
  if (type === "channel") return Hash
  if (type === "file") return FileText
  return Search
}

function resultMeta(result: SearchResult) {
  if (result.type === "message") return [result.sender, result.channel, formatTime(result.timestamp)].filter(Boolean).join(" · ")
  if (result.type === "task") return [`#${result.taskNumber}`, result.status, result.channel].filter(Boolean).join(" · ")
  if (result.type === "member") return [result.handle, result.kind].filter(Boolean).join(" · ")
  if (result.type === "channel") return [result.channelType].filter(Boolean).join(" · ")
  if (result.type === "file") return [result.mimeType, result.channel, formatTime(result.createdAt)].filter(Boolean).join(" · ")
  return ""
}

function SearchResults({ query, results }: {
  query: string
  results: SearchResult[]
}) {
  if (!query) return null

  if (results.length === 0) {
    return (
      <Card>
        <CardContent className="py-6">
          <EmptyState title={`No results for "${query}"`} description="Try a different search term." />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1">
          <Search className="size-3" /> Results ({results.length})
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {results.map((result) => {
          const Icon = resultIcon(result.type)
          const href = result.href || result.downloadUrl || "/"
          return (
            <Link key={`${result.type}-${result.id}`} href={href} className="block text-sm">
              <EvidenceSurface kind={result.type} className="flex items-start gap-2 p-2">
                <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{result.title}</span>
                  {(result.content || result.description) && (
                    <span className="block truncate text-xs text-muted-foreground">{result.content || result.description}</span>
                  )}
                </span>
                <span className="max-w-[14rem] truncate text-xs text-muted-foreground">{resultMeta(result)}</span>
              </EvidenceSurface>
            </Link>
          )
        })}
      </CardContent>
    </Card>
  )
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireCurrentAccount()
  const sessionToken = await getSessionToken()
  const activeServerId = session.server.id
  const resolvedSearchParams = (await searchParams) ?? {}
  const searchQuery = Array.isArray(resolvedSearchParams.q) ? resolvedSearchParams.q[0] : resolvedSearchParams.q
  const t = await getTranslations("home")
  const tCommon = await getTranslations("common")

  const [{ channels }, { members }, { tasks }, { computers }, { activity }, { saved }, { results: searchResults }] = await Promise.all([
    getChannels(sessionToken, activeServerId),
    getMembers(sessionToken, activeServerId),
    getTasks(sessionToken, activeServerId),
    getComputers(sessionToken, activeServerId),
    getActivity(sessionToken, activeServerId),
    getSavedItems(sessionToken, activeServerId),
    getSearchResults(searchQuery, sessionToken, activeServerId),
  ])
  const agents = members.filter((member) => member.kind === "agent")
  // Dashboard workbench: active agents (ACTIVE/THINKING/STARTING buckets only).
  const activeAgents = agents.filter((member) => {
    const bucket = getStatusBucket(member.status)
    return bucket === "ACTIVE" || bucket === "THINKING" || bucket === "STARTING"
  })
  const onlineComputers = computers.filter((computer) => computer.status === "online" || computer.status === "active")

  const nonHeartbeat = activity.filter((a) => a.type !== "workspace_heartbeat")
  const heartbeatOnly = activity.filter((a) => a.type === "workspace_heartbeat")
  const recentActivity = [...nonHeartbeat, ...heartbeatOnly.slice(0, 5)]
  // Recent messages feed: activity rows describing sent messages.
  const recentMessages = recentActivity.filter((a) => a.type.includes("message_sent")).slice(0, 8)

  return (
    <TaskProjectionProvider
      scopeKey={`${session.account.id}:${activeServerId}`}
      initialTasks={tasks}
      sessionToken={sessionToken}
      activeServerId={activeServerId}
    >
    <ProductShell
      active="search"
      title={t("brand")}
      description={t("recentMessagesDesc")}
      session={session}
      sidebarTitle={t("quickStart")}
      sidebarDescription={t("quickStartDesc")}
      sidebar={
        <div className="space-y-4">
          <form action={createChannelAction} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="channel-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("newChannel")}
              </label>
              <Input
                id="channel-name"
                name="channelName"
                placeholder={t("channelPlaceholder")}
                required
              />
            </div>
            <Button type="submit" size="icon" aria-label="Create channel">
              <Plus className="size-4" />
            </Button>
          </form>
          <form action={createDmAction} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="dm-peer" className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("startDmWith")}
              </label>
              <Select
                id="dm-peer"
                name="peer"
                required
                items={agents.map((member) => member.displayName || member.name)}
                emptyLabel={t("selectMember")}
              />
            </div>
            <Button type="submit" size="icon" aria-label="Start DM">
              <MessageSquare className="size-4" />
            </Button>
          </form>
        </div>
      }
      actions={
        <>
          <Link href="/chat">
            <Button size="sm">
              <MessageSquare className="size-4" />
              Chat
            </Button>
          </Link>
          <Link href="/tasks">
            <Button variant="outline" size="sm">
              <CheckSquare className="size-4" />
              Tasks
            </Button>
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <RealtimeRefresh eventTypes={["member.status.updated", "member.updated", "message.created"]} />

        <form action="/" method="get" className="flex items-center gap-2">
          <Toolbar>
            <Search className="size-4 text-muted-foreground" />
            <Input
              aria-label="Global search"
              name="q"
              placeholder={tCommon("searchPlaceholder")}
              defaultValue={searchQuery}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button type="submit" size="sm" variant="ghost">{tCommon("search")}</Button>
          </Toolbar>
        </form>

        {searchQuery ? (
          <SearchResults query={searchQuery} results={searchResults} />
        ) : (
          <>
            {/* Brand header + greeting */}
            <div className="space-y-1">
              {/* Per DESIGN.md: no gradient text. Use weight + size for hierarchy. */}
              <h1 className="text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
                {t("brand")}
              </h1>
              <p className="text-muted-foreground">
                {t("greeting", { name: session?.account?.displayName ?? session?.account?.name ?? "there" })}
              </p>
            </div>

            {/* Dashboard workbench: 3 columns on desktop, stacked on mobile. */}
            <div className="grid gap-4 lg:grid-cols-3">
              {/* Recent Messages (wide on desktop via row-spanning) */}
              <Card className="lg:col-span-2">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <MessageSquare className="size-4 text-accent-blue" />
                      {t("recentMessages")}
                    </CardTitle>
                    <CardDescription>{t("recentMessagesDesc")}</CardDescription>
                  </div>
                  <Link href="/chat">
                    <Button variant="ghost" size="sm">
                      {tCommon("open")} <ArrowRight className="size-3" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent className="space-y-1">
                  {recentMessages.length === 0 ? (
                    <EmptyState title={t("noRecentMessages")} description={t("noRecentMessagesDesc")} />
                  ) : (
                    recentMessages.map((item) => {
                      const channelName = (item.details?.channelName as string) || (item.details?.channel as string) || item.description?.split(/\s+/).find((w) => w.startsWith("#")) || null
                      const channelHref = channelName ? `/chat/${channelPathSegment(channelName)}` : "/chat"
                      return (
                        <Link key={item.id} href={channelHref} className="block text-sm">
                          <EvidenceSurface kind="message" className="flex items-start gap-2.5 p-2">
                            <Hash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-medium">{item.agentName || "system"}</span>
                                {channelName && <span className="truncate text-xs text-muted-foreground">#{channelName.replace(/^#/, "")}</span>}
                              </div>
                              <div className="line-clamp-1 text-xs text-muted-foreground">{item.description}</div>
                            </div>
                            <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(item.timestamp)}</span>
                          </EvidenceSurface>
                        </Link>
                      )
                    })
                  )}
                </CardContent>
              </Card>

              {/* Active Agents */}
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Bot className="size-4 text-accent-mint" />
                    {t("activeAgents")}
                  </CardTitle>
                  <RuntimeChip tone="paper" className="min-h-0 gap-1 px-1.5 py-0.5 text-[11px]">
                    <span className="size-1.5 shrink-0 rounded-full bg-success" />
                    {activeAgents.length}
                  </RuntimeChip>
                </CardHeader>
                <CardContent className="space-y-1">
                  {activeAgents.length === 0 ? (
                    <EmptyState title={t("noActiveAgents")} description={t("noActiveAgentsDesc")} />
                  ) : (
                    activeAgents.map((agent) => (
                      <Link key={agent.id} href={`/chat/${encodeURIComponent(agent.displayName || agent.name)}`} className="block text-sm">
                        <MemberNameTag kind="agent" status={agent.status} className="flex items-center gap-2.5 px-2 py-1.5">
                          <AgentSealMark status={agent.status}>
                            <MemberAvatar member={agent} size="sm" showStatus />
                          </AgentSealMark>
                          <span className="min-w-0 flex-1 truncate font-medium">{agent.displayName || agent.name}</span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{getStatusLabel(agent.status)}</span>
                        </MemberNameTag>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>

              <TaskDashboardProjection />

              {/* Quick stats sidebar card (computers + saved) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="size-4 text-accent-purple" />
                    {t("workspace")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-1">
                  <ObjectMetric label={t("channels")} value={channels.length} />
                  <ObjectMetric label={t("agents")} value={agents.length} />
                  <ObjectMetric label={t("computersOnline")} value={onlineComputers.length} />
                  <ObjectMetric label={t("savedItems")} value={saved.length} />
                  <Link href="/computers" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-paper-ink hover:underline sm:col-span-2 lg:col-span-1">
                    <Bookmark className="size-3" /> {tCommon("manageComputers")} <ArrowRight className="size-3" />
                  </Link>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </ProductShell>
    </TaskProjectionProvider>
  )
}
