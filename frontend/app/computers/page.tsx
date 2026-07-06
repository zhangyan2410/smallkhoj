import Link from "next/link"
import { revalidatePath } from "next/cache"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import {
  AlertTriangle,
  Bot,
  Clock,
  Cpu,
  HardDrive,
  Monitor,
  Network,
  Play,
  Power,
  RefreshCw,
  RotateCcw,
  Scan,
  Search,
  Server,
  Shield,
  Terminal,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { AttachmentSheet, ComputerInkstone, InkframeObjectSurface, ObjectField, ObjectMetric, SidebarEntityItem } from "@/components/inkframe-object-ui"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { EmptyState, RuntimeChip, type CategoryTone, StatusPill } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Panel } from "@/components/ui/panel"
import { ConnectComputerForm } from "./connect-computer-form"
import { buildComputerReconnectUrl, shouldShowConnectComputerForm } from "@/lib/computer-navigation"
import {
  apiGet,
  API_BASE,
  formatTime,
  runtimeLabel,
  shortId,
  statusLabel,
  type AgentWorkspace,
  type Computer,
  type RuntimeInfo,
} from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"
import { resolvePublicApiBaseFromHeaders } from "@/lib/runtime-url"

type TranslationFn = (key: string, values?: Record<string, string | number>) => string

function makeComputersCopy(t: TranslationFn) {
  return {
    title: t("title"),
    description: t("description"),
    runtimeSnapshot: t("runtimeSnapshot"),
    runtimeSnapshotDesc: t("runtimeSnapshotDesc"),
    registered: t("registered"),
    online: t("online"),
    runningWorkspaces: t("runningWorkspaces"),
    members: t("members"),
    tasks: t("tasks"),
    allComputers: t("allComputers"),
    unknownOs: t("unknownOs"),
    unknown: t("unknown"),
    workspacesRunning: (total: number, running: number) => t("workspacesRunning", { total, running }),
    lifecycleControls: t("lifecycleControls"),
    reconnect: t("reconnect"),
    scanWorkspaces: t("scanWorkspaces"),
    stopAll: t("stopAll"),
    restartAll: t("restartAll"),
    reconcile: t("reconcile"),
    lifecycleHelp: t("lifecycleHelp"),
    offlineHelp: t("offlineHelp"),
    reconnectCommand: t("reconnectCommand"),
    useOn: (name: string) => t("useOn", { name }),
    computerName: t("computerName"),
    server: t("server"),
    expires: t("expires"),
    none: t("none"),
    expired: t("expired"),
    detectedRuntimes: t("detectedRuntimes"),
    noRuntimes: t("noRuntimes"),
    agentWorkspaces: t("agentWorkspaces"),
    agent: t("agent"),
    runtime: t("runtime"),
    status: t("status"),
    pid: t("pid"),
    session: t("session"),
    cwd: t("cwd"),
    actions: t("actions"),
    noWorkspaces: t("noWorkspaces"),
    delete: t("delete"),
    deleteComputer: t("deleteComputer"),
    deleteComputerDesc: t("deleteComputerDesc"),
    deleteBlocking: (count: number) => t("deleteBlocking", { count }),
    start: t("start"),
    stop: t("stop"),
    restart: t("restart"),
    providerDefault: t("providerDefault"),
    runtimeDefault: t("runtimeDefault"),
    noCwd: t("noCwd"),
    computerCount: (count: number) => t("computerCount", { count }),
    selectForDetail: t("selectForDetail"),
    noComputers: t("noComputers"),
    noComputersDesc: t("noComputersDesc"),
  }
}

type ComputersCopy = ReturnType<typeof makeComputersCopy>

async function getComputers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ computers: Computer[]; count?: number }>("/api/v1/computers", { computers: [], count: 0 }, sessionToken, activeServerId)
}

function searchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function parseCredentialCookie(value?: string) {
  if (!value) return null
  try {
    const data = JSON.parse(value) as {
      name?: unknown
      command?: unknown
      expiresAt?: unknown
      mode?: unknown
      computerId?: unknown
      serverId?: unknown
      serverName?: unknown
    }
    if (typeof data.name !== "string" || typeof data.command !== "string" || typeof data.expiresAt !== "string") {
      return null
    }
    return {
      name: data.name,
      command: data.command,
      expiresAt: data.expiresAt,
      mode: data.mode === "reconnect" ? "reconnect" : "create",
      computerId: typeof data.computerId === "string" ? data.computerId : null,
      serverId: typeof data.serverId === "string" ? data.serverId : null,
      serverName: typeof data.serverName === "string" ? data.serverName : null,
    }
  } catch {
    return null
  }
}

