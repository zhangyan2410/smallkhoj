import Link from "next/link"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import {
  Activity,
  Bell,
  Bot,
  Cpu,
  HardDrive,
  MessageSquare,
  Puzzle,
  Shield,
  User,
  UserRound,
  Wrench,
} from "lucide-react"

import ActivityTab from "./activity-tab"

import { ProductShell } from "@/components/product-shell"
import { EmptyState, RuntimeChip, StatusPill } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  apiGet,
  badgeClass,
  dotClass,
  formatTime,
  type Computer,
  type Member,
  runtimeLabel,
  shortId,
  statusLabel,
} from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
const EXPECTED_RUNTIME_PROVIDERS = ["Codex CLI", "OpenCode", "Antigravity", "Pi"]

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
  const runtimeProvider = formData.get("runtimeProvider") as string
  if (!name || !computerId) redirect("/members?error=Missing%20name%20or%20computer")
  const response = await fetch(`${API_BASE}/api/v1/members/agents`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ name, computerId, runtime, runtimeProvider }),
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
  return member.profile?.displayName || member.displayName
}

function profileDescription(member: Member) {
  return member.profile?.description ?? member.description
}

function profileAvatar(member: Member) {
  return member.profile?.avatarUrl ?? member.avatarUrl
}

function searchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function detectedProviderOptions(computers: Computer[]) {
  const options = new Map<string, string>()
  for (const computer of computers) {
    for (const runtime of computer.detectedRuntimes) {
      if (typeof runtime === "string") continue
      const provider = runtime.runtimeProvider ?? runtime.provider
      if (!provider) continue
      options.set(provider, runtimeLabel(runtime))
    }
  }
  return Array.from(options, ([value, label]) => ({ value, label }))
}

function unavailableProviderOptions(providerOptions: Array<{ value: string; label: string }>) {
  const available = new Set(providerOptions.map((provider) => provider.value))
  return EXPECTED_RUNTIME_PROVIDERS
    .filter((provider) => !available.has(provider))
    .map((provider) => ({
      value: provider,
      label: `${provider} (not detected on connected computers)`,
    }))
}

type TabKey = "profile" | "permissions" | "dms" | "reminders" | "workspace" | "apps" | "activity"

const memberTabs: Array<{ key: TabKey; label: string; icon: typeof User }> = [
  { key: "profile", label: "Profile", icon: User },
  { key: "permissions", label: "Permissions", icon: Shield },
  { key: "dms", label: "DMs", icon: MessageSquare },
  { key: "reminders", label: "Reminders", icon: Bell },
  { key: "workspace", label: "Workspace", icon: Cpu },
  { key: "apps", label: "Apps", icon: Puzzle },
  { key: "activity", label: "Activity", icon: Activity },
]

