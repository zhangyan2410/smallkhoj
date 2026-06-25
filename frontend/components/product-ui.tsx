import type { ReactNode } from "react"

import { cn } from "@/lib/utils"
import { badgeClass } from "@/lib/control-plane"

export function StatusPill({
  status,
  label,
  className,
}: {
  status: string
  label?: string
  className?: string
}) {
  return (
    <span
      className={cn(
        /* 手作风：墨色硬描边 + 直角 + 实色状态底。
           badgeClass 是单一真源（lib/control-plane.ts），改状态色只改那里。 */
        "inline-flex h-6 shrink-0 items-center rounded-none border border-[var(--ink)] px-2 text-xs font-semibold",
        badgeClass(status),
        className
      )}
    >
      {label ?? status}
    </span>
  )
}

export function RuntimeChip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary",
        className
      )}
    >
      <span className="truncate">{children}</span>
    </span>
  )
}

export function ProductRow({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "grid gap-2 border-b px-3 py-3 last:border-b-0 md:items-center",
        className
      )}
    >
      {children}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string
  description?: string
  className?: string
}) {
  return (
    <div className={cn("py-10 text-center", className)}>
      <div className="text-sm font-medium text-foreground">{title}</div>
      {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
    </div>
  )
}

export function Toolbar({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-2 rounded-md border bg-card px-3 py-2",
        className
      )}
    >
      {children}
    </div>
  )
}
