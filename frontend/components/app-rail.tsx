"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Bell,
  Bot,
  CheckSquare,
  HardDrive,
  MessageSquare,
  Radio,
  Search,
  Settings,
  Sparkles,
} from "lucide-react"

import type { AccountSession } from "@/lib/control-plane"
import { cn } from "@/lib/utils"
import { ServerSwitcher } from "@/components/server-switcher"

type NavKey = "search" | "chat" | "tasks" | "members" | "computers" | "control" | "activity" | "settings"

const railItems: Array<{
  key: NavKey
  href: string
  labelKey: string
  icon: typeof Search
  accent: "blue" | "rose" | "mint" | "green" | "purple"
}> = [
  { key: "search", href: "/?focus=search", labelKey: "search", icon: Search, accent: "blue" },
  { key: "chat", href: "/chat", labelKey: "chat", icon: MessageSquare, accent: "blue" },
  { key: "tasks", href: "/tasks", labelKey: "tasks", icon: CheckSquare, accent: "rose" },
  { key: "members", href: "/members", labelKey: "members", icon: Bot, accent: "mint" },
  { key: "computers", href: "/computers", labelKey: "computers", icon: HardDrive, accent: "green" },
  { key: "control", href: "/control/integration", labelKey: "control", icon: Radio, accent: "purple" },
  { key: "activity", href: "/daemon", labelKey: "activity", icon: Bell, accent: "mint" },
]

/**
 * 把当前路径映射成 rail 的 active NavKey。
 * 从 ProductShell 的 `active` prop 迁移而来：原先每页各自传 active，
 * 现在外壳常驻 layout，rail 自己根据 pathname 派生高亮。
 */
function useActiveNavKey(pathname: string): NavKey | null {
  if (pathname === "/" || pathname === "") return "search"
  if (pathname === "/chat" || pathname.startsWith("/chat/")) return "chat"
  if (pathname.startsWith("/tasks")) return "tasks"
  if (pathname.startsWith("/members")) return "members"
  if (pathname.startsWith("/computers")) return "computers"
  if (pathname.startsWith("/control")) return "control"
  if (pathname.startsWith("/daemon")) return "activity"
  if (pathname.startsWith("/settings")) return "settings"
  return null
}

/**
 * 应用图标导航栏（Col 0），常驻视口左侧。
 * 从 ProductShell 上提到 (app) layout 后，由本组件渲染：
 * ServerSwitcher + 主导航 + 底部 Settings。active 高亮从 usePathname 派生。
 */
export function AppRail({ session }: { session?: AccountSession | null }) {
  const t = useTranslations("nav")
  const pathname = usePathname()
  const active = useActiveNavKey(pathname)
  // 注：rail 图标的未读红点/计数徽标（ActivityIndicator）暂时下线——计数口径
  // 仍有问题且徽标遮挡图标。状态层（activity-unread-state/tracker）保留，
  // 聊天侧栏的按实体未读不受影响；修正好口径后再恢复此处集成。

  return (
    <nav
      aria-label="Primary"
      data-region="icon-rail"
      data-slot="tool-spine"
      className="sk-rail z-20 hidden w-14 flex-col items-center gap-1 py-3 sm:flex"
    >
      <span
        aria-hidden
        className="sk-rail-bg pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
      />
      {session?.account ? (
        <ServerSwitcher session={session} />
      ) : (
        <Link
          href="/"
          aria-label="Home"
          className="sk-rail-logo relative mb-1 flex size-9 items-center justify-center rounded-none text-primary-foreground"
        >
          <Sparkles className="size-4" />
        </Link>
      )}
      {railItems.map(({ key, href, labelKey, icon: Icon, accent }) => {
        const label = t(labelKey as never)
        return (
          <Link
            key={key}
            href={href}
            aria-label={label}
            title={label}
            aria-current={active === key ? "page" : undefined}
            className={cn(
              "relative flex size-9 items-center justify-center rounded-none transition-colors",
              active === key ? `sk-rail-active-${accent}` : "sk-rail-icon"
            )}
          >
            <Icon className="size-[18px]" />
          </Link>
        )
      })}
      <div className="mt-auto flex flex-col items-center gap-1">
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          aria-current={active === "settings" ? "page" : undefined}
          className={cn(
            "sk-rail-icon relative flex size-9 items-center justify-center rounded-none transition-colors",
            active === "settings" && "sk-rail-active-mint"
          )}
        >
          <Settings className="size-[18px]" />
        </Link>
      </div>
    </nav>
  )
}
