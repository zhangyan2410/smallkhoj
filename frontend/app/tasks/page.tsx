import Link from "next/link"
import { revalidatePath } from "next/cache"
import { getTranslations } from "next-intl/server"

import { ProductShell } from "@/components/product-shell"
import { TaskDetailDialog } from "@/components/task-detail-dialog"
import { TaskMaterialStateProvider } from "@/components/task-material-state"
import { TaskProjectionProvider } from "@/components/task-projection-provider"
import {
  TaskRouteDetail,
  TaskRouteFormDialogs,
  TaskRouteList,
  TaskRouteWorkspace,
  type TaskActivityItem,
  type TaskDetailActions,
  type TaskRouteFilters,
} from "@/components/task-route-projection"
import { Button } from "@/components/ui/button"
import {
  API_BASE,
  apiGet,
  apiGetCritical,
  type Channel,
  type Member,
  type MemoryEntry,
  type TaskRunTemplate,
} from "@/lib/control-plane"
import { fetchAllTaskPages, type TaskCursorPage } from "@/lib/cursor-pagination"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"
import { canManageActiveServer } from "@/lib/server-permissions"
import {
  selectTaskProjection,
  type TaskEvidence,
  type TaskEvidenceEntry,
  type TaskProjectionTask,
} from "@/lib/task-projection"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

async function getTasks(sessionToken?: string | null, activeServerId?: string | null) {
  const tasks = await fetchAllTaskPages<TaskProjectionTask>((path) => (
    apiGetCritical<TaskCursorPage<TaskProjectionTask>>(path, sessionToken, activeServerId)
  ))
  return { tasks }
}

async function getChannels(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGetCritical<{ channels: Channel[] }>("/api/v1/channels", sessionToken, activeServerId)
}

async function getMembers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGetCritical<{ members: Member[] }>("/api/v1/members", sessionToken, activeServerId)
}

async function getTaskRunTemplates(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGetCritical<{ templates: TaskRunTemplate[] }>("/api/v1/task-run-templates", sessionToken, activeServerId)
}

async function getTaskActivity(taskId: string, sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ activity: TaskActivityItem[] }>(
    `/api/v1/activity?taskId=${encodeURIComponent(taskId)}&limit=20`,
    { activity: [] },
    sessionToken,
    activeServerId,
  )
}

