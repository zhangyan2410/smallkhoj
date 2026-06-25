import Link from "next/link"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { getTranslations } from "next-intl/server"
import {
  Activity,
  Bell,
  Bot,
  Cpu,
  HardDrive,
  MessageSquare,
  Play,
  Puzzle,
  RotateCcw,
  Shield,
  Square,
  Trash2,
  User,
  UserRound,
  Wrench,
} from "lucide-react"

import ActivityTab from "./activity-tab"
import { CreateAgentCard } from "./create-agent-card"
import { MembersList } from "./members-list"

import { MemberAvatar } from "@/components/member-avatar"
import { ProductShell } from "@/components/product-shell"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { EmptyState, RuntimeChip, StatusPill } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  API_BASE,
  apiGet,
  formatTime,
  type Computer,
  type Member,
  runtimeLabel,
  shortId,
  statusLabel,
} from "@/lib/control-plane"
import { getStatusBucket, getStatusLabel } from "@/lib/agent-status"
import { detectedProviderOptions } from "@/lib/runtime-options"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

async function getMembers() {
  return apiGet<{ members: Member[]; count?: number }>("/api/v1/members", { members: [], count: 0 })
}

async function getComputers() {
  return apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] })
}

function profileName(member: Member) {
  return member.profile?.displayName || member.displayName
}

function profileDescription(member: Member) {
  return member.profile?.description ?? member.description
}

function searchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

type TabKey = "profile" | "permissions" | "dms" | "reminders" | "workspace" | "apps" | "activity"

const MEMBERS_LIST_WIDTH = {
  storageKey: "smallkhoj.members.listWidth",
  defaultWidth: 260,
  min: 220,
  max: 380,
} as const

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

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-2">
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="mt-1 truncate font-mono text-xs">{value || "none"}</div>
    </div>
  )
}

async function updateHumanAvatarUrlAction(formData: FormData) {
  "use server"
  const memberId = String(formData.get("memberId") || "")
  const avatarUrl = String(formData.get("avatarUrl") || "").trim()
  if (!memberId) return

  const response = await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ avatarUrl: avatarUrl || null }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/members?member=${encodeURIComponent(memberId)}&tab=profile&error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/members")
  redirect(`/members?member=${encodeURIComponent(memberId)}&tab=profile`)
}

