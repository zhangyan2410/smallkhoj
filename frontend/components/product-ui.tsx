import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

const statusStyles: Record<string, string> = {
  online: "border-emerald-200 bg-emerald-50 text-emerald-700",
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  running: "border-emerald-200 bg-emerald-50 text-emerald-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  idle: "border-amber-200 bg-amber-50 text-amber-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  pending_start: "border-amber-200 bg-amber-50 text-amber-700",
  in_review: "border-amber-200 bg-amber-50 text-amber-700",
  busy: "border-amber-200 bg-amber-50 text-amber-700",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700",
  failed: "border-rose-200 bg-rose-50 text-rose-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
  offline: "border-rose-200 bg-rose-50 text-rose-700",
  stopped: "border-rose-200 bg-rose-50 text-rose-700",
}

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
        "inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs font-medium",
        statusStyles[status] ?? "border-border bg-muted text-muted-foreground",
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
        "inline-flex min-h-6 max-w-full items-center rounded-md border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-xs font-medium text-cyan-800",
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