async function createComputerConnectCommandAction(formData: FormData) {
  "use server"

  const name = String(formData.get("name") || "").trim() || "unregistered-computer"
  const publicServerUrl = resolvePublicApiBaseFromHeaders(process.env, await headers())
  const response = await fetch(`${API_BASE}/api/v1/computers/connect-command`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ name, serverUrl: publicServerUrl }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/computers?error=${encodeURIComponent(detail)}`)
  }

  const data = await response.json()
  const cookieStore = await cookies()
  cookieStore.set("smallkhoj_last_computer_connect_command", JSON.stringify({
    name,
    command: data.command,
    expiresAt: data.expiresAt,
    serverId: data.serverId,
    serverName: data.serverName,
    mode: "create",
  }), {
    httpOnly: true,
    maxAge: 300,
    path: "/computers",
    sameSite: "lax",
  })
  revalidatePath("/computers")
  redirect("/computers?created=1")
}

async function createComputerReconnectCommandAction(formData: FormData) {
  "use server"

  const computerId = String(formData.get("computerId") || "").trim()
  if (!computerId) redirect("/computers?error=Missing%20computer")

  const publicServerUrl = resolvePublicApiBaseFromHeaders(process.env, await headers())
  const response = await fetch(`${API_BASE}/api/v1/computers/${computerId}/reconnect-command`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ serverUrl: publicServerUrl }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/computers?error=${encodeURIComponent(detail)}`)
  }

  const data = await response.json()
  const cookieStore = await cookies()
  cookieStore.set("smallkhoj_last_computer_connect_command", JSON.stringify({
    name: data.name,
    command: data.command,
    expiresAt: data.expiresAt,
    serverId: data.serverId,
    serverName: data.serverName,
    mode: "reconnect",
    computerId: data.computerId,
  }), {
    httpOnly: true,
    maxAge: 300,
    path: "/computers",
    sameSite: "lax",
  })
  revalidatePath("/computers")
  redirect(buildComputerReconnectUrl(data.computerId))
}

async function controlWorkspaceLifecycleAction(formData: FormData) {
  "use server"

  const workspaceId = String(formData.get("workspaceId") || "").trim()
  const computerId = String(formData.get("computerId") || "").trim()
  const action = String(formData.get("action") || "").trim()
  const selected = computerId ? `?computer=${encodeURIComponent(computerId)}` : ""
  if (!workspaceId || !action) redirect(`/computers${selected}`)

  const response = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/lifecycle`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ action }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    const joiner = selected ? "&" : "?"
    redirect(`/computers${selected}${joiner}error=${encodeURIComponent(detail)}`)
  }

  revalidatePath("/computers")
  redirect(`/computers?computer=${encodeURIComponent(computerId)}&lifecycle=${encodeURIComponent(workspaceId)}`)
}

async function deleteComputerAction(formData: FormData) {
  "use server"

  const computerId = String(formData.get("computerId") || "").trim()
  if (!computerId) redirect("/computers?error=Missing%20computer")
  const response = await fetch(`${API_BASE}/api/v1/computers/${computerId}`, {
    method: "DELETE",
    headers: await serverApiHeaders(),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/computers?computer=${encodeURIComponent(computerId)}&error=${encodeURIComponent(detail)}`)
  }

  revalidatePath("/computers")
  revalidatePath("/members")
  redirect("/computers?deleted=1")
}

