"use client"

import { useEffect, useRef } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
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
import { useTranslations } from "next-intl"

import { DestructiveActionDialog } from "@/components/destructive-action-dialog"
import TaskDndBoardLazy from "@/components/task-dnd-board-lazy"
import { TaskFormDialogs } from "@/components/task-form-dialogs"
import { TaskListPanel } from "@/components/task-list-panel"
import { TaskRouteDetailMaterialFrame } from "@/components/task-material-state"
import { TaskProjectionStatus, useTaskProjection } from "@/components/task-projection-provider"
import { EmptyState, StatusPill, Toolbar } from "@/components/product-ui"
import {
  EvidenceSurface,
  InkframeObjectSurface,
  MemoryFixedNote,
  ObjectToggleField,
  ReviewStamp,
  TaskTicket,
} from "@/components/inkframe-object-ui"
import { TaskRecoveryCockpit, type TaskRecoveryCopy } from "@/components/memory-entry-surface"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldLabel, Select, Textarea } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  apiDelete,
  dotClass,
  formatTime,
  isTaskDeleteResult,
  statusLabel,
  type Channel,
  type Member,
  type MemoryEntry,
  type TaskRunTemplate,
} from "@/lib/control-plane"
import {
  filterTaskProjection,
  selectTaskProjection,
  type TaskEvidenceEntry,
  type TaskProjectionFilters,
  type TaskProjectionTask,
  type TaskSource,
} from "@/lib/task-projection"

const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "closed"]
const TASK_STATUS_OPTIONS = TASK_STATUSES.map((status) => `${status}|${statusLabel(status)}`)
const MEMORY_OUTPUT_DIRECTIONS = ["final_summary", "evidence", "artifacts", "next_steps", "channel_memory"]

export type TaskRouteFilters = Required<TaskProjectionFilters> & {
  view: "board" | "list"
}

export type TaskActivityItem = {
  id: string
  agentName?: string | null
  type: string
  description: string
  timestamp?: string | null
}

export type TaskDetailActions = {
  addEvidence: (formData: FormData) => void | Promise<void>
  addReviewNote: (formData: FormData) => void | Promise<void>
  requestMemory: (formData: FormData) => void | Promise<void>
}

export type TaskRouteDeleteConfig = {
  sessionToken?: string | null
  activeServerId: string
  clearSelectionHref: string
}

export function TaskRouteList({
  filters,
  selectedTaskId,
}: {
  filters: TaskRouteFilters
  selectedTaskId?: string | null
}) {
  const t = useTranslations("tasks")
  const { tasks } = useTaskProjection()
  const visibleTasks = filterTaskProjection(tasks, filters)
  const selectedTask = selectTaskProjection(tasks, filters, selectedTaskId)

  return (
    <TaskListPanel
      tasks={visibleTasks}
      selectedTaskId={selectedTask?.id}
      filters={filters}
      createLabel={t("createTask")}
      emptyLabel={t("noTaskSelectedTitle")}
    />
  )
}

export function TaskRouteFormDialogs({
  createAction,
  updateAction,
  channels,
  agents,
  templates,
}: {
  createAction: (formData: FormData) => void | Promise<void>
  updateAction: (formData: FormData) => void | Promise<void>
  channels: Channel[]
  agents: Member[]
  templates: TaskRunTemplate[]
}) {
  const t = useTranslations("tasks")
  const { tasks } = useTaskProjection()

  return (
    <TaskFormDialogs
      createAction={createAction}
      updateAction={updateAction}
      channels={channels}
      agents={agents}
      templates={templates}
      tasks={tasks}
      copy={{
        create: t("create"),
        createTask: t("createTask"),
        createTaskDesc: t("createTaskDesc"),
        createTitlePlaceholder: t("createTitlePlaceholder"),
        titleLabel: t("titleLabel"),
        descriptionLabel: t("descriptionLabel"),
        createDescPlaceholder: t("createDescPlaceholder"),
        channel: t("channel"),
        assignee: t("assignee"),
        unassigned: t("unassigned"),
        taskRunTemplate: t("taskRunTemplate"),
        status: t("status"),
        update: t("update"),
        updateTask: t("updateTask"),
        updateTaskDesc: t("updateTaskDesc"),
        task: t("task"),
        keepBlankPlaceholder: t("keepBlankPlaceholder"),
      }}
    />
  )
}

