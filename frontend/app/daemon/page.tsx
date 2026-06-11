import Link from "next/link"
import type { ComponentType, ReactNode } from "react"
import { revalidatePath } from "next/cache"
import {
  Activity,
  AlarmClock,
  ArrowLeft,
  Bot,
  CheckSquare,
  Clock,
  Database,
  FileText,
  HardDrive,
  MessageSquare,
  Radio,
  Server,
  Send,
  Shield,
  Users,
  Wifi,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

type Channel = {
  id: string
  name: string
  type: string
  description?: string
}

type Message = {
  id: string
  seq?: number
  shortId?: string
  sender: string
  senderType: string
  content: string
  time: string
  channelName?: string
}

type Task = {
  id?: string
  number: number
  title: string
  status: string
  creator?: string
  assignee?: string | null
}

type AgentWorkspace = {
  id: string
  agentId: string
  agentName?: string | null
  runtime?: string | null
  runtimeModel?: string | null
  runtimeProvider?: string | null
  status: string
  cwd?: string | null
  pid?: number | null
  startedAt?: string | null
  stoppedAt?: string | null
}

type Computer = {
  id: string
  name: string
  os?: string | null
  daemonVersion?: string | null
  status: string
  detectedRuntimes: Array<string | { type?: string; status?: string; command?: string; provider?: string; runtimeProvider?: string; model?: string }>
  agentWorkspaces: AgentWorkspace[]
  lastHeartbeatAt?: string | null
}

type ActivityItem = {
  id: string
  agentName?: string | null
  type: string
  description: string
  timestamp?: string | null
}

type FileItem = {
  id: string
  fileName: string
  originalName?: string | null
  mimeType: string
  size: number
  createdAt?: string | null
}

type Reminder = {
  id: string
  agentName?: string | null
  title: string
  fireAt?: string | null
  status: string
  repeat?: Record<string, unknown> | null
}

type Member = {
  id: string
  displayName: string
  handle?: string
  kind: string
  status: string
  config?: {
    permissions?: Record<string, boolean>
    actions?: Record<string, boolean>
    backend?: string
  }
}

type DashboardData = {
  channels: Channel[]
  members: Member[]
  computers: Computer[]
  tasks: Task[]
  activity: ActivityItem[]
  files: FileItem[]
  reminders: Reminder[]
  messages: Message[]
  backendOnline: boolean
}

type DebugSearchResult = {
  id: string
  type: string
  title: string
  excerpt?: string
  href?: string
  metadata?: Record<string, unknown>
}

type DebugSearchData = {
  q: string
  count: number
  results: DebugSearchResult[]
}

async function apiGet<T>(path: string, fallback: T): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, { cache: "no-store", headers: await serverApiHeaders() })
    if (!response.ok) return fallback
    return response.json()
  } catch {
    return fallback
  }
}

function searchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

async function apiWrite(path: string, body: Record<string, unknown>, method = "POST") {
  "use server"
  await fetch(`${API_BASE}${path}`, {
    method,
    headers: await serverApiHeaders(true),
    body: JSON.stringify(body),
  })
  revalidatePath("/daemon")
}

async function createTaskAction(formData: FormData) {
  "use server"
  await apiWrite("/api/v1/tasks", {
    channel: formData.get("channel"),
    title: formData.get("title"),
    description: formData.get("description"),
    assignee: formData.get("assignee"),
    status: formData.get("status") || "todo",
  })
}

async function createChannelAction(formData: FormData) {
  "use server"
  const name = formData.get("channelName") as string
  if (!name) return
  await apiWrite("/api/v1/channels", {
    name,
    description: formData.get("channelDescription") || "",
    type: formData.get("channelType") || "public",
  })
}

async function updateTaskAction(formData: FormData) {
  "use server"
  await apiWrite(`/api/v1/tasks/${formData.get("taskId")}`, {
    status: formData.get("status"),
    assignee: formData.get("assignee"),
  }, "PATCH")
}

