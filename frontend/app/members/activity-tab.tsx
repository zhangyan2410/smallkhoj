"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cpu,
  Hash,
  MessageCircle,
  MessageSquare,
  Plug,
  Smile,
  Terminal,
  User,
} from "lucide-react"

import { EmptyState } from "@/components/product-ui"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiGet, badgeClass, dotClass, formatTime, statusLabel, shortId, type Member, type Computer, type AgentWorkspace } from "@/lib/control-plane"

type ActivityItem = {
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

function ActivityIcon({ type }: { type: string }) {
  const Icon = activityIcons[type] ?? Terminal
  return <Icon className="size-3.5" />
}

function ActivityTypeBadge({ type }: { type: string }) {
  const label = activityTypeLabel[type] ?? type
  const colorMap: Record<string, string> = {
    Message: "border-sky-200 bg-sky-50 text-sky-700",
    Task: "border-amber-200 bg-amber-50 text-amber-700",
    Runtime: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Heartbeat: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Reaction: "border-pink-200 bg-pink-50 text-pink-700",
    Channel: "border-violet-200 bg-violet-50 text-violet-700",
    Reminder: "border-orange-200 bg-orange-50 text-orange-700",
    Profile: "border-primary/30 bg-primary/10 text-primary",
    Integration: "border-teal-200 bg-teal-50 text-teal-700",
    Thread: "border-indigo-200 bg-indigo-50 text-indigo-700",
    Error: "border-rose-200 bg-rose-50 text-rose-700",
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${colorMap[label] ?? "border-border bg-muted text-muted-foreground"}`}>
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

function ActivityEventCard({ item }: { item: ActivityItem }) {
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
      {expanded && hasDetails && (
        <div className="border-t px-3 py-2">
          <div className="space-y-1">
            <ActivityDetailRow label="activityId" value={shortId(item.id)} />
            {item.channelId && <ActivityDetailRow label="channelId" value={shortId(item.channelId)} />}
            {item.taskId && <ActivityDetailRow label="taskId" value={shortId(item.taskId)} />}
            {item.details.status != null && <ActivityDetailRow label="status" value={String(item.details.status)} />}
            {item.details.target != null && <ActivityDetailRow label="target" value={String(item.details.target)} />}
            {item.details.content != null && (
              <div className="mt-1">
                <span className="text-[11px] text-muted-foreground">Content preview</span>
                <pre className="mt-0.5 max-h-24 overflow-auto rounded bg-muted p-1.5 text-[11px]">
                  {String(item.details.content).slice(0, 200)}
                  {String(item.details.content).length > 200 ? "..." : ""}
                </pre>
              </div>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] text-muted-foreground">Raw details</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted p-1.5 text-[11px]">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  )
}

function RuntimeStateSummary({ member, workspace }: { member: Member; workspace?: AgentWorkspace }) {
  const lifecycleStates = [
    { key: "pending_start", label: "Starting", active: workspace?.status === "pending_start" || (!workspace && member.kind === "agent") },
    { key: "starting", label: "Initializing", active: workspace?.status === "starting" },
    { key: "running", label: "Running", active: workspace?.status === "running" },
    { key: "idle", label: "Idle", active: workspace?.status === "idle" },
    { key: "busy", label: "Thinking", active: workspace?.status === "busy" },
    { key: "stopped", label: "Stopped", active: workspace?.status === "stopped" },
    { key: "failed", label: "Failed", active: workspace?.status === "failed" || member.status === "failed" },
  ]

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">Runtime Lifecycle</div>
      <div className="flex flex-wrap gap-1.5">
        {lifecycleStates.map(({ key, label, active }) => (
          <span
            key={key}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium ${
              active
                ? badgeClass(key)
                : "border-border bg-muted text-muted-foreground opacity-60"
            }`}
          >
            <span className={`size-1.5 rounded-full ${active ? dotClass(key) : "bg-muted-foreground"}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  )
}

export default function ActivityTab({ member, computers }: { member: Member; computers: Computer[] }) {
  const computer = computers.find((c) => c.id === member.computerId)
  const workspace = computer?.agentWorkspaces.find((w) => w.agentId === member.id)
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [loading, setLoading] = useState(true)

  const refreshActivity = useCallback(async () => {
    setLoading(true)
    const data = await apiGet<{ activity: ActivityItem[]; count: number }>(
      `/api/v1/activity?agentId=${member.id}&limit=20`,
      { activity: [], count: 0 }
    )
    setActivity(data.activity)
    setLoading(false)
  }, [member.id])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshActivity()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshActivity])

  const messageActivities = activity.filter((a) =>
    ["message_sent", "supervisor_message_sent", "message_reaction_added", "message_reaction_removed"].includes(a.type)
  )
  const taskActivities = activity.filter((a) =>
    ["task_created", "task_claimed", "task_unclaimed", "task_status_changed", "task_updated", "supervisor_task_created", "supervisor_task_updated"].includes(a.type)
  )
  const runtimeActivities = activity.filter((a) =>
    ["workspace_registered", "workspace_updated", "workspace_heartbeat"].includes(a.type)
  )
  const otherActivities = activity.filter((a) =>
    ![...messageActivities, ...taskActivities, ...runtimeActivities].some((x) => x.id === a.id)
  )

  return (
    <div className="space-y-5">
      <RuntimeStateSummary member={member} workspace={workspace} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>Status</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className={`size-2 rounded-full ${dotClass(member.status)}`} />
              {statusLabel(member.status)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Session</CardDescription>
            <CardTitle className="font-mono text-base">{workspace?.sessionId ? shortId(workspace.sessionId) : "none"}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>Started</CardDescription>
            <CardTitle className="text-base">{formatTime(workspace?.startedAt)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {member.kind === "agent" && workspace && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">Session Timeline</div>
          <div className="rounded-md border bg-background p-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Launched</span>
                <span className="font-mono text-xs">{formatTime(workspace.startedAt)}</span>
              </div>
              {workspace.stoppedAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Stopped</span>
                  <span className="font-mono text-xs">{formatTime(workspace.stoppedAt)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">PID</span>
                <span className="font-mono text-xs">{workspace.pid ?? "none"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Provider</span>
                <span className="font-mono text-xs">{workspace.runtimeProvider ?? "default"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Model</span>
                <span className="font-mono text-xs">{workspace.runtimeModel ?? "default"}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase text-muted-foreground">Recent Activity</div>
          <button
            onClick={refreshActivity}
            className="text-[11px] text-muted-foreground hover:text-foreground"
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading activity...</div>
        ) : activity.length === 0 ? (
          <EmptyState
            title="No activity recorded"
            description={
              member.kind === "agent"
                ? "Activity events will appear when the agent sends messages, claims tasks, or interacts with the system."
                : "Activity events will appear when this member sends messages or interacts with tasks."
            }
          />
        ) : (
          <div className="space-y-4">
            {messageActivities.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-sky-700">
                  <MessageSquare className="size-3" />
                  Messages ({messageActivities.length})
                </div>
                {messageActivities.map((item) => (
                  <ActivityEventCard key={item.id} item={item} />
                ))}
              </div>
            )}
            {taskActivities.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
                  <ClipboardList className="size-3" />
                  Tasks ({taskActivities.length})
                </div>
                {taskActivities.map((item) => (
                  <ActivityEventCard key={item.id} item={item} />
                ))}
              </div>
            )}
            {runtimeActivities.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <Cpu className="size-3" />
                  Runtime ({runtimeActivities.length})
                </div>
                {runtimeActivities.map((item) => (
                  <ActivityEventCard key={item.id} item={item} />
                ))}
              </div>
            )}
            {otherActivities.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Terminal className="size-3" />
                  Other ({otherActivities.length})
                </div>
                {otherActivities.map((item) => (
                  <ActivityEventCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {member.kind === "agent" && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">Debug & Trace</div>
          <div className="rounded-md border bg-background p-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Trace tool</span>
                <code className="rounded bg-muted px-1 font-mono text-xs">./smallkhoj-trace summary</code>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Agent ID</span>
                <code className="rounded bg-muted px-1 font-mono text-xs">{shortId(member.id)}</code>
              </div>
              {workspace?.sessionId && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Session</span>
                  <code className="rounded bg-muted px-1 font-mono text-xs">{shortId(workspace.sessionId)}</code>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                Run <code className="rounded bg-muted px-1">./smallkhoj-trace summary --json</code> to see runtime events,
                message delivery, and daemon health for this agent.
              </p>
            </div>
          </div>
        </div>
      )}

      {!workspace && member.kind === "agent" && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            No active runtime session. Activity events will appear when the daemon starts a session for this agent.
          </p>
        </div>
      )}

      {member.kind === "human" && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            Human members do not have runtime sessions. Activity is tracked through message and task interactions.
          </p>
        </div>
      )}
    </div>
  )
}
