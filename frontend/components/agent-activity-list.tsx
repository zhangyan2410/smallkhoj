"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  Bell,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  CirclePause,
  Cpu,
  Hash,
  LoaderCircle,
  MessageCircle,
  MessageSquare,
  Plug,
  Smile,
  Terminal,
  User,
} from "lucide-react"

import { apiGet, formatTime, shortId } from "@/lib/control-plane"

export type ActivityItem = {
  id: string
  serverId: string
  agentId: string
  agentName: string | null
  type: string
  description: string
  details: Record<string, unknown>
  channelId: string | null
  taskId: string | null
  timestamp: string | null
}

const activityIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  message_sent: MessageSquare,
  supervisor_message_sent: MessageSquare,
  task_created: ClipboardList,
  task_claimed: CheckCircle2,
  task_unclaimed: ClipboardList,
  task_status_changed: ClipboardList,
  task_updated: ClipboardList,
  supervisor_task_created: ClipboardList,
  supervisor_task_updated: ClipboardList,
  workspace_registered: Cpu,
  workspace_updated: Cpu,
  workspace_heartbeat: Cpu,
  runtime_working: LoaderCircle,
  runtime_thinking: Brain,
  runtime_output: Terminal,
  runtime_idle: CirclePause,
  message_reaction_added: Smile,
  message_reaction_removed: Smile,
  channel_joined: Hash,
  channel_left: Hash,
  reminder_fired: Bell,
  profile_updated: User,
  integration_connected: Plug,
  thread_followed: MessageCircle,
  thread_unfollowed: MessageCircle,
  error: AlertCircle,
  failed: AlertCircle,
}

const activityTypeLabel: Record<string, string> = {
  message_sent: "Message",
  supervisor_message_sent: "Message",
  task_created: "Task",
  task_claimed: "Task",
  task_unclaimed: "Task",
  task_status_changed: "Task",
  task_updated: "Task",
  supervisor_task_created: "Task",
  supervisor_task_updated: "Task",
  workspace_registered: "Runtime",
  workspace_updated: "Runtime",
  workspace_heartbeat: "Heartbeat",
  runtime_working: "Working",
  runtime_thinking: "Thinking",
  runtime_output: "Output",
  runtime_idle: "Idle",
  message_reaction_added: "Reaction",
  message_reaction_removed: "Reaction",
  channel_joined: "Channel",
  channel_left: "Channel",
  reminder_fired: "Reminder",
  profile_updated: "Profile",
  integration_connected: "Integration",
  thread_followed: "Thread",
  thread_unfollowed: "Thread",
  error: "Error",
  failed: "Error",
}

const labelColorMap: Record<string, string> = {
  Message: "border-sky-200 bg-sky-50 text-sky-700",
  Task: "border-amber-200 bg-amber-50 text-amber-700",
  Runtime: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Heartbeat: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Working: "border-orange-200 bg-orange-50 text-orange-700",
  Thinking: "border-yellow-200 bg-yellow-50 text-yellow-700",
  Output: "border-blue-200 bg-blue-50 text-blue-700",
  Idle: "border-emerald-200 bg-emerald-50 text-emerald-700",
  Reaction: "border-pink-200 bg-pink-50 text-pink-700",
  Channel: "border-violet-200 bg-violet-50 text-violet-700",
  Reminder: "border-orange-200 bg-orange-50 text-orange-700",
  Profile: "border-primary/30 bg-primary/10 text-primary",
  Integration: "border-teal-200 bg-teal-50 text-teal-700",
  Thread: "border-indigo-200 bg-indigo-50 text-indigo-700",
  Error: "border-rose-200 bg-rose-50 text-rose-700",
}

function ActivityIcon({ type }: { type: string }) {
  const Icon = activityIcons[type] ?? Terminal
  return <Icon className="size-3.5" />
}

