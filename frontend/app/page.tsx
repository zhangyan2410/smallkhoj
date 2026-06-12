import Link from "next/link"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  Activity,
  Bell,
  Bookmark,
  CheckSquare,
  FileText,
  Hash,
  MessageSquare,
  Plus,
  Search,
  User,
  Eye,
  AtSign,
} from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { EmptyState, Toolbar } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiGet, formatTime, type Computer, type Member } from "@/lib/control-plane"
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

function activityIcon(type: string) {
  if (type.includes("message")) return MessageSquare
  if (type.includes("task")) return CheckSquare
  if (type.includes("workspace") || type.includes("heartbeat")) return Activity
  if (type.includes("member")) return User
  if (type.includes("file")) return FileText
  return Bell
}

function activityColor(type: string) {
  if (type.includes("message_sent")) return "text-primary"
  if (type.includes("task_claimed") || type.includes("task_updated")) return "text-sky-600"
  if (type.includes("workspace_heartbeat")) return "text-muted-foreground"
  return "text-muted-foreground"
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
  const activityFilter = Array.isArray(resolvedSearchParams.filter) ? resolvedSearchParams.filter[0] : resolvedSearchParams.filter || "all"

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
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "closed")
  const onlineComputers = computers.filter((computer) => computer.status === "online" || computer.status === "active")

  const nonHeartbeat = activity.filter((a) => a.type !== "workspace_heartbeat")
  const heartbeatOnly = activity.filter((a) => a.type === "workspace_heartbeat")
  const recentActivity = [...nonHeartbeat, ...heartbeatOnly.slice(0, 5)]

  const filteredActivity = activityFilter === "messages"
    ? recentActivity.filter((a) => a.type.includes("message"))
    : recentActivity

  return (
    <ProductShell
      active="search"
      title="SmallKhoj Workbench"
      description="Search, chat, tasks, agents, and connected computers in one operational product surface."
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
        <form action="/" method="get" className="flex items-center gap-2">
          <Toolbar>
            <Search className="size-4 text-muted-foreground" />
            <Input
              aria-label="Global search"
              name="q"
              placeholder="Search messages, files, tasks, members..."
              defaultValue={searchQuery}
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button type="submit" size="sm" variant="ghost">Search</Button>
          </Toolbar>
        </form>

        {searchQuery ? (
          <SearchResults query={searchQuery} results={searchResults} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Card size="sm">
                <CardHeader>
                  <CardDescription>Channels</CardDescription>
                  <CardTitle className="text-2xl">{channels.length}</CardTitle>
                </CardHeader>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardDescription>Open Tasks</CardDescription>
                  <CardTitle className="text-2xl">{openTasks.length}</CardTitle>
                </CardHeader>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardDescription>Agents</CardDescription>
                  <CardTitle className="text-2xl">{agents.length}</CardTitle>
                </CardHeader>
              </Card>
              <Card size="sm">
                <CardHeader>
                  <CardDescription>Computers Online</CardDescription>
                  <CardTitle className="text-2xl">{onlineComputers.length}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Hash className="size-4 text-primary" />
                    Chat Spaces
                  </CardTitle>
                  <CardDescription>Channels and DMs are the fastest path into collaboration.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {channels.slice(0, 6).map((ch) => (
                    <Link
                      key={ch.id}
                      href={`/chat/${channelPathSegment(ch.name)}`}
                      className="flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm transition-colors hover:bg-accent"
                    >
                      <Hash className="size-4 text-primary" />
                      <span className="min-w-0 flex-1 truncate font-medium">{ch.name}</span>
                      <span className="text-xs text-muted-foreground">{ch.type}</span>
                    </Link>
                  ))}
                  {channels.length === 0 && (
                    <EmptyState title="No channels yet" description="Create one from the quick start panel." />
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Bell className="size-4 text-primary" />
                      Activity Inbox
                    </CardTitle>
                    <CardDescription>Recent events across the control plane.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex gap-1">
                      <Link
                        href="/"
                        className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${activityFilter === "all" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
                      >All</Link>
                      <Link
                        href="/?filter=messages"
                        className={`inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-medium transition-colors ${activityFilter === "messages" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-accent"}`}
                      ><Eye className="size-3" />Messages</Link>
                      <span
                        className="inline-flex cursor-not-allowed items-center gap-1 rounded-md bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground/50"
                        title="Unread filtering requires backend read-state tracking (follow-up: read/unread state API)"
                      ><Eye className="size-3" />Unread</span>
                      <span
                        className="inline-flex cursor-not-allowed items-center gap-1 rounded-md bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground/50"
                        title="Mentions filtering requires backend mention parsing (follow-up: mentions API)"
                      ><AtSign className="size-3" />Mentions</span>
                    </div>
                    <div className="space-y-1">
                    {filteredActivity.slice(0, 10).map((item) => {
                      const Icon = activityIcon(item.type)
                      const color = activityColor(item.type)
                      return (
                        <div key={item.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm">
                          <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} />
                          <div className="min-w-0 flex-1">
                            <div className="truncate">{item.description}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{item.agentName || "system"}</span>
                              <span>{formatTime(item.timestamp)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                    {filteredActivity.length === 0 && (
                      <EmptyState
                        title={activityFilter === "all" ? "No recent activity" : `No ${activityFilter} events`}
                        description={activityFilter === "all" ? "Events will appear here as agents work." : "Try a different filter."}
                      />
                    )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Bookmark className="size-4 text-primary" />
                      Saved
                    </CardTitle>
                    <CardDescription>Bookmarked messages, tasks, and files.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {saved.length === 0 ? (
                      <EmptyState title="No saved items yet" description="Save a message, task, or file to keep it here." />
                    ) : (
                      <div className="space-y-1">
                        {saved.map((item) => {
                          const Icon = resultIcon(item.itemType)
                          return (
                            <Link
                              key={item.id}
                              href={item.href || item.downloadUrl || "/"}
                              className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                            >
                              <Icon className="mt-0.5 size-4 shrink-0 text-primary" />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{item.title}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {resultMeta({ ...item, type: item.itemType })}
                                </span>
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </>
        )}
      </div>
    </ProductShell>
  )
}
