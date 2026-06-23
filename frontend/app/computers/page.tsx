import Link from "next/link"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
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
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { EmptyState, StatusPill } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConnectComputerForm } from "./connect-computer-form"
import { buildComputerReconnectUrl } from "@/lib/computer-navigation"
import {
  apiGet,
  badgeClass,
  dotClass,
  formatTime,
  runtimeLabel,
  shortId,
  statusLabel,
  type AgentWorkspace,
  type Computer,
  type RuntimeInfo,
} from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

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

async function getComputers() {
  return apiGet<{ computers: Computer[]; count?: number }>("/api/v1/computers", { computers: [], count: 0 })
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
    }
  } catch {
    return null
  }
}

async function createComputerConnectCommandAction(formData: FormData) {
  "use server"

  const name = String(formData.get("name") || "").trim() || "unregistered-computer"
  const response = await fetch(`${API_BASE}/api/v1/computers/connect-command`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ name, serverUrl: API_BASE }),
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

  const response = await fetch(`${API_BASE}/api/v1/computers/${computerId}/reconnect-command`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ serverUrl: API_BASE }),
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

function StatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} label={statusLabel(status)} className={badgeClass(status)} />
}

function Field({ label, value, icon }: { label: string; value?: string | null; icon?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-2">
      <div className="flex items-center gap-1 text-[11px] font-medium uppercase text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-xs">{value || "none"}</div>
    </div>
  )
}

