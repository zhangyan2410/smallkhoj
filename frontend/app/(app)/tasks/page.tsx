import Link from "next/link"
import { revalidatePath } from "next/cache"
import { getTranslations } from "next-intl/server"
import {
  Bell,
  Camera,
  Columns3,
  Database,
  ExternalLink,
  FileText,
  Filter,
  ListChecks,
  MessageSquare,
  Plus,
  Shield,
} from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { EmptyState, StatusPill, Toolbar } from "@/components/product-ui"
import { EvidenceSurface, InkframeObjectSurface, MemoryFixedNote, ObjectToggleField, ReviewStamp, TaskTicket } from "@/components/inkframe-object-ui"
import { TaskRecoveryCockpit, type TaskRecoveryCopy } from "@/components/memory-entry-surface"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { FieldLabel, Select, Textarea } from "@/components/ui/form"
import { TaskListPanel } from "@/components/task-list-panel"
import { TaskMaterialStateProvider, TaskRouteDetailMaterialFrame } from "@/components/task-material-state"
import { TaskFormDialogs } from "@/components/task-form-dialogs"
import { API_BASE, apiGet, dotClass, formatTime, statusLabel, type Member, type MemoryEntry, type TaskRunTemplate } from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

import { TaskDndBoard } from "@/components/task-dnd-board"
import { TaskDetailDialog } from "@/components/task-detail-dialog"

const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "closed"]
const TASK_STATUS_OPTIONS = TASK_STATUSES.map((status) => `${status}|${statusLabel(status)}`)
const MEMORY_OUTPUT_DIRECTIONS = ["final_summary", "evidence", "artifacts", "next_steps", "channel_memory"]

type TranslationFn = (key: string, values?: Record<string, string | number>) => string

function makeTasksCopy(t: TranslationFn) {
  return {
    title: t("title"),
    description: t("description"),
    detailTitle: t("detailTitle"),
    detailDescription: t("detailDescription"),
    controlPlane: t("controlPlane"),
    boardListSurface: t("boardListSurface"),
    visibleCount: (visible: number, total: number) => t("visibleCount", { visible, total }),
    board: t("board"),
    list: t("list"),
    total: t("total"),
    open: t("open"),
    agents: t("agents"),
    createTask: t("createTask"),
    createTaskDesc: t("createTaskDesc"),
    updateTask: t("updateTask"),
    updateTaskDesc: t("updateTaskDesc"),
    titleLabel: t("titleLabel"),
    descriptionLabel: t("descriptionLabel"),
    channel: t("channel"),
    assignee: t("assignee"),
    taskRunTemplate: t("taskRunTemplate"),
    status: t("status"),
    create: t("create"),
    update: t("update"),
    task: t("task"),
    filters: t("filters"),
    creator: t("creator"),
    apply: t("apply"),
    clear: t("clear"),
    unassigned: t("unassigned"),
    anyChannel: t("anyChannel"),
    anyCreator: t("anyCreator"),
    anyAssignee: t("anyAssignee"),
    anyStatus: t("anyStatus"),
    createTitlePlaceholder: t("createTitlePlaceholder"),
    createDescPlaceholder: t("createDescPlaceholder"),
    keepBlankPlaceholder: t("keepBlankPlaceholder"),
    noTaskSelectedTitle: t("noTaskSelectedTitle"),
    noTaskSelectedDesc: t("noTaskSelectedDesc"),
    unknown: t("unknown"),
    activity: t("activity"),
    noActivity: t("noActivity"),
    source: t("source"),
    sourceType: t("sourceType"),
    sourceMessage: t("sourceMessage"),
    sourceThread: t("sourceThread"),
    openSourceChannel: (channel: string) => t("openSourceChannel", { channel }),
    noSource: t("noSource"),
    evidence: t("evidence"),
    evidenceLink: t("evidenceLink"),
    noEvidence: t("noEvidence"),
    evidencePathPlaceholder: t("evidencePathPlaceholder"),
    evidenceContentPlaceholder: t("evidenceContentPlaceholder"),
    addEvidence: t("addEvidence"),
    review: t("review"),
    memoryRequest: t("memoryRequest"),
    memoryRequestDesc: t("memoryRequestDesc"),
    memoryInstructionPlaceholder: t("memoryInstructionPlaceholder"),
    triggerMemoryRequest: t("triggerMemoryRequest"),
    outputDirections: t("outputDirections"),
    directionFinalSummary: t("directionFinalSummary"),
    directionEvidence: t("directionEvidence"),
    directionArtifacts: t("directionArtifacts"),
    directionNextSteps: t("directionNextSteps"),
    directionChannelMemory: t("directionChannelMemory"),
    selectDecision: t("selectDecision"),
    approved: t("approved"),
    rejected: t("rejected"),
    needsWork: t("needsWork"),
    reopened: t("reopened"),
    reviewNotePlaceholder: t("reviewNotePlaceholder"),
    submitReview: t("submitReview"),
    byReviewer: (reviewer: string) => t("byReviewer", { reviewer }),
    evidenceTypeScreenshot: t("evidenceTypeScreenshot"),
    evidenceTypeTrace: t("evidenceTypeTrace"),
    evidenceTypeApiProof: t("evidenceTypeApiProof"),
    evidenceTypeNote: t("evidenceTypeNote"),
    evidenceTypeReviewDecision: t("evidenceTypeReviewDecision"),
    evidenceTypeReviewNote: t("evidenceTypeReviewNote"),
    taskRecovery: {
      title: t("taskRecoveryTitle"),
      scoreLabel: (score: number) => t("taskRecoveryScore", { score }),
      brief: t("taskRecoveryBrief"),
      plan: t("taskRecoveryPlan"),
      progress: t("taskRecoveryProgress"),
      output: t("taskRecoveryOutput"),
      noMemory: t("taskRecoveryNoMemory"),
      taskBreakdown: t("taskRecoveryBreakdown"),
      outputsAndEvidence: t("taskRecoveryOutputs"),
    } satisfies TaskRecoveryCopy,
  }
}

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

