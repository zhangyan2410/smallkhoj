import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 轻量面板 —— 手作风的内嵌信息块。
 *
 * 用于那些「需要墨边直角、但不需要 Card 的硬阴影」的场景，比如：
 * - 消息气泡（无阴影，密集不闹）
 * - 内嵌信息块（任务详情的 activity/evidence 区块）
 * - 表单内的分组容器
 *
 * 替代满地的 `rounded-none border bg-background p-3` 裸 div。
 *
 * variant:
 * - default：墨边 + 暖白底 + 无阴影（气泡/信息块）
 * - raised：墨边 + 暖白底 + 硬阴影（需要浮起感，但比 Card 轻）
 * - flat：墨边 + 透明底（嵌套在已有背景里）
 */
const panelVariants = {
  default: "sk-object-panel border-2 border-[var(--ink)] rounded-none",
  raised: "sk-object-panel sk-object-panel-raised border-2 border-[var(--ink)] rounded-none",
  flat: "sk-object-panel sk-object-panel-flat border-2 border-[var(--ink)] bg-transparent rounded-none",
} as const

const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: keyof typeof panelVariants
  }
>(({ className, variant = "default", ...props }, ref) => (
  <div ref={ref} className={cn(panelVariants[variant], className)} {...props} />
))
Panel.displayName = "Panel"

const PanelTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn("text-sm font-semibold text-foreground", className)}
    {...props}
  />
))
PanelTitle.displayName = "PanelTitle"

export { Panel, PanelTitle, panelVariants }
