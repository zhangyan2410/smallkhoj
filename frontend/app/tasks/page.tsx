import Link from "next/link"
import { revalidatePath } from "next/cache"
import { ArrowLeft, CheckSquare, ListChecks } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiGet, badgeClass, formatTime, statusLabel, type Member } from "@/lib/control-plane"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
const PUBLIC_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "sk_public_local"

type Channel = {
  id: string
  name: string
  type: string
}

type Task = {
  id: string
  number: number
  taskNumber?: number
  channel?: string | null
  title: string
  description?: string | null
  status: string
  creator?: string | null
  assignee?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

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
    headers: { "Content-Type": "application/json", "X-Public-Key": PUBLIC_KEY },
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
  })
  revalidatePath("/tasks")
  revalidatePath("/daemon")
}

async function updateTaskAction(formData: FormData) {
  "use server"
  const taskId = String(formData.get("taskId") || "")
  if (!taskId) return
  await writeTask(
    `/api/v1/tasks/${taskId}`,
    {
      title: String(formData.get("title") || "").trim() || undefined,
      description: String(formData.get("description") || "").trim() || undefined,
      status: formData.get("status") || undefined,
      assignee: formData.get("assignee") || null,
    },
    "PATCH"
  )
  revalidatePath("/tasks")
  revalidatePath("/daemon")
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md border px-2 text-xs ${badgeClass(status)}`}>
      {statusLabel(status)}
    </span>
  )
}

function Select({
  id,
  name,
  items,
  fallback,
  splitValue = false,
}: {
  id: string
  name: string
  items: string[]
  fallback?: string
  splitValue?: boolean
}) {
  const options = items.length > 0 ? items : fallback ? [fallback] : []
  return (
    <select
      id={id}
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

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase text-muted-foreground">
      {children}
    </label>
  )
}

export default async function TasksPage() {
  const [{ tasks }, { channels }, { members }] = await Promise.all([getTasks(), getChannels(), getMembers()])
  const agents = members.filter((member) => member.kind === "agent")
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "closed")

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
                <ListChecks className="size-6 text-primary" />
                Tasks
              </h1>
              <p className="text-sm text-muted-foreground">Create, assign, and review backend tasks from the browser.</p>
            </div>
          </div>
          <Link href="/daemon">
            <Button variant="outline" size="sm">
              Control Plane
            </Button>
          </Link>
        </div>

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

        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckSquare className="size-4" />
                Create Task
              </CardTitle>
              <CardDescription>Posts to /api/v1/tasks.</CardDescription>
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
                  <Select id="task-assignee" name="assignee" items={agents.map((agent) => agent.name)} />
                </div>
                <div>
                  <FieldLabel htmlFor="task-status">Status</FieldLabel>
                  <Select id="task-status" name="status" items={["todo", "in_progress", "in_review", "done"]} fallback="todo" />
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
              <CardTitle className="text-base">Update Task</CardTitle>
              <CardDescription>Patches title, description, status, or assignee.</CardDescription>
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
                  <Select id="update-task-status" name="status" items={["todo", "in_progress", "in_review", "done", "closed"]} fallback="in_review" />
                </div>
                <div>
                  <FieldLabel htmlFor="update-task-assignee">Assignee</FieldLabel>
                  <Select id="update-task-assignee" name="assignee" items={agents.map((agent) => agent.name)} />
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

        <div className="space-y-3">
          {tasks.map((task) => (
            <Card key={task.id}>
              <CardContent className="grid gap-3 py-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                <div className="font-mono text-xs text-muted-foreground">#{task.number}</div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{task.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {task.channel && <span>{task.channel}</span>}
                    {task.creator && <span>by @{task.creator}</span>}
                    {task.assignee && <span>assigned @{task.assignee}</span>}
                    <span>updated {formatTime(task.updatedAt || task.createdAt)}</span>
                  </div>
                  {task.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{task.description}</p>}
                </div>
                <StatusBadge status={task.status} />
              </CardContent>
            </Card>
          ))}
          {tasks.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">No tasks returned from /api/v1/tasks.</CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  )
}