function memberDetailHref(memberId: string, tab?: TabKey) {
  const params = new URLSearchParams()
  params.set("member", memberId)
  if (tab) params.set("tab", tab)
  return `/members?${params.toString()}`
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

function MemberRow({ member, selected }: { member: Member; selected: boolean }) {
  const avatar = profileAvatar(member)
  const name = profileName(member)
  const href = memberDetailHref(member.id)

  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-sm transition-colors hover:bg-accent ${
        selected ? "bg-primary/8 border border-primary/20" : "border border-transparent"
      }`}
    >
      <span className={`size-2 shrink-0 rounded-full ${dotClass(member.status)}`} />
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="size-6 rounded-md border object-cover" />
      ) : (
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border bg-muted">
          {member.kind === "agent" ? <Bot className="size-3.5" /> : <UserRound className="size-3.5" />}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
        {member.kind}
      </span>
    </Link>
  )
}

function TabBar({ activeTab, memberId }: { activeTab: TabKey; memberId: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b pb-px">
      {memberTabs.map(({ key, label, icon: Icon }) => {
        const isActive = key === activeTab
        return (
          <Link
            key={key}
            href={memberDetailHref(memberId, key)}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-t-md border-b-2 px-3 text-xs font-medium transition-colors ${
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            {label}
          </Link>
        )
      })}
    </div>
  )
}

function ProfileTab({ member, computers }: { member: Member; computers: Computer[] }) {
  const description = profileDescription(member)
  const avatar = profileAvatar(member)
  const computer = computers.find((c) => c.id === member.computerId)
  const workspace = computer?.agentWorkspaces.find((w) => w.agentId === member.id)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" className="size-14 rounded-lg border object-cover" />
        ) : (
          <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-lg border bg-muted">
            {member.kind === "agent" ? <Bot className="size-7" /> : <UserRound className="size-7" />}
          </span>
        )}
        <div className="min-w-0">
          <div className="text-lg font-semibold">{profileName(member)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{member.handle || `@${member.displayName}`}</span>
            <StatusBadge status={member.status} />
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{member.kind}</span>
            {(member.runtimeProvider || member.backend) && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                {member.runtimeProvider || member.backend}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{description || "No profile description."}</p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="memberId" value={shortId(member.id)} />
        <Field label="computerId" value={shortId(member.computerId)} />
        <Field label="workspaceId" value={shortId(member.workspaceId)} />
      </div>

      {member.kind === "agent" && computer && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <Cpu className="size-3" />
            Runtime Binding
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="computer" value={computer.name} />
            <Field label="computer status" value={computer.status} />
            <Field label="runtime" value={workspace?.runtime ?? "unbound"} />
            <Field label="provider" value={workspace?.runtimeProvider ?? member.runtimeProvider ?? "default"} />
            <Field label="pid" value={workspace?.pid?.toString() ?? "none"} />
            <Field label="session" value={shortId(workspace?.sessionId)} />
          </div>
          {workspace?.cwd && (
            <Field label="cwd" value={workspace.cwd} />
          )}
        </div>
      )}

      {member.skills && member.skills.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
            <Wrench className="size-3" />
            Skills
          </div>
          <div className="flex flex-wrap gap-1.5">
            {member.skills.map((skill) => (
              <RuntimeChip key={skill}>{skill}</RuntimeChip>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

async function updatePermissionsAction(formData: FormData) {
  "use server"
  const memberId = String(formData.get("memberId") || "")
  if (!memberId) return
  const permissionsRaw = String(formData.get("permissions") || "{}")
  const actionsRaw = String(formData.get("actions") || "{}")
  const permissions = JSON.parse(permissionsRaw) as Record<string, boolean>
  const actions = JSON.parse(actionsRaw) as Record<string, boolean>
  await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ permissions, actions }),
  })
  revalidatePath("/members")
}

function PermissionsTab({ member }: { member: Member }) {
  const permissions = member.permissions ?? member.config?.permissions ?? {}
  const actions = member.actions ?? member.config?.actions ?? {}
  const isAgent = member.kind === "agent"

  return (
    <div className="space-y-5">
      <form action={updatePermissionsAction} className="space-y-5">
        <input type="hidden" name="memberId" value={member.id} />
        <input type="hidden" name="permissions" value={JSON.stringify(permissions)} />
        <input type="hidden" name="actions" value={JSON.stringify(actions)} />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Shield className="size-3" />
              Permissions
            </div>
            {isAgent && Object.keys(permissions).length > 0 && (
              <Button type="submit" size="sm" variant="outline">Save permissions</Button>
            )}
          </div>
          {Object.keys(permissions).length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(permissions).map(([key, enabled]) => (
                <div key={key} className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                  <span className="text-sm">{key}</span>
                  <span className={`text-xs font-medium ${enabled ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {enabled ? "enabled" : "disabled"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No custom permissions" description={isAgent ? "Add a permission key below to configure this agent's policy." : "This member uses default permissions."} />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
              <Activity className="size-3" />
              Actions
            </div>
            {isAgent && Object.keys(actions).length > 0 && (
              <Button type="submit" size="sm" variant="outline">Save actions</Button>
            )}
          </div>
          {Object.keys(actions).length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(actions).map(([key, enabled]) => (
                <div key={key} className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                  <span className="text-sm">{key}</span>
                  <span className={`text-xs font-medium ${enabled ? "text-emerald-600" : "text-muted-foreground"}`}>
                    {enabled ? "on" : "off"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No custom actions" description={isAgent ? "Add an action key below to configure this agent's allowed actions." : "This member uses default actions."} />
          )}
        </div>
      </form>

      {isAgent && <AddPermissionForm memberId={member.id} permissions={permissions} actions={actions} />}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <Shield className="size-3" />
          Enforcement status
        </div>
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-amber-500" />
            <span className="text-sm">Config persisted but not enforced at runtime</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Permission and action changes are saved to member config immediately. Server-side enforcement
            (blocking unauthorized actions at the daemon/runtime level) is not yet implemented.
            Changes will propagate on the next agent session refresh.
          </p>
        </div>
      </div>
    </div>
  )
}

async function addPermissionEntryAction(formData: FormData) {
  "use server"
  const memberId = String(formData.get("memberId") || "")
  const type = String(formData.get("type") || "permissions")
  const key = String(formData.get("key") || "").trim()
  const value = formData.get("value") === "true"
  if (!memberId || !key) return
  const existingRaw = String(formData.get("existing") || "{}")
  const existing = JSON.parse(existingRaw) as Record<string, boolean>
  const merged = { ...existing, [key]: value }
  await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ [type]: merged }),
  })
  revalidatePath("/members")
}

