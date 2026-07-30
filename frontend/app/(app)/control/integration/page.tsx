import Link from "next/link"
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CheckSquare,
  CircleDashed,
  Clock,
  Gauge,
  HardDrive,
  MessageSquare,
  Radio,
  Server,
  ShieldAlert,
  Timer,
  Workflow,
  XCircle,
} from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { EmptyState, RuntimeChip, StatusPill } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  apiGet,
  formatTime,
  runtimeLabel,
  shortId,
  statusLabel,
  type Computer,
  type Member,
  type RuntimeInfo,
} from "@/lib/control-plane"
import { fetchAllTaskPages, type TaskCursorPage } from "@/lib/cursor-pagination"
import { getSessionToken, requireCurrentAccount } from "@/lib/server-auth"
import { cn } from "@/lib/utils"

type TaskRun = {
  id: string
  taskId: string
  assignmentId?: string | null
  agentId: string
  channelId: string
  sourceMessageId?: string | null
  threadRootMessageId?: string | null
  parentRunId?: string | null
  attempt: number
  status: string
  triggerType: string
  runtimeWorkspaceId?: string | null
  computerId?: string | null
  daemonId?: string | null
  runtime?: string | null
  runtimeProvider?: string | null
  runtimeModel?: string | null
  promptProfile?: string | null
  workspaceSessionId?: string | null
  runtimeSessionId?: string | null
  contextSessionId?: string | null
  cwd?: string | null
  contextScope?: string | null
  contextSummary?: Record<string, unknown>
  contextUsage?: Record<string, unknown>
  tokenUsage?: Record<string, unknown>
  toolUsageSummary?: Record<string, unknown>
  usageSummary?: {
    inputTokens?: number | null
    outputTokens?: number | null
    cacheReadInputTokens?: number | null
    totalTokens?: number | null
    durationMs?: number | null
    durationApiMs?: number | null
    numTurns?: number | null
    totalCostUsd?: number | null
    toolCalls?: number | null
    toolResults?: number | null
    contextKnownTokens?: number | null
    contextWindow?: number | null
    contextSource?: string | null
    contextOccupancyRatio?: number | null
    contextOverThreshold?: boolean | null
  }
  outputMessageId?: string | null
  failureCode?: string | null
  failureReason?: string | null
  progressState?: string | null
  progressLabel?: string | null
  evidenceIssues?: string[]
  runtimePendingMs?: number | null
  lastUpdateAgeMs?: number | null
  staleAfterMs?: number | null
  stale?: boolean | null
  startedAt?: string | null
  completedAt?: string | null
  createdAt?: string | null
  updatedAt?: string | null
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
  assigneeId?: string | null
  runs?: TaskRun[]
  createdAt?: string | null
  updatedAt?: string | null
}

type ActivityItem = {
  id: string
  agentName?: string | null
  type: string
  description: string
  timestamp?: string | null
  details?: Record<string, unknown>
}

type RunWithTask = TaskRun & {
  task: Task
}

type GateState = "pass" | "warn" | "fail" | "idle"

type Gate = {
  title: string
  state: GateState
  summary: string
  detail: string
}

async function getIntegrationData(sessionToken?: string | null, activeServerId?: string | null) {
  const [tasks, computersData, membersData, activityData] = await Promise.all([
    fetchAllTaskPages<Task>((path) => (
      apiGet<TaskCursorPage<Task>>(path, { tasks: [], nextCursor: null }, sessionToken, activeServerId)
    )),
    apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] }, sessionToken, activeServerId),
    apiGet<{ members: Member[] }>("/api/v1/members", { members: [] }, sessionToken, activeServerId),
    apiGet<{ activity: ActivityItem[]; count?: number }>("/api/v1/activity?limit=40", { activity: [] }, sessionToken, activeServerId),
  ])

  return {
    tasks,
    computers: computersData.computers,
    members: membersData.members,
    activity: activityData.activity,
  }
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function percent(value: unknown) {
  const ratio = asNumber(value)
  if (ratio === undefined) return null
  return `${Math.round(ratio * 100)}%`
}

function compactNumber(value: unknown) {
  const n = asNumber(value)
  if (n === undefined) return null
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return `${n}`
}

