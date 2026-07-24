import Link from "next/link"
import { Suspense } from "react"
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
  Puzzle,
  Shield,
  Trash2,
  User,
  UserRound,
  Wrench,
} from "lucide-react"

import ActivityTab from "./activity-tab"
import { CreateAgentDialog } from "../chat/[channel]/create-agent-dialog"
import { InviteMemberDialog } from "./invite-member-dialog"
import { RestoreMemberSelection } from "./restore-member-selection"
import { MembersList } from "./members-list"

import { ProductShell } from "@/components/product-shell"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { EmptyState, RuntimeChip, StatusPill } from "@/components/product-ui"
import {
  AvatarObject,
  ComputerInkstone,
  InkframeObjectSurface,
  MemberNameTag,
  ObjectField,
  ObjectMetric,
} from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  API_BASE,
  apiGet,
  findMemberWorkspace,
  formatTime,
  type Computer,
  type Member,
  runtimeLabel,
  shortId,
  statusLabel,
} from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

async function getMembers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ members: Member[]; count?: number }>("/api/v1/members", { members: [], count: 0 }, sessionToken, activeServerId)
}

async function getComputers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] }, sessionToken, activeServerId)
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

function TabBar({ activeTab, memberId }: { activeTab: TabKey; memberId: string }) {
  return (
    <div data-inkframe-mobile-role="member-tab-bar" className="flex min-w-0 gap-1 overflow-x-auto border-b pb-px">
      {memberTabs.map(({ key, label, icon: Icon }) => {
        const isActive = key === activeTab
        return (
          <Link
            key={key}
            href={memberDetailHref(memberId, key)}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-none px-3 text-xs font-medium transition-colors ${
              isActive
                ? "bg-sand-card text-foreground"
                : "text-muted-foreground hover:text-foreground"
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
  const workspace = findMemberWorkspace(member, computers)

  return (
    <div className="space-y-4">
      <MemberNameTag
        kind={member.kind}
        status={member.status}
        data-inkframe-mobile-role="member-profile"
        className="flex min-w-0 items-start gap-4 overflow-x-hidden border-[var(--ink)] bg-[var(--paper)] p-3 shadow-[2px_2px_0_var(--ink)]"
      >
        <AvatarObject member={member} size="xl" />
        <div className="min-w-0">
          <div className="text-lg font-semibold">{profileName(member)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{member.handle || `@${member.displayName}`}</span>
            <StatusPill status={member.status} label={statusLabel(member.status)} />
            <RuntimeChip tone="neutral">{member.kind}</RuntimeChip>
            {(member.config?.provider || member.runtimeProvider || member.backend) && (
              <RuntimeChip tone="neutral" className="min-h-5 px-2 py-0 text-xs">
                {member.config?.provider || member.runtimeProvider || member.backend}
              </RuntimeChip>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{description || "No profile description."}</p>
        </div>
      </MemberNameTag>

      {member.kind === "human" && (
        <form action={updateHumanAvatarUrlAction} className="sk-object-surface p-3">
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
        <ObjectField label="memberId" value={shortId(member.id)} />
        <ObjectField label="computerId" value={shortId(member.computerId)} />
        <ObjectField label="workspaceId" value={shortId(member.workspaceId)} />
      </div>

      {member.kind === "agent" && computer && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Cpu className="size-3" />
            Runtime Binding
          </div>
          <ComputerInkstone
            status={computer.status}
            data-inkframe-mobile-role="member-workspace-binding"
            className="min-w-0 overflow-x-hidden"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <ObjectField label="computer" value={computer.name} />
              <ObjectField label="computer status" value={computer.status} />
              <ObjectField label="runtime" value={workspace?.runtime ?? "unbound"} />
              <ObjectField label="provider" value={workspace?.runtimeProvider ?? member.config?.provider ?? member.runtimeProvider ?? "default"} />
              <ObjectField label="pid" value={workspace?.pid?.toString() ?? "none"} />
              <ObjectField label="session" value={shortId(workspace?.sessionId)} />
            </div>
          </ComputerInkstone>
          {workspace?.cwd && (
            <ObjectField label="cwd" value={workspace.cwd} />
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
                <ObjectField
                  key={key}
                  label={key}
                  mono={false}
                  value={<RuntimeChip tone={enabled ? "success" : "neutral"}>{enabled ? "enabled" : "disabled"}</RuntimeChip>}
                />
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
                <ObjectField
                  key={key}
                  label={key}
                  mono={false}
                  value={<RuntimeChip tone={enabled ? "success" : "neutral"}>{enabled ? "on" : "off"}</RuntimeChip>}
                />
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
        <InkframeObjectSurface material="drying" className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-warning" />
            <span className="text-sm">Config persisted but not enforced at runtime</span>
          </div>
          <p className="text-xs text-muted-foreground">
            Permission and action changes are saved to member config immediately. Server-side enforcement
            (blocking unauthorized actions at the daemon/runtime level) is not yet implemented.
            Changes will propagate on the next agent session refresh.
          </p>
        </InkframeObjectSurface>
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
              <form key={key} action={togglePermissionEntryAction} data-inkframe-mobile-role="member-permission-entry" className="sk-object-surface flex min-w-0 items-center justify-between gap-3 overflow-x-hidden px-3 py-2">
                <input type="hidden" name="memberId" value={memberId} />
                <input type="hidden" name="type" value="permissions" />
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="currentValue" value={String(enabled)} />
                <input type="hidden" name="existing" value={JSON.stringify(permissions)} />
                <span className="min-w-0 truncate text-sm font-mono">{key}</span>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" variant={enabled ? "default" : "outline"}>
                    {enabled ? "enabled" : "disabled"}
                  </Button>
                  <Button type="submit" formAction={removePermissionEntryAction} size="xs" variant="destructive" title="Remove">
                    remove
                  </Button>
                </div>
              </form>
            ))}
          </div>
        )}
        <form action={addPermissionEntryAction} className="flex min-w-0 flex-wrap items-end gap-2 overflow-x-hidden">
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="type" value="permissions" />
          <input type="hidden" name="existing" value={JSON.stringify(permissions)} />
          <Input name="key" placeholder="permission key" className="min-w-0 max-w-[200px] flex-1" />
          <Select id="permission-entry-value" name="value" items={["true|enabled", "false|disabled"]} splitValue className="h-9 w-auto min-w-28 shrink-0" />
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
              <form key={key} action={togglePermissionEntryAction} data-inkframe-mobile-role="member-permission-entry" className="sk-object-surface flex min-w-0 items-center justify-between gap-3 overflow-x-hidden px-3 py-2">
                <input type="hidden" name="memberId" value={memberId} />
                <input type="hidden" name="type" value="actions" />
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="currentValue" value={String(enabled)} />
                <input type="hidden" name="existing" value={JSON.stringify(actions)} />
                <span className="min-w-0 truncate text-sm font-mono">{key}</span>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" variant={enabled ? "default" : "outline"}>
                    {enabled ? "on" : "off"}
                  </Button>
                  <Button type="submit" formAction={removePermissionEntryAction} size="xs" variant="destructive" title="Remove">
                    remove
                  </Button>
                </div>
              </form>
            ))}
          </div>
        )}
        <form action={addPermissionEntryAction} className="flex min-w-0 flex-wrap items-end gap-2 overflow-x-hidden">
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="type" value="actions" />
          <input type="hidden" name="existing" value={JSON.stringify(actions)} />
          <Input name="key" placeholder="action key" className="min-w-0 max-w-[200px] flex-1" />
          <Select id="action-entry-value" name="value" items={["true|on", "false|off"]} splitValue className="h-9 w-auto min-w-28 shrink-0" />
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
      <InkframeObjectSurface material="dry" className="p-3">
        <p className="text-xs text-muted-foreground">
          DM channel for this member is <code className="font-mono">dm:&lt;your-id&gt;-&lt;member-id&gt;</code>.
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
      </InkframeObjectSurface>
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
      <InkframeObjectSurface material="dry" className="p-3">
        <p className="text-xs text-muted-foreground">
          Scheduled reminders for this {member.kind} are managed through the Control Plane dispatch.
          Reminders fire based on the configured delay and channel.
        </p>
      </InkframeObjectSurface>
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

  const workspace = findMemberWorkspace(member, computers)

  return (
    <div className="space-y-4">
      <div data-inkframe-mobile-role="member-workspace-binding" className="min-w-0 space-y-2 overflow-x-hidden">
        <div className="text-sm font-medium text-foreground">Bound Computer</div>
        <ComputerInkstone status={computer.status}>
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-accent-green" />
            <span className="text-sm font-medium">{computer.name}</span>
            <StatusPill status={computer.status} label={statusLabel(computer.status)} />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <ObjectField label="os" value={computer.os} />
            <ObjectField label="daemon" value={computer.daemonVersion} />
            <ObjectField label="heartbeat" value={formatTime(computer.lastHeartbeatAt)} />
          </div>
        </ComputerInkstone>
      </div>

      {workspace && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">Agent Workspace</div>
          <InkframeObjectSurface raised data-inkframe-mobile-role="member-workspace-binding" className="min-w-0 overflow-x-hidden p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <ObjectField label="status" value={workspace.status} />
              <ObjectField label="pid" value={workspace.pid?.toString() ?? "none"} />
              <ObjectField label="runtime" value={workspace.runtime ?? "default"} />
              <ObjectField label="provider" value={workspace.runtimeProvider ?? "default"} />
              <ObjectField label="model" value={workspace.runtimeModel ?? "default"} />
              <ObjectField label="started" value={formatTime(workspace.startedAt)} />
              <ObjectField label="stopped" value={formatTime(workspace.stoppedAt)} />
            </div>
            {workspace.cwd && <div className="mt-2"><ObjectField label="cwd" value={workspace.cwd} /></div>}
          </InkframeObjectSurface>
        </div>
      )}

      {!workspace && member.kind === "agent" && (
        <InkframeObjectSurface material="drying" className="p-3">
          <p className="text-xs text-muted-foreground">
            This agent is bound to <code className="font-mono">{computer.name}</code> but has no
            active workspace. The workspace is created when the daemon launches a runtime session for this agent.
          </p>
        </InkframeObjectSurface>
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
      <InkframeObjectSurface material="dry" className="p-3">
        <p className="text-xs text-muted-foreground">
          App integrations are configured per agent through the runtime provider settings.
          Available integrations depend on the agent&apos;s runtime capabilities.
        </p>
      </InkframeObjectSurface>
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
    <Card data-inkframe-mobile-role="member-detail" className="min-w-0 overflow-x-hidden">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          {member.kind === "agent" ? <Bot className="size-4" /> : <UserRound className="size-4" />}
          Member Detail
          {member.kind === "agent" && (
            <form action={deleteMemberAction} className="ml-auto">
              <input type="hidden" name="memberId" value={member.id} />
              <Button type="submit" size="sm" variant="outline">
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
  const sessionToken = await getSessionToken()
  const activeServerId = session.server.id
  const [{ members }, { computers }] = await Promise.all([
    getMembers(sessionToken, activeServerId),
    getComputers(sessionToken, activeServerId),
  ])
  const error = searchValue(resolvedSearchParams.error)
  const selectedMemberId = searchValue(resolvedSearchParams.member)
  const activeTab = (searchValue(resolvedSearchParams.tab) ?? "profile") as TabKey

  const humansList = members.filter((m) => m.kind === "human")
  const agentsList = members.filter((m) => m.kind === "agent")
  const boundAgents = agentsList.filter((m) => m.computerId).length
  const t = await getTranslations("members")
  const activeMembership = session.memberships?.find((membership) => membership.server.id === session.server.id)
  const canInviteMembers = activeMembership?.role === "owner" || activeMembership?.role === "admin"

  const selectedMember = selectedMemberId
    ? members.find((m) => m.id === selectedMemberId)
    : null

  return (
    <ProductShell
      title={t("title")}
      description={t("description")}
      list={<MembersList members={members} computers={computers} selectedMemberId={selectedMemberId} />}
      listTitle="Members"
      listConfig={MEMBERS_LIST_WIDTH}
      sidebarTitle={t("memberGroups")}
      sidebarDescription={t("selectMember")}
      sidebar={
        <div className="space-y-2">
          <ObjectMetric label={t("humans")} value={humansList.length} />
          <ObjectMetric label={t("agents")} value={agentsList.length} />
          <ObjectMetric label={t("boundAgents")} value={boundAgents} />
          {canInviteMembers && (
            <InkframeObjectSurface material="dry" className="space-y-3 p-3">
              <ObjectField label={t("inviteServerLabel")} value={session.server.name} mono={false} />
              <InviteMemberDialog
                serverName={session.server.name}
                copy={{
                  inviteMember: t("inviteMember"),
                  inviteMemberDesc: t("inviteMemberDesc"),
                  serverLabel: t("inviteServerLabel"),
                  invitedNameLabel: t("invitedNameLabel"),
                  invitedNamePlaceholder: t("invitedNamePlaceholder"),
                  manualCopyHint: t("manualCopyHint"),
                  generateInviteLink: t("generateInviteLink"),
                  generatingInviteLink: t("generatingInviteLink"),
                  copyInviteLink: t("copyInviteLink"),
                  copiedInviteLink: t("copiedInviteLink"),
                  inviteLinkLabel: t("inviteLinkLabel"),
                  close: t("closeInviteDialog"),
                }}
              />
            </InkframeObjectSurface>
          )}
        </div>
      }
      actions={
        <>
          <CreateAgentDialog />
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
        <Suspense fallback={null}>
          <RestoreMemberSelection />
        </Suspense>

        {selectedMember && (
          <MemberDetail member={selectedMember} computers={computers} activeTab={activeTab} />
        )}

        {error && (
          <InkframeObjectSurface material="blocked" className="p-3 text-sm text-destructive">
            {error}
          </InkframeObjectSurface>
        )}

        {/* No agent card gallery or humans list here — the sidebar lists both
            agents (by computer) and humans. The main area only shows the
            selected member's detail (MemberDetail above), nothing else. */}
      </div>
    </ProductShell>
  )
}
