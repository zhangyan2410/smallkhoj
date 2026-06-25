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

type NavKey = "search" | "chat" | "tasks" | "members" | "computers" | "control" | "activity" | "settings"

const railItems: Array<{
  key: NavKey
  href: string
  labelKey: string
  icon: typeof Search
}> = [
  { key: "search", href: "/?focus=search", labelKey: "search", icon: Search },
  { key: "chat", href: "/chat", labelKey: "chat", icon: MessageSquare },
  { key: "tasks", href: "/tasks", labelKey: "tasks", icon: CheckSquare },
  { key: "members", href: "/members", labelKey: "members", icon: Bot },
  { key: "computers", href: "/computers", labelKey: "computers", icon: HardDrive },
  { key: "control", href: "/control/integration", labelKey: "control", icon: Radio },
  { key: "activity", href: "/daemon", labelKey: "activity", icon: Bell },
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
}) {
  const t = await getTranslations("nav")
  return (
    <main className="flex h-screen bg-background text-foreground">
      {/* Col 0 — icon rail：真实水材质底图 + 图标层 */}
      <nav
        aria-label="Primary"
        className="sk-rail hidden w-14 shrink-0 flex-col items-center gap-1 py-3 sm:flex"
      >
        {/* 真实水材质底图（阳光穿透中海蓝 + 暖沙），来自 zy-think 色彩提取与生图 */}
        <span
          aria-hidden
          className="sk-rail-bg pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat"
        />
        <Link
          href="/"
          aria-label="Home"
          className="sk-rail-logo relative mb-1 flex size-9 items-center justify-center rounded-xl text-primary-foreground"
        >
          <Sparkles className="size-4" />
        </Link>
        {railItems.map(({ key, href, labelKey, icon: Icon }) => {
          const label = t(labelKey as never)
          return (
          <Link
            key={key}
            href={href}
            aria-label={label}
            title={label}
            aria-current={active === key ? "page" : undefined}
            className={cn(
              "relative flex size-9 items-center justify-center rounded-xl transition-colors",
              active === key ? "sk-rail-active" : "sk-rail-icon"
            )}
          >
            <Icon className="size-[18px]" />
          </Link>
          )
        })}
        <div className="mt-auto flex flex-col items-center gap-1">
          {session?.account && (
            <span
              title={session.account.displayName || session.account.name || "Account"}
              className="sk-rail-icon relative flex size-9 items-center justify-center rounded-xl text-xs font-semibold"
            >
              {(session.account.displayName || session.account.name || "?")[0].toUpperCase()}
            </span>
          )}
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="sk-rail-icon relative flex size-9 items-center justify-center rounded-xl transition-colors"
          >
            <Settings className="size-[18px]" />
          </Link>
        </div>
      </nav>

      {/* Content area（header + body）—— 委托给 ProductShellBody，支持三栏可调宽列表栏 */}
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
      >
        {children}
      </ProductShellBody>
    </main>
  )
}
