"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  ClipboardList,
  Cpu,
  MessageSquare,
  Terminal,
} from "lucide-react"

import { EmptyState, RuntimeChip, type CategoryTone } from "@/components/product-ui"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ActivityEventCard, type ActivityItem } from "@/components/agent-activity-list"
import { InkframeObjectSurface, ObjectField } from "@/components/inkframe-object-ui"
import { apiGet, dotClass, findMemberWorkspace, formatTime, statusLabel, shortId, type Member, type Computer, type AgentWorkspace } from "@/lib/control-plane"

function lifecycleTone(key: string, active: boolean): CategoryTone {
  if (!active) return "neutral"
  if (key === "failed") return "danger"
  if (key === "stopped") return "warning"
  if (key === "running" || key === "idle") return "success"
  return "info"
}

function RuntimeStateSummary({ member, workspace }: { member: Member; workspace?: AgentWorkspace }) {
  const t = useTranslations("members")
  const lifecycleStates = [
    { key: "pending_start", label: t("lifecycleStarting"), active: workspace?.status === "pending_start" || (!workspace && member.kind === "agent") },
    { key: "starting", label: t("lifecycleInitializing"), active: workspace?.status === "starting" },
    { key: "running", label: t("lifecycleRunning"), active: workspace?.status === "running" },
    { key: "idle", label: t("lifecycleIdle"), active: workspace?.status === "idle" },
    { key: "busy", label: t("lifecycleThinking"), active: workspace?.status === "busy" },
    { key: "stopped", label: t("lifecycleStopped"), active: workspace?.status === "stopped" },
    { key: "failed", label: t("lifecycleFailed"), active: workspace?.status === "failed" || member.status === "failed" },
  ]

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium uppercase text-muted-foreground">{t("runtimeLifecycle")}</div>
      <div className="flex flex-wrap gap-1.5">
        {lifecycleStates.map(({ key, label, active }) => (
          <RuntimeChip
            key={key}
            tone={lifecycleTone(key, active)}
            className={!active ? "opacity-60" : undefined}
          >
            <span className={`size-1.5 rounded-full ${active ? dotClass(key) : "bg-muted-foreground"}`} />
            {label}
          </RuntimeChip>
        ))}
      </div>
    </div>
  )
}

export default function ActivityTab({ member, computers }: { member: Member; computers: Computer[] }) {
  const t = useTranslations("members")
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
            <CardDescription>{t("fieldStatus")}</CardDescription>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className={`size-2 rounded-full ${dotClass(member.status)}`} />
              {statusLabel(member.status)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("fieldSession")}</CardDescription>
            <CardTitle className="font-mono text-base">{workspace?.sessionId ? shortId(workspace.sessionId) : t("valueNone")}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("fieldStarted")}</CardDescription>
            <CardTitle className="text-base">{formatTime(workspace?.startedAt)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {member.kind === "agent" && workspace && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">{t("sessionTimeline")}</div>
          <InkframeObjectSurface material="dry" className="p-3">
            <div className="space-y-2">
              <ObjectField label={t("fieldLaunched")} value={formatTime(workspace.startedAt)} />
              {workspace.stoppedAt && (
                <ObjectField label={t("fieldStopped")} value={formatTime(workspace.stoppedAt)} />
              )}
              <ObjectField label={t("fieldPid")} value={workspace.pid?.toString() ?? t("valueNone")} />
              <ObjectField label={t("fieldProvider")} value={workspace.runtimeProvider ?? t("defaultValue")} />
              <ObjectField label={t("fieldModel")} value={workspace.runtimeModel ?? t("defaultValue")} />
            </div>
          </InkframeObjectSurface>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium uppercase text-muted-foreground">{t("recentActivity")}</div>
          <button
            onClick={refreshActivity}
            className="text-[11px] text-muted-foreground hover:text-foreground"
            disabled={loading}
          >
            {loading ? t("loading") : t("refresh")}
          </button>
        </div>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">{t("loadingActivity")}</div>
        ) : activity.length === 0 ? (
          <EmptyState
            title={t("noActivityRecorded")}
            description={
              member.kind === "agent"
                ? t("noActivityAgentDesc")
                : t("noActivityHumanDesc")
            }
          />
        ) : (
          <div className="space-y-4">
            {messageActivities.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-accent-blue">
                  <MessageSquare className="size-3" />
                  {t("messagesGroup", { count: messageActivities.length })}
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
                  {t("tasksGroup", { count: taskActivities.length })}
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
                  {t("runtimeGroup", { count: runtimeActivities.length })}
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
                  {t("otherGroup", { count: otherActivities.length })}
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
