"use client"

import { useTranslations } from "next-intl"

import { ProfileTab } from "@/components/member-tabs/profile-tab"
import { PermissionsTab } from "@/components/member-tabs/permissions-tab"
import { DmTab } from "@/components/member-tabs/dm-tab"
import { RemindersTab } from "@/components/member-tabs/reminders-tab"
import { WorkspaceTab } from "@/components/member-tabs/workspace-tab"
import { AppsTab } from "@/components/member-tabs/apps-tab"
import ActivityTab from "@/app/(app)/members/activity-tab"
import { TAB_LABEL_KEYS, memberTabs, type TabKey } from "@/lib/member-tabs"
import type { Computer, Member } from "@/lib/control-plane"
import { cn } from "@/lib/utils"

export { type TabKey } from "@/lib/member-tabs"

/**
 * Shared tab content for member detail. Used by both the members page
 * (server-side, URL-based tab switching) and the chat member-detail side
 * panel (client-side, useState tab switching). Each tab is a self-contained
 * client component using useTranslations("members").
 */
export function MemberDetailContent({
  member,
  computers,
  activeTab,
  canManageMembers,
}: {
  member: Member
  computers?: Computer[]
  activeTab: TabKey
  canManageMembers?: boolean
}) {
  return (
    <div className="min-h-48">
      {activeTab === "profile" && (
        <ProfileTab member={member} computers={computers} canManageMembers={canManageMembers} />
      )}
      {activeTab === "permissions" && <PermissionsTab member={member} />}
      {activeTab === "dms" && <DmTab member={member} />}
      {activeTab === "reminders" && <RemindersTab member={member} />}
      {activeTab === "workspace" && <WorkspaceTab member={member} computers={computers} />}
      {activeTab === "apps" && <AppsTab member={member} />}
      {activeTab === "activity" && <ActivityTab member={member} computers={computers ?? []} />}
    </div>
  )
}

/**
 * Client-side tab bar for the chat side panel. Unlike the members page TabBar
 * (URL-based <Link>), this uses useState + onClick — no navigation.
 */
export function ClientTabBar({
  activeTab,
  onChange,
}: {
  activeTab: TabKey
  onChange: (tab: TabKey) => void
}) {
  const t = useTranslations("members")
  return (
    <div data-inkframe-mobile-role="member-tab-bar" className="flex min-w-0 gap-1 overflow-x-auto border-b pb-px">
      {memberTabs.map(({ key, icon: Icon }) => {
        const isActive = key === activeTab
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-none px-3 text-xs font-medium transition-colors",
              isActive
                ? "sk-accent-mint-soft text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3.5" />
            {t(TAB_LABEL_KEYS[key])}
          </button>
        )
      })}
    </div>
  )
}