export function TaskRouteWorkspace({
  filters,
  channels,
  agentCount,
  sessionToken,
}: {
  filters: TaskRouteFilters
  channels: Channel[]
  agentCount: number
  sessionToken?: string | null
}) {
  const t = useTranslations("tasks")
  const tCommon = useTranslations("common")
  const { tasks } = useTaskProjection()
  const visibleTasks = filterTaskProjection(tasks, filters)
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "closed")
  const creators = Array.from(new Set(
    tasks.map((task) => task.creator).filter((value): value is string => Boolean(value)),
  )).sort()
  const assignees = Array.from(new Set(
    tasks.map((task) => task.assignee).filter((value): value is string => Boolean(value)),
  )).sort()

  return (
    <div data-inkframe-mobile-role="task-workspace" className="flex min-h-0 min-w-0 flex-1 flex-col gap-5 overflow-x-hidden overflow-y-auto pr-1">
      <TaskProjectionStatus
        refreshingLabel={tCommon("loading")}
        errorLabel={tCommon("routeErrorDesc")}
        retryLabel={tCommon("tryAgain")}
      />

      <Toolbar data-inkframe-mobile-role="task-controls">
        <ListChecks className="size-4 text-primary" />
        <span className="text-sm font-medium">{t("boardListSurface")}</span>
        <span className="text-xs text-muted-foreground">
          {t("visibleCount", { visible: visibleTasks.length, total: tasks.length })}
        </span>
        <div className="ml-auto flex gap-1">
          <Link href={`/tasks?${new URLSearchParams({ ...filters, view: "board" }).toString()}`}>
            <Button variant={filters.view === "board" ? "default" : "outline"} size="sm">
              <Columns3 className="size-4" />
              {t("board")}
            </Button>
          </Link>
          <Link href={`/tasks?${new URLSearchParams({ ...filters, view: "list" }).toString()}`}>
            <Button variant={filters.view === "list" ? "default" : "outline"} size="sm">
              <ListChecks className="size-4" />
              {t("list")}
            </Button>
          </Link>
        </div>
      </Toolbar>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("total")}</CardDescription>
            <CardTitle className="text-2xl">{tasks.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("open")}</CardDescription>
            <CardTitle className="text-2xl">{openTasks.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("agents")}</CardDescription>
            <CardTitle className="text-2xl">{agentCount}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <InkframeObjectSurface
        material="dry"
        data-inkframe-mobile-role="task-filters"
        className="grid min-w-0 grid-cols-1 gap-3 overflow-x-hidden p-3 sm:grid-cols-2 xl:grid-cols-5"
      >
        <form action="/tasks" className="contents">
          <input type="hidden" name="view" value={filters.view} />
          <div className="flex min-w-0 items-center gap-2 text-sm font-medium xl:col-span-5">
            <Filter className="size-4 text-primary" />
            {t("filters")}
          </div>
          <div>
            <FieldLabel htmlFor="filter-channel">{t("channel")}</FieldLabel>
            <Select id="filter-channel" name="channel" items={channels.map((channel) => channel.name)} defaultValue={filters.channel} emptyLabel={t("anyChannel")} />
          </div>
          <div>
            <FieldLabel htmlFor="filter-creator">{t("creator")}</FieldLabel>
            <Select id="filter-creator" name="creator" items={creators} defaultValue={filters.creator} emptyLabel={t("anyCreator")} />
          </div>
          <div>
            <FieldLabel htmlFor="filter-assignee">{t("assignee")}</FieldLabel>
            <Select id="filter-assignee" name="assignee" items={assignees} defaultValue={filters.assignee} emptyLabel={t("anyAssignee")} />
          </div>
          <div>
            <FieldLabel htmlFor="filter-status">{t("status")}</FieldLabel>
            <Select id="filter-status" name="status" items={TASK_STATUS_OPTIONS} defaultValue={filters.status} emptyLabel={t("anyStatus")} splitValue />
          </div>
          <div className="flex min-w-0 items-end gap-2">
            <Button type="submit" size="sm" className="min-w-0 flex-1">
              {t("apply")}
            </Button>
            <Link href={`/tasks?view=${filters.view}`}>
              <Button type="button" size="sm" variant="outline">
                {t("clear")}
              </Button>
            </Link>
          </div>
        </form>
      </InkframeObjectSurface>

      <TaskDndBoardLazy
        filters={filters}
        view={filters.view}
        sessionToken={sessionToken}
      />
    </div>
  )
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