function issueLabel(code: string) {
  const labels: Record<string, string> = {
    TASK_RUN_MISSING: "缺少执行记录",
    TASK_RUN_TARGET_MISMATCH: "执行目标不匹配",
    TASK_RUN_WORKSPACE_MISSING: "缺少工作区",
    TASK_RUN_RUNTIME_NOT_READY: "runtime 未就绪",
    TASK_RUN_CONTEXT_USAGE_MISSING: "缺少上下文统计",
    TASK_RUN_CONTEXT_WINDOW_MISSING: "缺少上下文窗口",
    TASK_RUN_OUTPUT_MISSING: "缺少输出证据",
    TASK_RUN_TOKEN_USAGE_MISSING: "缺少 token 统计",
    TASK_RUN_TOOL_USAGE_MISSING: "缺少工具统计",
    TASK_RUN_ACTIVITY_MISSING: "缺少 runtime 活动",
    TASK_RUN_RESULT_PENDING: "缺少结束结果",
    RUNTIME_STALL_TIMEOUT: "runtime 静默超时",
    RUNTIME_RESULT_MISSING: "缺少 runtime 结果",
  }
  return labels[code] ?? hideTechnicalStrings(code)
}

function progressLabel(run: TaskRun) {
  const label = run.progressLabel || run.status
  const labels: Record<string, string> = {
    queued: "等待投递",
    dispatched_runtime_activity_required: "已投递，等待 runtime 活动证据",
    dispatched_activity_missing: "已投递，但长时间没有 runtime 活动",
    running: "runtime 正在处理",
    running_result_pending: "运行较久，等待 runtime 结果",
    awaiting_input: "等待人类输入",
    completed: "已完成",
    completed_missing_evidence: "已完成，但证据不完整",
    failed: "失败",
    cancelled: "已取消",
  }
  return labels[label] ?? hideTechnicalStrings(label)
}

