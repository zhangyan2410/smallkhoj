"use client"

import { useCallback, useEffect, useState } from "react"
import {
  ClipboardList,
  Cpu,
  MessageSquare,
  Terminal,
} from "lucide-react"

import { EmptyState } from "@/components/product-ui"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ActivityEventCard, type ActivityItem } from "@/components/agent-activity-list"
import { apiGet, badgeClass, dotClass, findMemberWorkspace, formatTime, statusLabel, shortId, type Member, type Computer, type AgentWorkspace } from "@/lib/control-plane"

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
            className={`inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] px-2 py-0.5 text-xs font-medium ${
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
  const workspace = findMemberWorkspace(member, computers)
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
    ["workspace_registered", "workspace_updated", "workspace_heartbeat", "runtime_working", "runtime_thinking", "runtime_output", "runtime_idle"].includes(a.type)
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
          <div className="rounded-none border-2 border-[var(--ink)] bg-sand-card p-3">
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
                <div className="flex items-center gap-1.5 text-xs font-medium text-accent-blue">
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
                <div className="flex items-center gap-1.5 text-xs font-medium text-accent-rose">
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
                <div className="flex items-center gap-1.5 text-xs font-medium text-accent-mint">
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
    </div>
  )
}
