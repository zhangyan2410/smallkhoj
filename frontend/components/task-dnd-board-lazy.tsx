"use client"

import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"

import type { TaskDndBoardProps } from "@/components/task-dnd-board"

function TaskBoardLoadingFallback() {
  const t = useTranslations("common")
  return (
    <div
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-48 flex-col justify-center gap-3"
    >
      <span className="text-sm font-medium text-foreground">{t("taskBoardLoading")}</span>
      <span aria-hidden="true" className="h-3 w-3/5 bg-muted motion-safe:animate-pulse" />
      <span aria-hidden="true" className="h-3 w-full bg-muted motion-safe:animate-pulse" />
      <span aria-hidden="true" className="h-3 w-4/5 bg-muted motion-safe:animate-pulse" />
    </div>
  )
}

const TaskDndBoard = dynamic(
  () => import("@/components/task-dnd-board").then((module) => ({ default: module.TaskDndBoard })),
  {
    ssr: false,
    loading: () => <TaskBoardLoadingFallback />,
  },
)

export default function TaskDndBoardLazy(props: TaskDndBoardProps) {
  return <TaskDndBoard {...props} />
}
