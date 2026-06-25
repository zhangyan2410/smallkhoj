"use client"

import type { ReactNode } from "react"
import { Activity } from "lucide-react"

import { cn } from "@/lib/utils"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useResizablePanel } from "@/hooks/use-resizable-panel"

/**
 * 列表栏（Col 1）宽度配置。
 * - storageKey：localStorage key，按页面区分（如 "smallkhoj.tasks.listWidth"）
 * - defaultWidth / min / max：单位 px
 */
export type ListPanelConfig = {
  storageKey: string
  defaultWidth?: number
  min?: number
  max?: number
}

/**
 * ProductShell 的内容区（header + body）。
 * 从 ProductShell 拆成独立 client 组件，因为可调宽列表栏需要 client state。
 *
 * 布局：
 * - 无 list prop（默认）：单栏 dashboard —— header + [内容 + 可选右栏]，向后兼容。
 * - 有 list prop：三栏 —— header + [可调宽列表栏(深暖沙) + 主区(浅暖沙) + 可选右栏]。
 *
 * 配色：rail 用水材质（在 ProductShell 里）；列表栏/主区用暖沙色系（见 globals.css 的 --sand*）。
 */
export function ProductShellBody({
  title,
  description,
  actions,
  className,
  children,
  list,
  listTitle,
  listConfig,
  sidebar,
  sidebarTitle,
  sidebarDescription,
  /** 主区是否由 ProductShellBody 自己 overflow-y-auto（默认 true）。
   *  chat 页面有自己的内部滚动结构（消息流独立滚），需要传 false 让 channel-client 自己管滚动。 */
  mainScrollable = true,
}: {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
  children: ReactNode
  list?: ReactNode
  listTitle?: string
  listConfig?: ListPanelConfig
  sidebar?: ReactNode
  sidebarTitle?: string
  sidebarDescription?: string
  mainScrollable?: boolean
}) {
  const isThreeColumn = !!list

  const { width: listWidth, onPointerDown, onKeyDown } = useResizablePanel({
    storageKey: listConfig?.storageKey ?? "smallkhoj.list.width",
    defaultWidth: listConfig?.defaultWidth ?? 280,
    min: listConfig?.min ?? 220,
    max: listConfig?.max ?? 420,
    direction: "right-edge",
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-sand-border bg-sand px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase text-sand-muted">
              <Activity className="size-3.5" />
              SmallKhoj
            </div>
            <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-sand-ink">{title}</h1>
            {description && <p className="mt-1 max-w-3xl text-sm text-sand-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
          <div className="shrink-0">
            <LanguageSwitcher />
          </div>
        </div>
      </header>

      {isThreeColumn ? (
        /* 三栏：可调宽列表栏(深暖沙) + 主区(浅暖沙) + 可选右栏。
           关键：每列 flex flex-col + min-h-0 才能让 overflow-y-auto 真正起作用。
           父级 h-full 让三列共享主区高度。 */
        <div className="flex min-h-0 flex-1">
          <aside
            className="relative hidden shrink-0 flex-col border-r border-sand-border bg-sand-deep sm:flex"
            style={{ width: listWidth }}
          >
            {listTitle && (
              <div className="shrink-0 border-b border-sand-border px-3 py-2.5">
                <h2 className="text-sm font-semibold text-sand-ink">{listTitle}</h2>
              </div>
            )}
            <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">{list}</div>
            {/* 拖拽手柄（右边缘）—— 鼠标拖动调宽，键盘左右箭头微调 */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="调整列表栏宽度"
              tabIndex={0}
              className="sk-resize-handle absolute inset-y-0 right-0 z-10 w-1 cursor-col-resize"
              onPointerDown={onPointerDown}
              onKeyDown={onKeyDown}
            />
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-sand">
            <div className={cn("min-h-0 min-w-0 flex-1 p-4 sm:p-6", mainScrollable ? "overflow-y-auto" : "flex flex-col overflow-hidden", className)}>
              {children}
            </div>
          </div>

          {sidebar && (
            <aside className="hidden min-h-0 min-w-0 flex-col border-l border-sand-border bg-sand-deep/60 lg:flex lg:w-80">
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {sidebarTitle && (
                  <div className="mb-3">
                    <h2 className="text-sm font-semibold text-sand-ink">{sidebarTitle}</h2>
                    {sidebarDescription && <p className="mt-1 text-xs text-sand-muted">{sidebarDescription}</p>}
                  </div>
                )}
                {sidebar}
              </div>
            </aside>
          )}
        </div>
      ) : (
        /* 单栏 dashboard：内容 + 可选右栏（向后兼容旧行为）。
           同样用 min-h-0 + overflow-y-auto 让单列独立滚。 */
        <div className="grid min-h-0 min-w-0 flex-1 bg-sand lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className={cn("min-h-0 min-w-0 overflow-y-auto bg-sand p-4 sm:p-6", className)}>
            {children}
          </div>

          {sidebar && (
            <aside className="hidden min-h-0 min-w-0 flex-col border-l border-sand-border bg-sand-deep/60 lg:flex">
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {sidebarTitle && (
                  <div className="mb-3">
                    <h2 className="text-sm font-semibold text-sand-ink">{sidebarTitle}</h2>
                    {sidebarDescription && <p className="mt-1 text-xs text-sand-muted">{sidebarDescription}</p>}
                  </div>
                )}
                {sidebar}
              </div>
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
