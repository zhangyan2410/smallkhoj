import Link from "next/link"
import { Suspense } from "react"
import { getTranslations } from "next-intl/server"
import {
  Bot,
  HardDrive,
  Trash2,
  UserRound,
} from "lucide-react"

import { CreateAgentDialog } from "../chat/[channel]/create-agent-dialog"
import { InviteMemberDialog } from "./invite-member-dialog"
import { RestoreMemberSelection } from "./restore-member-selection"
import { MembersList } from "./members-list"

import { ProductShell } from "@/components/product-shell"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { InkframeObjectSurface, ObjectField, ObjectMetric } from "@/components/inkframe-object-ui"
import { MemberDetailContent } from "@/components/member-detail-content"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  apiGet,
  shortId,
  type Computer,
  type Member,
} from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount } from "@/lib/server-auth"
import { memberTabs, memberDetailHref, TAB_LABEL_KEYS, type TabKey } from "@/lib/member-tabs"
import { deleteMemberAction } from "./actions"

async function getMembers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ members: Member[]; count?: number }>("/api/v1/members", { members: [], count: 0 }, sessionToken, activeServerId)
}

async function getComputers(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] }, sessionToken, activeServerId)
}

function profileName(member: Member) {
  return member.kind === "agent"
    ? member.name
    : member.profile?.displayName || member.displayName || member.name
}

function searchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

const MEMBERS_LIST_WIDTH = {
  storageKey: "smallkhoj.members.listWidth",
  defaultWidth: 260,
  min: 220,
  max: 380,
} as const

type MembersT = (key: string, values?: Record<string, string | number>) => string

/** tab bar — URL-based navigation (members page uses ?member=...&tab=...). */
function TabBar({ activeTab, memberId, labels }: { activeTab: TabKey; memberId: string; labels: Record<TabKey, string> }) {
  return (
    <div data-inkframe-mobile-role="member-tab-bar" className="flex min-w-0 gap-1 overflow-x-auto border-b pb-px">
      {memberTabs.map(({ key, icon: Icon }) => {
        const isActive = key === activeTab
        return (
          <Link
            key={key}
            href={memberDetailHref(memberId, key)}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-none px-3 text-xs font-medium transition-colors ${
              isActive
                ? "sk-accent-mint-soft text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="size-3.5" />
            {labels[key]}
          </Link>
        )
      })}
    </div>
  )
}

function MemberDetail({
  member,
  computers,
  canManageMembers,
  activeTab,
  t,
}: {
  member: Member
  computers: Computer[]
  canManageMembers: boolean
  activeTab: TabKey
  t: MembersT
}) {
  const tabLabels = Object.fromEntries(
    (Object.keys(TAB_LABEL_KEYS) as TabKey[]).map((key) => [key, t(TAB_LABEL_KEYS[key])]),
  ) as Record<TabKey, string>
  return (
    <Card data-inkframe-mobile-role="member-detail" className="min-w-0 overflow-x-hidden">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-base">
          {member.kind === "agent" ? <Bot className="size-4" /> : <UserRound className="size-4" />}
          {t("detailTitle")}
          {member.kind === "agent" && canManageMembers && (
            <form action={deleteMemberAction} className="ml-auto">
              <input type="hidden" name="memberId" value={member.id} />
              <Button type="submit" size="sm" variant="outline">
                <Trash2 className="size-3.5" />
                {t("delete")}
              </Button>
            </form>
          )}
          <span className={`${member.kind === "agent" ? "" : "ml-auto"} text-xs font-normal text-muted-foreground`}>{shortId(member.id)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <TabBar activeTab={activeTab} memberId={member.id} labels={tabLabels} />
        <MemberDetailContent
          member={member}
          computers={computers}
          activeTab={activeTab}
          canManageMembers={canManageMembers}
        />
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
      listTitle={t("title")}
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
          {canInviteMembers ? <CreateAgentDialog /> : null}
          <Link href="/computers">
            <Button variant="outline" size="sm">
              <HardDrive className="size-4" />
              {t("goComputers")}
            </Button>
          </Link>
          <Link href="/tasks">
            <Button variant="outline" size="sm">
              {t("goTasks")}
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
          <MemberDetail
            member={selectedMember}
            computers={computers}
            canManageMembers={canInviteMembers}
            activeTab={activeTab}
            t={t}
          />
        )}

        {error && (
          <InkframeObjectSurface material="blocked" className="p-3 text-sm text-destructive">
            {error}
          </InkframeObjectSurface>
        )}
      </div>
    </ProductShell>
  )
}