async function sendMessageAction(formData: FormData) {
  "use server"
  const channel = String(formData.get("channel") || "#all").replace(/^#/, "")
  await apiWrite(`/api/v1/channels/${encodeURIComponent(channel)}/messages`, {
    content: formData.get("content"),
  })
}

async function createReminderAction(formData: FormData) {
  "use server"
  await apiWrite("/api/v1/reminders", {
    title: formData.get("title"),
    agent: formData.get("agent"),
    channel: formData.get("channel"),
    delaySeconds: Number(formData.get("delaySeconds") || 300),
  })
}

async function cancelReminderAction(formData: FormData) {
  "use server"
  const reminderId = String(formData.get("reminderId") || "")
  if (!reminderId) return
  await apiWrite(`/api/v1/reminders/${reminderId}`, { cancel: true }, "PATCH")
}

async function updateMemberAction(formData: FormData) {
  "use server"
  const paused = formData.get("paused") === "on"
  await apiWrite(`/api/v1/members/${formData.get("memberId")}`, {
    status: formData.get("status"),
    actions: { paused, autoRestart: formData.get("autoRestart") === "on" },
    permissions: {
      sendMessage: formData.get("sendMessage") === "on",
      createTask: formData.get("createTask") === "on",
      updateTask: formData.get("updateTask") === "on",
      fileWrite: formData.get("fileWrite") === "on",
    },
  }, "PATCH")
}

async function getDashboardData(): Promise<DashboardData> {
  const [channelsData, membersData, computersData, tasksData, activityData, filesData, remindersData] =
    await Promise.all([
      apiGet<{ channels: Channel[] }>("/api/v1/channels", { channels: [] }),
      apiGet<{ members: Member[] }>("/api/v1/members", { members: [] }),
      apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] }),
      apiGet<{ tasks: Task[] }>("/api/v1/tasks", { tasks: [] }),
      apiGet<{ activity: ActivityItem[] }>("/api/v1/activity?limit=25&compact=true", { activity: [] }),
      apiGet<{ files: FileItem[] }>("/api/v1/files?limit=12", { files: [] }),
      apiGet<{ reminders: Reminder[] }>("/api/v1/reminders?limit=12", { reminders: [] }),
    ])

  const channelMessages = await Promise.all(
    channelsData.channels.slice(0, 4).map(async (channel) => {
      const channelKey = channel.name.replace(/^#/, "")
      const data = await apiGet<{ messages: Message[] }>(
        `/api/v1/channels/${encodeURIComponent(channelKey)}/messages?limit=8`,
        { messages: [] }
      )
      return data.messages.map((message) => ({ ...message, channelName: channel.name }))
    })
  )

  const messages = channelMessages
    .flat()
    .sort((a, b) => {
      if (a.seq !== undefined && b.seq !== undefined) return b.seq - a.seq
      return new Date(b.time).getTime() - new Date(a.time).getTime()
    })
    .slice(0, 12)

  return {
    channels: channelsData.channels,
    members: membersData.members,
    computers: computersData.computers,
    tasks: tasksData.tasks,
    activity: activityData.activity,
    files: filesData.files,
    reminders: remindersData.reminders,
    messages,
    backendOnline:
      channelsData.channels.length > 0 ||
      computersData.computers.length > 0 ||
      tasksData.tasks.length > 0 ||
      activityData.activity.length > 0,
  }
}

function dotClass(status: string) {
  switch (status) {
    case "online":
    case "active":
    case "running":
    case "done":
    case "fired":
      return "bg-emerald-500"
    case "idle":
    case "pending":
    case "in_review":
      return "bg-amber-500"
    case "in_progress":
      return "bg-sky-500"
    case "failed":
    case "cancelled":
    case "offline":
      return "bg-rose-500"
    default:
      return "bg-muted-foreground"
  }
}

function badgeClass(status: string) {
  switch (status) {
    case "online":
    case "active":
    case "running":
    case "done":
    case "fired":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "idle":
    case "pending":
    case "in_review":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "in_progress":
      return "border-sky-200 bg-sky-50 text-sky-700"
    case "failed":
    case "cancelled":
    case "offline":
      return "border-rose-200 bg-rose-50 text-rose-700"
    default:
      return "border-border bg-muted text-muted-foreground"
  }
}