async function getTaskMemory(taskId: string, sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ entries: MemoryEntry[] }>(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/memory`,
    { entries: [] },
    sessionToken,
    activeServerId,
  )
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
    template: formData.get("template") || null,
    status: formData.get("status") || "todo",
    data: { evidence: { notes: ["Created from Tasks UI."], links: [] } },
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
  await writeTask(`/api/v1/tasks/${taskId}`, {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    status: formData.get("status") || undefined,
    assignee: formData.get("assignee") || null,
  }, "PATCH")
  revalidatePath("/tasks")
  revalidatePath("/daemon")
}

function currentTaskData(formData: FormData) {
  return JSON.parse(String(formData.get("currentData") || "{}")) as Record<string, unknown>
}

function appendEvidence(data: Record<string, unknown>, entry: TaskEvidenceEntry) {
  const evidence = (data.evidence ?? { notes: [], links: [], entries: [] }) as TaskEvidence
  return {
    ...data,
    evidence: { ...evidence, entries: [...(evidence.entries ?? []), entry] },
  }
}

async function addEvidenceAction(formData: FormData) {
  "use server"
  const taskId = String(formData.get("taskId") || "")
  if (!taskId) return
  const entry: TaskEvidenceEntry = {
    type: String(formData.get("entryType") || "note") as TaskEvidenceEntry["type"],
    timestamp: new Date().toISOString(),
  }
  const path = String(formData.get("entryPath") || "").trim()
  const content = String(formData.get("entryContent") || "").trim()
  if (path) entry.path = path
  if (content) entry.content = content
  await writeTask(`/api/v1/tasks/${taskId}`, {
    data: appendEvidence(currentTaskData(formData), entry),
  }, "PATCH")
  revalidatePath("/tasks")
}

async function addReviewNoteAction(formData: FormData) {
  "use server"
  const taskId = String(formData.get("taskId") || "")
  if (!taskId) return
  const decision = String(formData.get("reviewDecision") || "").trim()
  const note = String(formData.get("reviewNote") || "").trim()
  if (!decision && !note) return
  const entry: TaskEvidenceEntry = {
    type: decision ? "reviewer_decision" : "review_note",
    timestamp: new Date().toISOString(),
  }
  if (decision) entry.decision = decision
  if (note) entry.note = note
  await writeTask(`/api/v1/tasks/${taskId}`, {
    data: appendEvidence(currentTaskData(formData), entry),
  }, "PATCH")
  revalidatePath("/tasks")
}

async function requestTaskMemoryAction(formData: FormData) {
  "use server"
  const taskId = String(formData.get("taskId") || "")
  if (!taskId) return
  await writeTask(`/api/v1/tasks/${taskId}/memory/request`, {
    instruction: String(formData.get("memoryInstruction") || "").trim() || null,
    outputDirections: formData.getAll("outputDirection").map((item) => String(item)),
  })
  revalidatePath("/tasks")
}

function firstParam(value: string | string[] | undefined, fallback = "") {
  return Array.isArray(value) ? value[0] ?? fallback : value ?? fallback
}

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireCurrentAccount()
  const t = await getTranslations("tasks")
  const sessionToken = await getSessionToken()
  const activeServerId = session.server.id
  const canManageServer = canManageActiveServer(session)
  const params = await searchParams
  const view = firstParam(params.view, "board") === "list" ? "list" : "board"
  const filters: TaskRouteFilters = {
    view,
    channel: firstParam(params.channel),
    creator: firstParam(params.creator),
    assignee: firstParam(params.assignee),
    status: firstParam(params.status),
  }
  const selectedTaskId = firstParam(params.task)
  const [{ tasks }, { channels }, { members }, { templates }] = await Promise.all([
    getTasks(sessionToken, activeServerId),
    getChannels(sessionToken, activeServerId),
    getMembers(sessionToken, activeServerId),
    getTaskRunTemplates(sessionToken, activeServerId),
  ])
  const agents = members.filter((member) => member.kind === "agent")
  const activeTemplates = templates.filter((template) => template.status === "active")
  const selectedTask = selectTaskProjection(tasks, filters, selectedTaskId)
  const [{ activity }, { entries: memoryEntries }] = selectedTask
    ? await Promise.all([
      getTaskActivity(selectedTask.id, sessionToken, activeServerId),
      getTaskMemory(selectedTask.id, sessionToken, activeServerId),
    ])
    : [{ activity: [] }, { entries: [] }]
  const tasksBaseHref = `/tasks?${new URLSearchParams(filters).toString()}`
  const detailActions: TaskDetailActions = {
    addEvidence: addEvidenceAction,
    addReviewNote: addReviewNoteAction,
    requestMemory: requestTaskMemoryAction,
  }

  return (
    <TaskProjectionProvider
      scopeKey={`${session.account.id}:${activeServerId}`}
      initialTasks={tasks}
      sessionToken={sessionToken}
      activeServerId={activeServerId}
    >
      <TaskMaterialStateProvider>
        <ProductShell
          active="tasks"
          title={t("title")}
          description={t("description")}
          session={session}
          listTitle={t("boardListSurface")}
          listConfig={{ storageKey: "smallkhoj.tasks.listWidth", defaultWidth: 300, min: 240, max: 440 }}
          list={<TaskRouteList filters={filters} selectedTaskId={selectedTaskId} />}
          sidebarTitle={t("detailTitle")}
          sidebarDescription={t("detailDescription")}
          sidebar={(
            <TaskRouteDetail
              filters={filters}
              selectedTaskId={selectedTaskId}
              activity={activity}
              memoryEntries={memoryEntries}
              actions={detailActions}
            />
          )}
          mainScrollable={false}
          actions={(
            <>
              <TaskRouteFormDialogs
                createAction={createTaskAction}
                updateAction={updateTaskAction}
                channels={channels}
                agents={agents}
                templates={activeTemplates}
              />
              <Link href="/daemon">
                <Button variant="outline" size="sm">{t("controlPlane")}</Button>
              </Link>
            </>
          )}
        >
          <TaskRouteWorkspace
            filters={filters}
            channels={channels}
            agentCount={agents.length}
            sessionToken={sessionToken}
          />
          <TaskDetailDialog open={Boolean(selectedTaskId)} closeHref={tasksBaseHref}>
            <TaskRouteDetail
              filters={filters}
              selectedTaskId={selectedTaskId}
              activity={activity}
              memoryEntries={memoryEntries}
              actions={detailActions}
              deleteConfig={canManageServer && selectedTaskId ? {
                sessionToken,
                activeServerId,
                clearSelectionHref: tasksBaseHref,
              } : undefined}
            />
          </TaskDetailDialog>
        </ProductShell>
      </TaskMaterialStateProvider>
    </TaskProjectionProvider>
  )
}