async function getTasks(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ tasks: Task[] }>("/api/v1/tasks", { tasks: [] }, sessionToken, activeServerId)
}

async function getChannels(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ channels: Channel[] }>("/api/v1/channels", { channels: [] }, sessionToken, activeServerId)
}

async function getMembers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ members: Member[] }>("/api/v1/members", { members: [] }, sessionToken, activeServerId)
}

async function getTaskRunTemplates(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ templates: TaskRunTemplate[] }>("/api/v1/task-run-templates", { templates: [] }, sessionToken, activeServerId)
}

async function getTaskActivity(taskId: string, sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ activity: ActivityItem[] }>(`/api/v1/activity?taskId=${encodeURIComponent(taskId)}&limit=20`, { activity: [] }, sessionToken, activeServerId)
}

async function getTaskMemory(taskId: string, sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ entries: MemoryEntry[] }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/memory`, { entries: [] }, sessionToken, activeServerId)
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

async function requestTaskMemoryAction(formData: FormData) {
  "use server"
  const taskId = String(formData.get("taskId") || "")
  if (!taskId) return
  const outputDirections = formData.getAll("outputDirection").map((item) => String(item))
  await writeTask(
    `/api/v1/tasks/${taskId}/memory/request`,
    {
      instruction: String(formData.get("memoryInstruction") || "").trim() || null,
      outputDirections,
    },
    "POST"
  )
  revalidatePath("/tasks")
}

function firstParam(value: string | string[] | undefined, fallback = "") {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}

// StatusBadge 包装已删 —— 直接用 StatusPill（内部已调 badgeClass 单一真源）

// FieldLabel/Select 已抽到 @/components/ui/form，下方表单直接使用。

function filteredTasks(tasks: Task[], filters: { channel: string; creator: string; assignee: string; status: string }) {
  return tasks.filter((task) => {
    if (filters.channel && task.channel !== filters.channel) return false
    if (filters.creator && task.creator !== filters.creator) return false
    if (filters.assignee && task.assignee !== filters.assignee) return false
    if (filters.status && task.status !== filters.status) return false
    return true
  })
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

// dotClass 已收口到 lib/control-plane 单一真源（上方 import）

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

type TasksCopy = ReturnType<typeof makeTasksCopy>

function entryLabel(type: EvidenceEntry["type"], copy: TasksCopy) {
  switch (type) {
    case "screenshot": return copy.evidenceTypeScreenshot
    case "trace": return copy.evidenceTypeTrace
    case "api_proof": return copy.evidenceTypeApiProof
    case "note": return copy.evidenceTypeNote
    case "reviewer_decision": return copy.evidenceTypeReviewDecision
    case "review_note": return copy.evidenceTypeReviewNote
  }
}

function EvidenceEntryRow({ entry, copy }: { entry: EvidenceEntry; copy: TasksCopy }) {
  return (
    <EvidenceSurface kind={entry.type} className="flex items-start gap-2 px-2.5 py-2">
      <EvidenceIcon type={entry.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{entryLabel(entry.type, copy)}</span>
          {entry.timestamp && (
            <span className="text-[0.65rem] text-muted-foreground">{formatTime(entry.timestamp)}</span>
          )}
        </div>
        {entry.path && (
          <div className="mt-1 truncate font-mono text-xs text-primary">{entry.path}</div>
        )}
        {entry.content && (
          <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{entry.content}</p>
        )}
        {entry.decision && (
          <div className="mt-1">
            <ReviewStamp
              tone={entry.decision === "approved" || entry.decision === "pass" ? "approved" : entry.decision === "rejected" || entry.decision === "fail" ? "blocked" : "review"}
              className="text-[0.65rem]"
            >
              {entry.decision}
            </ReviewStamp>
          </div>
        )}
        {entry.note && (
          <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>
        )}
        {entry.reviewer && (
          <div className="mt-1 text-[0.65rem] text-muted-foreground">{copy.byReviewer(entry.reviewer)}</div>
        )}
      </div>
    </EvidenceSurface>
  )
}

function outputDirectionLabel(direction: string, copy: TasksCopy) {
  switch (direction) {
    case "final_summary": return copy.directionFinalSummary
    case "evidence": return copy.directionEvidence
    case "artifacts": return copy.directionArtifacts
    case "next_steps": return copy.directionNextSteps
    case "channel_memory": return copy.directionChannelMemory
    default: return direction
  }
}

function TaskDetail({ task, activity = [], memoryEntries = [], copy }: { task?: Task; activity?: ActivityItem[]; memoryEntries?: MemoryEntry[]; copy: TasksCopy }) {
  if (!task) {
    return <EmptyState title={copy.noTaskSelectedTitle} description={copy.noTaskSelectedDesc} />
  }
  const source = task.data?.source
  const evidence = task.data?.evidence
  const entries = evidence?.entries ?? []
  const sourceLink = source ? sourceHref(source) : null
  return (
    <TaskRouteDetailMaterialFrame taskId={task.id} status={task.status}>
      <div>
        <div className="font-mono text-xs text-muted-foreground">
          {task.channel} #{task.number}
        </div>
        <h2 className="mt-1 text-base font-semibold">{task.title}</h2>
        {task.description && <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>}
      </div>
      <div className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{copy.status}</span>
          <StatusPill status={task.status} label={statusLabel(task.status)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{copy.assignee}</span>
          <span>{task.assignee ? `@${task.assignee}` : copy.unassigned}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{copy.creator}</span>
          <span>{task.creator ? `@${task.creator}` : copy.unknown}</span>
        </div>
      </div>
      <EvidenceSurface kind="activity" className="px-3 py-3">
        <h3 className="text-sm font-medium">{copy.activity}</h3>
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
          <p className="mt-2 text-xs text-muted-foreground">{copy.noActivity}</p>
        )}
      </EvidenceSurface>
      <EvidenceSurface kind="source" className="px-3 py-3">
        <h3 className="text-sm font-medium">{copy.source}</h3>
        {source ? (
          <div className="mt-2 space-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <span className="font-medium">{copy.sourceType}</span> {source.type || "message"}
            </div>
            {source.messageId && (
              <div className="flex items-center gap-1">
                <span className="font-medium">{copy.sourceMessage}</span> {source.messageShortId || source.messageId.slice(0, 8)}
              </div>
            )}
            {source.threadId && (
              <div className="flex items-center gap-1">
                <span className="font-medium">{copy.sourceThread}</span> {source.threadId.slice(0, 8)}
              </div>
            )}
            {source.channel && sourceLink && (
              <TaskTicket href={sourceLink} status="source" className="text-xs">
                <MessageSquare className="size-3" />
                {copy.openSourceChannel(source.channel)}
              </TaskTicket>
            )}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{copy.noSource}</p>
        )}
      </EvidenceSurface>
      <div data-inkframe-mobile-role="task-evidence" className="space-y-2">
        <h3 className="text-sm font-medium">{copy.evidence}</h3>
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          {(evidence?.notes || []).map((note) => (
            <EvidenceSurface key={note} kind="note" className="px-2 py-1.5">{note}</EvidenceSurface>
          ))}
          {(evidence?.links || []).map((link) => (
            <EvidenceSurface key={`${link.label}-${link.href}`} kind="link" className="flex items-center gap-1.5 px-2 py-1.5">
              <ExternalLink className="size-3" />
              {link.label || link.href || copy.evidenceLink}
            </EvidenceSurface>
          ))}
          {entries.length > 0 && (
            <div className="space-y-1.5">
              {entries.map((entry, i) => (
                <EvidenceEntryRow key={`${entry.type}-${entry.timestamp}-${i}`} entry={entry} copy={copy} />
              ))}
            </div>
          )}
          {(evidence?.notes?.length || 0) + (evidence?.links?.length || 0) + entries.length === 0 && (
            <p className="text-muted-foreground">{copy.noEvidence}</p>
          )}
        </div>
        <form action={addEvidenceAction} className="mt-3 min-w-0 space-y-2 border-t pt-3">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="currentData" value={JSON.stringify(task.data ?? {})} />
          <div className="flex min-w-0 gap-2">
            <Select
              id={`evidence-entry-type-${task.id}`}
              name="entryType"
              items={[
                `note|${copy.evidenceTypeNote}`,
                `screenshot|${copy.evidenceTypeScreenshot}`,
                `trace|${copy.evidenceTypeTrace}`,
                `api_proof|${copy.evidenceTypeApiProof}`,
              ]}
              splitValue
              defaultValue="note"
              className="h-7 w-auto shrink-0 text-xs"
            />
            <Input name="entryPath" placeholder={copy.evidencePathPlaceholder} className="h-7 min-w-0 text-xs" />
          </div>
          <Input name="entryContent" placeholder={copy.evidenceContentPlaceholder} className="h-7 min-w-0 text-xs" />
          <Button type="submit" size="sm" variant="outline" className="w-full text-xs">
            <Plus className="size-3" />
            {copy.addEvidence}
          </Button>
        </form>
      </div>
      <TaskRecoveryCockpit entries={memoryEntries} copy={copy.taskRecovery} />
      <MemoryFixedNote fixed={memoryEntries.length > 0} className="p-2.5">
        <div className="flex items-start gap-2">
          <Bell className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium">{copy.memoryRequest}</h3>
            <p className="mt-0.5 text-[0.7rem] leading-4 text-muted-foreground">{copy.memoryRequestDesc}</p>
          </div>
        </div>
        <form action={requestTaskMemoryAction} className="mt-2 space-y-2">
          <input type="hidden" name="taskId" value={task.id} />
          <Textarea
            name="memoryInstruction"
            placeholder={copy.memoryInstructionPlaceholder}
            rows={3}
            className="resize-none text-xs"
          />
          <div className="flex flex-wrap gap-1.5" aria-label={copy.outputDirections}>
            {MEMORY_OUTPUT_DIRECTIONS.map((direction) => (
              <ObjectToggleField key={direction} className="cursor-pointer px-0 py-0 text-[0.68rem]">
                <input
                  type="checkbox"
                  name="outputDirection"
                  value={direction}
                  defaultChecked={direction === "final_summary" || direction === "evidence"}
                  className="peer sr-only"
                />
                <span className="inline-flex px-2 py-1 text-muted-foreground peer-checked:text-primary">
                  {outputDirectionLabel(direction, copy)}
                </span>
              </ObjectToggleField>
            ))}
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-7 w-full text-xs">
            {copy.triggerMemoryRequest}
          </Button>
        </form>
      </MemoryFixedNote>
      <EvidenceSurface kind="review" data-inkframe-mobile-role="task-review" className="px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{copy.review}</h3>
          <ReviewStamp tone="review">{copy.review}</ReviewStamp>
        </div>
        <form action={addReviewNoteAction} className="mt-2 space-y-2">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="currentData" value={JSON.stringify(task.data ?? {})} />
          <Select
            id={`review-decision-${task.id}`}
            name="reviewDecision"
            items={[
              `approved|${copy.approved}`,
              `rejected|${copy.rejected}`,
              `needs_work|${copy.needsWork}`,
              `reopened|${copy.reopened}`,
            ]}
            emptyLabel={copy.selectDecision}
            splitValue
            className="h-7 text-xs"
          />
          <Input name="reviewNote" placeholder={copy.reviewNotePlaceholder} className="h-7 min-w-0 text-xs" />
          <Button type="submit" size="sm" variant="outline" className="w-full text-xs">
            {copy.submitReview}
          </Button>
        </form>
      </EvidenceSurface>
    </TaskRouteDetailMaterialFrame>
  )
}

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireCurrentAccount()
  const t = await getTranslations("tasks")
  const copy = makeTasksCopy(t)
  const sessionToken = await getSessionToken()
  const activeServerId = session.server.id
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
  const [{ tasks }, { channels }, { members }, { templates }] = await Promise.all([
    getTasks(sessionToken, activeServerId),
    getChannels(sessionToken, activeServerId),
    getMembers(sessionToken, activeServerId),
    getTaskRunTemplates(sessionToken, activeServerId),
  ])
  const agents = members.filter((member) => member.kind === "agent")
  const activeTemplates = templates.filter((template) => template.status === "active")
  const visibleTasks = filteredTasks(tasks, filters)
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "closed")
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) ?? visibleTasks[0]
  let activity: ActivityItem[] = []
  let memoryEntries: MemoryEntry[] = []
  if (selectedTask?.id) {
    const [result, memoryResult] = await Promise.all([
      getTaskActivity(selectedTask.id, sessionToken, activeServerId),
      getTaskMemory(selectedTask.id, sessionToken, activeServerId),
    ])
    activity = result.activity
    memoryEntries = memoryResult.entries
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
  const tasksBaseHref = `/tasks?${new URLSearchParams(filterRecord).toString()}`

  return (
    <TaskMaterialStateProvider>
    <ProductShell
      title={copy.title}
      description={copy.description}
      listTitle={copy.boardListSurface}
      listConfig={{ storageKey: "smallkhoj.tasks.listWidth", defaultWidth: 300, min: 240, max: 440 }}
      list={
        <TaskListPanel
          tasks={visibleTasks}
          selectedTaskId={selectedTask?.id}
          filters={filterRecord}
          createLabel={copy.createTask}
          emptyLabel="No tasks"
        />
      }
      sidebarTitle={copy.detailTitle}
      sidebarDescription={copy.detailDescription}
      sidebar={<TaskDetail task={selectedTask} activity={activity} memoryEntries={memoryEntries} copy={copy} />}
      mainScrollable={false}
      actions={
        <>
          <TaskFormDialogs
            createAction={createTaskAction}
            updateAction={updateTaskAction}
            channels={channels}
            agents={agents}
            templates={activeTemplates}
            tasks={tasks}
            copy={{
              create: copy.create,
              createTask: copy.createTask,
              createTaskDesc: copy.createTaskDesc,
              createTitlePlaceholder: copy.createTitlePlaceholder,
              titleLabel: copy.titleLabel,
              descriptionLabel: copy.descriptionLabel,
              createDescPlaceholder: copy.createDescPlaceholder,
              channel: copy.channel,
              assignee: copy.assignee,
              unassigned: copy.unassigned,
              taskRunTemplate: copy.taskRunTemplate,
              status: copy.status,
              update: copy.update,
              updateTask: copy.updateTask,
              updateTaskDesc: copy.updateTaskDesc,
              task: copy.task,
              keepBlankPlaceholder: copy.keepBlankPlaceholder,
            }}
          />
          <Link href="/daemon">
            <Button variant="outline" size="sm">
              {copy.controlPlane}
            </Button>
          </Link>
        </>
      }
    >
      <RealtimeRefresh eventTypes={["task.created", "task.updated"]} />
      <div data-inkframe-mobile-role="task-workspace" className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto pr-1">
        <Toolbar data-inkframe-mobile-role="task-controls">
          <ListChecks className="size-4 text-primary" />
          <span className="text-sm font-medium">{copy.boardListSurface}</span>
          <span className="text-xs text-muted-foreground">{copy.visibleCount(visibleTasks.length, tasks.length)}</span>
          <div className="ml-auto flex gap-1">
            <Link href={`/tasks?${new URLSearchParams({ ...filterRecord, view: "board" }).toString()}`}>
              <Button variant={view === "board" ? "default" : "outline"} size="sm">
                <Columns3 className="size-4" />
                {copy.board}
              </Button>
            </Link>
            <Link href={`/tasks?${new URLSearchParams({ ...filterRecord, view: "list" }).toString()}`}>
              <Button variant={view === "list" ? "default" : "outline"} size="sm">
                <ListChecks className="size-4" />
                {copy.list}
              </Button>
            </Link>
          </div>
        </Toolbar>

        <div className="grid gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>{copy.total}</CardDescription>
              <CardTitle className="text-2xl">{tasks.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>{copy.open}</CardDescription>
              <CardTitle className="text-2xl">{openTasks.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>{copy.agents}</CardDescription>
              <CardTitle className="text-2xl">{agents.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* 创建/更新表单已收进顶部对话框（TaskFormDialogs），主区只保留看板主体 */}

        <InkframeObjectSurface
          material="dry"
          data-inkframe-mobile-role="task-filters"
          className="grid min-w-0 grid-cols-1 gap-3 overflow-x-hidden p-3 sm:grid-cols-2 xl:grid-cols-5"
        >
        <form action="/tasks" className="contents">
          <input type="hidden" name="view" value={view} />
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium xl:col-span-5">
            <Filter className="size-4 text-primary" />
            {copy.filters}
          </div>
          <div>
            <FieldLabel htmlFor="filter-channel">{copy.channel}</FieldLabel>
            <Select id="filter-channel" name="channel" items={channels.map((channel) => channel.name)} defaultValue={filters.channel} emptyLabel={copy.anyChannel} />
          </div>
          <div>
            <FieldLabel htmlFor="filter-creator">{copy.creator}</FieldLabel>
            <Select id="filter-creator" name="creator" items={creators} defaultValue={filters.creator} emptyLabel={copy.anyCreator} />
          </div>
          <div>
            <FieldLabel htmlFor="filter-assignee">{copy.assignee}</FieldLabel>
            <Select id="filter-assignee" name="assignee" items={assignees} defaultValue={filters.assignee} emptyLabel={copy.anyAssignee} />
          </div>
          <div>
            <FieldLabel htmlFor="filter-status">{copy.status}</FieldLabel>
            <Select id="filter-status" name="status" items={TASK_STATUS_OPTIONS} defaultValue={filters.status} emptyLabel={copy.anyStatus} splitValue />
          </div>
          <div className="flex min-w-0 items-end gap-2">
            <Button type="submit" size="sm" className="min-w-0 flex-1">
              {copy.apply}
            </Button>
            <Link href={`/tasks?view=${view}`}>
              <Button type="button" size="sm" variant="outline">
                {copy.clear}
              </Button>
            </Link>
          </div>
        </form>
        </InkframeObjectSurface>

        <TaskDndBoard
          tasks={visibleTasks}
          filters={filterRecord}
          view={view}
          sessionToken={sessionToken}
        />
      </div>
      <TaskDetailDialog open={!!selectedTaskId} closeHref={tasksBaseHref}>
        <TaskDetail task={selectedTask} activity={activity} memoryEntries={memoryEntries} copy={copy} />
      </TaskDetailDialog>
    </ProductShell>
    </TaskMaterialStateProvider>
  )
}
