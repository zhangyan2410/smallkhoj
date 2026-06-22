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

import { MemberAvatar } from "@/components/member-avatar"
import { ProductShell } from "@/components/product-shell"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { EmptyState, Toolbar } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiGet, formatTime, type Computer, type Member } from "@/lib/control-plane"
import { getStatusBucket, getStatusLabel } from "@/lib/agent-status"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

type Channel = {
  id: string
  name: string
  type: string
  description?: string
}

type Task = {
  id: string
  number: number
  title: string
  status: string
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

async function getChannels() {
  return apiGet<{ channels: Channel[] }>("/api/v1/channels", { channels: [] })
}

async function getMembers() {
  return apiGet<{ members: Member[] }>("/api/v1/members", { members: [] })
}

async function getTasks() {
  return apiGet<{ tasks: Task[] }>("/api/v1/tasks", { tasks: [] })
}

async function getComputers() {
  return apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] })
}

async function getActivity() {
  return apiGet<{ activity: ActivityItem[]; count: number }>("/api/v1/activity?limit=30", { activity: [], count: 0 })
}

async function getSavedItems(sessionToken?: string | null) {
  return apiGet<{ saved: SavedItem[]; count: number }>("/api/v1/saved?limit=8", { saved: [], count: 0 }, sessionToken)
}