async function removePermissionEntryAction(formData: FormData) {
  "use server"
  const memberId = String(formData.get("memberId") || "")
  const type = String(formData.get("type") || "permissions")
  const key = String(formData.get("key") || "").trim()
  if (!memberId || !key) return
  const existingRaw = String(formData.get("existing") || "{}")
  const existing = JSON.parse(existingRaw) as Record<string, boolean>
  const rest = Object.fromEntries(Object.entries(existing).filter(([entryKey]) => entryKey !== key))
  await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ [type]: rest }),
  })
  revalidatePath("/members")
}

async function togglePermissionEntryAction(formData: FormData) {
  "use server"
  const memberId = String(formData.get("memberId") || "")
  const type = String(formData.get("type") || "permissions")
  const key = String(formData.get("key") || "").trim()
  const currentValue = formData.get("currentValue") === "true"
  if (!memberId || !key) return
  const existingRaw = String(formData.get("existing") || "{}")
  const existing = JSON.parse(existingRaw) as Record<string, boolean>
  const merged = { ...existing, [key]: !currentValue }
  await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ [type]: merged }),
  })
  revalidatePath("/members")
}

function AddPermissionForm({ memberId, permissions, actions }: {
  memberId: string
  permissions: Record<string, boolean>
  actions: Record<string, boolean>
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <Shield className="size-3" />
          Permission entries
        </div>
        {Object.keys(permissions).length > 0 && (
          <div className="space-y-1">
            {Object.entries(permissions).map(([key, enabled]) => (
              <form key={key} action={togglePermissionEntryAction} className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <input type="hidden" name="memberId" value={memberId} />
                <input type="hidden" name="type" value="permissions" />
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="currentValue" value={String(enabled)} />
                <input type="hidden" name="existing" value={JSON.stringify(permissions)} />
                <span className="text-sm font-mono">{key}</span>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" variant={enabled ? "default" : "outline"}>
                    {enabled ? "enabled" : "disabled"}
                  </Button>
                  <button formAction={removePermissionEntryAction} className="text-xs text-rose-500 hover:text-rose-700" title="Remove">
                    remove
                  </button>
                  <input type="hidden" formAction={undefined} name="existing" value={JSON.stringify(permissions)} />
                </div>
              </form>
            ))}
          </div>
        )}
        <form action={addPermissionEntryAction} className="flex items-end gap-2">
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="type" value="permissions" />
          <input type="hidden" name="existing" value={JSON.stringify(permissions)} />
          <Input name="key" placeholder="permission key" className="max-w-[200px]" />
          <select name="value" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="true">enabled</option>
            <option value="false">disabled</option>
          </select>
          <Button type="submit" size="sm" variant="outline">Add</Button>
        </form>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <Activity className="size-3" />
          Action entries
        </div>
        {Object.keys(actions).length > 0 && (
          <div className="space-y-1">
            {Object.entries(actions).map(([key, enabled]) => (
              <form key={key} action={togglePermissionEntryAction} className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
                <input type="hidden" name="memberId" value={memberId} />
                <input type="hidden" name="type" value="actions" />
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="currentValue" value={String(enabled)} />
                <input type="hidden" name="existing" value={JSON.stringify(actions)} />
                <span className="text-sm font-mono">{key}</span>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" variant={enabled ? "default" : "outline"}>
                    {enabled ? "on" : "off"}
                  </Button>
                  <button formAction={removePermissionEntryAction} className="text-xs text-rose-500 hover:text-rose-700" title="Remove">
                    remove
                  </button>
                  <input type="hidden" formAction={undefined} name="existing" value={JSON.stringify(actions)} />
                </div>
              </form>
            ))}
          </div>
        )}
        <form action={addPermissionEntryAction} className="flex items-end gap-2">
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="type" value="actions" />
          <input type="hidden" name="existing" value={JSON.stringify(actions)} />
          <Input name="key" placeholder="action key" className="max-w-[200px]" />
          <select name="value" className="h-9 rounded-md border bg-background px-2 text-sm">
            <option value="true">on</option>
            <option value="false">off</option>
          </select>
          <Button type="submit" size="sm" variant="outline">Add</Button>
        </form>
      </div>
    </div>
  )
}