function Field({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  return (
    <ObjectField
      label={
        <span className="inline-flex items-center gap-1">
          {icon}
          {label}
        </span>
      }
      value={value || "none"}
    />
  )
}

/** runtime 安装状态 → CategoryTone 单一真源。色走 sk-cat-* token。 */
function runtimeStatusKind(status?: string): CategoryTone {
  if (!status) return "neutral"
  switch (status) {
    case "installed":
    case "available":
    case "active":
      return "success"
    case "not_installed":
    case "unavailable":
    case "missing":
      return "danger"
    case "unknown":
    case "detecting":
      return "warning"
    default:
      return "neutral"
  }
}

function runtimeStatusIcon(status?: string) {
  if (!status) return null
  switch (status) {
    case "installed":
    case "available":
    case "active":
      return <Zap className="size-3" />
    case "not_installed":
    case "unavailable":
    case "missing":
      return <XCircle className="size-3" />
    case "unknown":
    case "detecting":
      return <Search className="size-3" />
    default:
      return null
  }
}

function RuntimeStatusChip({ runtime }: { runtime: RuntimeInfo }) {
  if (typeof runtime === "string") {
    return (
      <RuntimeChip tone="neutral" className="gap-1">{runtime}</RuntimeChip>
    )
  }
  const status = runtime.status
  const label = runtimeLabel(runtime)
  const icon = runtimeStatusIcon(status)

  return (
    <RuntimeChip tone="paper" className="gap-1">
      <span
        className={
          runtimeStatusKind(status) === "success"
            ? "size-1.5 shrink-0 rounded-full bg-success"
            : runtimeStatusKind(status) === "danger"
              ? "size-1.5 shrink-0 rounded-full bg-danger"
              : runtimeStatusKind(status) === "warning"
                ? "size-1.5 shrink-0 rounded-full bg-warning"
                : "size-1.5 shrink-0 rounded-full bg-muted-foreground"
        }
      />
      {icon}
      {label}
    </RuntimeChip>
  )
}

function ComputerDetail({
  computer,
  reconnectCredential,
  reconnectComputerId,
  copy,
}: {
  computer: Computer
  reconnectCredential: ReturnType<typeof parseCredentialCookie>
  reconnectComputerId?: string | null
  copy: ComputersCopy
}) {
  const runningWorkspaces = computer.agentWorkspaces.filter((w) => w.status === "running").length
  const deleteBlockingWorkspaces = computer.agentWorkspaces.filter((w) =>
    ["running", "active", "idle", "busy", "starting", "restarting"].includes(w.status)
  ).length
  const leaseExpiry = computer.daemonLeaseExpiresAt
    ? new Date(computer.daemonLeaseExpiresAt)
    : null
  const leaseExpired = leaseExpiry ? leaseExpiry < new Date() : true

  return (
    <div data-inkframe-mobile-role="computer-detail" className="min-w-0 space-y-4 overflow-x-hidden">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/computers" className="text-sm text-muted-foreground hover:text-foreground">
          ← {copy.allComputers}
        </Link>
      </div>

      <Card>
        <CardHeader className="border-b">
          <ComputerInkstone status={computer.status}>
            <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
              <span className="min-w-0 flex-1 truncate">{computer.name}</span>
              <StatusPill status={computer.status} label={statusLabel(computer.status)} />
            </CardTitle>
            <CardDescription className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span>{computer.os || copy.unknownOs}</span>
              <span>daemon {computer.daemonVersion || copy.unknown}</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {formatTime(computer.lastHeartbeatAt)}
              </span>
              <span className="inline-flex items-center gap-1">
                <HardDrive className="size-3" />
                {copy.workspacesRunning(computer.agentWorkspaces.length, runningWorkspaces)}
              </span>
            </CardDescription>
          </ComputerInkstone>
        </CardHeader>
        <CardContent className="space-y-5 pt-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Power className="size-3" />
              {copy.lifecycleControls}
            </div>
            <div data-inkframe-mobile-role="computer-lifecycle" className="min-w-0 overflow-x-hidden rounded-none border-2 border-[var(--ink)] p-3">
              <div className="flex flex-wrap gap-2">
                <form action={createComputerReconnectCommandAction}>
                  <input type="hidden" name="computerId" value={computer.id} />
                  <Button type="submit" size="sm" variant="outline">
                    <RefreshCw className="size-4" />
                    {copy.reconnect}
                  </Button>
                </form>
                <Button size="sm" variant="outline" disabled title="Workspace scan requires backend endpoint">
                  <Scan className="size-4" />
                  {copy.scanWorkspaces}
                </Button>
                <Button size="sm" variant="outline" disabled title="Use row actions to stop one runtime">
                  <Power className="size-4" />
                  {copy.stopAll}
                </Button>
                <Button size="sm" variant="outline" disabled title="Use row actions to restart one runtime">
                  <RotateCcw className="size-4" />
                  {copy.restartAll}
                </Button>
                <Button size="sm" variant="outline" disabled title="Reconcile requires backend endpoint">
                  <Play className="size-4" />
                  {copy.reconcile}
                </Button>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {copy.lifecycleHelp}
              </p>
              {computer.status === "offline" || leaseExpired ? (
                <p className="mt-1 text-xs text-warning">
                  {copy.offlineHelp}
                </p>
              ) : null}
            </div>
          </div>

          {reconnectCredential?.computerId === computer.id && reconnectComputerId === computer.id && (
            <InkframeObjectSurface material="drying" data-inkframe-mobile-role="computer-reconnect-command" className="min-w-0 space-y-2 overflow-x-hidden p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">{copy.reconnectCommand}</div>
                <div className="text-xs text-muted-foreground">{copy.useOn(computer.name)}</div>
              </div>
              <AttachmentSheet kind="proof" className="p-2">
                <code
                  data-testid="reconnect-command"
                  className="block whitespace-pre-wrap break-all text-xs"
                >
                  {reconnectCredential.command}
                </code>
              </AttachmentSheet>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label={copy.computerName} value={reconnectCredential.name} />
                <Field label={copy.server} value={reconnectCredential.serverName || shortId(reconnectCredential.serverId)} />
                <Field label={copy.expires} value={reconnectCredential.expiresAt} />
              </div>
            </InkframeObjectSurface>
          )}

          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="computerId" value={shortId(computer.id)} icon={<Monitor className="size-3" />} />
            <Field label="machineId" value={shortId(computer.machineId)} icon={<Server className="size-3" />} />
            <Field label="serverId" value={shortId(computer.serverId)} icon={<Server className="size-3" />} />
            <Field label="apiKey" value={computer.apiKeyPrefix} icon={<Shield className="size-3" />} />
            <Field label="daemon" value={computer.activeDaemonId ? shortId(computer.activeDaemonId) : copy.none} icon={<Terminal className="size-3" />} />
            <Field
              label="lease"
              value={leaseExpiry ? (leaseExpired ? copy.expired : formatTime(computer.daemonLeaseExpiresAt)) : copy.none}
              icon={<Clock className="size-3" />}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Cpu className="size-3" />
              {copy.detectedRuntimes}
            </div>
            <div className="flex min-h-8 flex-wrap gap-1.5">
              {(computer.detectedRuntimes.length ? computer.detectedRuntimes : []).map((runtime, i) => (
                <RuntimeStatusChip key={`${runtimeLabel(runtime)}-${i}`} runtime={runtime} />
              ))}
              {computer.detectedRuntimes.length === 0 && (
                <span className="text-xs text-muted-foreground">{copy.noRuntimes}</span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Network className="size-3" />
              {copy.agentWorkspaces}
            </div>
            <InkframeObjectSurface material="dry" data-inkframe-mobile-role="computer-workspace-list" className="min-w-0 overflow-x-hidden p-0">
              <div className="hidden grid-cols-[1.1fr_0.8fr_0.65fr_0.55fr_0.6fr_0.9fr_1fr] gap-2 border-b-2 border-[var(--ink)] bg-[var(--paper)] px-3 py-2 text-sm font-medium text-foreground md:grid">
                <span>{copy.agent}</span>
                <span>{copy.runtime}</span>
                <span>{copy.status}</span>
                <span>{copy.pid}</span>
                <span>{copy.session}</span>
                <span>{copy.cwd}</span>
                <span>{copy.actions}</span>
              </div>
              {computer.agentWorkspaces.map((workspace) => (
                <WorkspaceRow
                  key={workspace.id}
                  workspace={workspace}
                  computerId={computer.id}
                  daemonOffline={computer.status === "offline" || leaseExpired}
                  copy={copy}
                />
              ))}
              {computer.agentWorkspaces.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {copy.noWorkspaces}
                </div>
              )}
            </InkframeObjectSurface>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Trash2 className="size-3" />
              {copy.delete}
            </div>
            <Panel variant="flat" className="sk-cat-danger space-y-3 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{copy.deleteComputer}</p>
                  <p className="mt-1 text-xs">
                    {copy.deleteComputerDesc}
                  </p>
                  {deleteBlockingWorkspaces > 0 && (
                    <p className="mt-1 text-xs">
                      {copy.deleteBlocking(deleteBlockingWorkspaces)}
                    </p>
                  )}
                  <form action={deleteComputerAction} className="mt-3">
                    <input type="hidden" name="computerId" value={computer.id} />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      disabled={deleteBlockingWorkspaces > 0}
                    >
                      <Trash2 className="size-3.5" />
                      {copy.delete}
                    </Button>
                  </form>
                </div>
              </div>
            </Panel>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function WorkspaceRow({
  workspace,
  computerId,
  daemonOffline,
  copy,
}: {
  workspace: AgentWorkspace
  computerId: string
  daemonOffline: boolean
  copy: ComputersCopy
}) {
  const canStart = !daemonOffline && ["stopped", "offline", "failed", "exited", "crashed"].includes(workspace.status)
  const canStop = !daemonOffline && ["running", "active", "idle", "busy", "pending_start"].includes(workspace.status)
  const canRestart = !daemonOffline && ["running", "active", "idle", "busy"].includes(workspace.status)
  const disabledTitle = daemonOffline ? "Reconnect the daemon before controlling runtimes" : undefined
  const runtimeError = workspace.runtimeLastError

  return (
    <div data-inkframe-mobile-role="computer-workspace-row" className="grid min-w-0 gap-2 overflow-x-hidden border-b px-3 py-3 last:border-b-0 md:grid-cols-[1.1fr_0.8fr_0.65fr_0.55fr_0.6fr_0.9fr_1fr] md:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-muted-foreground" />
          <span className="truncate text-sm font-medium">
            {workspace.agentHandle || `@${workspace.agentName ?? workspace.agentId}`}
          </span>
        </div>
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {shortId(workspace.workspaceId || workspace.id)} · {workspace.runtimeProvider || workspace.backend || copy.providerDefault}
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <Terminal className="size-4 text-muted-foreground" />
          <span className="truncate">{workspace.runtime || copy.runtimeDefault}</span>
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">
          {workspace.runtimeProvider || workspace.runtimeModel || workspace.runtimeCommand || copy.providerDefault}
        </div>
      </div>
      <StatusPill status={workspace.status} label={statusLabel(workspace.status)} />
      <div className="font-mono text-xs text-muted-foreground">{workspace.pid ?? copy.none}</div>
      <div className="truncate font-mono text-xs text-muted-foreground" title={workspace.sessionId ?? ""}>
        {workspace.sessionId ? shortId(workspace.sessionId) : copy.none}
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        <div className="truncate">{workspace.cwd || copy.noCwd}</div>
        {runtimeError ? (
          <div className="mt-1 flex items-start gap-1 text-destructive" title={runtimeError}>
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            <span className="break-words">{runtimeError}</span>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <form action={controlWorkspaceLifecycleAction}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="computerId" value={computerId} />
          <input type="hidden" name="action" value="start" />
          <Button type="submit" size="sm" variant="outline" disabled={!canStart} title={disabledTitle || copy.start}>
            <Play className="size-3.5" />
            {copy.start}
          </Button>
        </form>
        <form action={controlWorkspaceLifecycleAction}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="computerId" value={computerId} />
          <input type="hidden" name="action" value="stop" />
          <Button type="submit" size="sm" variant="outline" disabled={!canStop} title={disabledTitle || copy.stop}>
            <Power className="size-3.5" />
            {copy.stop}
          </Button>
        </form>
        <form action={controlWorkspaceLifecycleAction}>
          <input type="hidden" name="workspaceId" value={workspace.id} />
          <input type="hidden" name="computerId" value={computerId} />
          <input type="hidden" name="action" value="restart" />
          <Button type="submit" size="sm" variant="outline" disabled={!canRestart} title={disabledTitle || copy.restart}>
            <RotateCcw className="size-3.5" />
            {copy.restart}
          </Button>
        </form>
      </div>
    </div>
  )
}

function ComputerListRow({ computer, selectedId, copy }: { computer: Computer; selectedId?: string | null; copy: ComputersCopy }) {
  const isSelected = computer.id === selectedId
  const running = computer.agentWorkspaces.filter((w) => w.status === "running").length

  return (
    <SidebarEntityItem
      href={`/computers?computer=${computer.id}`}
      data-inkframe-mobile-role="computer-entity-item"
      active={isSelected}
      tone="green"
      icon={<Monitor className="size-4" />}
      title={computer.name}
      subtitle={`${computer.os || copy.unknownOs} · daemon ${computer.daemonVersion || copy.unknown} · ${copy.workspacesRunning(computer.agentWorkspaces.length, running)} · ${formatTime(computer.lastHeartbeatAt)}`}
      trailing={<StatusPill status={computer.status} label={statusLabel(computer.status)} />}
    />
  )
}

export default async function ComputersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireCurrentAccount()
  const t = await getTranslations("computers")
  const copy = makeComputersCopy(t)
  const resolvedSearchParams = (await searchParams) ?? {}
  const cookieStore = await cookies()
  const sessionToken = await getSessionToken()
  const activeServerId = session.server.id
  const { computers } = await getComputers(sessionToken, activeServerId)

  const selectedComputerId = searchValue(resolvedSearchParams.computer)
  const selectedComputer = selectedComputerId
    ? computers.find((c) => c.id === selectedComputerId || c.id.startsWith(selectedComputerId))
    : computers[0] ?? null

  const pendingCookie = searchValue(resolvedSearchParams.created) || searchValue(resolvedSearchParams.reconnect)
    ? parseCredentialCookie(cookieStore.get("smallkhoj_last_computer_connect_command")?.value)
    : null
  const pendingCredential = pendingCookie?.mode === "create" ? pendingCookie : null
  const reconnectComputerId = searchValue(resolvedSearchParams.reconnect)
  const reconnectCredential = pendingCookie?.mode === "reconnect" ? pendingCookie : null
  const connectedComputer = pendingCredential
    ? computers.find((c) => c.name === pendingCredential.name && (c.status === "online" || c.status === "active"))
    : null
  const credential = connectedComputer ? null : pendingCredential
  const showConnectComputerForm = shouldShowConnectComputerForm({
    computerCount: computers.length,
    hasPendingCredential: Boolean(credential),
  })
  const error = searchValue(resolvedSearchParams.error)
  const runningWorkspaces = computers.reduce(
    (total, c) => total + c.agentWorkspaces.filter((w) => w.status === "running").length,
    0,
  )
  const onlineComputers = computers.filter((c) => c.status === "online" || c.status === "active").length

  return (
    <ProductShell
      active="computers"
      title={copy.title}
      description={copy.description}
      session={session}
      listTitle="Computers"
      list={
        <nav className="flex h-full min-h-0 flex-col">
          <div className="flex items-center justify-between border-b border-sand-border px-3 py-2.5 text-sm">
            <span className="font-semibold text-sand-ink">{copy.computerCount(computers.length)}</span>
            <span className="text-xs text-sand-muted">{onlineComputers} {copy.online}</span>
          </div>
          <div data-inkframe-mobile-role="computers-list" className="min-h-0 min-w-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto p-2">
            {computers.map((computer) => (
              <ComputerListRow key={computer.id} computer={computer} selectedId={selectedComputerId} copy={copy} />
            ))}
            {computers.length === 0 && (
              <p className="px-2 py-4 text-center text-xs text-sand-muted">{copy.noComputers}</p>
            )}
          </div>
        </nav>
      }
      listConfig={{
        storageKey: "smallkhoj.computers.listWidth",
        defaultWidth: 300,
        min: 240,
        max: 420,
      }}
      sidebarTitle={copy.runtimeSnapshot}
      sidebarDescription={copy.runtimeSnapshotDesc}
      sidebar={
        <div className="space-y-2">
          <ObjectMetric label={copy.registered} value={computers.length} />
          <ObjectMetric label={copy.online} value={onlineComputers} />
          <ObjectMetric label={copy.runningWorkspaces} value={runningWorkspaces} />
        </div>
      }
      actions={
        <>
          <Link href="/members">
            <Button variant="outline" size="sm">
              <Bot className="size-4" />
              {copy.members}
            </Button>
          </Link>
          <Link href="/tasks">
            <Button variant="outline" size="sm">
              {copy.tasks}
            </Button>
          </Link>
        </>
      }
    >
      <RealtimeRefresh eventTypes={["workspace.updated", "runtime.updated", "computer.status.updated", "member.status.updated"]} />
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-primary" />
            {copy.registered} <span className="font-medium text-foreground">{computers.length}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" />
            {copy.online} <span className="font-medium text-foreground">{onlineComputers}</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-warning" />
            {copy.runningWorkspaces} <span className="font-medium text-foreground">{runningWorkspaces}</span>
          </span>
        </div>

        {showConnectComputerForm && (
          <ConnectComputerForm
            action={createComputerConnectCommandAction}
            credential={credential}
            connectedComputerName={connectedComputer?.name}
            error={error}
          />
        )}

        {selectedComputer ? (
          <ComputerDetail
            computer={selectedComputer}
            reconnectCredential={reconnectCredential}
            reconnectComputerId={reconnectComputerId}
            copy={copy}
          />
        ) : (
          <Card>
            <CardContent>
              <EmptyState title={copy.selectForDetail} description={copy.noComputersDesc} />
            </CardContent>
          </Card>
        )}
      </div>
    </ProductShell>
  )
}