function EvidenceIcon({ type }: { type: TaskEvidenceEntry["type"] }) {
  switch (type) {
    case "screenshot": return <Camera className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    case "trace": return <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    case "api_proof": return <Database className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    case "reviewer_decision": return <Shield className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    case "note":
    case "review_note":
      return <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
  }
}

function evidenceEntryLabel(type: TaskEvidenceEntry["type"], t: ReturnType<typeof useTranslations<"tasks">>) {
  switch (type) {
    case "screenshot": return t("evidenceTypeScreenshot")
    case "trace": return t("evidenceTypeTrace")
    case "api_proof": return t("evidenceTypeApiProof")
    case "note": return t("evidenceTypeNote")
    case "reviewer_decision": return t("evidenceTypeReviewDecision")
    case "review_note": return t("evidenceTypeReviewNote")
  }
}

function EvidenceEntryRow({ entry }: { entry: TaskEvidenceEntry }) {
  const t = useTranslations("tasks")
  return (
    <EvidenceSurface kind={entry.type} className="flex items-start gap-2 px-2.5 py-2">
      <EvidenceIcon type={entry.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{evidenceEntryLabel(entry.type, t)}</span>
          {entry.timestamp && <span className="text-[0.65rem] text-muted-foreground">{formatTime(entry.timestamp)}</span>}
        </div>
        {entry.path && <div className="mt-1 truncate font-mono text-xs text-primary">{entry.path}</div>}
        {entry.content && <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{entry.content}</p>}
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
        {entry.note && <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>}
        {entry.reviewer && <div className="mt-1 text-[0.65rem] text-muted-foreground">{t("byReviewer", { reviewer: entry.reviewer })}</div>}
      </div>
    </EvidenceSurface>
  )
}

function outputDirectionLabel(direction: string, t: ReturnType<typeof useTranslations<"tasks">>) {
  switch (direction) {
    case "final_summary": return t("directionFinalSummary")
    case "evidence": return t("directionEvidence")
    case "artifacts": return t("directionArtifacts")
    case "next_steps": return t("directionNextSteps")
    case "channel_memory": return t("directionChannelMemory")
    default: return direction
  }
}

function TaskRouteDeleteAction({
  task,
  config,
}: {
  task: TaskProjectionTask
  config: TaskRouteDeleteConfig
}) {
  const t = useTranslations("tasks")
  const tCommon = useTranslations("common")
  const router = useRouter()
  const { removeTask } = useTaskProjection()
  const mountedRef = useRef(true)
  const requestControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestControllerRef.current?.abort()
    }
  }, [])

  return (
    <div className="border-t pt-3" data-slot="task-delete-action">
      <DestructiveActionDialog
        key={task.id}
        triggerLabel={t("deleteTask")}
        title={t("deleteTaskTitle")}
        targetName={`#${task.number} ${task.title}`}
        consequence={t("deleteTaskConsequence")}
        confirmLabel={tCommon("delete")}
        cancelLabel={tCommon("cancel")}
        submittingLabel={t("deletingTask")}
        retryLabel={tCommon("tryAgain")}
        failureLabel={t("taskDeleteFailed")}
        closeLabel={tCommon("close")}
        onConfirm={async () => {
          const controller = new AbortController()
          requestControllerRef.current = controller
          try {
            const result = await apiDelete<unknown>(
              `/api/v1/tasks/${encodeURIComponent(task.id)}`,
              config.sessionToken,
              config.activeServerId,
              { signal: controller.signal, timeoutMs: 15_000 },
            )
            if (!isTaskDeleteResult(result, task.id)) {
              throw new Error(t("taskDeleteInvalidResponse"))
            }
            return result
          } finally {
            if (requestControllerRef.current === controller) {
              requestControllerRef.current = null
            }
          }
        }}
        onSuccess={() => {
          if (!mountedRef.current) return
          removeTask(task.id)
          router.replace(config.clearSelectionHref, { scroll: false })
        }}
      />
    </div>
  )
}

