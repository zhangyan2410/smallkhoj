"use client"

import { type DragEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react"
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
  Camera,
  Columns3,
  Database,
  ExternalLink,
  FileText,
  ListChecks,
  MessageSquare,
  Shield,
} from "lucide-react"

import { EmptyState, StatusPill } from "@/components/product-ui"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { apiGet, apiHeaders, apiPatch, badgeClass, formatTime, statusLabel, type Member } from "@/lib/control-plane"
import { AGENT_DRAG_MIME, parseAgentDragPayload, type AgentDragPayload } from "@/lib/drag-data"
import { applyHighWater, connectRealtimeEvents, type HighWater } from "@/lib/realtime-events"

const TASK_STATUSES = ["todo", "in_progress", "in_review", "done", "closed"]

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

export type Task = {
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
  assigneeName?: string | null
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

function StatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} label={statusLabel(status)} className={badgeClass(status)} />
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
    <div ref={setNodeRef} style={style} className="relative">
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
        className={`group block w-full text-left outline-none ${
          dragDisabled ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <Card
          size="sm"
          className={`transition-all ${
            selected ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20" : ""
          } ${
            recentlyUpdated ? "border-emerald-300 bg-emerald-50 ring-1 ring-emerald-200" : ""
          } ${
            isAgentOver ? "border-purple-400 bg-purple-50 ring-2 ring-purple-200" : ""
          } ${
            dragDisabled
              ? "hover:border-primary/40 hover:bg-primary/5"
              : "hover:border-primary/60 hover:bg-primary/5 hover:shadow-sm hover:ring-1 hover:ring-primary/15"
          } ${isDragging ? "border-primary/70 bg-primary/10 shadow-lg ring-2 ring-primary/30" : ""}`}
        >
          <CardContent className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-muted-foreground">
                  {formatChannelName(task.channel, agentName)} #{task.number}
                </div>
                <div className="mt-1 line-clamp-2 text-sm font-medium">{task.title}</div>
              </div>
              <div className="flex items-center gap-1 transition-transform group-hover:translate-x-0.5">
                <StatusBadge status={task.status} />
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              {task.creator && (
                <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">创建 @{task.creator}</span>
              )}
              {task.assignee && (
                <span className="rounded bg-purple-50 px-1.5 py-0.5 font-medium text-purple-700">负责 @{task.assignee}</span>
              )}
              <span className="text-muted-foreground">{formatTime(task.updatedAt || task.createdAt)}</span>
            </div>
            {source && (
              <div className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
                <ExternalLink className="size-3" />
                {source.channel ? formatChannelName(source.channel, agentName) : (source.type || "来源")}
              </div>
            )}
            {isAgentOver && (
              <div className="rounded-md border border-purple-200 bg-purple-100 px-2 py-1 text-xs font-medium text-purple-700">
                松开以分配 agent
              </div>
            )}
          </CardContent>
        </Card>
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
      className={`min-w-0 rounded-md border p-1.5 transition-all ${
        isDropTarget
          ? "border-primary/60 bg-primary/10 shadow-sm ring-2 ring-primary/15"
          : "bg-muted/20"
      }`}
    >
      <div className={`mb-1.5 flex items-center justify-between gap-2 rounded px-1 py-0.5 ${
        isDropTarget ? "bg-primary/10 text-primary" : ""
      }`}>
        <span className="text-xs font-medium">{statusLabel(status)}</span>
        <span className="text-[0.65rem] text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="min-h-[72px] space-y-1.5">
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
          <div className="rounded-md border border-dashed py-4 text-center text-[0.65rem] text-muted-foreground">
            {isDropTarget ? "松开以放置" : "空"}
          </div>
        )}
      </div>
    </section>
  )
}

function ListRow({ task, selected, onSelect }: { task: Task; selected: boolean; onSelect: (task: Task) => void }) {
  const agentName = task.assigneeMember?.displayName ?? task.assignee ?? undefined
  return (
    <button
      type="button"
      onClick={() => onSelect(task)}
      className={`grid w-full gap-2 border-b px-3 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40 md:grid-cols-[auto_1fr_auto] md:items-center ${selected ? "bg-primary/5" : ""}`}
    >
      <div className="font-mono text-xs text-muted-foreground">{formatChannelName(task.channel, agentName)} #{task.number}</div>
      <div className="min-w-0">
        <div className="truncate font-medium">{task.title}</div>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          {task.creator && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 font-medium text-blue-700">创建 @{task.creator}</span>
          )}
          {task.assignee && (
            <span className="rounded bg-purple-50 px-1.5 py-0.5 font-medium text-purple-700">负责 @{task.assignee}</span>
          )}
          <span className="text-muted-foreground">更新 {formatTime(task.updatedAt || task.createdAt)}</span>
        </div>
      </div>
      <StatusBadge status={task.status} />
    </button>
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
    <div className="flex items-start gap-2 rounded-md border bg-background px-2.5 py-2">
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
        {entry.note && <p className="mt-1 text-xs text-muted-foreground">{entry.note}</p>}
      </div>
    </div>
  )
}

function TaskDetailInline({ task, activity }: { task: Task; activity: ActivityItem[] }) {
  const source = task.data?.source
  const evidence = task.data?.evidence
  const entries = evidence?.entries ?? []
  const agentName = task.assigneeMember?.displayName ?? task.assignee ?? undefined
  return (
    <div className="space-y-3">
      <div>
        <div className="font-mono text-xs text-muted-foreground">{formatChannelName(task.channel, agentName)} #{task.number}</div>
        <h3 className="mt-1 text-sm font-semibold">{task.title}</h3>
        {task.description && <p className="mt-1 text-xs text-muted-foreground">{task.description}</p>}
      </div>
      <div className="grid gap-1.5 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">状态</span>
          <StatusBadge status={task.status} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">负责人</span>
          <span className="font-medium text-purple-700">{task.assignee ? `@${task.assignee}` : "未指派"}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">创建者</span>
          <span className="font-medium text-blue-700">{task.creator ? `@${task.creator}` : "未知"}</span>
        </div>
      </div>
      {source && (
        <div className="rounded-md border bg-background p-2.5">
          <h4 className="text-xs font-medium">来源</h4>
          <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
            <div>类型: {source.type || "message"}</div>
            {source.messageId && <div>消息: {source.messageShortId || source.messageId.slice(0, 8)}</div>}
          </div>
        </div>
      )}
      {(entries.length > 0 || (evidence?.notes?.length ?? 0) > 0) && (
        <div className="rounded-md border bg-background p-2.5">
          <h4 className="text-xs font-medium">证据</h4>
          <div className="mt-1.5 space-y-1.5">
            {(evidence?.notes || []).map((note) => (
              <div key={note} className="rounded-md border border-dashed bg-muted/30 px-2 py-1 text-xs">{note}</div>
            ))}
            {entries.map((entry, i) => (
              <EvidenceEntryRow key={`${entry.type}-${entry.timestamp}-${i}`} entry={entry} />
            ))}
          </div>
        </div>
      )}
      {activity.length > 0 && (
        <div className="rounded-md border bg-background p-2.5">
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
        </div>
      )}
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
  /** Callback when a task is moved (for optimistic updates in parent) */
  onTaskMoved?: (taskId: string, newStatus: string) => void
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
  onTaskMoved,
}: TaskBoardProps) {
  const [view, setView] = useState<"board" | "list">(initialView)
  const [tasks, setTasks] = useState<Task[]>(preloadedTasks ?? [])
  const [loading, setLoading] = useState(!preloadedTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [dragError, setDragError] = useState<string | null>(null)
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [overStatus, setOverStatus] = useState<string | null>(null)
  const [recentlyUpdatedTaskId, setRecentlyUpdatedTaskId] = useState<string | null>(null)
  const highWaterRef = useRef(new Map<string, HighWater>())

  const refreshTasks = useCallback(async () => {
    if (preloadedTasks) return
    setLoading(true)
    const data = await apiGet<{ tasks: Task[] }>("/api/v1/tasks", { tasks: [] })
    let filtered = data.tasks || []
    if (channelName) {
      filtered = filtered.filter((t) => t.channel === channelName)
    }
    setTasks(filtered)
    setLoading(false)
  }, [preloadedTasks, channelName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshTasks()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshTasks])

  useEffect(() => {
    if (preloadedTasks) return
    const controller = new AbortController()
    let refreshTimer: number | null = null
    const scheduleRefresh = () => {
      if (refreshTimer) window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(() => {
        void refreshTasks()
        refreshTimer = null
      }, 150)
    }
    const stop = connectRealtimeEvents({
      headers: apiHeaders(),
      signal: controller.signal,
      scope: { kind: "task" },
      onEvent: (event) => {
        if (event.type !== "task.created" && event.type !== "task.updated") return
        const decision = applyHighWater(highWaterRef.current, event)
        if (decision.action === "drop") return
        scheduleRefresh()
      },
      onStatus: (status) => {
        if (status.state === "error") console.warn("[realtime] task stream error", status.error)
      },
    })
    return () => {
      stop()
      controller.abort()
      if (refreshTimer) window.clearTimeout(refreshTimer)
    }
  }, [preloadedTasks, refreshTasks])

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
    setSelectedTask((prev) => (prev?.id === task.id ? null : task))
  }, [])

  const updateLocalTask = useCallback((taskId: string, updater: (task: Task) => Task) => {
    setTasks((prev) => prev.map((task) => (task.id === taskId ? updater(task) : task)))
    setSelectedTask((prev) => (prev?.id === taskId ? updater(prev) : prev))
  }, [])

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
      if (result.task) {
        updateLocalTask(task.id, () => result.task as Task)
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
    <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-5"}`}>
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
    <div className="space-y-3">
      {dragError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {dragError}
        </div>
      )}
      {showViewToggle && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{tasks.length} task{tasks.length === 1 ? "" : "s"}</span>
          <div className="flex gap-1">
            <Button variant={view === "board" ? "default" : "outline"} size="sm" onClick={() => setView("board")}>
              <Columns3 className="size-3.5" />
              Board
            </Button>
            <Button variant={view === "list" ? "default" : "outline"} size="sm" onClick={() => setView("list")}>
              <ListChecks className="size-3.5" />
              List
            </Button>
          </div>
        </div>
      )}

      {view === "board" && !dragDisabled ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          {boardContent}
          <DragOverlay>
            {activeTask ? (
              <div className="rotate-1 opacity-95">
                <Card size="sm" className="border-primary/60 bg-card shadow-xl ring-2 ring-primary/20">
                  <CardContent className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-muted-foreground">
                          {formatChannelName(activeTask.channel, activeTask.assigneeMember?.displayName ?? activeTask.assignee ?? undefined)} #{activeTask.number}
                        </div>
                        <div className="mt-1 line-clamp-2 text-sm font-medium">{activeTask.title}</div>
                      </div>
                      <StatusBadge status={activeTask.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">移动到目标状态列</div>
                  </CardContent>
                </Card>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : view === "board" ? (
        boardContent
      ) : (
        <div className="overflow-hidden rounded-md border bg-card">
          {tasks.map((task) => (
            <ListRow
              key={task.id}
              task={task}
              selected={selectedTask?.id === task.id}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}

      {showDetail && selectedTask && (
        <div className="rounded-md border bg-card p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">任务详情</h3>
            <button
              type="button"
              onClick={() => setSelectedTask(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              关闭
            </button>
          </div>
          <TaskDetailInline task={selectedTask} activity={activity} />
        </div>
      )}
    </div>
  )
}