function DmTab({ member }: { member: Member }) {
  return (
    <div className="space-y-4">
      <EmptyState
        title={`Direct messages with ${profileName(member)}`}
        description="Agent DM history and conversation threads will appear here."
      />
      <div className="rounded-md border border-dashed bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">
          DM channel for this member is <code className="rounded bg-muted px-1 font-mono">dm:&lt;your-id&gt;-&lt;member-id&gt;</code>.
          Use the Chat page to view conversation history.
        </p>
        <div className="mt-2">
          <Link href="/chat">
            <Button variant="outline" size="sm">
              <MessageSquare className="size-4" />
              Open Chat
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}

function RemindersTab({ member }: { member: Member }) {
  return (
    <div className="space-y-4">
      <EmptyState
        title={`Reminders for ${profileName(member)}`}
        description="Active and pending reminders assigned to this member."
      />
      <div className="rounded-md border border-dashed bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">
          Scheduled reminders for this {member.kind} are managed through the Control Plane dispatch.
          Reminders fire based on the configured delay and channel.
        </p>
      </div>
    </div>
  )
}

function WorkspaceTab({ member, computers }: { member: Member; computers: Computer[] }) {
  const computer = computers.find((c) => c.id === member.computerId)

  if (!computer) {
    return (
      <EmptyState
        title="No computer binding"
        description={member.kind === "human"
          ? "Humans are not bound to computers."
          : "This agent is not bound to any computer. Use the Create Agent form to bind it."}
      />
    )
  }

  const workspace = computer.agentWorkspaces.find((w) => w.agentId === member.id)

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-xs font-medium uppercase text-muted-foreground">Bound Computer</div>
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{computer.name}</span>
            <StatusBadge status={computer.status} />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <Field label="os" value={computer.os} />
            <Field label="daemon" value={computer.daemonVersion} />
            <Field label="heartbeat" value={formatTime(computer.lastHeartbeatAt)} />
          </div>
        </div>
      </div>

      {workspace && (
        <div className="space-y-2">
          <div className="text-xs font-medium uppercase text-muted-foreground">Agent Workspace</div>
          <div className="rounded-md border bg-background p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="status" value={workspace.status} />
              <Field label="pid" value={workspace.pid?.toString() ?? "none"} />
              <Field label="runtime" value={workspace.runtime ?? "default"} />
              <Field label="provider" value={workspace.runtimeProvider ?? "default"} />
              <Field label="model" value={workspace.runtimeModel ?? "default"} />
              <Field label="started" value={formatTime(workspace.startedAt)} />
              <Field label="stopped" value={formatTime(workspace.stoppedAt)} />
            </div>
            {workspace.cwd && <div className="mt-2"><Field label="cwd" value={workspace.cwd} /></div>}
          </div>
        </div>
      )}

      {!workspace && member.kind === "agent" && (
        <div className="rounded-md border border-dashed bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">
            This agent is bound to <code className="rounded bg-muted px-1 font-mono">{computer.name}</code> but has no
            active workspace. The workspace is created when the daemon launches a runtime session for this agent.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
          <Cpu className="size-3" />
          Detected Runtimes
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(computer.detectedRuntimes.length ? computer.detectedRuntimes : ["none"]).map((runtime, i) => (
            <RuntimeChip key={typeof runtime === "string" ? `${runtime}-${i}` : runtimeLabel(runtime)}>
              {runtimeLabel(runtime)}
            </RuntimeChip>
          ))}
        </div>
      </div>
    </div>
  )
}

function AppsTab({ member }: { member: Member }) {
  return (
    <div className="space-y-4">
      <EmptyState
        title={`Apps for ${profileName(member)}`}
        description="Integrations and connected apps will appear here."
      />
      <div className="rounded-md border border-dashed bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">
          App integrations are configured per agent through the runtime provider settings.
          Available integrations depend on the agent&apos;s runtime capabilities.
        </p>
      </div>
    </div>
  )
}

function MemberDetail({
  member,
  computers,
  activeTab,
}: {
  member: Member
  computers: Computer[]
  activeTab: TabKey
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          {member.kind === "agent" ? <Bot className="size-4" /> : <UserRound className="size-4" />}
          Member Detail
          <span className="ml-auto text-xs font-normal text-muted-foreground">{shortId(member.id)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <TabBar activeTab={activeTab} memberId={member.id} />
        <div className="min-h-48">
          {activeTab === "profile" && <ProfileTab member={member} computers={computers} />}
          {activeTab === "permissions" && <PermissionsTab member={member} />}
          {activeTab === "dms" && <DmTab member={member} />}
          {activeTab === "reminders" && <RemindersTab member={member} />}
          {activeTab === "workspace" && <WorkspaceTab member={member} computers={computers} />}
          {activeTab === "apps" && <AppsTab member={member} />}
          {activeTab === "activity" && <ActivityTab member={member} computers={computers} />}
        </div>
      </CardContent>
    </Card>
  )
}

function CreateAgentCard({
  computers,
  error,
  providerOptions,
}: {
  computers: Computer[]
  error?: string | null
  providerOptions: Array<{ value: string; label: string }>
}) {
  const unavailableProviders = unavailableProviderOptions(providerOptions)

  return (
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
            <label htmlFor="agent-provider" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Provider
            </label>
            <select
              id="agent-provider"
              name="runtimeProvider"
              className="h-9 min-w-36 rounded-md border bg-background px-3 text-sm"
            >
              <option value="">Default</option>
              {providerOptions.map((provider) => (
                <option key={provider.value} value={provider.value}>{provider.label}</option>
              ))}
              {unavailableProviders.length > 0 && (
                <option value="" disabled>Unavailable providers</option>
              )}
              {unavailableProviders.map((provider) => (
                <option key={provider.value} value={provider.value} disabled>{provider.label}</option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm">Create Agent</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function KindFilter({ active, counts }: { active: string; counts: { all: number; humans: number; agents: number } }) {
  const filters = [
    { key: "all", label: "All", count: counts.all },
    { key: "human", label: "Humans", count: counts.humans },
    { key: "agent", label: "Agents", count: counts.agents },
  ]

  return (
    <div className="flex gap-1">
      {filters.map(({ key, label, count }) => {
        const isActive = active === key
        const href = key === "all" ? "/members" : `/members?kind=${key}`
        return (
          <Link
            key={key}
            href={href}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors ${
              isActive
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-transparent bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            {label}
            <span className={`ml-0.5 rounded px-1.5 py-0.5 text-[11px] ${isActive ? "bg-primary/15" : "bg-muted"}`}>
              {count}
            </span>
          </Link>
        )
      })}
    </div>
  )
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
  const selectedMemberId = searchValue(resolvedSearchParams.member)
  const activeTab = (searchValue(resolvedSearchParams.tab) ?? "profile") as TabKey
  const kindFilter = searchValue(resolvedSearchParams.kind) ?? "all"

  const humansList = members.filter((m) => m.kind === "human")
  const agentsList = members.filter((m) => m.kind === "agent")
  const boundAgents = agentsList.filter((m) => m.computerId).length
  const providerOptions = detectedProviderOptions(computers)

  const filteredMembers = kindFilter === "human"
    ? humansList
    : kindFilter === "agent"
      ? agentsList
      : members

  const selectedMember = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId)
    : null

  return (
    <ProductShell
      active="members"
      title="Members"
      description="Humans and agents with profile, runtime binding, permissions, skills, and activity hints."
      session={session}
      sidebarTitle="Member Groups"
      sidebarDescription="Select a member to view profile, permissions, and runtime detail."
      sidebar={
        <div className="space-y-2">
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">Humans</div>
            <div className="mt-1 text-2xl font-semibold">{humansList.length}</div>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs text-muted-foreground">Agents</div>
            <div className="mt-1 text-2xl font-semibold">{agentsList.length}</div>
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
              <CardTitle className="text-2xl">{humansList.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Agents Bound</CardDescription>
              <CardTitle className="text-2xl">
                {boundAgents}
                <span className="ml-2 text-xs font-normal text-muted-foreground">of {agentsList.length}</span>
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {selectedMember && (
          <MemberDetail member={selectedMember} computers={computers} activeTab={activeTab} />
        )}

        <CreateAgentCard computers={computers} error={error} providerOptions={providerOptions} />

        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="size-4" />
                Member Directory
              </CardTitle>
              <KindFilter
                active={kindFilter}
                counts={{ all: members.length, humans: humansList.length, agents: agentsList.length }}
              />
            </div>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="divide-y">
              {filteredMembers.map((member) => (
                <MemberRow key={member.id} member={member} selected={member.id === selectedMemberId} />
              ))}
            </div>
            {filteredMembers.length === 0 && (
              <EmptyState
                title="No members found"
                description={kindFilter === "all"
                  ? "Create a human/agent member to start."
                  : `No ${kindFilter}s registered yet.`}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </ProductShell>
  )
}
