import Link from "next/link"
import type { ReactNode } from "react"
import {
  Activity,
  Bell,
  Bot,
  CheckSquare,
  HardDrive,
  MessageSquare,
  Search,
  Settings,
  Sparkles,
} from "lucide-react"

import type { AccountSession } from "@/lib/control-plane"
import { cn } from "@/lib/utils"

type NavKey = "search" | "chat" | "tasks" | "members" | "computers" | "activity" | "settings"

const navItems: Array<{
  key: NavKey
  href: string
  label: string
  icon: typeof Search
}> = [
  { key: "search", href: "/?focus=search", label: "Search", icon: Search },
  { key: "chat", href: "/chat", label: "Chat", icon: MessageSquare },
  { key: "tasks", href: "/tasks", label: "Tasks", icon: CheckSquare },
  { key: "members", href: "/members", label: "Members", icon: Bot },
  { key: "computers", href: "/computers", label: "Computers", icon: HardDrive },
  { key: "activity", href: "/daemon", label: "Activity", icon: Bell },
  { key: "settings", href: "/settings", label: "Settings", icon: Settings },
]

export function ProductShell({
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
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[13.5rem_1fr]">
        <aside className="border-b bg-sidebar/95 lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col gap-4 p-3">
            <Link href="/" className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Sparkles className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">SmallKhoj</span>
                <span className="block truncate text-xs text-muted-foreground">Product workbench</span>
              </span>
            </Link>

            <nav aria-label="Primary" className="grid gap-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const selected = active === item.key
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    aria-current={selected ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center gap-2 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      selected && "bg-primary/10 text-primary"
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                )
              })}
            </nav>

            <div className="mt-auto rounded-md border bg-background/70 p-2 text-xs">
              <div className="truncate font-medium">{session?.account.displayName || session?.account.name || "Local account"}</div>
              <div className="mt-1 truncate text-muted-foreground">{session?.server.name || "default server"}</div>
            </div>
          </div>
        </aside>

        <section className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className={cn("min-w-0 px-4 py-4 sm:px-6", className)}>
            <header className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs font-medium uppercase text-cyan-700">
                  <Activity className="size-3.5" />
                  SmallKhoj Control Plane
                </div>
                <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{title}</h1>
                {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
              </div>
              {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
            </header>
            {children}
          </div>

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
        </section>
      </div>
    </main>
  )
}
