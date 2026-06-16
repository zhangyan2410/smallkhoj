"use client"

import { useCallback, useEffect, useState } from "react"
import {
  Camera,
  CheckSquare,
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
import { apiGet, badgeClass, formatTime, statusLabel, type Member } from "@/lib/control-plane"

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

/**
 * Format a channel name for display. DM channels look like "dm:{humanId}-{agentId}"
 * — show the agent's display name if available, otherwise fall back to the raw name.
 */
function formatChannelName(channel: string | null | undefined, agentName?: string | null): string {
  if (!channel) return "unknown"
  // DM channel: extract agent identity
  if (channel.startsWith("dm:")) {
    if (agentName) return `DM @${agentName}`
    // Try to extract a short id from the dm:uuid-uuid format
    const parts = channel.slice(3).split("-")
    return parts.length >= 2 ? `DM @${parts[parts.length - 1].slice(0, 4)}` : "DM"
  }
  return channel.startsWith("#") ? channel : `#${channel}`
}

function TaskCard({ task, selected, onSelect }: { task: Task; selected: boolean; onSelect: (task: Task) => void }) {
  const source = task.data?.source
  const agentName = task.assigneeMember?.displayName ?? task.assignee ?? undefined
  return (
    <button
      type="button"
      onClick={() => onSelect(task)}
      className="block w-full text-left"
    >
      <Card size="sm" className={`transition-colors hover:border-primary/40 ${selected ? "border-primary/60 ring-1 ring-primary/20" : ""}`}>
        <CardContent className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-xs text-muted-foreground">
                {formatChannelName(task.channel, agentName)} #{task.number}
              </div>
              <div className="mt-1 line-clamp-2 text-sm font-medium">{task.title}</div>
            </div>
            <StatusBadge status={task.status} />
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
        </CardContent>
      </Card>
    </button>
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
}

export function TaskBoard({
  channelName,
  tasks: preloadedTasks,
  initialView = "board",
  showViewToggle = true,
  showDetail = true,
  compact = false,
}: TaskBoardProps) {
  const [view, setView] = useState<"board" | "list">(initialView)
  const [tasks, setTasks] = useState<Task[]>(preloadedTasks ?? [])
  const [loading, setLoading] = useState(!preloadedTasks)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [activity, setActivity] = useState<ActivityItem[]>([])

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
    void refreshTasks()
  }, [refreshTasks])

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

  return (
    <div className="space-y-3">
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

      {view === "board" ? (
        <div className={`grid gap-2 ${compact ? "grid-cols-1" : "grid-cols-2 md:grid-cols-3 xl:grid-cols-5"}`}>
          {TASK_STATUSES.map((status) => {
            const columnTasks = tasks.filter((t) => t.status === status)
            return (
              <section key={status} className="min-w-0 rounded-md border bg-muted/20 p-1.5">
                <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
                  <span className="text-xs font-medium">{statusLabel(status)}</span>
                  <span className="text-[0.65rem] text-muted-foreground">{columnTasks.length}</span>
                </div>
                <div className="space-y-1.5">
                  {columnTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      selected={selectedTask?.id === task.id}
                      onSelect={handleSelect}
                    />
                  ))}
                  {columnTasks.length === 0 && (
                    <div className="rounded-md border border-dashed py-4 text-center text-[0.65rem] text-muted-foreground">空</div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
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
