import Link from "next/link"
import type { ReactNode } from "react"
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
import { getTranslations } from "next-intl/server"

import type { AccountSession } from "@/lib/control-plane"
import { cn } from "@/lib/utils"
import { ProductShellBody, type ListPanelConfig } from "@/components/product-shell-body"
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

export async function ProductShell({
  active,
  title,
  description,
  children,
  sidebar,
  sidebarTitle,
  sidebarDescription,
  session,
  actions,
  className,
  list,
  listTitle,
  listConfig,
  mainScrollable,
}: {
  active: NavKey
  title: string
  description?: string
  children: ReactNode
  sidebar?: ReactNode
  sidebarTitle?: string
  sidebarDescription?: string
  session?: AccountSession | null
  actions?: ReactNode
  className?: string
  /** 三栏模式的列表栏（Col 1）。传入即启用三栏布局，不传则保持单栏（向后兼容）。 */
  list?: ReactNode
  /** 列表栏标题（可选，显示在列表栏顶部） */
  listTitle?: string
  /** 列表栏宽度配置（默认宽 280，可调 220-420）。 */
  listConfig?: ListPanelConfig
  /** 透传给 ProductShellBody 的 mainScrollable。chat 页面传 false。 */
  mainScrollable?: boolean
}) {
  const t = await getTranslations("nav")
  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      {/* Col 0 — icon rail：fixed 钉死在视口左侧，不随任何滚动离开位置。
          背景图来自 .sk-rail-bg（globals.css），仍用 absolute inset-0 铺满 rail 本身。 */}
      <nav
        aria-label="Primary"
        className="sk-rail hidden w-14 flex-col items-center gap-1 py-3 sm:flex"
      >
        {/* 真实水材质底图（阳光穿透中海蓝 + 暖沙），来自 zy-think 色彩提取与生图 */}
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
            className="sk-rail-icon relative flex size-9 items-center justify-center rounded-none transition-colors"
          >
            <Settings className="size-[18px]" />
          </Link>
        </div>
      </nav>

      {/* 主内容区—— 留出 rail 宽度 (w-14 = 56px)，自身占满 h-screen。
          子栏的滚动由 ProductShellBody 内部按列独立控制。 */}
      <div className="ml-14 flex h-screen min-w-0 flex-col">
        <ProductShellBody
          title={title}
          description={description}
          actions={actions}
          className={className}
          list={list}
          listTitle={listTitle}
          listConfig={listConfig}
          sidebar={sidebar}
          sidebarTitle={sidebarTitle}
          sidebarDescription={sidebarDescription}
          mainScrollable={mainScrollable}
        >
          {children}
        </ProductShellBody>
      </div>
    </main>
  )
}