async function getSearchResults(query?: string) {
  const trimmed = (query || "").trim()
  if (!trimmed) return { results: [], count: 0 }
  return apiGet<{ results: SearchResult[]; count: number }>(
    `/api/v1/search?q=${encodeURIComponent(trimmed)}&limit=20`,
    { results: [], count: 0 }
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
            <Link
              key={`${result.type}-${result.id}`}
              href={href}
              className="flex items-start gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{result.title}</span>
                {(result.content || result.description) && (
                  <span className="block truncate text-xs text-muted-foreground">{result.content || result.description}</span>
                )}
              </span>
              <span className="max-w-[14rem] truncate text-xs text-muted-foreground">{resultMeta(result)}</span>
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
  const resolvedSearchParams = (await searchParams) ?? {}
  const searchQuery = Array.isArray(resolvedSearchParams.q) ? resolvedSearchParams.q[0] : resolvedSearchParams.q
  const t = await getTranslations("home")
  const tCommon = await getTranslations("common")

  const [{ channels }, { members }, { tasks }, { computers }, { activity }, { saved }, { results: searchResults }] = await Promise.all([
    getChannels(),
    getMembers(),
    getTasks(),
    getComputers(),
    getActivity(),
    getSavedItems(sessionToken),
    getSearchResults(searchQuery),
  ])
  const agents = members.filter((member) => member.kind === "agent")
  // Dashboard workbench: active agents (ACTIVE/THINKING/STARTING buckets only).
  const activeAgents = agents.filter((member) => {
    const bucket = getStatusBucket(member.status)
    return bucket === "ACTIVE" || bucket === "THINKING" || bucket === "STARTING"
  })
  const openTasks = tasks.filter((task) => task.status === "open")
  const inProgressTasks = tasks.filter((task) => task.status === "in_progress")
  const pendingTasks = [...openTasks, ...inProgressTasks]
  const onlineComputers = computers.filter((computer) => computer.status === "online" || computer.status === "active")

  const nonHeartbeat = activity.filter((a) => a.type !== "workspace_heartbeat")
  const heartbeatOnly = activity.filter((a) => a.type === "workspace_heartbeat")
  const recentActivity = [...nonHeartbeat, ...heartbeatOnly.slice(0, 5)]
  // Recent messages feed: activity rows describing sent messages.
  const recentMessages = recentActivity.filter((a) => a.type.includes("message_sent")).slice(0, 8)

  return (
    <ProductShell
      active="search"
      title={t("brand")}
      description={t("recentMessagesDesc")}
      session={session}
      sidebarTitle="Quick Start"
      sidebarDescription="Create a channel or start a DM without leaving the workbench."
      sidebar={
        <div className="space-y-4">
          <form action={createChannelAction} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="channel-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                New Channel
              </label>
              <Input
                id="channel-name"
                name="channelName"
                placeholder="channel-name"
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
                Start DM with
              </label>
              <select id="dm-peer" name="peer" required className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm">
                <option value="">Select member...</option>
                {agents.map((m) => (
                  <option key={m.id} value={m.displayName}>{m.displayName}</option>
                ))}
              </select>
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
        <RealtimeRefresh eventTypes={["member.status.updated", "member.updated", "message.created", "task.created", "task.updated"]} />

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
              <h1 className="bg-gradient-brand bg-clip-text text-3xl font-bold text-transparent sm:text-4xl">
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
                      <MessageSquare className="size-4 text-primary" />
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
                        <Link
                          key={item.id}
                          href={channelHref}
                          className="flex items-start gap-2.5 rounded-md px-2 py-2 text-sm transition-colors hover:bg-accent"
                        >
                          <Hash className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate font-medium">{item.agentName || "system"}</span>
                              {channelName && <span className="truncate text-xs text-muted-foreground">#{channelName.replace(/^#/, "")}</span>}
                            </div>
                            <div className="line-clamp-1 text-xs text-muted-foreground">{item.description}</div>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(item.timestamp)}</span>
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
                    <Bot className="size-4 text-primary" />
                    {t("activeAgents")}
                  </CardTitle>
                  <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
                    {activeAgents.length}
                  </span>
                </CardHeader>
                <CardContent className="space-y-1">
                  {activeAgents.length === 0 ? (
                    <EmptyState title={t("noActiveAgents")} description={t("noActiveAgentsDesc")} />
                  ) : (
                    activeAgents.map((agent) => (
                      <Link
                        key={agent.id}
                        href={`/chat/${encodeURIComponent(agent.displayName || agent.name)}`}
                        className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                      >
                        <MemberAvatar member={agent} size="sm" showStatus />
                        <span className="min-w-0 flex-1 truncate font-medium">{agent.displayName || agent.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{getStatusLabel(agent.status)}</span>
                      </Link>
                    ))
                  )}
                </CardContent>
              </Card>

              {/* Pending Tasks */}
              <Card className="lg:col-span-2 lg:col-start-2">
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <CheckSquare className="size-4 text-primary" />
                      {t("pendingTasks")}
                    </CardTitle>
                    <CardDescription>{t("pendingTasksDesc")}</CardDescription>
                  </div>
                  <Link href="/tasks">
                    <Button variant="ghost" size="sm">
                      {tCommon("allTasks")} <ArrowRight className="size-3" />
                    </Button>
                  </Link>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 flex gap-2">
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                      <span className="size-1.5 rounded-full bg-amber-500" />
                      {t("openCount", { count: openTasks.length })}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-1 text-xs font-medium text-sky-700 dark:text-sky-400">
                      <span className="size-1.5 rounded-full bg-sky-500" />
                      {t("inProgressCount", { count: inProgressTasks.length })}
                    </span>
                  </div>
                  {pendingTasks.length === 0 ? (
                    <EmptyState title={t("noPendingTasks")} description={t("noPendingTasksDesc")} />
                  ) : (
                    <div className="space-y-1">
                      {pendingTasks.slice(0, 6).map((task) => (
                        <Link
                          key={task.id}
                          href="/tasks"
                          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                        >
                          <span className="font-mono text-xs text-muted-foreground">#{task.number}</span>
                          <span className="min-w-0 flex-1 truncate">{task.title}</span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{task.status}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Quick stats sidebar card (computers + saved) */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="size-4 text-primary" />
                    {t("workspace")}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("channels")}</span>
                    <span className="font-semibold">{channels.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("agents")}</span>
                    <span className="font-semibold">{agents.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("computersOnline")}</span>
                    <span className="font-semibold">{onlineComputers.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("savedItems")}</span>
                    <span className="font-semibold">{saved.length}</span>
                  </div>
                  <Link href="/computers" className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <Bookmark className="size-3" /> {tCommon("manageComputers")} <ArrowRight className="size-3" />
                  </Link>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </ProductShell>
  )
}
