import Link from "next/link"
import type { ReactNode } from "react"
import {
  Activity,
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
import { LanguageSwitcher } from "@/components/language-switcher"

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
}) {
  const t = await getTranslations("nav")
  return (
    <main className="flex h-screen bg-background text-foreground">
      {/* Col 0 — icon rail */}
      <nav
        aria-label="Primary"
        className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-3 sm:flex"
      >
        <Link
          href="/"
          aria-label="Home"
          className="mb-1 flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.14_262)] text-primary-foreground"
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
              active === key
                ? "bg-primary/10 text-primary before:absolute before:left-0 before:top-1/2 before:h-5 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-gradient-to-b before:from-[oklch(0.60_0.18_260)] before:to-[oklch(0.55_0.20_290)]"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
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
              className="flex size-9 items-center justify-center rounded-xl bg-muted text-xs font-semibold text-muted-foreground"
            >
              {(session.account.displayName || session.account.name || "?")[0].toUpperCase()}
            </span>
          )}
          <Link
            href="/settings"
            aria-label="Settings"
            title="Settings"
            className="flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <Settings className="size-[18px]" />
          </Link>
        </div>
      </nav>

      {/* Content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                <Activity className="size-3.5" />
                SmallKhoj
              </div>
              <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{title}</h1>
              {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
            </div>
            {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
            <div className="shrink-0">
              <LanguageSwitcher />
            </div>
          </div>
        </header>

        {/* Body: content + optional right sidebar */}
        <div className="grid min-w-0 flex-1 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className={cn("min-w-0 overflow-y-auto p-4 sm:p-6", className)}>
            {children}
          </div>

          {sidebar && (
            <aside className="hidden min-w-0 border-l bg-sidebar/55 p-4 lg:block">
              <div className="sticky top-4">
                {sidebarTitle && (
                  <div className="mb-3">
                    <h2 className="text-sm font-semibold">{sidebarTitle}</h2>
                    {sidebarDescription && <p className="mt-1 text-xs text-muted-foreground">{sidebarDescription}</p>}
                  </div>
                )}
                {sidebar}
              </div>
            </aside>
          )}
        </div>
      </div>
    </main>
  )
}