function ActivityTypeBadge({ type }: { type: string }) {
  const label = activityTypeLabel[type] ?? type
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${labelColorMap[label] ?? "border-border bg-muted text-muted-foreground"}`}>
      <ActivityIcon type={type} />
      {label}
    </span>
  )
}

function ActivityDetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}

export function ActivityEventCard({ item }: { item: ActivityItem }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = Object.keys(item.details).length > 0

  return (
    <div className="rounded-md border bg-background">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left ${hasDetails ? "cursor-pointer hover:bg-accent/50" : "cursor-default"}`}
      >
        {hasDetails ? (
          expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />
        ) : (
          <span className="size-3.5" />
        )}
        <ActivityTypeBadge type={item.type} />
        <span className="flex-1 truncate text-sm">{item.description}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatTime(item.timestamp)}</span>
      </button>
      {/* Inline preview of thought/command — visible without expanding */}
      {(() => {
        const preview =
          typeof item.details.thought === "string" ? item.details.thought :
          typeof item.details.commandPreview === "string" ? item.details.commandPreview : null;
        if (!preview) return null;
        return (
          <div className="px-3 pb-1.5 pl-9">
            <p className="truncate text-xs text-muted-foreground">{preview.replace(/\n/g, " ")}</p>
          </div>
        );
      })()}
      {expanded && hasDetails && (
        <div className="border-t px-3 py-2">
          <div className="space-y-1">
            <ActivityDetailRow label="activityId" value={shortId(item.id)} />
            {item.channelId && <ActivityDetailRow label="channelId" value={shortId(item.channelId)} />}
            {item.taskId && <ActivityDetailRow label="taskId" value={shortId(item.taskId)} />}
            {item.details.status != null && <ActivityDetailRow label="status" value={String(item.details.status)} />}
            {item.details.target != null && <ActivityDetailRow label="target" value={String(item.details.target)} />}
            {item.details.toolName != null && <ActivityDetailRow label="tool" value={String(item.details.toolName)} />}
            {item.details.durationMs != null && <ActivityDetailRow label="durationMs" value={String(item.details.durationMs)} />}
            {item.details.wallClockMs != null && <ActivityDetailRow label="wallClockMs" value={String(item.details.wallClockMs)} />}
            {item.details.usageSource != null && <ActivityDetailRow label="usageSource" value={String(item.details.usageSource)} />}
            {item.details.thought != null && (
              <div className="mt-1">
                <span className="text-[11px] text-muted-foreground">Thought</span>
                <pre className="mt-0.5 max-h-32 overflow-auto rounded bg-muted p-1.5 text-[11px]">
                  {String(item.details.thought)}
                </pre>
              </div>
            )}
            {item.details.commandPreview != null && (
              <div className="mt-1">
                <span className="text-[11px] text-muted-foreground">Command</span>
                <pre className="mt-0.5 max-h-24 overflow-auto rounded bg-muted p-1.5 text-[11px]">
                  {String(item.details.commandPreview)}
                </pre>
              </div>
            )}
            {item.details.tokens != null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">tokens</span>
                <span className="font-mono">
                  {[
                    (item.details.tokens as Record<string, unknown>).input,
                    (item.details.tokens as Record<string, unknown>).output,
                    (item.details.tokens as Record<string, unknown>).cacheRead,
                  ]
                    .map((v, i) => ["in", "out", "cache"][i] + "=" + (v ?? "-"))
                    .join(" ")}
                </span>
              </div>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">raw details</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-2 text-[11px]">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  )
}

export type AgentActivityListProps = {
  agentId: string
  limit?: number
  /** Max number of items to display (queue cap, newest first). Default 25. */
  maxDisplay?: number
  /** Optional filter to restrict to runtime-state activities only (Working/Thinking/Output/Idle) */
  runtimeOnly?: boolean
  /** Show a header with count + refresh button. Default true. */
  showHeader?: boolean
  /** Compact mode: smaller padding, no empty-state illustration. Default false. */
  compact?: boolean
}

// Module-level cache: survives component unmount/remount on tab switch so the
// Activity list reappears instantly instead of flashing "Loading...".
const activityCache = new Map<string, { items: ActivityItem[]; at: number }>()

export function AgentActivityList({
  agentId,
  limit = 50,
  maxDisplay = 25,
  runtimeOnly = false,
  showHeader = true,
  compact = false,
}: AgentActivityListProps) {
  const cacheKey = `${agentId}:${limit}:${runtimeOnly}`
  const [activity, setActivity] = useState<ActivityItem[]>(() => activityCache.get(cacheKey)?.items ?? [])
  const [loading, setLoading] = useState(() => !activityCache.has(cacheKey))

  const refreshActivity = useCallback(async () => {
    // Don't show a loading spinner if we already have cached data — refresh
    // silently in the background.
    if (!activityCache.get(cacheKey)?.items.length) setLoading(true)
    const data = await apiGet<{ activity: ActivityItem[]; count: number }>(
      `/api/v1/activity?agentId=${agentId}&limit=${limit}`,
      { activity: [], count: 0 }
    )
    let items = data.activity
    if (runtimeOnly) {
      items = items.filter((a) =>
        ["runtime_working", "runtime_thinking", "runtime_output", "runtime_idle"].includes(a.type)
      )
    }
    activityCache.set(cacheKey, { items, at: Date.now() })
    setActivity(items)
    setLoading(false)
  }, [agentId, limit, runtimeOnly, cacheKey])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshActivity()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshActivity])

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      {showHeader && (
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">
            Activity
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {Math.min(activity.length, maxDisplay)}{activity.length > maxDisplay ? `/${activity.length}` : ""} {runtimeOnly ? "state change" : "event"}{activity.length === 1 ? "" : "s"}
            </span>
          </h2>
          <button
            onClick={() => void refreshActivity()}
            className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          >
            Refresh
          </button>
        </div>
      )}
      {loading && <p className="py-8 text-center text-sm text-muted-foreground">Loading activity...</p>}
      {!loading && activity.length === 0 && !compact && (
        <div className="rounded-lg border border-dashed py-10 text-center">
          <Cpu className="mx-auto size-7 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No activity yet.</p>
        </div>
      )}
      {!loading && activity.length === 0 && compact && (
        <p className="py-4 text-center text-xs text-muted-foreground">No activity</p>
      )}
      {!loading && activity.length > 0 && (
        <div className="space-y-1.5">
          {activity.slice(0, maxDisplay).map((item) => (
            <ActivityEventCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