function durationLabel(start?: string | null, end?: string | null) {
  if (!start || !end) return null
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return null
  const seconds = Math.round((endMs - startMs) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

function durationMsLabel(value?: number | null) {
  const n = asNumber(value)
  if (n === undefined) return null
  const seconds = Math.round(n / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const minuteRest = minutes % 60
  return minuteRest ? `${hours}h ${minuteRest}m` : `${hours}h`
}

function basename(path?: string | null) {
  if (!path) return "未记录"
  const cleaned = path.replace(/\/+$/, "")
  return compactVisibleText(cleaned.split("/").filter(Boolean).pop() || cleaned)
}

function compactVisibleText(value: string, max = 30) {
  if (value.length <= max) return value
  return `${value.slice(0, 18)}…${value.slice(-8)}`
}

function hideTechnicalStrings(value?: string | null) {
  if (!value) return ""
  return value
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "长标识")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "长标识")
}

function memberLabel(members: Member[], id?: string | null) {
  if (!id) return "未指定"
  const member = members.find((item) => item.id === id)
  return member?.handle || (member?.name ? `@${member.name}` : "未知 agent")
}

function computerName(computers: Computer[], id?: string | null) {
  if (!id) return "未绑定电脑"
  return computers.find((item) => item.id === id)?.name ?? "未命名电脑"
}

function workspaceName(computers: Computer[], id?: string | null) {
  if (!id) return "未绑定工作区"
  for (const computer of computers) {
    const workspace = computer.agentWorkspaces.find((item) => item.id === id)
    if (workspace) return `${workspace.agentName ? `@${workspace.agentName}` : "未知 agent"} · ${basename(workspace.cwd)}`
  }
  return "未命名工作区"
}

function runRole(profile?: string | null) {
  if (profile === "task.leader") return "协调"
  if (profile === "task.reviewer") return "复核"
  if (profile === "task.participant") return "参与"
  if (profile === "task.worker") return "执行"
  return "执行"
}

function runStatusText(status: string) {
  const labels: Record<string, string> = {
    queued: "等待投递",
    dispatched: "已投递",
    running: "运行中",
    awaiting_input: "等待输入",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消",
  }
  return labels[status] ?? statusLabel(status)
}

function runPhaseText(run: TaskRun) {
  if (run.progressLabel) return progressLabel(run)
  if (run.status === "queued") return "还没有到达 runtime"
  if (run.status === "dispatched") return "daemon 已收到并尝试投递"
  if (run.status === "running") return "runtime 已开始处理"
  if (run.status === "awaiting_input") return "需要人类输入后继续"
  if (run.status === "completed") return "runtime 已结束本次执行"
  if (run.status === "failed") return hideTechnicalStrings(run.failureReason || run.failureCode) || "执行失败，等待查看失败原因"
  if (run.status === "cancelled") return hideTechnicalStrings(run.failureReason) || "执行被取消"
  return "状态已记录"
}

function contextScopeLabel(scope?: string | null) {
  const labels: Record<string, string> = {
    channel: "频道上下文",
    thread: "线程上下文",
    task: "任务上下文",
    run: "单次执行上下文",
  }
  return labels[scope || "task"] ?? (hideTechnicalStrings(scope) || "任务上下文")
}

function triggerTypeLabel(trigger?: string | null) {
  const labels: Record<string, string> = {
    assigned_task: "任务分配",
    delegated_task: "代理委派",
    manual: "手动触发",
    retry: "重试",
    leader_child: "协调拆分",
  }
  return labels[trigger || "assigned_task"] ?? (hideTechnicalStrings(trigger) || "任务分配")
}

function activityTypeLabel(type: string) {
  const labels: Record<string, string> = {
    "task.created": "任务创建",
    "task.updated": "任务更新",
    "task.assigned": "任务分配",
    "runtime.started": "Runtime 启动",
    "runtime.running": "Runtime 运行",
    "runtime.completed": "Runtime 完成",
    "runtime.failed": "Runtime 失败",
    "runtime_idle": "Runtime 空闲",
    "runtime_busy": "Runtime 忙碌",
    "workspace.updated": "工作区更新",
    "workspace.registered": "工作区注册",
  }
  if (labels[type]) return labels[type]
  if (type.startsWith("task")) return "任务动态"
  if (type.startsWith("runtime")) return "Runtime 动态"
  if (type.startsWith("workspace")) return "工作区动态"
  return "控制动态"
}

function activityDescriptionLabel(description: string) {
  const labels: Record<string, string> = {
    Idle: "空闲",
    Thinking: "思考中",
    "Ran Edit": "执行编辑工具",
    "Ran Write": "执行写入工具",
    "Ran Bash": "执行命令工具",
    "Ran Read": "读取文件",
  }
  return labels[description] ?? hideTechnicalStrings(description)
}

function runAccent(status: string) {
  if (status === "completed") return "border-[var(--ink)] sk-cat-success"
  if (status === "running" || status === "dispatched") return "border-[var(--ink)] sk-cat-info"
  if (status === "queued" || status === "awaiting_input") return "border-[var(--ink)] sk-cat-warning"
  if (status === "failed" || status === "cancelled") return "border-[var(--ink)] sk-cat-danger"
  return "border-[var(--ink)] sk-cat-neutral"
}

function gateClass(state: GateState) {
  if (state === "pass") return "border-[var(--ink)] sk-cat-success"
  if (state === "warn") return "border-[var(--ink)] sk-cat-warning"
  if (state === "fail") return "border-[var(--ink)] sk-cat-danger"
  return "border-[var(--ink)] sk-cat-neutral"
}

function runtimeInfo(run: TaskRun): RuntimeInfo {
  return {
    type: run.runtime || undefined,
    provider: run.runtimeProvider || undefined,
    model: run.runtimeModel || undefined,
  }
}

function buildGates({
  computers,
  tasks,
  runs,
}: {
  computers: Computer[]
  tasks: Task[]
  runs: RunWithTask[]
}): Gate[] {
  const onlineComputers = computers.filter((item) => item.status === "online" || item.status === "active")
  const workspaces = computers.flatMap((computer) => computer.agentWorkspaces)
  const readyWorkspaces = workspaces.filter((item) => ["running", "active", "idle", "busy"].includes(item.status))
  const failedRuns = runs.filter((item) => item.status === "failed")
  const completedRuns = runs.filter((item) => item.status === "completed")
  const runsWithUsage = runs.filter((item) => {
    const usage = item.usageSummary || {}
    return usage.totalTokens != null || usage.contextOccupancyRatio != null || usage.toolCalls != null
  })
  const runsWithIssues = runs.filter((item) => (item.evidenceIssues || []).length > 0)

  return [
    {
      title: "Daemon 连接",
      state: onlineComputers.length > 0 ? "pass" : computers.length > 0 ? "warn" : "fail",
      summary: onlineComputers.length > 0 ? `${onlineComputers.length} 台在线` : computers.length > 0 ? "有电脑但未在线" : "没有 daemon 连接",
      detail: onlineComputers.length > 0 ? "控制面可以向 daemon 继续下发运行时命令。" : "先完成 daemon connect，否则后续 runtime 和 TaskRun 都不会真实发生。",
    },
    {
      title: "Runtime 就绪",
      state: readyWorkspaces.length > 0 ? "pass" : workspaces.length > 0 ? "warn" : "fail",
      summary: readyWorkspaces.length > 0 ? `${readyWorkspaces.length} 个工作区可用` : workspaces.length > 0 ? "工作区未就绪" : "没有 runtime 工作区",
      detail: readyWorkspaces.length > 0 ? "至少一个 agent runtime 已可接收任务。" : "这会导致 TaskRun 停留在排队或启动失败，需要先修 runtime preflight。",
    },
    {
      title: "TaskRun 证据",
      state: runs.length > 0 ? failedRuns.length > 0 || runsWithIssues.length > 0 ? "warn" : "pass" : tasks.length > 0 ? "warn" : "idle",
      summary: runs.length > 0 ? `${runs.length} 次执行，${completedRuns.length} 次完成，${runsWithIssues.length} 次需补证据` : tasks.length > 0 ? "任务存在但没有 run" : "暂无任务执行",
      detail: runs.length > 0 ? "任务已经有独立执行记录；若有缺失项，会在时间线里直接显示。" : "如果是分配给 agent 的任务，这里应出现 TaskRun。",
    },
    {
      title: "用量与上下文",
      state: runs.length === 0 ? "idle" : runsWithUsage.length > 0 ? "pass" : "warn",
      summary: runs.length === 0 ? "暂无可评估执行" : runsWithUsage.length > 0 ? `${runsWithUsage.length} 次有用量证据` : "缺少用量证据",
      detail: runsWithUsage.length > 0 ? "可查看 token/context 概览；原始 session 只在详情里折叠。" : "这不会阻断执行，但会降低 gate 对上下文占用的判断能力。",
    },
  ]
}

function GateStateIcon({ state }: { state: GateState }) {
  const className = "mt-0.5 size-4 shrink-0"
  if (state === "pass") return <CheckCircle2 className={className} />
  if (state === "warn") return <AlertTriangle className={className} />
  if (state === "fail") return <XCircle className={className} />
  return <CircleDashed className={className} />
}

function GateCard({ gate }: { gate: Gate }) {
  return (
    <div className={cn("rounded-none border-2 border-[var(--ink)] p-3", gateClass(gate.state))}>
      <div className="flex items-start gap-2">
        <GateStateIcon state={gate.state} />
        <div className="min-w-0">
          <div className="text-sm font-semibold">{gate.title}</div>
          <div className="mt-1 text-lg font-semibold leading-tight">{gate.summary}</div>
          <div className="mt-1 text-xs opacity-80">{gate.detail}</div>
        </div>
      </div>
    </div>
  )
}

function EvidenceBadge({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const toneClass = {
    neutral: "sk-cat-neutral",
    good: "sk-cat-success",
    warn: "sk-cat-warning",
    bad: "sk-cat-danger",
  }[tone]
  return (
    <span className={cn("inline-flex min-h-6 items-center rounded-none border-2 border-[var(--ink)] px-2 py-0.5 text-xs", toneClass)}>
      <span className="opacity-70">{label}</span>
      <span className="ml-1 font-medium">{value}</span>
    </span>
  )
}

function UsageSummary({ run }: { run: TaskRun }) {
  const summary = run.usageSummary || {}
  const occupancy = percent(summary.contextOccupancyRatio)
  const input = compactNumber(summary.inputTokens)
  const output = compactNumber(summary.outputTokens)
  const cache = compactNumber(summary.cacheReadInputTokens)
  const total = compactNumber(summary.totalTokens)
  const tools = compactNumber(summary.toolCalls)
  const contextKnown = compactNumber(summary.contextKnownTokens)
  const contextWindow = compactNumber(summary.contextWindow)
  const hasToken = Boolean(input || output || cache || total)

  return (
    <div className="flex flex-wrap gap-1.5">
      <EvidenceBadge
        label="上下文"
        value={occupancy ?? "未知"}
        tone={occupancy ? asNumber(summary.contextOccupancyRatio)! >= 0.5 ? "warn" : "good" : "warn"}
      />
      {contextKnown && <EvidenceBadge label="上下文 token" value={contextKnown} />}
      {contextWindow && <EvidenceBadge label="窗口" value={contextWindow} />}
      <EvidenceBadge label="总 token" value={total ?? "未知"} tone={total ? "neutral" : "warn"} />
      <EvidenceBadge label="输入" value={input ?? "未知"} tone={input ? "neutral" : "warn"} />
      <EvidenceBadge label="输出" value={output ?? "未知"} tone={output ? "neutral" : "warn"} />
      {cache && <EvidenceBadge label="缓存读" value={cache} />}
      <EvidenceBadge label="工具" value={tools ?? "未知"} tone={tools ? "neutral" : "warn"} />
      {!hasToken && <EvidenceBadge label="用量" value="未回写" tone="warn" />}
    </div>
  )
}

function RunRow({
  run,
  members,
  computers,
}: {
  run: RunWithTask
  members: Member[]
  computers: Computer[]
}) {
  const duration = durationLabel(run.startedAt, run.completedAt)
  const runtimePending = durationMsLabel(run.runtimePendingMs)
  const lastUpdateAge = durationMsLabel(run.lastUpdateAgeMs)
  const started = run.startedAt ? formatTime(run.startedAt) : "未开始"
  const completed = run.completedAt ? formatTime(run.completedAt) : null
  const failure = hideTechnicalStrings(run.failureReason || run.failureCode)
  const issues = run.evidenceIssues || []
  const hasRawDetails = run.runtimeSessionId || run.workspaceSessionId || run.contextSessionId || run.cwd || run.daemonId

  return (
    <div className={cn("rounded-none border-2 border-[var(--ink)] p-3", run.stale ? "sk-cat-warning" : runAccent(run.status))}>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={run.status} label={runStatusText(run.status)} />
            <RuntimeChip>{runRole(run.promptProfile)}</RuntimeChip>
            <span className="min-w-0 truncate text-sm font-medium">#{run.task.taskNumber ?? run.task.number} {run.task.title}</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{runPhaseText(run)}</p>
          {failure && (
            <div className="mt-2 flex items-start gap-2 rounded-none border-2 border-[var(--ink)] sk-cat-danger px-2 py-1.5 text-sm">
              <ShieldAlert className="mt-0.5 size-4 shrink-0" />
              <span>{failure}</span>
            </div>
          )}
          {issues.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {issues.slice(0, 5).map((issue) => (
                <EvidenceBadge key={issue} label="待补" value={issueLabel(issue)} tone="warn" />
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-1.5 lg:max-w-[24rem] lg:justify-end">
          <EvidenceBadge label="执行者" value={memberLabel(members, run.agentId)} />
          <EvidenceBadge label="电脑" value={computerName(computers, run.computerId)} />
          <EvidenceBadge label="工作区" value={workspaceName(computers, run.runtimeWorkspaceId)} />
        </div>
      </div>

      <div className="mt-3 grid gap-3 border-t pt-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.7fr)]">
        <div className="flex flex-wrap gap-1.5">
          <EvidenceBadge label="开始" value={started} />
          <EvidenceBadge label="结束" value={completed ?? "未结束"} tone={completed ? "good" : "warn"} />
          <EvidenceBadge label="耗时" value={duration ?? runtimePending ?? "未形成"} tone={duration ? "good" : run.stale ? "warn" : "neutral"} />
          {lastUpdateAge && <EvidenceBadge label="最后更新" value={`${lastUpdateAge} 前`} tone={run.stale ? "warn" : "neutral"} />}
          <EvidenceBadge label="输出" value={run.outputMessageId ? "已有消息" : "未记录"} tone={run.outputMessageId ? "good" : "warn"} />
        </div>
        <UsageSummary run={run} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>运行时：{runtimeLabel(runtimeInfo(run))}</span>
        <span>·</span>
        <span>上下文：{contextScopeLabel(run.contextScope)}</span>
        <span>·</span>
        <span>触发：{triggerTypeLabel(run.triggerType)}</span>
      </div>

      {hasRawDetails && (
        <details className="mt-3 rounded-none border-2 border-[var(--ink)] bg-sand-card/80 px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">技术细节（默认隐藏）</summary>
          <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
            <DetailLine label="执行记录" value={shortId(run.id)} />
            <DetailLine label="分配记录" value={shortId(run.assignmentId)} />
            <DetailLine label="工作区会话" value={shortId(run.workspaceSessionId)} />
            <DetailLine label="运行会话" value={shortId(run.runtimeSessionId)} />
            <DetailLine label="上下文会话" value={shortId(run.contextSessionId)} />
            <DetailLine label="工作目录" value={run.cwd ? basename(run.cwd) : "未记录"} />
          </div>
        </details>
      )}
    </div>
  )
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span>{label}</span>
      <code className="truncate rounded-none bg-muted px-1.5 py-0.5 text-[11px] text-foreground">{value}</code>
    </div>
  )
}

function CompactActivity({ items }: { items: ActivityItem[] }) {
  const visible = items
    .filter((item) => item.type.startsWith("task") || item.type.startsWith("runtime") || item.type.startsWith("workspace"))
    .slice(0, 8)

  return (
    <div className="space-y-3">
      {visible.map((item) => (
        <div key={item.id} className="grid grid-cols-[auto_1fr] gap-2 border-b pb-3 last:border-b-0">
          <span className="mt-1 size-2 rounded-full bg-info" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{activityDescriptionLabel(item.description)}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {item.agentName ? `@${hideTechnicalStrings(item.agentName)} · ` : ""}{activityTypeLabel(item.type)} · {formatTime(item.timestamp)}
            </div>
          </div>
        </div>
      ))}
      {visible.length === 0 && (
        <EmptyState title="暂无相关动态" description="当 daemon、runtime 或 TaskRun 产生事件后会显示在这里。" />
      )}
    </div>
  )
}

export default async function IntegrationControlPage() {
  const session = await requireCurrentAccount()
  const sessionToken = await getSessionToken()
  const activeServerId = session.server.id
  const { tasks, computers, members, activity } = await getIntegrationData(sessionToken, activeServerId)
  const runs = tasks
    .flatMap((task) => (task.runs || []).map((run) => ({ ...run, task })))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
  const latestRuns = runs.slice(0, 10)
  const gates = buildGates({ computers, tasks, runs })
  const workspaces = computers.flatMap((computer) => computer.agentWorkspaces)
  const activeWorkspaces = workspaces.filter((item) => ["running", "active", "idle", "busy"].includes(item.status))
  const failedRuns = runs.filter((item) => item.status === "failed")
  const inFlightRuns = runs.filter((item) => ["queued", "dispatched", "running", "awaiting_input"].includes(item.status))

  return (
    <ProductShell
      title="集成门禁"
      description="门禁视图：只把能判断流程真实性的信息放在第一屏，原始标识默认隐藏。"
      actions={
        <>
          <RealtimeRefresh eventTypes={["task.created", "task.updated", "workspace.updated", "workspace.registered", "member.updated"]} />
          <Link href="/daemon">
            <Button variant="outline" size="sm">
              <Activity className="size-4" />
              原始控制面
            </Button>
          </Link>
        </>
      }
      sidebarTitle="观察重点"
      sidebarDescription="默认看状态和原因；需要追踪时再展开技术细节。"
      sidebar={
        <div className="space-y-3 text-sm">
          <SideFact icon={Server} label="Daemon" value={`${computers.length} 台注册，${activeWorkspaces.length} 个 runtime 可用`} />
          <SideFact icon={Workflow} label="TaskRun" value={`${runs.length} 次执行，${inFlightRuns.length} 次进行中`} />
          <SideFact icon={ShieldAlert} label="失败" value={failedRuns.length ? `${failedRuns.length} 次需要处理` : "当前无失败 run"} />
          <div className="rounded-none border-2 border-[var(--ink)] bg-sand-card p-3 text-xs text-muted-foreground">
            这里不会默认展示完整 id、token、session 字符串。短码只用于沟通定位，完整追踪仍以 backend/trace 为准。
          </div>
        </div>
      }
      className="space-y-5"
    >
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {gates.map((gate) => (
          <GateCard key={gate.title} gate={gate} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Radio className="size-5" />
                  TaskRun 时间线
                </CardTitle>
                <CardDescription>最近的任务执行记录，按人能判断的阶段和证据展示。</CardDescription>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <StatusPill status="running" label={`${inFlightRuns.length} 进行中`} />
                <StatusPill status={failedRuns.length ? "failed" : "done"} label={`${failedRuns.length} 失败`} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            {latestRuns.map((run) => (
              <RunRow key={run.id} run={run} members={members} computers={computers} />
            ))}
            {latestRuns.length === 0 && (
              <EmptyState
                title="还没有 TaskRun"
                description="分配给 agent 的任务应该生成 TaskRun。若已有任务但没有 run，先检查 assignment/runtime delivery。"
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-5" />
                Runtime 就绪情况
              </CardTitle>
              <CardDescription>只显示可操作状态，不把 session 字符串放在主界面。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {computers.map((computer) => (
                <div key={computer.id} className="rounded-none border-2 border-[var(--ink)] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Server className="size-4 text-primary" />
                        <span className="truncate text-sm font-medium">{computer.name}</span>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        heartbeat {formatTime(computer.lastHeartbeatAt)} · daemon {computer.daemonVersion || "unknown"}
                      </div>
                    </div>
                    <StatusPill status={computer.status} label={statusLabel(computer.status)} />
                  </div>
                  <div className="mt-3 space-y-2">
                    {computer.agentWorkspaces.map((workspace) => (
                      <div key={workspace.id} className="flex items-center justify-between gap-2 rounded-none bg-muted/45 px-2 py-1.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm">@{workspace.agentName || workspace.agentHandle || "未命名 agent"}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {workspace.runtime ? runtimeLabel({
                              type: workspace.runtime,
                              provider: workspace.runtimeProvider || undefined,
                              model: workspace.runtimeModel || undefined,
                            }) : "runtime 未知"} · {basename(workspace.cwd)}
                          </div>
                        </div>
                        <StatusPill status={workspace.status} label={statusLabel(workspace.status)} />
                      </div>
                    ))}
                    {computer.agentWorkspaces.length === 0 && (
                      <p className="text-xs text-muted-foreground">这台电脑还没有 runtime 工作区。</p>
                    )}
                  </div>
                </div>
              ))}
              {computers.length === 0 && (
                <EmptyState title="没有 daemon 连接" description="先完成 daemon-connect，后续 runtime-ready gate 才有意义。" />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <Clock className="size-5" />
                相关动态
              </CardTitle>
              <CardDescription>只保留 daemon/runtime/task 相关事件，避免活动流干扰判断。</CardDescription>
            </CardHeader>
            <CardContent className="pt-4">
              <CompactActivity items={activity} />
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-5 lg:grid-cols-3">
        <MetricPanel icon={CheckSquare} label="任务" value={`${tasks.length}`} detail={`${tasks.filter((task) => task.status !== "done" && task.status !== "closed").length} 个未完成`} />
        <MetricPanel icon={Timer} label="执行中" value={`${inFlightRuns.length}`} detail="等待投递 / 已投递 / 运行中 / 等待输入" />
        <MetricPanel icon={Gauge} label="上下文风险" value={`${runs.filter((run) => asNumber(run.usageSummary?.contextOccupancyRatio)! >= 0.5).length}`} detail="超过 50% 的 run 会在这里计数" />
      </section>

      <section className="rounded-none border-2 border-[var(--ink)] bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <MessageSquare className="mt-0.5 size-5 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">页面读法</h2>
            <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
              先看四个门禁块是否通过，再看 TaskRun 时间线有没有清楚进入 runtime、有没有输出或失败原因。
              只有在需要定位具体记录时才展开技术细节；这里不会把 token、session、长 id 当成主要信息展示。
            </p>
          </div>
        </div>
      </section>
    </ProductShell>
  )
}

function SideFact({ icon: Icon, label, value }: { icon: typeof Server; label: string; value: string }) {
  return (
    <div className="rounded-none border-2 border-[var(--ink)] bg-sand-card p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}

function MetricPanel({ icon: Icon, label, value, detail }: { icon: typeof Bot; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-none border-2 border-[var(--ink)] bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
        <div className="flex size-10 items-center justify-center rounded-none bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </div>
  )
}
