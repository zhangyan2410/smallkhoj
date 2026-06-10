import Link from "next/link"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Bot, Clock, Cpu, Network, RefreshCw, Terminal } from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { EmptyState, RuntimeChip, StatusPill } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ConnectComputerForm } from "./connect-computer-form"
import {
  apiGet,
  badgeClass,
  dotClass,
  formatTime,
  runtimeLabel,
  shortId,
  statusLabel,
  type Computer,
} from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

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
    body: JSON.stringify({ name }),
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
    body: JSON.stringify({}),
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
  redirect(`/computers?reconnect=${encodeURIComponent(data.computerId)}`)
}

function StatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} label={statusLabel(status)} className={badgeClass(status)} />
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-2">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value || "none"}</div>
    </div>
  )
}

export default async function ComputersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireCurrentAccount()
  const resolvedSearchParams = (await searchParams) ?? {}
  const cookieStore = await cookies()
  const { computers } = await getComputers()
  const pendingCookie = searchValue(resolvedSearchParams.created) || searchValue(resolvedSearchParams.reconnect)
    ? parseCredentialCookie(cookieStore.get("smallkhoj_last_computer_connect_command")?.value)
    : null
  const pendingCredential = pendingCookie?.mode === "create" ? pendingCookie : null
  const reconnectComputerId = searchValue(resolvedSearchParams.reconnect)
  const reconnectCredential = pendingCookie?.mode === "reconnect" ? pendingCookie : null
  const connectedComputer = pendingCredential
    ? computers.find((computer) => computer.name === pendingCredential.name && (computer.status === "online" || computer.status === "active"))
    : null
  const credential = connectedComputer ? null : pendingCredential
  const error = searchValue(resolvedSearchParams.error)
  const workspaceCount = computers.reduce((total, computer) => total + computer.agentWorkspaces.length, 0)
  const runningWorkspaces = computers.reduce(
    (total, computer) => total + computer.agentWorkspaces.filter((workspace) => workspace.status === "running").length,
    0
  )
  const onlineComputers = computers.filter((computer) => computer.status === "online" || computer.status === "active").length

  return (
    <ProductShell
      active="computers"
      title="Computers"
      description="Daemon onboarding, reconnect commands, detected runtimes, and agent workspace status."
      session={session}
      sidebarTitle="Runtime Snapshot"
      sidebarDescription="Live counts from the connected control plane."
      sidebar={
        <div className="space-y-2">
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">Registered</div>
            <div className="mt-1 text-2xl font-semibold">{computers.length}</div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">Online</div>
            <div className="mt-1 text-2xl font-semibold">{onlineComputers}</div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">Running workspaces</div>
            <div className="mt-1 text-2xl font-semibold">{runningWorkspaces}</div>
          </div>
        </div>
      }
      actions={
        <>
            <Link href="/members">
              <Button variant="outline" size="sm">
                <Bot className="size-4" />
                Members
              </Button>
            </Link>
            <Link href="/tasks">
              <Button variant="outline" size="sm">
                Tasks
              </Button>
            </Link>
        </>
      }
    >
      <div className="space-y-5">

        <div className="grid gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Registered</CardDescription>
              <CardTitle className="text-2xl">
                {computers.length}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{onlineComputers} online</span>
              </CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Workspaces</CardDescription>
              <CardTitle className="text-2xl">{workspaceCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Running</CardDescription>
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

        <div className="space-y-4">
          {computers.map((computer) => (
            <Card key={computer.id}>
              <CardHeader className="border-b">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className={`size-2 rounded-full ${dotClass(computer.status)}`} />
                  <span className="min-w-0 flex-1 truncate">{computer.name}</span>
                  <StatusBadge status={computer.status} />
                </CardTitle>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{computer.os || "unknown os"}</span>
                    <span>daemon {computer.daemonVersion || "unknown"}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatTime(computer.lastHeartbeatAt)}
                    </span>
                  </CardDescription>
                  <form action={createComputerReconnectCommandAction}>
                    <input type="hidden" name="computerId" value={computer.id} />
                    <Button type="submit" size="sm" variant="outline">
                      <RefreshCw className="size-4" />
                      Reconnect
                    </Button>
                  </form>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {reconnectCredential?.computerId === computer.id && reconnectComputerId === computer.id && (
                  <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">Reconnect Command</div>
                      <div className="text-xs text-muted-foreground">Use on {computer.name}</div>
                    </div>
                    <code
                      data-testid="reconnect-command"
                      className="block whitespace-pre-wrap break-all rounded-md border bg-background p-2 text-xs"
                    >
                      {reconnectCredential.command}
                    </code>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase text-muted-foreground">Computer Name</div>
                        <div className="truncate font-mono text-xs">{reconnectCredential.name}</div>
                      </div>
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium uppercase text-muted-foreground">Expires</div>
                        <div className="truncate font-mono text-xs">{reconnectCredential.expiresAt}</div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid gap-2 sm:grid-cols-5">
                  <Field label="computerId" value={shortId(computer.id)} />
                  <Field label="machineId" value={shortId(computer.machineId)} />
                  <Field label="serverId" value={shortId(computer.serverId)} />
                  <Field label="apiKey" value={computer.apiKeyPrefix} />
                  <Field label="lease" value={formatTime(computer.daemonLeaseExpiresAt)} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <Cpu className="size-3" />
                    Detected runtimes
                  </div>
                  <div className="flex min-h-8 flex-wrap gap-1.5">
                    {(computer.detectedRuntimes.length ? computer.detectedRuntimes : ["none"]).map((runtime) => (
                      <RuntimeChip key={runtimeLabel(runtime)}>
                        {runtimeLabel(runtime)}
                      </RuntimeChip>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <Network className="size-3" />
                    Agent workspaces
                  </div>
                  <div className="overflow-hidden rounded-md border">
                    <div className="hidden grid-cols-[1.15fr_0.85fr_0.7fr_0.7fr_1fr] gap-2 border-b bg-muted/60 px-3 py-2 text-xs font-medium uppercase text-muted-foreground md:grid">
                      <span>Agent</span>
                      <span>Runtime</span>
                      <span>Status</span>
                      <span>PID</span>
                      <span>CWD</span>
                    </div>
                    {computer.agentWorkspaces.map((workspace) => (
                      <div
                        key={workspace.id}
                        className="grid gap-2 border-b px-3 py-3 last:border-b-0 md:grid-cols-[1.15fr_0.85fr_0.7fr_0.7fr_1fr] md:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Bot className="size-4 text-muted-foreground" />
                            <span className="truncate text-sm font-medium">
                              {workspace.agentHandle || `@${workspace.agentName ?? workspace.agentId}`}
                            </span>
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
                            {shortId(workspace.workspaceId || workspace.id)} · {workspace.backend || "backend unknown"}
                          </div>
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-sm">
                            <Terminal className="size-4 text-muted-foreground" />
                            <span className="truncate">{workspace.runtime || "runtime"}</span>
                          </div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">
                            {workspace.runtimeModel || workspace.runtimeCommand || "no model"}
                          </div>
                        </div>
                        <StatusBadge status={workspace.status} />
                        <div className="font-mono text-xs text-muted-foreground">{workspace.pid ?? "none"}</div>
                        <div className="min-w-0 truncate text-xs text-muted-foreground">{workspace.cwd || "no cwd"}</div>
                      </div>
                    ))}
                    {computer.agentWorkspaces.length === 0 && (
                      <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                        No agent workspaces registered on this computer.
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {computers.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState title="No computers returned" description="Generate a connect command above to register the first daemon." />
            </CardContent>
          </Card>
        )}
      </div>
    </ProductShell>
  )
}
