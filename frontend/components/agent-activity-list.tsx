"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  AlertCircle,
  AlertTriangle,
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

import { AttachmentSheet, EvidenceSurface, InkframeObjectSurface } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { RuntimeChip } from "@/components/product-ui"
import { apiGet, activityCategoryKind, formatTime, shortId } from "@/lib/control-plane"

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
  runtime_warning: AlertTriangle,
  runtime_error: AlertCircle,
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
  runtime_warning: "Warning",
  runtime_error: "Error",
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

// NOTE: labelColorMap removed — 分类色走单一真源 activityCategoryKind() + sk-cat-* token。

function ActivityIcon({ type }: { type: string }) {
  const Icon = activityIcons[type] ?? Terminal
  return <Icon className="size-3.5" />
}

function ActivityTypeBadge({ type }: { type: string }) {
  const label = activityTypeLabel[type] ?? type
  return (
    <RuntimeChip tone={activityCategoryKind(label)} className="min-h-5 gap-1 px-1.5 py-0.5 text-[11px]">
      <ActivityIcon type={type} />
      {label}
    </RuntimeChip>
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
  const t = useTranslations("chat")
  const [expanded, setExpanded] = useState(false)
  const hasDetails = Object.keys(item.details).length > 0

  return (
    <EvidenceSurface kind="activity">
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
        <div className="border-t-2 border-[var(--ink)] px-3 py-2">
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
                <span className="text-[11px] text-muted-foreground">{t("thought")}</span>
                <AttachmentSheet kind="proof" className="mt-0.5 p-1.5">
                  <pre className="max-h-32 overflow-auto text-[11px]">
                    {String(item.details.thought)}
                  </pre>
                </AttachmentSheet>
              </div>
            )}
            {item.details.commandPreview != null && (
              <div className="mt-1">
                <span className="text-[11px] text-muted-foreground">{t("command")}</span>
                <AttachmentSheet kind="proof" className="mt-0.5 p-1.5">
                  <pre className="max-h-24 overflow-auto text-[11px]">
                    {String(item.details.commandPreview)}
                  </pre>
                </AttachmentSheet>
              </div>
            )}
            {item.details.tokens != null && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t("tokens")}</span>
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
              <summary className="cursor-pointer text-[11px] text-muted-foreground">{t("rawDetails")}</summary>
              <AttachmentSheet kind="proof" className="mt-1 p-2">
                <pre className="max-h-40 overflow-auto text-[11px]">
                  {JSON.stringify(item.details, null, 2)}
                </pre>
              </AttachmentSheet>
            </details>
          </div>
        </div>
      )}
    </EvidenceSurface>
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
  const t = useTranslations("chat")
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
        ["runtime_working", "runtime_thinking", "runtime_output", "runtime_idle", "runtime_warning", "runtime_error"].includes(a.type)
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
            {t("activity")}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">
              {Math.min(activity.length, maxDisplay)}{activity.length > maxDisplay ? `/${activity.length}` : ""} {runtimeOnly ? t("stateChange") : t("eventSingular")}
            </span>
          </h2>
          <Button
            onClick={() => void refreshActivity()}
            variant="outline"
            size="xs"
          >
            {t("refresh")}
          </Button>
        </div>
      )}
      {loading && <p className="py-8 text-center text-sm text-muted-foreground">{t("loadingActivity")}</p>}
      {!loading && activity.length === 0 && !compact && (
        <InkframeObjectSurface material="dry" className="py-10 text-center">
          <Cpu className="mx-auto size-7 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">{t("noActivityYet")}</p>
        </InkframeObjectSurface>
      )}
      {!loading && activity.length === 0 && compact && (
        <p className="py-4 text-center text-xs text-muted-foreground">{t("noActivity")}</p>
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
