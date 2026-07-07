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
        "inline-flex h-6 shrink-0 items-center rounded-none border-2 border-[var(--ink)] px-2 text-xs font-semibold",
        badgeClass(status),
        className
      )}
    >
      {label ?? status}
    </span>
  )
}

export type CategoryTone = "primary" | "info" | "success" | "warning" | "danger" | "neutral" | "paper"

/**
 * 分类标签（≠ 状态）。颜色走单一真源 sk-cat-* token，改分类色只改 globals.css。
 * tone 选语义：primary 默认中海蓝；info/success/warning/danger 对应 sk-cat-*；
 * 不要再用 className 覆盖颜色（border-emerald-200 bg-emerald-50 这类）。
 */
const chipToneClass: Record<CategoryTone, string> = {
  primary: "border-[var(--ink)] sk-accent-blue-soft",
  info: "border-[var(--ink)] sk-cat-info",
  success: "border-[var(--ink)] sk-cat-success",
  warning: "border-[var(--ink)] sk-cat-warning",
  danger: "border-[var(--ink)] sk-cat-danger",
  neutral: "border-[var(--ink)] sk-cat-neutral",
  paper: "border-[var(--ink)] bg-[var(--paper)] text-[var(--paper-ink)]",
}

export function RuntimeChip({
  children,
  className,
  tone = "primary",
}: {
  children: ReactNode
  className?: string
  tone?: CategoryTone
}) {
  return (
    <span
      data-slot="runtime-chip"
      className={cn(
        "inline-flex min-h-6 max-w-full items-center rounded-none border-2 border-[var(--ink)] px-2 py-0.5 text-xs font-medium",
        chipToneClass[tone],
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
        "sk-product-row grid gap-2 border-b px-3 py-3 last:border-b-0 md:items-center",
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
    <div data-slot="empty-state" className={cn("sk-empty-note", className)}>
      <div className="sk-empty-note-title text-sm font-medium text-foreground">{title}</div>
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
      data-slot="toolbar"
      className={cn(
        "sk-object-toolbar flex min-h-10 flex-wrap items-center gap-2 rounded-none border-2 border-[var(--ink)] px-3 py-2",
        className
      )}
    >
      {children}
    </div>
  )
}
