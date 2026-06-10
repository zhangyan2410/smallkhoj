import Link from "next/link"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { Bot, Cpu, HardDrive, Shield, UserRound } from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { EmptyState, RuntimeChip, StatusPill } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  apiGet,
  badgeClass,
  dotClass,
  type Computer,
  type Member,
  shortId,
  statusLabel,
} from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

async function getMembers() {
  return apiGet<{ members: Member[]; count?: number }>("/api/v1/members", { members: [], count: 0 })
}

async function getComputers() {
  return apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] })
}

async function createAgentAction(formData: FormData) {
  "use server"
  const name = formData.get("name") as string
  const computerId = formData.get("computerId") as string
  const runtime = formData.get("runtime") as string || "claude_code"
  const backend = formData.get("backend") as string
  if (!name || !computerId) redirect("/members?error=Missing%20name%20or%20computer")
  const response = await fetch(`${API_BASE}/api/v1/members/agents`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ name, computerId, runtime, backend }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/members?error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/members")
  redirect("/members")
}

function profileName(member: Member) {
  return member.profile?.displayName || member.displayName || member.name
}

function profileDescription(member: Member) {
  return member.profile?.description ?? member.description
}

function profileAvatar(member: Member) {
  return member.profile?.avatarUrl ?? member.avatarUrl
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

function searchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function MembersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await requireCurrentAccount()
  const resolvedSearchParams = (await searchParams) ?? {}
  const { members } = await getMembers()
  const { computers } = await getComputers()
  const error = searchValue(resolvedSearchParams.error)
  const humans = members.filter((member) => member.kind === "human").length
  const agents = members.filter((member) => member.kind === "agent").length
  const boundAgents = members.filter((member) => member.kind === "agent" && member.computerId).length

  return (
    <ProductShell
      active="members"
      title="Members"
      description="Humans and agents with profile, runtime binding, permissions, skills, and activity hints."
      session={session}
      sidebarTitle="Member Groups"
      sidebarDescription="The selected-member tabs will grow from this directory surface."
      sidebar={
        <div className="space-y-2">
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">Humans</div>
            <div className="mt-1 text-2xl font-semibold">{humans}</div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">Agents</div>
            <div className="mt-1 text-2xl font-semibold">{agents}</div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">Bound agents</div>
            <div className="mt-1 text-2xl font-semibold">{boundAgents}</div>
          </div>
        </div>
      }
      actions={
        <>
            <Link href="/computers">
              <Button variant="outline" size="sm">
                <HardDrive className="size-4" />
                Computers
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
              <CardDescription>Total</CardDescription>
              <CardTitle className="text-2xl">{members.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Humans</CardDescription>
              <CardTitle className="text-2xl">{humans}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Agents Bound</CardDescription>
              <CardTitle className="text-2xl">
                {boundAgents}
                <span className="ml-2 text-xs font-normal text-muted-foreground">of {agents}</span>
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4" />
              Create Agent
            </CardTitle>
            <CardDescription>Create a new agent and bind it to a computer runtime.</CardDescription>
          </CardHeader>
          <CardContent>
            {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
            <form action={createAgentAction} className="flex flex-wrap items-end gap-3">
              <div>
                <label htmlFor="agent-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Agent Name
                </label>
                <Input id="agent-name" name="name" placeholder="my-agent" required className="w-36" />
              </div>
              <div>
                <label htmlFor="agent-computer" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Computer
                </label>
                <select
                  id="agent-computer"
                  name="computerId"
                  required
                  className="h-9 rounded-md border bg-background px-3 text-sm"
                >
                  <option value="">Select...</option>
                  {computers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="agent-runtime" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Runtime
                </label>
                <select id="agent-runtime" name="runtime" className="h-9 rounded-md border bg-background px-3 text-sm">
                  <option value="claude_code">Claude Code</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              <div>
                <label htmlFor="agent-backend" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Backend
                </label>
                <Input id="agent-backend" name="backend" placeholder="Claude" className="w-28" />
              </div>
              <Button type="submit" size="sm">Create Agent</Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-3 xl:grid-cols-2">
          {members.map((member) => {
            const avatar = profileAvatar(member)
            const description = profileDescription(member)
            const permissions = member.permissions ?? member.config?.permissions ?? {}
            const actions = member.actions ?? member.config?.actions ?? {}

            return (
              <Card key={member.id}>
                <CardHeader className="border-b">
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    <span className={`size-2 rounded-full ${dotClass(member.status)}`} />
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt="" className="size-7 rounded-md border object-cover" />
                    ) : (
                      <span className="inline-flex size-7 items-center justify-center rounded-md border bg-muted">
                        {member.kind === "agent" ? <Bot className="size-4" /> : <UserRound className="size-4" />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{profileName(member)}</span>
                    <StatusBadge status={member.status} />
                  </CardTitle>
                  <CardDescription className="flex flex-wrap items-center gap-2">
                    <span>{member.handle || `@${member.name}`}</span>
                    <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{member.kind}</span>
                    {member.backend && <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{member.backend}</span>}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 pt-4">
                  <p className="min-h-5 text-sm text-muted-foreground">{description || "No profile description."}</p>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <Field label="memberId" value={shortId(member.id)} />
                    <Field label="computerId" value={shortId(member.computerId)} />
                    <Field label="workspaceId" value={shortId(member.workspaceId)} />
                  </div>

                  <div className="grid gap-3 lg:grid-cols-3">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                        <Cpu className="size-3" />
                        Skills
                      </div>
                      <div className="flex min-h-8 flex-wrap gap-1.5">
                        {(member.skills?.length ? member.skills : ["none"]).map((skill) => (
                          <RuntimeChip key={skill}>
                            {skill}
                          </RuntimeChip>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                        <Shield className="size-3" />
                        Permissions
                      </div>
                      <div className="flex min-h-8 flex-wrap gap-1.5">
                        {Object.keys(permissions).length > 0 ? (
                          Object.entries(permissions).map(([key, enabled]) => (
                            <span key={key} className="rounded-md border bg-background px-2 py-1 text-xs">
                              {key}: {enabled ? "on" : "off"}
                            </span>
                          ))
                        ) : (
                          <span className="rounded-md border bg-background px-2 py-1 text-xs">default</span>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">Actions</div>
                      <div className="flex min-h-8 flex-wrap gap-1.5">
                        {Object.keys(actions).length > 0 ? (
                          Object.entries(actions).map(([key, enabled]) => (
                            <span key={key} className="rounded-md border bg-background px-2 py-1 text-xs">
                              {key}: {enabled ? "on" : "off"}
                            </span>
                          ))
                        ) : (
                          <span className="rounded-md border bg-background px-2 py-1 text-xs">default</span>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>

        {members.length === 0 && (
          <Card>
            <CardContent>
              <EmptyState title="No members returned" description="Create or seed a human/agent member to start." />
            </CardContent>
          </Card>
        )}
      </div>
    </ProductShell>
  )
}
