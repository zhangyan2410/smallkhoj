import Link from "next/link"
import { revalidatePath } from "next/cache"
import {
  Camera,
  CheckSquare,
  Columns3,
  Database,
  ExternalLink,
  FileText,
  Filter,
  ListChecks,
  MessageSquare,
  PanelRight,
  Plus,
  Shield,
} from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { EmptyState, StatusPill, Toolbar } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiGet, badgeClass, formatTime, statusLabel, type Member } from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "closed"]

type Channel = {
  id: string
  name: string
  type: string
}

type EvidenceEntry = {
  type: "screenshot" | "trace" | "api_proof" | "note" | "reviewer_decision" | "review_note"
  path?: string
  content?: string
  note?: string
  reviewer?: string
  decision?: string
  timestamp?: string
}

type TaskEvidence = {
  notes?: string[]
  links?: Array<{ label?: string; href?: string }>
  entries?: EvidenceEntry[]
}

type TaskSource = {
  type?: string
  messageId?: string
  messageShortId?: string
  threadId?: string
  channel?: string
}

type Task = {
  id: string
  number: number
  taskNumber?: number
  channel?: string | null
  channelId?: string | null
  messageId?: string | null
  title: string
  description?: string | null
  status: string
  creator?: string | null
  assignee?: string | null
  assigneeMember?: Member | null
  data?: {
    source?: TaskSource
    evidence?: TaskEvidence
  } | null
  createdAt?: string | null
  updatedAt?: string | null
}

