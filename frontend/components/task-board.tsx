"use client"

import { type DragEvent, type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import {
  Bell,
  Camera,
  Columns3,
  Database,
  ExternalLink,
  FileText,
  ListChecks,
  MessageSquare,
  Shield,
} from "lucide-react"

import { EmptyState, RuntimeChip, StatusPill } from "@/components/product-ui"
import { useRealtimeSubscription } from "@/components/realtime-provider"
import { EvidenceSurface, InkframeObjectSurface, ObjectToggleField, ReviewStamp, TaskMaterialSurface } from "@/components/inkframe-object-ui"
import { TaskRecoveryCockpit } from "@/components/memory-entry-surface"
import { Textarea } from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { apiGet, apiPatch, apiPost, formatTime, statusLabel, type MemoryEntry } from "@/lib/control-plane"
import { fetchAllTaskPages, type TaskCursorPage } from "@/lib/cursor-pagination"
import { AGENT_DRAG_MIME, parseAgentDragPayload, type AgentDragPayload } from "@/lib/drag-data"
import { TASK_DATA_INVALIDATED_EVENT } from "@/lib/realtime-owner"
import type { TaskProjectionTask as Task } from "@/lib/task-projection"

export type { TaskProjectionTask as Task } from "@/lib/task-projection"

const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "closed"]
const TASK_BOARD_DND_CONTEXT_ID = "smallkhoj-task-board"
const MEMORY_OUTPUT_DIRECTIONS = ["final_summary", "evidence", "artifacts", "next_steps", "channel_memory"] as const
type MemoryOutputDirection = (typeof MEMORY_OUTPUT_DIRECTIONS)[number]

type EvidenceEntry = {
  type: "screenshot" | "trace" | "api_proof" | "note" | "reviewer_decision" | "review_note"
  path?: string
  content?: string
  note?: string
  reviewer?: string
  decision?: string
  timestamp?: string
}

type ActivityItem = {
  id: string
  agentName?: string | null
  type: string
  description: string
  timestamp?: string | null
}

function formatChannelName(channel: string | null | undefined, agentName?: string | null): string {
  if (!channel) return "unknown"
  if (channel.startsWith("dm:")) {
    if (agentName) return `DM @${agentName}`
    const parts = channel.slice(3).split("-")
    return parts.length >= 2 ? `DM @${parts[parts.length - 1].slice(0, 4)}` : "DM"
  }
  return channel.startsWith("#") ? channel : `#${channel}`
}

