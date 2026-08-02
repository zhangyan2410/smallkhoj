import type { HTMLAttributes, ReactNode } from "react"

import { EventBadge } from "@/components/inkframe-object-ui"
import { cn } from "@/lib/utils"

/**
 * 实时活动指示原件（任务 07-30-realtime-activity-indicators R2）。
 * 与具体业务无关：只接 hasUnread / count 展示 props，不耦合事件流；
 * 事件订阅由 hooks/use-activity-indicator.ts 的 useActivityIndicator 注入。
 * 视觉沿用 EventBadge 协议（sk-event-badge / data-inkframe-unread）：
 * 红点语义 = 「有未看内容」，不表达优先级/告警。
 */

/** 纯红点（无计数）。复用 EventBadge 的空态 + active 形态。 */
export function ActivityDot({
  active,
  label,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  active: boolean
  label?: string
}) {
  if (!active) return null
  return <EventBadge active label={label} className={className} {...props} />
}

/** 计数徽标（count > 0 时显示，>99 显示 99+，由 EventBadge 处理）。 */
export function ActivityCountBadge({
  count = 0,
  label,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  count?: number
  label?: string
}) {
  if (count <= 0) return null
  return <EventBadge count={count} active label={label} className={className} {...props} />
}

/**
 * 包裹式原件：把红点/计数徽标定位到子元素角标（如图标右上角）。
 * 子元素可以是任意元素 —— 原件不需要知道它包的是什么。
 */
export function ActivityIndicator({
  hasUnread = false,
  count,
  label,
  children,
  className,
  badgeClassName,
}: {
  hasUnread?: boolean
  /** 传入则显示计数徽标，否则显示纯红点。 */
  count?: number
  label?: string
  children: ReactNode
  className?: string
  badgeClassName?: string
}) {
  const show = Boolean(hasUnread || (typeof count === "number" && count > 0))
  return (
    <span data-slot="activity-indicator" className={cn("relative inline-flex", className)}>
      {children}
      {show ? (
        <span className={cn("pointer-events-none absolute -right-1 -top-1", badgeClassName)}>
          {typeof count === "number" ? (
            <ActivityCountBadge count={count} label={label} />
          ) : (
            <ActivityDot active label={label} />
          )}
        </span>
      ) : null}
    </span>
  )
}
