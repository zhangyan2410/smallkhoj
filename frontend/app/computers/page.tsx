import Link from "next/link"
import { ArrowLeft, Bot, Clock, Cpu, HardDrive, Network, Terminal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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

async function getComputers() {
  return apiGet<{ computers: Computer[]; count?: number }>("/api/v1/computers", { computers: [], count: 0 })
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex h-6 items-center rounded-md border px-2 text-xs ${badgeClass(status)}`}>
      {statusLabel(status)}
    </span>
  )
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-2">
      <div className="text-[11px] font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value || "none"}</div>
    </div>
  )
}

export default async function ComputersPage() {
  const { computers } = await getComputers()
  const workspaceCount = computers.reduce((total, computer) => total + computer.agentWorkspaces.length, 0)
  const runningWorkspaces = computers.reduce(
    (total, computer) => total + computer.agentWorkspaces.filter((workspace) => workspace.status === "running").length,
    0
  )
  const onlineComputers = computers.filter((computer) => computer.status === "online" || computer.status === "active").length

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Link href="/daemon">
              <Button variant="outline" size="icon-sm" aria-label="返回控制台">
                <ArrowLeft />
              </Button>
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
                <HardDrive className="size-6 text-primary" />
                Computers
              </h1>
              <p className="text-sm text-muted-foreground">Daemon registrations, detected runtimes, and linked agent workspaces</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>

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

        <div className="space-y-4">
          {computers.map((computer) => (
            <Card key={computer.id}>
              <CardHeader className="border-b">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className={`size-2 rounded-full ${dotClass(computer.status)}`} />
                  <span className="min-w-0 flex-1 truncate">{computer.name}</span>
                  <StatusBadge status={computer.status} />
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{computer.os || "unknown os"}</span>
                  <span>daemon {computer.daemonVersion || "unknown"}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3" />
                    {formatTime(computer.lastHeartbeatAt)}
                  </span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="grid gap-2 sm:grid-cols-4">
                  <Field label="computerId" value={shortId(computer.id)} />
                  <Field label="serverId" value={shortId(computer.serverId)} />
                  <Field label="apiKey" value={computer.apiKeyPrefix} />
                  <Field label="updated" value={formatTime(computer.updatedAt)} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                    <Cpu className="size-3" />
                    Detected runtimes
                  </div>
                  <div className="flex min-h-8 flex-wrap gap-1.5">
                    {(computer.detectedRuntimes.length ? computer.detectedRuntimes : ["none"]).map((runtime) => (
                      <span key={runtimeLabel(runtime)} className="rounded-md border bg-background px-2 py-1 text-xs">
                        {runtimeLabel(runtime)}
                      </span>
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
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No computers returned from /api/v1/computers.
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
