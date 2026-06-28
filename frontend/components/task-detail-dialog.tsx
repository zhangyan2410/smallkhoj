"use client"

import { useRouter } from "next/navigation"

import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog"

/**
 * 任务详情大 Dialog。URL-driven：page 是 server component，选中 ?task= 时
 * 以 open=true 渲染本组件，把 server 渲染的 TaskDetail 作为 children 传入。
 * 关闭 = 导航回不带 ?task 的基础 URL（DialogContent 自带的 ✕ 会触发 onOpenChange(false)，
 * 这里转成 router.push(closeHref)，比 JS back 更可预测、可分享）。
 *
 * server→client 边界：children 是渲染好的 ReactNode，不传函数，安全。
 */
export function TaskDetailDialog({
  open,
  closeHref,
  children,
}: {
  open: boolean
  closeHref: string
  children: React.ReactNode
}) {
  const router = useRouter()
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) router.push(closeHref)
      }}
    >
      <DialogContent className="max-w-4xl max-h-[88vh] overflow-y-auto">
        {children}
      </DialogContent>
    </Dialog>
  )
}
