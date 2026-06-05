import Link from "next/link"
import { ArrowLeft, Bot, Cpu, HardDrive, Shield, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  apiGet,
  badgeClass,
  dotClass,
  type Member,
  shortId,
  statusLabel,
} from "@/lib/control-plane"

async function getMembers() {
  return apiGet<{ members: Member[]; count?: number }>("/api/v1/members", { members: [], count: 0 })
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

export default async function MembersPage() {
  const { members } = await getMembers()
  const humans = members.filter((member) => member.kind === "human").length
  const agents = members.filter((member) => member.kind === "agent").length
  const boundAgents = members.filter((member) => member.kind === "agent" && member.computerId).length

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
                <UserRound className="size-6 text-primary" />
                Members
              </h1>
              <p className="text-sm text-muted-foreground">Unified human and agent directory with P1 binding fields</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
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
          </div>
        </div>

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
                          <span key={skill} className="rounded-md border bg-background px-2 py-1 text-xs">
                            {skill}
                          </span>
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
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No members returned from /api/v1/members.
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