function runtimeStatusColor(status?: string) {
  if (!status) return "text-muted-foreground border-border"
  switch (status) {
    case "installed":
    case "available":
    case "active":
      return "text-emerald-600 border-emerald-200 bg-emerald-50"
    case "not_installed":
    case "unavailable":
    case "missing":
      return "text-rose-600 border-rose-200 bg-rose-50"
    case "unknown":
    case "detecting":
      return "text-amber-600 border-amber-200 bg-amber-50"
    default:
      return "text-muted-foreground border-border"
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
      <span className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
        {runtime}
      </span>
    )
  }
  const status = runtime.status
  const label = runtimeLabel(runtime)
  const colorClass = runtimeStatusColor(status)
  const icon = runtimeStatusIcon(status)

  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${colorClass}`}>
      {icon}
      {label}
    </span>
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/computers" className="text-sm text-muted-foreground hover:text-foreground">
          ← {copy.allComputers}
        </Link>
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
            <Monitor className="size-5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{computer.name}</span>
            <StatusBadge status={computer.status} />
          </CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
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
        </CardHeader>
        <CardContent className="space-y-5 pt-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Power className="size-3" />
              {copy.lifecycleControls}
            </div>
            <div className="rounded-md border p-3">
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
                <p className="mt-1 text-xs text-amber-700">
                  {copy.offlineHelp}
                </p>
              ) : null}
            </div>
          </div>

          {reconnectCredential?.computerId === computer.id && reconnectComputerId === computer.id && (
            <div className="space-y-2 rounded-md border bg-muted/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-medium uppercase text-muted-foreground">{copy.reconnectCommand}</div>
                <div className="text-xs text-muted-foreground">{copy.useOn(computer.name)}</div>
              </div>
              <code
                data-testid="reconnect-command"
                className="block whitespace-pre-wrap break-all rounded-md border bg-background p-2 text-xs"
              >
                {reconnectCredential.command}
              </code>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={copy.computerName} value={reconnectCredential.name} />
                <Field label={copy.expires} value={reconnectCredential.expiresAt} />
              </div>
            </div>
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
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
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
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Network className="size-3" />
              {copy.agentWorkspaces}
            </div>
            <div className="overflow-hidden rounded-md border">
              <div className="hidden grid-cols-[1.1fr_0.8fr_0.65fr_0.55fr_0.6fr_0.9fr_1fr] gap-2 border-b bg-muted/60 px-3 py-2 text-xs font-medium uppercase text-muted-foreground md:grid">
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
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Trash2 className="size-3" />
              {copy.delete}
            </div>
            <div className="rounded-md border border-rose-200 bg-rose-50/50 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 text-rose-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-rose-700">{copy.deleteComputer}</p>
                  <p className="mt-1 text-xs text-rose-600">
                    {copy.deleteComputerDesc}
                  </p>
                  {deleteBlockingWorkspaces > 0 && (
                    <p className="mt-1 text-xs text-rose-600">
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
                      className="border-rose-200 text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 className="size-3.5" />
                      {copy.delete}
                    </Button>
                  </form>
                </div>
              </div>
            </div>
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
    <div className="grid gap-2 border-b px-3 py-3 last:border-b-0 md:grid-cols-[1.1fr_0.8fr_0.65fr_0.55fr_0.6fr_0.9fr_1fr] md:items-center">
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
      <StatusBadge status={workspace.status} />
      <div className="font-mono text-xs text-muted-foreground">{workspace.pid ?? copy.none}</div>
      <div className="truncate font-mono text-xs text-muted-foreground" title={workspace.sessionId ?? ""}>
        {workspace.sessionId ? shortId(workspace.sessionId) : copy.none}
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        <div className="truncate">{workspace.cwd || copy.noCwd}</div>
        {runtimeError ? (
          <div className="mt-1 flex items-start gap-1 text-rose-600" title={runtimeError}>
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
    <Link href={`/computers?computer=${computer.id}`}>
      <Card className={`cursor-pointer transition-colors hover:border-primary/40 ${isSelected ? "border-primary/50 ring-1 ring-primary/30" : ""}`}>
        <CardContent className="flex items-center gap-3 p-3">
          <span className={`size-2 shrink-0 rounded-full ${dotClass(computer.status)}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{computer.name}</span>
              <StatusBadge status={computer.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              <span>{computer.os || copy.unknownOs}</span>
              <span>daemon {computer.daemonVersion || copy.unknown}</span>
              <span>{copy.workspacesRunning(computer.agentWorkspaces.length, running)}</span>
              <span className="inline-flex items-center gap-1">
                <Clock className="size-3" />
                {formatTime(computer.lastHeartbeatAt)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
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
  const { computers } = await getComputers()

  const selectedComputerId = searchValue(resolvedSearchParams.computer)
  const selectedComputer = selectedComputerId
    ? computers.find((c) => c.id === selectedComputerId || c.id.startsWith(selectedComputerId))
    : null

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
  const error = searchValue(resolvedSearchParams.error)
  const workspaceCount = computers.reduce((total, c) => total + c.agentWorkspaces.length, 0)
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
      sidebarTitle={copy.runtimeSnapshot}
      sidebarDescription={copy.runtimeSnapshotDesc}
      sidebar={
        <div className="space-y-2">
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">{copy.registered}</div>
            <div className="mt-1 text-2xl font-semibold">{computers.length}</div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">{copy.online}</div>
            <div className="mt-1 text-2xl font-semibold">{onlineComputers}</div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">{copy.runningWorkspaces}</div>
            <div className="mt-1 text-2xl font-semibold">{runningWorkspaces}</div>
          </div>
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
        <div className="grid gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>{copy.registered}</CardDescription>
              <CardTitle className="text-2xl">
                {computers.length}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{onlineComputers} {copy.online}</span>
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>{copy.agentWorkspaces}</CardDescription>
              <CardTitle className="text-2xl">{workspaceCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>{copy.runningWorkspaces}</CardDescription>
              <CardTitle className="text-2xl">{runningWorkspaces}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <ConnectComputerForm
          action={createComputerConnectCommandAction}
          credential={credential}
          connectedComputerName={connectedComputer?.name}
          error={error}
        />

        {selectedComputer ? (
          <ComputerDetail
            computer={selectedComputer}
            reconnectCredential={reconnectCredential}
            reconnectComputerId={reconnectComputerId}
            copy={copy}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Monitor className="size-4" />
              {copy.computerCount(computers.length)}
              <span className="text-xs">({copy.selectForDetail})</span>
            </div>
            {computers.map((computer) => (
              <ComputerListRow key={computer.id} computer={computer} selectedId={selectedComputerId} copy={copy} />
            ))}
            {computers.length === 0 && (
              <Card>
                <CardContent>
                  <EmptyState title={copy.noComputers} description={copy.noComputersDesc} />
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </ProductShell>
  )
}