async function controlAgentLifecycleAction(formData: FormData) {
  "use server"
  const memberId = String(formData.get("memberId") || "")
  const workspaceId = String(formData.get("workspaceId") || "")
  const action = String(formData.get("action") || "").trim()
  if (!memberId || !workspaceId || !action) {
    redirect(`/members?member=${encodeURIComponent(memberId)}&error=${encodeURIComponent("Missing member, workspace, or action")}`)
  }

  const response = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/lifecycle`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ action }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/members?member=${encodeURIComponent(memberId)}&error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/members")
  redirect(`/members?member=${encodeURIComponent(memberId)}`)
}

/**
 * Start / Stop / Restart controls for an agent card. Uses a native form bound to
 * the `controlAgentLifecycleAction` server action (per quality-guidelines:
 * critical backend mutations use native form submission so a hydration gap can't
 * silently fail). Each action is gated by the agent's status bucket so only the
 * contextually valid control is offered.
 */
async function AgentControls({ member }: { member: Member }) {
  const t = await getTranslations("members")
  const tCommon = await getTranslations("common")
  const workspaceId = member.workspaceId
  const bucket = getStatusBucket(member.status)
  const canStart = bucket === "OFFLINE" || bucket === "ERROR"
  const canStop = bucket === "ACTIVE" || bucket === "THINKING" || bucket === "STARTING"
  const showRestart = Boolean(workspaceId)

  if (!workspaceId) {
    return (
      <p className="text-[11px] text-muted-foreground">{t("noWorkspace")}</p>
    )
  }

  const control = (action: "start" | "stop" | "restart", label: string, Icon: typeof Play, show: boolean, tone: string) => {
    if (!show) return null
    return (
      <form action={controlAgentLifecycleAction} className="flex-1">
        <input type="hidden" name="memberId" value={member.id} />
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="action" value={action} />
        <button
          type="submit"
          className={`inline-flex w-full items-center justify-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${tone}`}
        >
          <Icon className="size-3" />
          {label}
        </button>
      </form>
    )
  }

  return (
    <div className="mt-1 flex w-full items-stretch gap-1.5">
      {control("start", tCommon("start"), Play, canStart, "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-950")}
      {control("stop", tCommon("stop"), Square, canStop, "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-400 dark:hover:bg-rose-950")}
      {control("restart", tCommon("restart"), RotateCcw, showRestart, "border-border text-muted-foreground hover:bg-accent")}
    </div>
  )
}

/**
 * Agent gallery card: avatar with live status, name, status label, description
 * snippet, and contextual start/stop/restart controls.
 */
function AgentCard({ member }: { member: Member }) {
  const name = profileName(member)
  const description = profileDescription(member)
  const href = memberDetailHref(member.id)

  return (
    <div className="group relative flex flex-col items-center gap-3 rounded-xl border bg-card p-4 text-center ring-1 ring-primary/10 transition-all hover:scale-[1.02] hover:ring-primary/30">
      <Link href={href} className="flex flex-1 flex-col items-center gap-2 self-stretch">
        <MemberAvatar member={member} size="xl" showStatus />
        <div className="min-w-0 w-full">
          <div className="truncate font-semibold">{name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{getStatusLabel(member.status)}</div>
          {description ? (
            <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{description}</div>
          ) : null}
        </div>
      </Link>
      <AgentControls member={member} />
    </div>
  )
}

/**
 * Compact human member row for the humans section below the agent gallery.
 */
function HumanRow({ member, selected }: { member: Member; selected: boolean }) {
  const name = profileName(member)
  const handle = member.handle || `@${member.name}`
  return (
    <Link
      href={memberDetailHref(member.id)}
      className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent ${
        selected ? "border-primary/20 bg-primary/8" : "border-transparent"
      }`}
    >
      <MemberAvatar member={member} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <div className="truncate text-[11px] text-muted-foreground">{handle}</div>
      </div>
      <StatusPill status={member.status} label={statusLabel(member.status)} />
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
  const computer = computers.find((c) => c.id === member.computerId)
  const workspace = computer?.agentWorkspaces.find((w) => w.agentId === member.id)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <MemberAvatar member={member} size="xl" />
        <div className="min-w-0">
          <div className="text-lg font-semibold">{profileName(member)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{member.handle || `@${member.displayName}`}</span>
            <StatusPill status={member.status} label={statusLabel(member.status)} />
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs">{member.kind}</span>
            {(member.config?.provider || member.runtimeProvider || member.backend) && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs">
                {member.config?.provider || member.runtimeProvider || member.backend}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{description || "No profile description."}</p>
        </div>
      </div>

      {member.kind === "human" && (
        <form action={updateHumanAvatarUrlAction} className="rounded-md border bg-muted/20 p-3">
          <input type="hidden" name="memberId" value={member.id} />
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UserRound className="size-3" />
            Human Avatar
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              name="avatarUrl"
              type="url"
              defaultValue={member.profile?.avatarUrl ?? member.avatarUrl ?? ""}
              placeholder="https://example.com/avatar.png"
              className="h-8"
            />
            <Button type="submit" size="sm" variant="outline">
              Save
            </Button>
          </div>
        </form>
      )}

      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="memberId" value={shortId(member.id)} />
        <Field label="computerId" value={shortId(member.computerId)} />
        <Field label="workspaceId" value={shortId(member.workspaceId)} />
      </div>

      {member.kind === "agent" && computer && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Cpu className="size-3" />
            Runtime Binding
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="computer" value={computer.name} />
            <Field label="computer status" value={computer.status} />
            <Field label="runtime" value={workspace?.runtime ?? "unbound"} />
            <Field label="provider" value={workspace?.runtimeProvider ?? member.config?.provider ?? member.runtimeProvider ?? "default"} />
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
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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

async function deleteMemberAction(formData: FormData) {
  "use server"
  const memberId = String(formData.get("memberId") || "")
  if (!memberId) return
  const response = await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "DELETE",
    headers: await serverApiHeaders(),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/members?error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/members")
  revalidatePath("/computers")
  redirect("/members?kind=agent")
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
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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
        <div className="text-sm font-medium text-foreground">Bound Computer</div>
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{computer.name}</span>
            <StatusPill status={computer.status} label={statusLabel(computer.status)} />
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
          <div className="text-sm font-medium text-foreground">Agent Workspace</div>
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
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
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
          {member.kind === "agent" && (
            <form action={deleteMemberAction} className="ml-auto">
              <input type="hidden" name="memberId" value={member.id} />
              <Button type="submit" size="sm" variant="outline" className="border-rose-200 text-rose-700 hover:bg-rose-50">
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            </form>
          )}
          <span className={`${member.kind === "agent" ? "" : "ml-auto"} text-xs font-normal text-muted-foreground`}>{shortId(member.id)}</span>
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

  const humansList = members.filter((m) => m.kind === "human")
  const agentsList = members.filter((m) => m.kind === "agent")
  const boundAgents = agentsList.filter((m) => m.computerId).length
  const providerOptions = detectedProviderOptions(computers)
  const t = await getTranslations("members")

  const selectedMember = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId)
    : null

  return (
    <ProductShell
      active="members"
      title={t("title")}
      description={t("description")}
      session={session}
      list={<MembersList members={members} selectedMemberId={selectedMemberId} />}
      listTitle="Members"
      listConfig={MEMBERS_LIST_WIDTH}
      sidebarTitle={t("memberGroups")}
      sidebarDescription={t("selectMember")}
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
        <RealtimeRefresh eventTypes={["member.created", "member.updated", "member.status.updated"]} />

        {selectedMember && (
          <MemberDetail member={selectedMember} computers={computers} activeTab={activeTab} />
        )}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Agent gallery: cards in a responsive grid, with the create-agent
            form styled as a dashed "add" card as the final grid cell. */}
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Bot className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{t("agents")}</h2>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              {agentsList.length}
            </span>
          </div>
          {agentsList.length === 0 ? (
            <CreateAgentCard computers={computers} providerOptions={providerOptions} />
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {agentsList.map((member) => (
                <AgentCard key={member.id} member={member} />
              ))}
              <CreateAgentCard computers={computers} providerOptions={providerOptions} />
            </div>
          )}
        </section>

        {/* Human members: compact list below the agent gallery. */}
        {humansList.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <UserRound className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t("humans")}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                {humansList.length}
              </span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {humansList.map((member) => (
                <HumanRow key={member.id} member={member} selected={member.id === selectedMemberId} />
              ))}
            </div>
          </section>
        )}
      </div>
    </ProductShell>
  )
}
