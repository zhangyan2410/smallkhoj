"use client"

import { useCallback, useMemo, useState } from "react"
import { useRouter } from "next/navigation"

import { TaskBoard, type Task } from "@/components/task-board"

export type TaskDndBoardProps = {
  tasks: Task[]
  filters: Record<string, string>
  view: "board" | "list"
  sessionToken?: string | null
}

function taskHref(task: Task, filters: Record<string, string>) {
  const params = new URLSearchParams({ ...filters, task: task.id })
  for (const [key, value] of [...params.entries()]) {
    if (!value) params.delete(key)
  }
  return `/tasks?${params.toString()}`
}

export function TaskDndBoard({ tasks, filters, view, sessionToken }: TaskDndBoardProps) {
  const router = useRouter()
  const [statusOverrides, setStatusOverrides] = useState<Record<string, string>>({})

  const localTasks = useMemo(
    () => tasks.map((task) => {
      const status = statusOverrides[task.id]
      return status ? { ...task, status } : task
    }),
    [tasks, statusOverrides],
  )
  const boardKey = useMemo(
    () => localTasks.map((task) => `${task.id}:${task.status}`).join("|"),
    [localTasks],
  )

  const handleTaskMoved = useCallback((taskId: string, newStatus: string) => {
    setStatusOverrides((prev) => ({ ...prev, [taskId]: newStatus }))
  }, [])

  const filterRecord = useMemo(
    () => ({
      view,
      channel: filters.channel,
      creator: filters.creator,
      assignee: filters.assignee,
      status: filters.status,
    }),
    [filters.assignee, filters.channel, filters.creator, filters.status, view],
  )

  // 点击看板卡片 -> 导航到 ?task=（打开详情 Dialog），单一真源是 URL
  const handleSelectTask = useCallback((task: Task) => {
    router.push(taskHref(task, filterRecord))
  }, [router, filterRecord])

  return (
    <div data-inkframe-mobile-role="task-board" className="min-w-0 overflow-x-hidden">
      <TaskBoard
        key={`${boardKey}:${view}`}
        tasks={localTasks}
        initialView={view}
        showViewToggle={false}
        showDetail={false}
        dragDisabled={view !== "board"}
        sessionToken={sessionToken}
        onTaskMoved={handleTaskMoved}
        onSelectTask={handleSelectTask}
        taskFilters={filters}
      />
    </div>
  )
}