type ActivityItem = {
  id: string
  agentName?: string | null
  type: string
  description: string
  timestamp?: string | null
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function getTasks() {
  return apiGet<{ tasks: Task[] }>("/api/v1/tasks", { tasks: [] })
}

async function getChannels() {
  return apiGet<{ channels: Channel[] }>("/api/v1/channels", { channels: [] })
}

async function getMembers() {
  return apiGet<{ members: Member[] }>("/api/v1/members", { members: [] })
}

async function getTaskActivity(taskId: string) {
  return apiGet<{ activity: ActivityItem[] }>(`/api/v1/activity?taskId=${encodeURIComponent(taskId)}&limit=20`, { activity: [] })
}

async function writeTask(path: string, body: Record<string, unknown>, method = "POST") {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: await serverApiHeaders(true),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`)
  }
}

async function createTaskAction(formData: FormData) {
  "use server"
  const title = String(formData.get("title") || "").trim()
  if (!title) return
  await writeTask("/api/v1/tasks", {
    title,
    description: String(formData.get("description") || "").trim() || null,
    channel: formData.get("channel") || "#all",
    assignee: formData.get("assignee") || null,
    status: formData.get("status") || "todo",
    data: {
      evidence: {
        notes: ["Created from Tasks UI."],
        links: [],
      },
    },
  })
  revalidatePath("/tasks")
  revalidatePath("/daemon")
}

async function updateTaskAction(formData: FormData) {
  "use server"
  const taskId = String(formData.get("taskId") || "")
  if (!taskId) return
  const title = String(formData.get("title") || "").trim()
  const description = String(formData.get("description") || "").trim()
  await writeTask(
    `/api/v1/tasks/${taskId}`,
    {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      status: formData.get("status") || undefined,
      assignee: formData.get("assignee") || null,
    },
    "PATCH"
  )
  revalidatePath("/tasks")
  revalidatePath("/daemon")
}

async function addEvidenceAction(formData: FormData) {
  "use server"
  const taskId = String(formData.get("taskId") || "")
  if (!taskId) return
  const entryType = String(formData.get("entryType") || "note")
  const entry: EvidenceEntry = {
    type: entryType as EvidenceEntry["type"],
    timestamp: new Date().toISOString(),
  }
  const path = String(formData.get("entryPath") || "").trim()
  const content = String(formData.get("entryContent") || "").trim()
  if (path) entry.path = path
  if (content) entry.content = content
  const existingData = JSON.parse(String(formData.get("currentData") || "{}")) as Record<string, unknown>
  const existingEvidence = (existingData.evidence ?? { notes: [], links: [], entries: [] }) as TaskEvidence
  const existingEntries = existingEvidence.entries ?? []
  const mergedData = {
    ...existingData,
    evidence: {
      ...existingEvidence,
      entries: [...existingEntries, entry],
    },
  }
  await writeTask(`/api/v1/tasks/${taskId}`, { data: mergedData }, "PATCH")
  revalidatePath("/tasks")
}

async function addReviewNoteAction(formData: FormData) {
  "use server"
  const taskId = String(formData.get("taskId") || "")
  if (!taskId) return
  const decision = String(formData.get("reviewDecision") || "").trim()
  const note = String(formData.get("reviewNote") || "").trim()
  if (!decision && !note) return
  const entry: EvidenceEntry = {
    type: decision ? "reviewer_decision" : "review_note",
    timestamp: new Date().toISOString(),
  }
  if (decision) entry.decision = decision
  if (note) entry.note = note
  const existingData = JSON.parse(String(formData.get("currentData") || "{}")) as Record<string, unknown>
  const existingEvidence = (existingData.evidence ?? { notes: [], links: [], entries: [] }) as TaskEvidence
  const existingEntries = existingEvidence.entries ?? []
  const mergedData = {
    ...existingData,
    evidence: {
      ...existingEvidence,
      entries: [...existingEntries, entry],
    },
  }
  await writeTask(`/api/v1/tasks/${taskId}`, { data: mergedData }, "PATCH")
  revalidatePath("/tasks")
}

function firstParam(value: string | string[] | undefined, fallback = "") {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}

function StatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} label={statusLabel(status)} className={badgeClass(status)} />
}

function Select({
  id,
  name,
  items,
  fallback,
  splitValue = false,
  defaultValue,
  emptyLabel = "Unassigned",
}: {
  id: string
  name: string
  items: string[]
  fallback?: string
  splitValue?: boolean
  defaultValue?: string
  emptyLabel?: string
}) {
  const options = items.length > 0 ? items : fallback ? [fallback] : []
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue ?? (splitValue ? options[0]?.split("|")[0] : fallback || options[0])}
      className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {!fallback && <option value="">{emptyLabel}</option>}
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

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">
      {children}
    </label>
  )
}

function filteredTasks(tasks: Task[], filters: { channel: string; creator: string; assignee: string; status: string }) {
  return tasks.filter((task) => {
    if (filters.channel && task.channel !== filters.channel) return false
    if (filters.creator && task.creator !== filters.creator) return false
    if (filters.assignee && task.assignee !== filters.assignee) return false
    if (filters.status && task.status !== filters.status) return false
    return true
  })
}

function taskHref(task: Task, filters: Record<string, string>) {
  const params = new URLSearchParams({ ...filters, task: task.id })
  for (const [key, value] of [...params.entries()]) {
    if (!value) params.delete(key)
  }
  return `/tasks?${params.toString()}`
}

function sourceHref(source: TaskSource) {
  if (!source.channel) return null
  const params = new URLSearchParams()
  if (source.threadId) params.set("thread", source.threadId)
  if (source.messageId) params.set("message", source.messageId)
  const query = params.toString()
  const path = `/chat/${encodeURIComponent(source.channel.replace(/^#/, ""))}`
  return query ? `${path}?${query}` : path
}

function TaskCard({ task, filters }: { task: Task; filters: Record<string, string> }) {
  const source = task.data?.source
  return (
    <Link href={taskHref(task, filters)} className="block">
      <Card size="sm" className="transition-colors hover:border-cyan-300">
        <CardContent className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-xs text-muted-foreground">
                {task.channel} #{task.number}
              </div>
              <div className="mt-1 line-clamp-2 text-sm font-medium">{task.title}</div>
            </div>
            <StatusBadge status={task.status} />
          </div>
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            {task.creator && <span>by @{task.creator}</span>}
            {task.assignee && <span>assigned @{task.assignee}</span>}
            <span>{formatTime(task.updatedAt || task.createdAt)}</span>
          </div>
          {source && (
            <div className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
              <ExternalLink className="size-3" />
              {source.channel || source.type || "source"}
              {source.messageShortId || source.messageId ? ` · ${source.messageShortId || source.messageId?.slice(0, 8)}` : ""}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
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
    case "stopped":
      return "bg-rose-500"
    default:
      return "bg-muted-foreground"
  }
}

function EvidenceIcon({ type }: { type: EvidenceEntry["type"] }) {
  switch (type) {
    case "screenshot":
      return <Camera className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    case "trace":
      return <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    case "api_proof":
      return <Database className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    case "reviewer_decision":
      return <Shield className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    case "note":
    case "review_note":
      return <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
  }
}

function entryLabel(type: EvidenceEntry["type"]) {
  switch (type) {
    case "screenshot": return "Screenshot"
    case "trace": return "Trace"
    case "api_proof": return "API/DB proof"
    case "note": return "Note"
    case "reviewer_decision": return "Review decision"
    case "review_note": return "Review note"
  }
}

function EvidenceEntryRow({ entry }: { entry: EvidenceEntry }) {
  return (
    <div className="flex items-start gap-2 rounded-md border bg-background px-2.5 py-2">
      <EvidenceIcon type={entry.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{entryLabel(entry.type)}</span>
          {entry.timestamp && (
            <span className="text-[0.65rem] text-muted-foreground">{formatTime(entry.timestamp)}</span>
          )}
        </div>
        {entry.path && (
          <div className="mt-1 truncate font-mono text-xs text-cyan-700">{entry.path}</div>
        )}
        {entry.content && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{entry.content}</p>
        )}
        {entry.decision && (
          <div className="mt-1">
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium ${
              entry.decision === "approved" || entry.decision === "pass"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : entry.decision === "rejected" || entry.decision === "fail"
                  ? "border-rose-200 bg-rose-50 text-rose-700"
                  : "border-border bg-muted text-muted-foreground"
            }`}>
              {entry.decision}
            </span>
          </div>
        )}
        {entry.note && (
          <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>
        )}
        {entry.reviewer && (
          <div className="mt-1 text-[0.65rem] text-muted-foreground">by @{entry.reviewer}</div>
        )}
      </div>
    </div>
  )
}

function TaskDetail({ task, activity = [] }: { task?: Task; activity?: ActivityItem[] }) {
  if (!task) {
    return <EmptyState title="No task selected" description="Open a task from board or list to inspect source and evidence." />
  }
  const source = task.data?.source
  const evidence = task.data?.evidence
  const entries = evidence?.entries ?? []
  const sourceLink = source ? sourceHref(source) : null
  return (
    <div className="space-y-4">
      <div>
        <div className="font-mono text-xs text-muted-foreground">
          {task.channel} #{task.number}
        </div>
        <h2 className="mt-1 text-base font-semibold">{task.title}</h2>
        {task.description && <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>}
      </div>
      <div className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Status</span>
          <StatusBadge status={task.status} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Assignee</span>
          <span>{task.assignee ? `@${task.assignee}` : "Unassigned"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Creator</span>
          <span>{task.creator ? `@${task.creator}` : "Unknown"}</span>
        </div>
      </div>
      <div className="rounded-md border bg-background p-3">
        <h3 className="text-sm font-medium">Activity</h3>
        {activity.length > 0 ? (
          <div className="mt-2 space-y-2">
            {activity.map((item) => (
              <div key={item.id} className="flex items-start gap-2 text-xs">
                <span className={`mt-0.5 size-1.5 rounded-full ${dotClass(item.type)}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">{item.type}</span>
                    {item.agentName && <span className="text-muted-foreground">@{item.agentName}</span>}
                  </div>
                  <p className="text-muted-foreground line-clamp-2">{item.description}</p>
                  <span className="text-[0.65rem] text-muted-foreground">{formatTime(item.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No activity recorded yet.</p>
        )}
      </div>
      <div className="rounded-md border bg-background p-3">
        <h3 className="text-sm font-medium">Source</h3>
        {source ? (
          <div className="mt-2 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <span className="font-medium">Type:</span> {source.type || "message"}
            </div>
            {source.messageId && (
              <div className="flex items-center gap-1">
                <span className="font-medium">Message:</span> {source.messageShortId || source.messageId.slice(0, 8)}
              </div>
            )}
            {source.threadId && (
              <div className="flex items-center gap-1">
                <span className="font-medium">Thread:</span> {source.threadId.slice(0, 8)}
              </div>
            )}
            {source.channel && sourceLink && (
              <Link
                href={sourceLink}
                className="inline-flex items-center gap-1 rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-100"
              >
                <MessageSquare className="size-3" />
                Open {source.channel}
              </Link>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No source message linked yet.</p>
        )}
      </div>
      <div className="rounded-md border bg-background p-3">
        <h3 className="text-sm font-medium">Evidence</h3>
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          {(evidence?.notes || []).map((note) => (
            <div key={note} className="rounded-md border border-dashed bg-muted/30 px-2 py-1.5">{note}</div>
          ))}
          {(evidence?.links || []).map((link) => (
            <div key={`${link.label}-${link.href}`} className="flex items-center gap-1.5 rounded-md border border-dashed bg-muted/30 px-2 py-1.5">
              <ExternalLink className="size-3" />
              {link.label || link.href || "Evidence link"}
            </div>
          ))}
          {entries.length > 0 && (
            <div className="space-y-1.5">
              {entries.map((entry, i) => (
                <EvidenceEntryRow key={`${entry.type}-${entry.timestamp}-${i}`} entry={entry} />
              ))}
            </div>
          )}
          {(evidence?.notes?.length || 0) + (evidence?.links?.length || 0) + entries.length === 0 && (
            <p className="text-muted-foreground">No evidence entries yet. Add screenshots, traces, API proofs, or notes below.</p>
          )}
        </div>
        <form action={addEvidenceAction} className="mt-3 space-y-2 border-t pt-3">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="currentData" value={JSON.stringify(task.data ?? {})} />
          <div className="flex gap-2">
            <select
              name="entryType"
              className="h-7 shrink-0 rounded-md border bg-background px-2 text-xs"
              defaultValue="note"
            >
              <option value="note">Note</option>
              <option value="screenshot">Screenshot</option>
              <option value="trace">Trace</option>
              <option value="api_proof">API/DB proof</option>
            </select>
            <Input name="entryPath" placeholder="Path or reference" className="h-7 text-xs" />
          </div>
          <Input name="entryContent" placeholder="Evidence content or description" className="h-7 text-xs" />
          <Button type="submit" size="sm" variant="outline" className="w-full text-xs">
            <Plus className="size-3" />
            Add Evidence
          </Button>
        </form>
      </div>
      <div className="rounded-md border bg-background p-3">
        <h3 className="text-sm font-medium">Review</h3>
        <form action={addReviewNoteAction} className="mt-2 space-y-2">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="currentData" value={JSON.stringify(task.data ?? {})} />
          <select
            name="reviewDecision"
            className="h-7 w-full rounded-md border bg-background px-2 text-xs"
          >
            <option value="">Select decision...</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="needs_work">Needs work</option>
            <option value="reopened">Reopened</option>
          </select>
          <Input name="reviewNote" placeholder="Review or reopen note" className="h-7 text-xs" />
          <Button type="submit" size="sm" variant="outline" className="w-full text-xs">
            Submit Review
          </Button>
        </form>
      </div>
    </div>
  )
}

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireCurrentAccount()
  const params = await searchParams
  const view = firstParam(params.view, "board") === "list" ? "list" : "board"
  const filters = {
    view,
    channel: firstParam(params.channel),
    creator: firstParam(params.creator),
    assignee: firstParam(params.assignee),
    status: firstParam(params.status),
  }
  const selectedTaskId = firstParam(params.task)
  const [{ tasks }, { channels }, { members }] = await Promise.all([getTasks(), getChannels(), getMembers()])
  const agents = members.filter((member) => member.kind === "agent")
  const visibleTasks = filteredTasks(tasks, filters)
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "closed")
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? visibleTasks[0]
  let activity: ActivityItem[] = []
  if (selectedTask?.id) {
    const result = await getTaskActivity(selectedTask.id)
    activity = result.activity
  }
  const creators = Array.from(new Set(tasks.map((task) => task.creator).filter((value): value is string => Boolean(value)))).sort()
  const assignees = Array.from(new Set(tasks.map((task) => task.assignee).filter((value): value is string => Boolean(value)))).sort()

  const filterRecord = {
    view,
    channel: filters.channel,
    creator: filters.creator,
    assignee: filters.assignee,
    status: filters.status,
  }

  return (
    <ProductShell
      active="tasks"
      title="Tasks"
      description="Create, assign, scan, and move work with visible status, source links, and review evidence."
      session={session}
      sidebarTitle="Task Detail"
      sidebarDescription="Source and evidence for the selected work item."
      sidebar={<TaskDetail task={selectedTask} activity={activity} />}
      actions={
        <Link href="/daemon">
          <Button variant="outline" size="sm">
            Control Plane
          </Button>
        </Link>
      }
    >
      <div className="space-y-5">
        <Toolbar>
          <ListChecks className="size-4 text-primary" />
          <span className="text-sm font-medium">Board/List surface</span>
          <span className="text-xs text-muted-foreground">{visibleTasks.length} visible of {tasks.length}</span>
          <div className="ml-auto flex gap-1">
            <Link href={`/tasks?${new URLSearchParams({ ...filterRecord, view: "board" }).toString()}`}>
              <Button variant={view === "board" ? "default" : "outline"} size="sm">
                <Columns3 className="size-4" />
                Board
              </Button>
            </Link>
            <Link href={`/tasks?${new URLSearchParams({ ...filterRecord, view: "list" }).toString()}`}>
              <Button variant={view === "list" ? "default" : "outline"} size="sm">
                <ListChecks className="size-4" />
                List
              </Button>
            </Link>
          </div>
        </Toolbar>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Total</CardDescription>
              <CardTitle className="text-2xl">{tasks.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Open</CardDescription>
              <CardTitle className="text-2xl">{openTasks.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Agents</CardDescription>
              <CardTitle className="text-2xl">{agents.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plus className="size-4" />
                Create Task
              </CardTitle>
              <CardDescription>Creates a backend task and emits task.created for agent pickup.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={createTaskAction} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FieldLabel htmlFor="task-title">Title</FieldLabel>
                  <Input id="task-title" name="title" required placeholder="Implement bounded worker task" />
                </div>
                <div className="sm:col-span-2">
                  <FieldLabel htmlFor="task-description">Description</FieldLabel>
                  <Input id="task-description" name="description" placeholder="Instructions and expected evidence" />
                </div>
                <div>
                  <FieldLabel htmlFor="task-channel">Channel</FieldLabel>
                  <Select id="task-channel" name="channel" items={channels.map((channel) => channel.name)} fallback="#all" />
                </div>
                <div>
                  <FieldLabel htmlFor="task-assignee">Assignee</FieldLabel>
                  <Select id="task-assignee" name="assignee" items={agents.map((agent) => agent.handle!)} />
                </div>
                <div>
                  <FieldLabel htmlFor="task-status">Status</FieldLabel>
                  <Select id="task-status" name="status" items={TASK_STATUSES} fallback="todo" />
                </div>
                <div className="flex items-end">
                  <Button type="submit" size="sm" className="w-full">
                    Create
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PanelRight className="size-4" />
                Update Task
              </CardTitle>
              <CardDescription>Move status or reassign while preserving create/update behavior.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={updateTaskAction} className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <FieldLabel htmlFor="update-task-id">Task</FieldLabel>
                  <Select
                    id="update-task-id"
                    name="taskId"
                    items={tasks.map((task) => `${task.id}|#${task.number} ${task.title}`)}
                    splitValue
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="update-task-title">Title</FieldLabel>
                  <Input id="update-task-title" name="title" placeholder="Leave blank to keep" />
                </div>
                <div>
                  <FieldLabel htmlFor="update-task-description">Description</FieldLabel>
                  <Input id="update-task-description" name="description" placeholder="Leave blank to keep" />
                </div>
                <div>
                  <FieldLabel htmlFor="update-task-status">Status</FieldLabel>
                  <Select id="update-task-status" name="status" items={TASK_STATUSES} fallback="in_review" />
                </div>
                <div>
                  <FieldLabel htmlFor="update-task-assignee">Assignee</FieldLabel>
                  <Select id="update-task-assignee" name="assignee" items={agents.map((agent) => agent.handle!)} />
                </div>
                <div className="sm:col-span-2">
                  <Button type="submit" size="sm" variant="outline" className="w-full">
                    Update
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <form action="/tasks" className="grid gap-3 rounded-md border bg-card p-3 sm:grid-cols-2 xl:grid-cols-5">
          <input type="hidden" name="view" value={view} />
          <div className="xl:col-span-5 flex items-center gap-2 text-sm font-medium">
            <Filter className="size-4 text-primary" />
            Filters
          </div>
          <div>
            <FieldLabel htmlFor="filter-channel">Channel</FieldLabel>
            <Select id="filter-channel" name="channel" items={channels.map((channel) => channel.name)} defaultValue={filters.channel} emptyLabel="Any channel" />
          </div>
          <div>
            <FieldLabel htmlFor="filter-creator">Creator</FieldLabel>
            <Select id="filter-creator" name="creator" items={creators} defaultValue={filters.creator} emptyLabel="Any creator" />
          </div>
          <div>
            <FieldLabel htmlFor="filter-assignee">Assignee</FieldLabel>
            <Select id="filter-assignee" name="assignee" items={assignees} defaultValue={filters.assignee} emptyLabel="Any assignee" />
          </div>
          <div>
            <FieldLabel htmlFor="filter-status">Status</FieldLabel>
            <Select id="filter-status" name="status" items={TASK_STATUSES} defaultValue={filters.status} emptyLabel="Any status" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" className="flex-1">
              Apply
            </Button>
            <Link href={`/tasks?view=${view}`}>
              <Button type="button" size="sm" variant="outline">
                Clear
              </Button>
            </Link>
          </div>
        </form>

        {view === "board" ? (
          <div className="grid gap-3 xl:grid-cols-5">
            {TASK_STATUSES.map((status) => {
              const columnTasks = visibleTasks.filter((task) => task.status === status)
              return (
                <section key={status} className="min-w-0 rounded-md border bg-muted/20 p-2">
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <span className="text-sm font-medium">{statusLabel(status)}</span>
                    <span className="text-xs text-muted-foreground">{columnTasks.length}</span>
                  </div>
                  <div className="space-y-2">
                    {columnTasks.map((task) => <TaskCard key={task.id} task={task} filters={filterRecord} />)}
                    {columnTasks.length === 0 && <div className="rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">Empty</div>}
                  </div>
                </section>
              )
            })}
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border bg-card">
            {visibleTasks.map((task) => (
              <Link
                key={task.id}
                href={taskHref(task, filterRecord)}
                className="grid gap-2 border-b px-3 py-3 text-sm last:border-b-0 hover:bg-muted/40 md:grid-cols-[auto_1fr_auto_auto] md:items-center"
              >
                <div className="font-mono text-xs text-muted-foreground">{task.channel} #{task.number}</div>
                <div className="min-w-0">
                  <div className="truncate font-medium">{task.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {task.creator && <span>by @{task.creator}</span>}
                    {task.assignee && <span>assigned @{task.assignee}</span>}
                    {task.data?.source && <span>source message</span>}
                    <span>updated {formatTime(task.updatedAt || task.createdAt)}</span>
                  </div>
                </div>
                <StatusBadge status={task.status} />
                <CheckSquare className="size-4 text-muted-foreground" />
              </Link>
            ))}
            {visibleTasks.length === 0 && <EmptyState title="No tasks match filters" description="Clear filters or create a new task." />}
          </div>
        )}
      </div>
    </ProductShell>
  )
}