function SortableTaskCard({
  task,
  selected,
  recentlyUpdated,
  onSelect,
  onAssignAgent,
  dragDisabled = false,
}: {
  task: Task
  selected: boolean
  recentlyUpdated?: boolean
  onSelect: (task: Task) => void
  onAssignAgent?: (task: Task, agent: AgentDragPayload) => void
  dragDisabled?: boolean
}) {
  const [isAgentOver, setIsAgentOver] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: dragDisabled })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : undefined,
  }

  const source = task.data?.source
  const agentName = task.assigneeMember?.displayName ?? task.assignee ?? undefined
  const sortableListeners = listeners as { onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void }
  const acceptsAgentDrop = Boolean(onAssignAgent)

  function handleAgentDragOver(event: DragEvent<HTMLDivElement>) {
    if (!acceptsAgentDrop || !event.dataTransfer.types.includes(AGENT_DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = "copy"
    setIsAgentOver(true)
  }

  function handleAgentDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!acceptsAgentDrop || !event.dataTransfer.types.includes(AGENT_DRAG_MIME)) return
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    setIsAgentOver(false)
  }

  function handleAgentDrop(event: DragEvent<HTMLDivElement>) {
    if (!acceptsAgentDrop || !event.dataTransfer.types.includes(AGENT_DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    setIsAgentOver(false)
    const payload = parseAgentDragPayload(event.dataTransfer.getData(AGENT_DRAG_MIME))
    if (payload) onAssignAgent?.(task, payload)
  }

  return (
    <div ref={setNodeRef} style={style} className="relative min-w-0">
      <div
        {...attributes}
        {...listeners}
        onClick={() => onSelect(task)}
        onDragOver={handleAgentDragOver}
        onDragLeave={handleAgentDragLeave}
        onDrop={handleAgentDrop}
        onKeyDown={(event) => {
          sortableListeners.onKeyDown?.(event)
          if (event.defaultPrevented) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onSelect(task)
          }
        }}
        aria-label={`Drag or open task ${task.title}`}
        title="Drag to move status, click to inspect"
        className={`group block min-w-0 w-full text-left outline-none ${
          dragDisabled ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <TaskMaterialSurface
          status={task.status}
          materialSurface={{
            ownerId: task.id,
            mode: "static",
            pointerMode: "none",
          }}
          className={`min-w-0 overflow-x-hidden transition-all ${
            selected ? "ring-2 ring-[var(--cinnabar)]/35" : ""
          } ${
            recentlyUpdated ? "ring-2 ring-[var(--moss)]/35" : ""
          } ${
            isAgentOver ? "ring-2 ring-[var(--wash)]/35" : ""
          } ${isDragging ? "sk-hard-shadow ring-2 ring-[var(--wash)]/45" : ""}`}
        >
          <div className="min-w-0 space-y-2 px-3 py-3">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-muted-foreground">
                  {formatChannelName(task.channel, agentName)} #{task.number}
                </div>
                <div className="mt-1 line-clamp-2 text-sm font-medium">{task.title}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1 transition-transform group-hover:translate-x-0.5">
                <StatusPill status={task.status} label={statusLabel(task.status)} />
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap gap-2 text-xs">
              {task.creator && (
                <RuntimeChip tone="info" className="min-h-0 px-1.5 py-0.5">创建 @{task.creator}</RuntimeChip>
              )}
              {task.assignee && (
                <RuntimeChip tone="primary" className="min-h-0 px-1.5 py-0.5">负责 @{task.assignee}</RuntimeChip>
              )}
              <span className="text-muted-foreground">{formatTime(task.updatedAt || task.createdAt)}</span>
            </div>
            {source && (
              <EvidenceSurface kind="source" className="inline-flex max-w-full min-w-0 items-center gap-1 overflow-x-hidden px-2 py-1 text-xs text-muted-foreground">
                <ExternalLink className="size-3" />
                <span className="min-w-0 truncate">
                  {source.channel ? formatChannelName(source.channel, agentName) : (source.type || "来源")}
                </span>
              </EvidenceSurface>
            )}
            {isAgentOver && (
              <InkframeObjectSurface material="wet" className="px-2 py-1 text-xs font-medium text-primary">
                松开以分配 agent
              </InkframeObjectSurface>
            )}
          </div>
        </TaskMaterialSurface>
      </div>
    </div>
  )
}

function TaskStatusColumn({
  status,
  tasks,
  selectedTaskId,
  recentlyUpdatedTaskId,
  overStatus,
  activeDragId,
  dragDisabled,
  onSelect,
  onAssignAgent,
}: {
  status: string
  tasks: Task[]
  selectedTaskId?: string
  recentlyUpdatedTaskId?: string | null
  overStatus: string | null
  activeDragId: string | null
  dragDisabled: boolean
  onSelect: (task: Task) => void
  onAssignAgent?: (task: Task, agent: AgentDragPayload) => void
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: status,
    disabled: dragDisabled,
    data: { type: "status", status },
  })
  const isDropTarget = (overStatus === status || isOver) && activeDragId !== null

  return (
    <section
      ref={setNodeRef}
      data-status={status}
      className={`sk-task-status-column min-w-0 overflow-x-hidden p-1.5 transition-all ${
        isDropTarget
          ? "sk-task-status-column-active sk-hard-shadow-sm ring-2 ring-[var(--wash)]/20"
          : ""
      }`}
    >
      <div className={`mb-1.5 flex items-center justify-between gap-2 rounded-none px-1 py-0.5 ${
        isDropTarget ? "bg-primary/10 text-primary" : ""
      }`}>
        <span className="text-xs font-medium">{statusLabel(status)}</span>
        <span className="text-[0.65rem] text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="min-h-[72px] min-w-0 space-y-1.5 overflow-x-hidden">
        <SortableContext
          items={tasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {tasks.map((task) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              selected={selectedTaskId === task.id}
              recentlyUpdated={recentlyUpdatedTaskId === task.id}
              onSelect={onSelect}
              onAssignAgent={onAssignAgent}
              dragDisabled={dragDisabled}
            />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <InkframeObjectSurface material="dry" className="py-4 text-center text-[0.65rem] text-muted-foreground">
            {isDropTarget ? "松开以放置" : "空"}
          </InkframeObjectSurface>
        )}
      </div>
    </section>
  )
}

function ListRow({
  task,
  selected,
  onSelect,
}: {
  task: Task
  selected: boolean
  onSelect: (task: Task) => void
}) {
  const agentName = task.assigneeMember?.displayName ?? task.assignee ?? undefined
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(task)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect(task)
        }
      }}
      className="block min-w-0 w-full text-left text-sm"
    >
      <TaskMaterialSurface
        status={task.status}
        materialSurface={{
          ownerId: task.id,
          mode: "static",
          pointerMode: "none",
        }}
        className={`grid min-w-0 grid-cols-1 gap-2 overflow-x-hidden px-3 py-3 md:grid-cols-[auto_1fr_auto_auto] md:items-center ${selected ? "ring-2 ring-[var(--cinnabar)]/35" : ""}`}
      >
        <div className="font-mono text-xs text-muted-foreground">{formatChannelName(task.channel, agentName)} #{task.number}</div>
        <div className="min-w-0">
          <div className="truncate font-medium">{task.title}</div>
          <div className="mt-1 flex flex-wrap gap-2 text-xs">
            {task.creator && (
              <RuntimeChip tone="info" className="min-h-0 px-1.5 py-0.5">创建 @{task.creator}</RuntimeChip>
            )}
            {task.assignee && (
              <RuntimeChip tone="primary" className="min-h-0 px-1.5 py-0.5">负责 @{task.assignee}</RuntimeChip>
            )}
            <span className="text-muted-foreground">更新 {formatTime(task.updatedAt || task.createdAt)}</span>
          </div>
        </div>
        <StatusPill status={task.status} label={statusLabel(task.status)} />
      </TaskMaterialSurface>
    </div>
  )
}

function EvidenceEntryRow({ entry }: { entry: EvidenceEntry }) {
  const icon = (() => {
    switch (entry.type) {
      case "screenshot": return <Camera className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      case "trace": return <FileText className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      case "api_proof": return <Database className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      case "reviewer_decision": return <Shield className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      default: return <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
    }
  })()
  const label = (() => {
    switch (entry.type) {
      case "screenshot": return "Screenshot"
      case "trace": return "Trace"
      case "api_proof": return "API/DB proof"
      case "reviewer_decision": return "Review decision"
      case "review_note": return "Review note"
      default: return "Note"
    }
  })()
  return (
    <EvidenceSurface kind={entry.type} className="flex items-start gap-2 px-2.5 py-2">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{label}</span>
          {entry.timestamp && <span className="text-[0.65rem] text-muted-foreground">{formatTime(entry.timestamp)}</span>}
        </div>
        {entry.path && <div className="mt-1 truncate font-mono text-xs text-primary">{entry.path}</div>}
        {entry.content && <p className="mt-1 text-xs text-muted-foreground line-clamp-3">{entry.content}</p>}
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
      </div>
    </EvidenceSurface>
  )
}

function memoryOutputDirectionLabel(direction: MemoryOutputDirection) {
  switch (direction) {
    case "final_summary":
      return "最终总结"
    case "evidence":
      return "证据"
    case "artifacts":
      return "产物"
    case "next_steps":
      return "后续步骤"
    case "channel_memory":
      return "频道提案"
  }
}

function TaskMemoryRequestInline({ task, sessionToken }: { task: Task; sessionToken?: string | null }) {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const hasAgentAssignee = Boolean(task.assignee || task.assigneeMember)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!hasAgentAssignee || status === "sending") return
    const form = event.currentTarget
    const formData = new FormData(form)
    const outputDirections = formData.getAll("outputDirection").map((item) => String(item))
    setStatus("sending")
    setError(null)
    try {
      await apiPost(
        `/api/v1/tasks/${encodeURIComponent(task.id)}/memory/request`,
        {
          instruction: String(formData.get("memoryInstruction") || "").trim() || null,
          outputDirections,
        },
        sessionToken,
      )
      setStatus("sent")
      form.reset()
    } catch (err) {
      setStatus("error")
      setError(err instanceof Error ? err.message : "发送失败")
    }
  }

  return (
    <InkframeObjectSurface material="dry" className="p-2.5">
    <form onSubmit={handleSubmit}>
      <div className="flex items-start gap-2">
        <Bell className="mt-0.5 size-3.5 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">提醒产出记忆</div>
          <p className="mt-0.5 text-[0.7rem] leading-4 text-muted-foreground">
            给负责人发送一次性提醒，让它用 slock task summary 产出结果。
          </p>
        </div>
      </div>
      <Textarea
        name="memoryInstruction"
        placeholder="补充要求，例如测试证据、剩余风险"
        rows={3}
        className="mt-2 resize-none text-xs"
        disabled={!hasAgentAssignee || status === "sending"}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {MEMORY_OUTPUT_DIRECTIONS.map((direction) => (
          <ObjectToggleField key={direction} className="cursor-pointer px-0 py-0 text-[0.68rem]">
            <input
              type="checkbox"
              name="outputDirection"
              value={direction}
              defaultChecked={direction === "final_summary" || direction === "evidence"}
              className="peer sr-only"
              disabled={!hasAgentAssignee || status === "sending"}
            />
            <span className="inline-flex px-2 py-1 text-muted-foreground peer-checked:text-primary">
              {memoryOutputDirectionLabel(direction)}
            </span>
          </ObjectToggleField>
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[0.68rem] text-muted-foreground">
          {!hasAgentAssignee ? "先分配智能体" : status === "sent" ? "已发送" : error}
        </span>
        <Button type="submit" size="sm" variant="outline" className="h-7 text-xs" disabled={!hasAgentAssignee || status === "sending"}>
          {status === "sending" ? "发送中" : "发送提醒"}
        </Button>
      </div>
    </form>
    </InkframeObjectSurface>
  )
}

function TaskMemoryInline({ taskId, sessionToken }: { taskId: string; sessionToken?: string | null }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [loadingTaskId, setLoadingTaskId] = useState(taskId)

  const refreshMemory = useCallback(async () => {
    const data = await apiGet<{ entries: MemoryEntry[] }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/memory`,
      { entries: [] },
      sessionToken,
    )
    setEntries(data.entries || [])
    setLoadingTaskId("")
  }, [taskId, sessionToken])

  useEffect(() => {
    let cancelled = false
    void apiGet<{ entries: MemoryEntry[] }>(
      `/api/v1/tasks/${encodeURIComponent(taskId)}/memory`,
      { entries: [] },
      sessionToken,
    ).then((data) => {
      if (!cancelled) {
        setEntries(data.entries || [])
        setLoadingTaskId("")
      }
    })
    return () => {
      cancelled = true
    }
  }, [taskId, sessionToken])

  useRealtimeSubscription(({ event }) => {
    if (!event.type.startsWith("memory.")) return
    const payloadTaskId = typeof event.payload.taskId === "string" ? event.payload.taskId : null
    if (event.scope.id !== taskId && payloadTaskId !== taskId) return
    void refreshMemory()
  })

  const loading = loadingTaskId === taskId

  if (loading) {
    return (
      <InkframeObjectSurface material="drying" className="p-2.5">
        <h4 className="text-xs font-medium">任务记忆</h4>
        <p className="mt-1.5 text-xs text-muted-foreground">Loading memory...</p>
      </InkframeObjectSurface>
    )
  }

  return (
    <TaskRecoveryCockpit entries={entries} compact />
  )
}

