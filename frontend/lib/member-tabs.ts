import { Activity, Bell, Cpu, MessageSquare, Puzzle, Shield, User } from "lucide-react"

export type TabKey = "profile" | "permissions" | "dms" | "reminders" | "workspace" | "apps" | "activity"

export const memberTabs: Array<{ key: TabKey; icon: typeof User }> = [
  { key: "profile", icon: User },
  { key: "permissions", icon: Shield },
  { key: "dms", icon: MessageSquare },
  { key: "reminders", icon: Bell },
  { key: "workspace", icon: Cpu },
  { key: "apps", icon: Puzzle },
  { key: "activity", icon: Activity },
]

export const TAB_LABEL_KEYS: Record<TabKey, string> = {
  profile: "tabProfile",
  permissions: "tabPermissions",
  dms: "tabDms",
  reminders: "tabReminders",
  workspace: "tabWorkspace",
  apps: "tabApps",
  activity: "tabActivity",
}

export function memberDetailHref(memberId: string, tab?: TabKey) {
  const params = new URLSearchParams()
  params.set("member", memberId)
  if (tab) params.set("tab", tab)
  return `/members?${params.toString()}`
}