function formatTime(value?: string | null) {
  if (!value) return "never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatBytes(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB"]
  let value = size
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    todo: "待办",
    in_progress: "进行中",
    in_review: "审核中",
    done: "完成",
    pending: "待触发",
    fired: "已触发",
    cancelled: "已取消",
    online: "在线",
    offline: "离线",
    active: "活跃",
    running: "运行中",
    idle: "空闲",
  }
  return labels[status] ?? status
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md border px-2 text-xs ${badgeClass(status)}`}>
      {statusLabel(status)}
    </span>
  )
}

function EmptyState({ label }: { label: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{label}</div>
}

function runtimeLabel(runtime: string | { type?: string; status?: string; command?: string; provider?: string; runtimeProvider?: string; model?: string }) {
  if (typeof runtime === "string") return runtime
  return [runtime.runtimeProvider ?? runtime.provider ?? runtime.type ?? "runtime", runtime.status, runtime.model].filter(Boolean).join(" / ")
}

export default async function DaemonPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireCurrentAccount()
  const resolvedSearchParams = searchParams ? await searchParams : {}
  const marker = (searchParamValue(resolvedSearchParams.marker) || "").trim()
  const data = await getDashboardData()
  const markerResults = marker
    ? await apiGet<DebugSearchData>(`/api/v1/search?q=${encodeURIComponent(marker)}&limit=12`, {
        q: marker,
        count: 0,
        results: [],
      })
    : null
  const workspaces = data.computers.flatMap((computer) => computer.agentWorkspaces)
  const runningWorkspaces = workspaces.filter((workspace) => workspace.status === "running").length
  const pendingReminders = data.reminders.filter((reminder) => reminder.status === "pending").length
  const openTasks = data.tasks.filter((task) => task.status !== "done" && task.status !== "closed").length

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link href="/">
              <Button variant="outline" size="icon-sm" aria-label="返回首页">
                <ArrowLeft />
              </Button>
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <Radio className="size-6 text-primary" />
                Slock Control Plane
              </h1>
              <p className="text-sm text-muted-foreground">
                本地后端聚合视图：agents、computers、tasks、files、reminders、activity
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/members">
              <Button variant="outline" size="sm">
                <Users className="size-4" />
                Members
              </Button>
            </Link>
            <Link href="/computers">
              <Button variant="outline" size="sm">
                <HardDrive className="size-4" />
                Computers
              </Button>
            </Link>
            <span className={`size-2 rounded-full ${data.backendOnline ? "bg-emerald-500" : "bg-amber-500"}`} />
            <span>{data.backendOnline ? "Backend connected" : "Waiting for backend"}</span>
            <Wifi className="size-4" />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard icon={HardDrive} label="Computers" value={data.computers.length} />
          <MetricCard icon={Bot} label="Workspaces" value={workspaces.length} detail={`${runningWorkspaces} running`} />
          <MetricCard icon={CheckSquare} label="Open Tasks" value={openTasks} detail={`${data.tasks.length} total`} />
          <MetricCard icon={AlarmClock} label="Reminders" value={pendingReminders} detail="pending" />
          <MetricCard icon={FileText} label="Files" value={data.files.length} detail="recent" />
          <MetricCard icon={MessageSquare} label="Channels" value={data.channels.length} />
        </div>

        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Database className="size-5" />
              Marker Debug Workbench
            </CardTitle>
            <CardDescription>Search one marker, then follow browser, API, DB, trace, and task evidence links.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 pt-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              <form method="get" action="/daemon" className="flex gap-2">
                <Input name="marker" defaultValue={marker} placeholder="REAL_debug_workbench_..." />
                <Button type="submit" variant="outline">
                  Search
                </Button>
              </form>
              <div className="rounded-md border bg-muted/35 p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground">Next checks</div>
                <div className="mt-2 grid gap-1">
                  <span>1. Open the source message/task/file from results.</span>
                  <span>2. Run trace summary for the same marker.</span>
                  <span>3. Save concise notes under the task evidence directory.</span>
                </div>
              </div>
              <code className="block whitespace-pre-wrap break-all rounded-md border bg-background p-3 text-xs">
                {marker ? `./smallkhoj-trace summary --json | rg '${marker}'` : "./smallkhoj-trace summary --json"}
              </code>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">Linked Evidence</div>
                <div className="text-xs text-muted-foreground">{markerResults ? `${markerResults.count} matches` : "enter marker"}</div>
              </div>
              <div className="overflow-hidden rounded-md border">
                {markerResults?.results.map((result) => (
                  <Link
                    key={`${result.type}-${result.id}`}
                    href={result.href || "/daemon"}
                    className="block border-b px-3 py-2 last:border-b-0 hover:bg-accent"
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-md border px-1.5 py-0.5 text-[11px] uppercase text-muted-foreground">{result.type}</span>
                      <span className="min-w-0 truncate text-sm font-medium">{result.title}</span>
                    </div>
                    {result.excerpt && <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.excerpt}</div>}
                  </Link>
                ))}
                {marker && markerResults?.results.length === 0 && <EmptyState label="No marker evidence found in API search." />}
                {!marker && <EmptyState label="Enter a unique REAL_* marker to start." />}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <CheckSquare className="size-5" />
                Dispatch
              </CardTitle>
              <CardDescription>创建任务、调整任务状态、向频道发送 supervisor 消息</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4 lg:grid-cols-4">
              <form action={createTaskAction} className="space-y-2">
                <ControlLabel text="Task" />
                <Input name="title" placeholder="Title" required />
                <Input name="description" placeholder="Description" />
                <ControlSelect name="channel" items={data.channels.map((item) => item.name)} fallback="#all" />
                <ControlSelect name="assignee" items={data.members.filter((item) => item.kind === "agent").map((item) => item.displayName)} fallback="" />
                <ControlSelect name="status" items={["todo", "in_progress", "in_review", "done"]} fallback="todo" />
                <Button size="sm" className="w-full" type="submit">
                  <CheckSquare className="size-4" />
                  Create
                </Button>
              </form>

              <form action={updateTaskAction} className="space-y-2">
                <ControlLabel text="Review" />
                <ControlSelect
                  name="taskId"
                  items={data.tasks.map((task) => `${task.id ?? task.number}|#${task.number} ${task.title}`)}
                  fallback=""
                  splitValue
                />
                <ControlSelect name="status" items={["todo", "in_progress", "in_review", "done", "closed"]} fallback="in_review" />
                <ControlSelect name="assignee" items={data.members.filter((item) => item.kind === "agent").map((item) => item.displayName)} fallback="" />
                <Button size="sm" variant="outline" className="w-full" type="submit">
                  Update
                </Button>
              </form>

              <form action={sendMessageAction} className="space-y-2">
                <ControlLabel text="Message" />
                <ControlSelect name="channel" items={data.channels.map((item) => item.name)} fallback="#all" />
                <Input name="content" placeholder="Content" required />
                <Button size="sm" variant="secondary" className="w-full" type="submit">
                  <Send className="size-4" />
                  Send
                </Button>
              </form>

              <form action={createChannelAction} className="space-y-2">
                <ControlLabel text="Channel" />
                <Input name="channelName" placeholder="Channel name" required />
                <Input name="channelDescription" placeholder="Description" />
                <ControlSelect name="channelType" items={["public", "private"]} fallback="public" />
                <Button size="sm" variant="outline" className="w-full" type="submit">
                  <MessageSquare className="size-4" />
                  Create
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Shield className="size-5" />
                Agent Control
              </CardTitle>
              <CardDescription>暂停 agent、调整写权限、安排提醒</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4 lg:grid-cols-2">
              <form action={updateMemberAction} className="space-y-2">
                <ControlLabel text="Permissions" />
                <ControlSelect name="memberId" items={data.members.filter((item) => item.kind === "agent").map((item) => `${item.id}|${item.handle}`)} fallback="" splitValue />
                <ControlSelect name="status" items={["active", "idle", "offline"]} fallback="active" />
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  {[
                    ["paused", "Paused"],
                    ["autoRestart", "Restart"],
                    ["sendMessage", "Send"],
                    ["createTask", "Create"],
                    ["updateTask", "Update"],
                    ["fileWrite", "Files"],
                  ].map(([name, label]) => (
                    <label key={name} className="flex items-center gap-2 rounded-md border px-2 py-1">
                      <input name={name} type="checkbox" defaultChecked={name !== "paused"} />
                      {label}
                    </label>
                  ))}
                </div>
                <Button size="sm" variant="outline" className="w-full" type="submit">
                  Save
                </Button>
              </form>

              <form action={createReminderAction} className="space-y-2">
                <ControlLabel text="Reminder" />
                <Input name="title" placeholder="Title" required />
                <ControlSelect name="agent" items={data.members.filter((item) => item.kind === "agent").map((item) => item.displayName)} fallback="aaa" />
                <ControlSelect name="channel" items={data.channels.map((item) => item.name)} fallback="#all" />
                <Input name="delaySeconds" type="number" min="1" defaultValue="300" />
                <Button size="sm" variant="secondary" className="w-full" type="submit">
                  <AlarmClock className="size-4" />
                  Schedule
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Server className="size-5" />
                Computers & Agent Workspaces
              </CardTitle>
              <CardDescription>daemon 所在机器、运行时探测和绑定的 agent 会话</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <ScrollArea className="h-[382px]">
                <div className="space-y-3 pr-3">
                  {data.computers.map((computer) => (
                    <div key={computer.id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`size-2 rounded-full ${dotClass(computer.status)}`} />
                            <h2 className="truncate text-sm font-medium">{computer.name}</h2>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {computer.os ?? "unknown os"} · daemon {computer.daemonVersion ?? "unknown"} · heartbeat{" "}
                            {formatTime(computer.lastHeartbeatAt)}
                          </p>
                        </div>
                        <StatusBadge status={computer.status} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(computer.detectedRuntimes.length ? computer.detectedRuntimes : ["no runtime detected"]).map(
                          (runtime) => (
                            <span key={runtimeLabel(runtime)} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                              {runtimeLabel(runtime)}
                            </span>
                          )
                        )}
                      </div>
                      <div className="mt-3 space-y-2">
                        {computer.agentWorkspaces.map((workspace) => (
                          <div key={workspace.id} className="grid gap-2 rounded-md bg-muted/45 p-2 sm:grid-cols-[1fr_auto]">
                            <div className="min-w-0">
                              <div className="truncate text-sm">
                                @{workspace.agentName ?? workspace.agentId} · {workspace.runtime ?? "runtime"}
                                {workspace.runtimeProvider ? `/${workspace.runtimeProvider}` : workspace.runtimeModel ? `/${workspace.runtimeModel}` : ""}
                              </div>
                              <div className="truncate text-xs text-muted-foreground">
                                {workspace.cwd ?? "no cwd"} {workspace.pid ? `· pid ${workspace.pid}` : ""}
                              </div>
                            </div>
                            <StatusBadge status={workspace.status} />
                          </div>
                        ))}
                        {computer.agentWorkspaces.length === 0 && (
                          <p className="text-xs text-muted-foreground">No workspaces registered on this computer.</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {data.computers.length === 0 && <EmptyState label="暂无 computer 数据；确认 backend 已启动并完成数据库迁移。" />}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-5" />
                Activity Feed
              </CardTitle>
              <CardDescription>agent、任务、提醒和文件相关事件</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <ScrollArea className="h-[382px]">
                <div className="space-y-3 pr-3">
                  {data.activity.map((item) => (
                    <div key={item.id} className="grid grid-cols-[auto_1fr] gap-3">
                      <span className={`mt-1 size-2 rounded-full ${dotClass(item.type)}`} />
                      <div className="min-w-0 border-b pb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{item.type}</span>
                          {item.agentName && <span className="text-xs text-muted-foreground">@{item.agentName}</span>}
                          <span className="ml-auto text-xs text-muted-foreground">{formatTime(item.timestamp)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                  ))}
                  {data.activity.length === 0 && <EmptyState label="暂无活动记录。" />}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-5 lg:grid-cols-3">
          <ListPanel
            icon={CheckSquare}
            title="Tasks"
            description="当前任务队列"
            empty="暂无任务。"
            items={data.tasks.slice(0, 12).map((task) => (
              <div key={task.id ?? task.number} className="flex min-w-0 items-center gap-2 rounded-md border p-2">
                <span className="font-mono text-xs text-muted-foreground">#{task.number}</span>
                <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                <StatusBadge status={task.status} />
              </div>
            ))}
          />

          <ListPanel
            icon={AlarmClock}
            title="Reminders"
            description="提醒调度状态"
            empty="暂无提醒。"
            items={data.reminders.map((reminder) => (
              <div key={reminder.id} className="rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{reminder.title}</span>
                  <StatusBadge status={reminder.status} />
                </div>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <Clock className="size-3 shrink-0" />
                    <span>{formatTime(reminder.fireAt)}</span>
                    {reminder.agentName && <span>@{reminder.agentName}</span>}
                  </div>
                  {reminder.status !== "cancelled" && reminder.status !== "fired" && (
                    <form action={cancelReminderAction}>
                      <input type="hidden" name="reminderId" value={reminder.id} />
                      <Button type="submit" size="xs" variant="outline">
                        Cancel
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          />

          <ListPanel
            icon={FileText}
            title="Files"
            description="最近上传附件"
            empty="暂无文件。"
            items={data.files.map((file) => (
              <div key={file.id} className="rounded-md border p-2">
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">{file.originalName || file.fileName}</span>
                  <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">
                  {file.mimeType} · {formatTime(file.createdAt)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Public API exposes list metadata only.</div>
              </div>
            ))}
          />
        </div>

        <div className="grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Database className="size-5" />
                API Surface
              </CardTitle>
              <CardDescription>本页已接入的公开控制台数据源</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 pt-4 text-sm sm:grid-cols-2">
              {[
                ["GET /api/v1/channels", "Home, chat sidebar, dispatch forms"],
                ["POST /api/v1/channels", "Home and Dispatch channel form"],
                ["GET/POST /api/v1/channels/:name/messages", "Chat page and Dispatch message form"],
                ["GET/POST/PATCH /api/v1/tasks", "Tasks page and Dispatch review form"],
                ["GET /api/v1/computers", "Computers page and Control Plane"],
                ["POST /api/v1/computers/connect-command", "Computers connect form"],
                ["POST /internal/agent-api/daemon/connect", "daemon one-time connect; creates/reuses computer"],
                ["GET/PATCH /api/v1/members", "Members page and Agent Control permissions"],
                ["POST /api/v1/members/agents", "Members create-agent form"],
                ["GET/POST/PATCH /api/v1/reminders", "Control Plane schedule/cancel forms"],
                ["GET /api/v1/files", "Control Plane metadata list"],
                ["GET /api/v1/activity", "Control Plane activity feed"],
                ["POST /api/v1/dm", "Home DM form"],
                ["GET/POST/DELETE /api/v1/channels/:id/members", "Chat member panel"],
              ].map(([endpoint, surface]) => (
                <div key={endpoint} className="flex min-w-0 flex-col gap-1 rounded-md border p-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2 rounded-full bg-emerald-500" />
                    <span className="truncate font-mono text-xs">{endpoint}</span>
                  </div>
                  <span className="truncate text-xs text-muted-foreground">{surface}</span>
                </div>
              ))}
              {[
                ["GET /internal/agent-api/events", "agent runtime polling; visible through daemon logs/trace"],
                ["POST /internal/agent-api/daemon/register", "legacy daemon lifecycle; visible on Computers"],
                ["POST /internal/agent-api/upload", "agent attachment upload; public UI lists resulting files"],
              ].map(([endpoint, surface]) => (
                <div key={endpoint} className="flex min-w-0 flex-col gap-1 rounded-md border p-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="size-2 rounded-full bg-amber-500" />
                    <span className="truncate font-mono text-xs">{endpoint}</span>
                  </div>
                  <span className="truncate text-xs text-muted-foreground">{surface}</span>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-5" />
                Recent Messages
              </CardTitle>
              <CardDescription>跨频道最近消息，用于观察 worker 和控制平面的互动</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <ScrollArea className="h-[238px]">
                <div className="space-y-3 pr-3">
                  {data.messages.map((message) => (
                    <div key={`${message.channelName}-${message.id}`} className="grid grid-cols-[auto_1fr] gap-3">
                      <span className={`mt-2 size-2 rounded-full ${message.senderType === "agent" ? "bg-sky-500" : "bg-muted-foreground"}`} />
                      <div className="min-w-0 border-b pb-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{message.sender}</span>
                          <span className="text-xs text-muted-foreground">{message.channelName}</span>
                          <span className="ml-auto text-xs text-muted-foreground">{message.time}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{message.content}</p>
                      </div>
                    </div>
                  ))}
                  {data.messages.length === 0 && <EmptyState label="暂无消息。" />}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  value: number
  detail?: string
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" />
          {label}
        </CardDescription>
        <CardTitle className="flex items-baseline gap-2 text-2xl">
          {value}
          {detail && <span className="text-xs font-normal text-muted-foreground">{detail}</span>}
        </CardTitle>
      </CardHeader>
    </Card>
  )
}

function ListPanel({
  icon: Icon,
  title,
  description,
  empty,
  items,
}: {
  icon: ComponentType<{ className?: string }>
  title: string
  description: string
  empty: string
  items: ReactNode[]
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <Icon className="size-5" />
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <ScrollArea className="h-[280px]">
          <div className="space-y-2 pr-3">{items.length > 0 ? items : <EmptyState label={empty} />}</div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

function ControlLabel({ text }: { text: string }) {
  return <div className="text-xs font-medium uppercase text-muted-foreground">{text}</div>
}

function ControlSelect({
  name,
  items,
  fallback,
  splitValue = false,
}: {
  name: string
  items: string[]
  fallback: string
  splitValue?: boolean
}) {
  const options = items.length > 0 ? items : fallback ? [fallback] : []
  return (
    <select
      name={name}
      defaultValue={splitValue ? options[0]?.split("|")[0] : fallback || options[0]}
      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {!fallback && <option value="">Unassigned</option>}
      {options.map((item) => {
        const [value, label] = splitValue ? item.split("|", 2) : [item, item]
        return (
          <option key={item} value={value}>
            {label}
          </option>
        )
      })}
    </select>
  )
}
