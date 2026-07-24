import type { ReactNode } from "react"

import { ProductShellBody, type ListPanelConfig } from "@/components/product-shell-body"

/**
 * 页面内容区外壳（body-only）。
 *
 * P2 重构后：稳定的 chrome（icon 导航栏 + WebGL 水墨背景 + 引擎脚本 + auth gate）
 * 已上移到 app/(app)/layout.tsx，整个会话只挂载一次。本组件只负责页面自己的：
 * header（title / description / actions）+ 三栏 body（list / main / sidebar）。
 *
 * 原先的 `active` / `session` / `getTranslations("nav")` / rail / background 都不再这里渲染。
 * 各页面继续 `<ProductShell>` 包住自己的内容，但只传内容相关 props。
 */
export async function ProductShell({
  title,
  description,
  children,
  sidebar,
  sidebarTitle,
  sidebarDescription,
  actions,
  className,
  list,
  listTitle,
  listConfig,
  mainScrollable,
}: {
  title: string
  description?: string
  children: ReactNode
  sidebar?: ReactNode
  sidebarTitle?: string
  sidebarDescription?: string
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
  return (
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
  )
}