export function TaskRouteDetail({
  filters,
  selectedTaskId,
  activity = [],
  memoryEntries = [],
  actions,
  deleteConfig,
}: {
  filters: TaskRouteFilters
  selectedTaskId?: string | null
  activity?: TaskActivityItem[]
  memoryEntries?: MemoryEntry[]
  actions: TaskDetailActions
  deleteConfig?: TaskRouteDeleteConfig
}) {
  const t = useTranslations("tasks")
  const { tasks } = useTaskProjection()
  const task = selectTaskProjection(tasks, filters, selectedTaskId)

  if (!task) {
    return <EmptyState title={t("noTaskSelectedTitle")} description={t("noTaskSelectedDesc")} />
  }

  const source = task.data?.source
  const evidence = task.data?.evidence
  const entries = evidence?.entries ?? []
  const sourceLink = source ? sourceHref(source) : null
  const recoveryCopy: TaskRecoveryCopy = {
    title: t("taskRecoveryTitle"),
    scoreLabel: (score) => t("taskRecoveryScore", { score }),
    brief: t("taskRecoveryBrief"),
    plan: t("taskRecoveryPlan"),
    progress: t("taskRecoveryProgress"),
    output: t("taskRecoveryOutput"),
    noMemory: t("taskRecoveryNoMemory"),
    taskBreakdown: t("taskRecoveryBreakdown"),
    outputsAndEvidence: t("taskRecoveryOutputs"),
  }

  return (
    <TaskRouteDetailMaterialFrame taskId={task.id} status={task.status}>
      <div>
        <div className="font-mono text-xs text-muted-foreground">{task.channel} #{task.number}</div>
        <h2 className="mt-1 text-base font-semibold">{task.title}</h2>
        {task.description && <p className="mt-2 text-sm text-muted-foreground">{task.description}</p>}
      </div>
      <div className="grid gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{t("status")}</span>
          <StatusPill status={task.status} label={statusLabel(task.status)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{t("assignee")}</span>
          <span>{task.assignee ? `@${task.assignee}` : t("unassigned")}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">{t("creator")}</span>
          <span>{task.creator ? `@${task.creator}` : t("unknown")}</span>
        </div>
      </div>
      <EvidenceSurface kind="activity" className="px-3 py-3">
        <h3 className="text-sm font-medium">{t("activity")}</h3>
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
                  <p className="line-clamp-2 text-muted-foreground">{item.description}</p>
                  <span className="text-[0.65rem] text-muted-foreground">{formatTime(item.timestamp)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-2 text-xs text-muted-foreground">{t("noActivity")}</p>}
      </EvidenceSurface>
      <EvidenceSurface kind="source" className="px-3 py-3">
        <h3 className="text-sm font-medium">{t("source")}</h3>
        {source ? (
          <div className="mt-2 space-y-2 text-xs text-muted-foreground">
            <div><span className="font-medium">{t("sourceType")}</span> {source.type || "message"}</div>
            {source.messageId && <div><span className="font-medium">{t("sourceMessage")}</span> {source.messageShortId || source.messageId.slice(0, 8)}</div>}
            {source.threadId && <div><span className="font-medium">{t("sourceThread")}</span> {source.threadId.slice(0, 8)}</div>}
            {source.channel && sourceLink && (
              <TaskTicket href={sourceLink} status="source" className="text-xs">
                <MessageSquare className="size-3" />
                {t("openSourceChannel", { channel: source.channel })}
              </TaskTicket>
            )}
          </div>
        ) : <p className="mt-2 text-xs text-muted-foreground">{t("noSource")}</p>}
      </EvidenceSurface>
      <div data-inkframe-mobile-role="task-evidence" className="space-y-2">
        <h3 className="text-sm font-medium">{t("evidence")}</h3>
        <div className="mt-2 space-y-2 text-xs text-muted-foreground">
          {(evidence?.notes || []).map((note) => <EvidenceSurface key={note} kind="note" className="px-2 py-1.5">{note}</EvidenceSurface>)}
          {(evidence?.links || []).map((link) => (
            <EvidenceSurface key={`${link.label}-${link.href}`} kind="link" className="flex items-center gap-1.5 px-2 py-1.5">
              <ExternalLink className="size-3" />
              {link.label || link.href || t("evidenceLink")}
            </EvidenceSurface>
          ))}
          {entries.map((entry, index) => <EvidenceEntryRow key={`${entry.type}-${entry.timestamp}-${index}`} entry={entry} />)}
          {(evidence?.notes?.length || 0) + (evidence?.links?.length || 0) + entries.length === 0 && <p>{t("noEvidence")}</p>}
        </div>
        <form action={actions.addEvidence} className="mt-3 min-w-0 space-y-2 border-t pt-3">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="currentData" value={JSON.stringify(task.data ?? {})} />
          <div className="flex min-w-0 gap-2">
            <Select
              id={`evidence-entry-type-${task.id}`}
              name="entryType"
              items={[
                `note|${t("evidenceTypeNote")}`,
                `screenshot|${t("evidenceTypeScreenshot")}`,
                `trace|${t("evidenceTypeTrace")}`,
                `api_proof|${t("evidenceTypeApiProof")}`,
              ]}
              splitValue
              defaultValue="note"
              className="h-7 w-auto shrink-0 text-xs"
            />
            <Input name="entryPath" placeholder={t("evidencePathPlaceholder")} className="h-7 min-w-0 text-xs" />
          </div>
          <Input name="entryContent" placeholder={t("evidenceContentPlaceholder")} className="h-7 min-w-0 text-xs" />
          <Button type="submit" size="sm" variant="outline" className="w-full text-xs"><Plus className="size-3" />{t("addEvidence")}</Button>
        </form>
      </div>
      <TaskRecoveryCockpit entries={memoryEntries} copy={recoveryCopy} />
      <MemoryFixedNote fixed={memoryEntries.length > 0} className="p-2.5">
        <div className="flex items-start gap-2">
          <Bell className="mt-0.5 size-3.5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-medium">{t("memoryRequest")}</h3>
            <p className="mt-0.5 text-[0.7rem] leading-4 text-muted-foreground">{t("memoryRequestDesc")}</p>
          </div>
        </div>
        <form action={actions.requestMemory} className="mt-2 space-y-2">
          <input type="hidden" name="taskId" value={task.id} />
          <Textarea name="memoryInstruction" placeholder={t("memoryInstructionPlaceholder")} rows={3} className="resize-none text-xs" />
          <div className="flex flex-wrap gap-1.5" aria-label={t("outputDirections")}>
            {MEMORY_OUTPUT_DIRECTIONS.map((direction) => (
              <ObjectToggleField key={direction} className="cursor-pointer px-0 py-0 text-[0.68rem]">
                <input type="checkbox" name="outputDirection" value={direction} defaultChecked={direction === "final_summary" || direction === "evidence"} className="peer sr-only" />
                <span className="inline-flex px-2 py-1 text-muted-foreground peer-checked:text-primary">{outputDirectionLabel(direction, t)}</span>
              </ObjectToggleField>
            ))}
          </div>
          <Button type="submit" size="sm" variant="outline" className="h-7 w-full text-xs">{t("triggerMemoryRequest")}</Button>
        </form>
      </MemoryFixedNote>
      <EvidenceSurface kind="review" data-inkframe-mobile-role="task-review" className="px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t("review")}</h3>
          <ReviewStamp tone="review">{t("review")}</ReviewStamp>
        </div>
        <form action={actions.addReviewNote} className="mt-2 space-y-2">
          <input type="hidden" name="taskId" value={task.id} />
          <input type="hidden" name="currentData" value={JSON.stringify(task.data ?? {})} />
          <Select
            id={`review-decision-${task.id}`}
            name="reviewDecision"
            items={[
              `approved|${t("approved")}`,
              `rejected|${t("rejected")}`,
              `needs_work|${t("needsWork")}`,
              `reopened|${t("reopened")}`,
            ]}
            emptyLabel={t("selectDecision")}
            splitValue
            className="h-7 text-xs"
          />
          <Input name="reviewNote" placeholder={t("reviewNotePlaceholder")} className="h-7 min-w-0 text-xs" />
          <Button type="submit" size="sm" variant="outline" className="w-full text-xs">{t("submitReview")}</Button>
        </form>
      </EvidenceSurface>
      {deleteConfig && selectedTaskId === task.id ? (
        <TaskRouteDeleteAction key={task.id} task={task} config={deleteConfig} />
      ) : null}
    </TaskRouteDetailMaterialFrame>
  )
}
