import Link from "next/link"
import { revalidatePath } from "next/cache"
import {
  CheckSquare,
  Columns3,
  ExternalLink,
  Filter,
  ListChecks,
  PanelRight,
  Plus,
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

type TaskEvidence = {
  notes?: string[]
  links?: Array<{ label?: string; href?: string }>
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
              {source.type || "source"} {source.messageShortId || source.messageId?.slice(0, 8)}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}

function TaskDetail({ task }: { task?: Task }) {
  if (!task) {
    return <EmptyState title="No task selected" description="Open a task from board or list to inspect source and evidence." />
  }
  const source = task.data?.source
  const evidence = task.data?.evidence
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
        <h3 className="text-sm font-medium">Source</h3>
        {source ? (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <div>Type: {source.type || "message"}</div>
            <div>Message: {source.messageShortId || source.messageId}</div>
            <div>Thread: {source.threadId?.slice(0, 8) || "none"}</div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">No source message linked yet.</p>
        )}
      </div>
      <div className="rounded-md border bg-background p-3">
        <h3 className="text-sm font-medium">Evidence</h3>
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          {(evidence?.notes || []).map((note) => <div key={note}>{note}</div>)}
          {(evidence?.links || []).map((link) => (
            <div key={`${link.label}-${link.href}`}>{link.label || link.href || "Evidence link"}</div>
          ))}
          {(!evidence?.notes?.length && !evidence?.links?.length) && (
            <div>Evidence starts as task data notes/links; file-backed evidence belongs in the upcoming Files surface.</div>
          )}
        </div>
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
      sidebar={<TaskDetail task={selectedTask} />}
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
                  <Select id="task-assignee" name="assignee" items={agents.map((agent) => agent.handle ?? `@${agent.name}`)} />
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
                  <Select id="update-task-assignee" name="assignee" items={agents.map((agent) => agent.handle ?? `@${agent.name}`)} />
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