function TaskDetailInline({ task, activity, sessionToken }: { task: Task; activity: ActivityItem[]; sessionToken?: string | null }) {
  const source = task.data?.source
  const evidence = task.data?.evidence
  const entries = evidence?.entries ?? []
  const agentName = task.assigneeMember?.displayName ?? task.assignee ?? undefined
  return (
    <div data-slot="task-detail-inline" className="min-w-0 space-y-3 overflow-x-hidden">
      <div>
        <div className="font-mono text-xs text-muted-foreground">{formatChannelName(task.channel, agentName)} #{task.number}</div>
        <h3 className="mt-1 text-sm font-semibold">{task.title}</h3>
        {task.description && <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>}
      </div>
      <div className="grid gap-1.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">状态</span>
          <StatusPill status={task.status} label={statusLabel(task.status)} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">负责人</span>
          <span className="font-medium text-paper-ink">{task.assignee ? `@${task.assignee}` : "未指派"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">创建者</span>
          <span className="font-medium text-paper-ink">{task.creator ? `@${task.creator}` : "未知"}</span>
        </div>
      </div>
      {source && (
        <EvidenceSurface kind="source" className="px-2.5 py-2">
          <h4 className="text-xs font-medium">来源</h4>
          <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
            <div>类型: {source.type || "message"}</div>
            {source.messageId && <div>消息: {source.messageShortId || source.messageId.slice(0, 8)}</div>}
          </div>
        </EvidenceSurface>
      )}
      {(entries.length > 0 || (evidence?.notes?.length ?? 0) > 0) && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-medium">证据</h4>
          <div className="mt-1.5 space-y-1.5">
            {(evidence?.notes || []).map((note) => (
              <EvidenceSurface key={note} kind="note" className="px-2 py-1 text-xs">{note}</EvidenceSurface>
            ))}
            {entries.map((entry, i) => (
              <EvidenceEntryRow key={`${entry.type}-${entry.timestamp}-${i}`} entry={entry} />
            ))}
          </div>
        </div>
      )}
      {activity.length > 0 && (
        <EvidenceSurface kind="activity" className="px-2.5 py-2">
          <h4 className="text-xs font-medium">活动</h4>
          <div className="mt-1.5 space-y-1.5">
            {activity.map((item) => (
              <div key={item.id} className="text-xs">
                <span className="font-medium">{item.type}</span>
                {item.agentName && <span className="text-muted-foreground"> @{item.agentName}</span>}
                <p className="text-muted-foreground line-clamp-2">{item.description}</p>
              </div>
            ))}
          </div>
        </EvidenceSurface>
      )}
      <TaskMemoryRequestInline task={task} sessionToken={sessionToken} />
      <TaskMemoryInline taskId={task.id} sessionToken={sessionToken} />
    </div>
  )
}

export type TaskBoardProps = {
  /** If set, only show tasks matching this channel name */
  channelName?: string
  /** Pre-loaded tasks (skip fetch). If omitted, fetches from /api/v1/tasks */
  tasks?: Task[]
  /** Initial view mode */
  initialView?: "board" | "list"
  /** Show Board/List toggle */
  showViewToggle?: boolean
  /** Show task detail panel when a task is selected */
  showDetail?: boolean
  /** Compact mode (smaller cards, for sidebar) */
  compact?: boolean
  /** Disable drag-and-drop */
  dragDisabled?: boolean
  /** Session token for API calls (for PATCH updates) */
  sessionToken?: string | null
  /** Optional initial selected task, used by tests or embedded focused views */
  initialSelectedTaskId?: string | null
  /** Callback when a task is moved (for optimistic updates in parent) */
  onTaskMoved?: (taskId: string, newStatus: string) => void
  /** Controlled owners receive each optimistic/confirmed replacement. */
  onTaskUpdated?: (task: Task) => void
  /** Optional override: clicking a card navigates (e.g. to ?task=) instead of
      toggling local selection. When provided, handleSelect calls this. */
  onSelectTask?: (task: Task) => void
  /** Filters for the uncontrolled embedded fetch mode. */
  taskFilters?: {
    channel?: string
    creator?: string
    assignee?: string
    status?: string
  }
}

export function TaskBoard({
  channelName,
  tasks: preloadedTasks,
  initialView = "board",
  showViewToggle = true,
  showDetail = true,
  compact = false,
  dragDisabled = false,
  sessionToken,
  initialSelectedTaskId,
  onTaskMoved,
  onTaskUpdated,
  onSelectTask,
  taskFilters,
}: TaskBoardProps) {
  const controlled = preloadedTasks !== undefined
  const [localView, setLocalView] = useState<"board" | "list">(initialView)
  const [localTasks, setLocalTasks] = useState<Task[]>(preloadedTasks ?? [])
  const [localLoading, setLocalLoading] = useState(!controlled)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialSelectedTaskId ?? null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [dragError, setDragError] = useState<string | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<string | null>(null)
  const [recentlyUpdatedTaskId, setRecentlyUpdatedTaskId] = useState<string | null>(null)
  const taskRefreshTimerRef = useRef<number | null>(null)
  const tasks = controlled ? preloadedTasks : localTasks
  const loading = controlled ? false : localLoading
  const view = showViewToggle ? localView : initialView
  const selectedTask = selectedTaskId
    ? tasks.find((task) => task.id === selectedTaskId) ?? null
    : null

  const refreshTasks = useCallback(async () => {
    if (controlled) return
    setLocalLoading(true)
    try {
      const fetchedTasks = await fetchAllTaskPages<Task>((path) => (
        apiGet<TaskCursorPage<Task>>(path, { tasks: [], nextCursor: null })
      ))
      const filtered = fetchedTasks.filter((task) => {
        if (channelName && task.channel !== channelName) return false
        if (taskFilters?.channel && task.channel !== taskFilters.channel) return false
        if (taskFilters?.creator && task.creator !== taskFilters.creator) return false
        if (taskFilters?.assignee && task.assignee !== taskFilters.assignee) return false
        if (taskFilters?.status && task.status !== taskFilters.status) return false
        return true
      })
      setLocalTasks(filtered)
    } finally {
      setLocalLoading(false)
    }
  }, [channelName, controlled, taskFilters])

  useEffect(() => {
    if (controlled) return
    const timer = window.setTimeout(() => {
      void refreshTasks()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [controlled, refreshTasks])

  useEffect(() => {
    if (controlled) return
    const scheduleRefresh = () => {
      if (taskRefreshTimerRef.current) window.clearTimeout(taskRefreshTimerRef.current)
      taskRefreshTimerRef.current = window.setTimeout(() => {
        void refreshTasks()
        taskRefreshTimerRef.current = null
      }, 150)
    }
    window.addEventListener(TASK_DATA_INVALIDATED_EVENT, scheduleRefresh)
    return () => {
      window.removeEventListener(TASK_DATA_INVALIDATED_EVENT, scheduleRefresh)
      if (taskRefreshTimerRef.current) window.clearTimeout(taskRefreshTimerRef.current)
    }
  }, [controlled, refreshTasks])

  // Load activity when task selected
  useEffect(() => {
    if (!showDetail || !selectedTask) return
    let cancelled = false
    void apiGet<{ activity: ActivityItem[] }>(
      `/api/v1/activity?taskId=${encodeURIComponent(selectedTask.id)}&limit=10`,
      { activity: [] },
    ).then((data) => {
      if (!cancelled) setActivity(data.activity || [])
    })
    return () => { cancelled = true }
  }, [selectedTask, showDetail])

  const handleSelect = useCallback((task: Task) => {
    if (onSelectTask) {
      onSelectTask(task)
      return
    }
    setSelectedTaskId((current) => (current === task.id ? null : task.id))
  }, [onSelectTask])

  const updateLocalTask = useCallback((taskId: string, updater: (task: Task) => Task) => {
    if (controlled) {
      const current = tasks.find((task) => task.id === taskId)
      if (current) onTaskUpdated?.(updater(current))
      return
    }
    setLocalTasks((currentTasks) => currentTasks.map((task) => (
      task.id === taskId ? updater(task) : task
    )))
  }, [controlled, onTaskUpdated, tasks])

  const flashTask = useCallback((taskId: string) => {
    setRecentlyUpdatedTaskId(taskId)
    window.setTimeout(() => {
      setRecentlyUpdatedTaskId((current) => (current === taskId ? null : current))
    }, 1400)
  }, [])

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(event.active.id as string)
    setDragError(null)
  }, [])

  const statusForOver = useCallback((overId?: string) => {
    if (!overId) return null
    if (TASK_STATUSES.includes(overId)) return overId
    const overTask = tasks.find((task) => task.id === overId)
    return overTask?.status ?? null
  }, [tasks])

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id as string | undefined
    setOverStatus(statusForOver(overId))
  }, [statusForOver])

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    setActiveDragId(null)
    setOverStatus(null)

    if (!over) return
    const taskId = active.id as string
    const newStatus = statusForOver(over.id as string | undefined)
    if (!newStatus) return

    const task = tasks.find((t) => t.id === taskId)
    if (!task || task.status === newStatus) return

    const oldStatus = task.status

    updateLocalTask(taskId, (current) => ({ ...current, status: newStatus }))
    onTaskMoved?.(taskId, newStatus)

    try {
      await apiPatch(`/api/v1/tasks/${taskId}`, { status: newStatus }, sessionToken)
      flashTask(taskId)
    } catch (error) {
      updateLocalTask(taskId, (current) => ({ ...current, status: oldStatus }))
      onTaskMoved?.(taskId, oldStatus)
      const message = error instanceof Error ? error.message : "Update failed"
      setDragError(message)
      window.setTimeout(() => setDragError(null), 4000)
    }
  }, [tasks, sessionToken, onTaskMoved, statusForOver, updateLocalTask, flashTask])

  const handleAssignAgent = useCallback(async (task: Task, agent: AgentDragPayload) => {
    const assignee = agent.handle ?? agent.displayName ?? agent.name
    const optimisticAssignee = assignee.replace(/^@/, "")
    const previousTask = task
    updateLocalTask(task.id, (current) => ({
      ...current,
      assignee: optimisticAssignee,
      assigneeMember: {
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName ?? optimisticAssignee,
        handle: agent.handle,
        kind: agent.kind,
        status: agent.status,
      },
    }))
    setDragError(null)

    try {
      const result = await apiPatch<{ task?: Task }>(`/api/v1/tasks/${task.id}`, { assignee }, sessionToken)
      const updatedTask = result.task
      if (updatedTask) {
        updateLocalTask(task.id, () => updatedTask)
      }
      flashTask(task.id)
    } catch (error) {
      updateLocalTask(task.id, () => previousTask)
      const message = error instanceof Error ? error.message : "Assign failed"
      setDragError(message)
      window.setTimeout(() => setDragError(null), 4000)
    }
  }, [sessionToken, updateLocalTask, flashTask])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  if (loading) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Loading tasks...</p>
  }

  if (tasks.length === 0) {
    return (
      <EmptyState
        title="暂无任务"
        description={channelName ? `此频道还没有任务。` : "没有找到任务。"}
      />
    )
  }

  const boardContent = (
    <div className={`grid min-w-0 grid-cols-1 gap-2 overflow-x-hidden ${compact ? "" : "sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5"}`}>
      {TASK_STATUSES.map((status) => {
        const columnTasks = tasks.filter((t) => t.status === status)
        return (
          <TaskStatusColumn
            key={status}
            status={status}
            tasks={columnTasks}
            selectedTaskId={selectedTask?.id}
            recentlyUpdatedTaskId={recentlyUpdatedTaskId}
            overStatus={overStatus}
            activeDragId={activeDragId}
            dragDisabled={dragDisabled || view !== "board"}
            onSelect={handleSelect}
            onAssignAgent={handleAssignAgent}
          />
        )
      })}
    </div>
  )
  const activeTask = activeDragId ? tasks.find((task) => task.id === activeDragId) : null

  return (
    <div data-slot="task-board-root" className="min-w-0 space-y-3 overflow-x-hidden">
      {dragError && (
        <div className="rounded-none border-2 border-[var(--ink)] sk-cat-danger px-3 py-2 text-xs">
          {dragError}
        </div>
      )}
      {showViewToggle && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{tasks.length} task{tasks.length === 1 ? "" : "s"}</span>
          <div className="flex gap-1">
            <Button variant={view === "board" ? "default" : "outline"} size="sm" onClick={() => setLocalView("board")}>
              <Columns3 className="size-3.5" />
              Board
            </Button>
            <Button variant={view === "list" ? "default" : "outline"} size="sm" onClick={() => setLocalView("list")}>
              <ListChecks className="size-3.5" />
              List
            </Button>
          </div>
        </div>
      )}

      {view === "board" && !dragDisabled ? (
        <DndContext
          id={TASK_BOARD_DND_CONTEXT_ID}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {boardContent}
          <DragOverlay>
            {activeTask ? (
              <div className="max-w-full min-w-0 overflow-x-hidden opacity-95">
                <TaskMaterialSurface
                  status={activeTask.status}
                  materialSurface={{
                    ownerId: activeTask.id,
                    mode: "static",
                    pointerMode: "none",
                  }}
                  className="sk-hard-shadow min-w-0 overflow-x-hidden px-3 py-3 ring-2 ring-[var(--wash)]/20"
                >
                  <div className="space-y-2">
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-muted-foreground">
                          {formatChannelName(activeTask.channel, activeTask.assigneeMember?.displayName ?? activeTask.assignee ?? undefined)} #{activeTask.number}
                        </div>
                        <div className="mt-1 line-clamp-2 text-sm font-medium">{activeTask.title}</div>
                      </div>
                      <StatusPill status={activeTask.status} label={statusLabel(activeTask.status)} />
                    </div>
                    <div className="text-xs text-muted-foreground">移动到目标状态列</div>
                  </div>
                </TaskMaterialSurface>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : view === "board" ? (
        boardContent
      ) : (
        <InkframeObjectSurface material="dry" className="overflow-hidden p-0">
          {tasks.map((task) => (
            <ListRow
              key={task.id}
              task={task}
              selected={selectedTask?.id === task.id}
              onSelect={handleSelect}
            />
          ))}
        </InkframeObjectSurface>
      )}

      {showDetail && selectedTask && (
        <TaskMaterialSurface
          status={selectedTask.status}
          materialSurface={{
            ownerId: selectedTask.id,
            mode: "static",
            pointerMode: "none",
          }}
          className="p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">任务详情</h3>
            <button
              type="button"
              onClick={() => setSelectedTaskId(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              关闭
            </button>
          </div>
          <TaskDetailInline task={selectedTask} activity={activity} sessionToken={sessionToken} />
        </TaskMaterialSurface>
      )}
    </div>
  )
}
