"use client"

import { useCallback, useMemo, useState } from "react"
import Link from "next/link"
import { ListChecks } from "lucide-react"

import { TaskBoard, type Task } from "@/components/task-board"
import { StatusPill } from "@/components/product-ui"
import { statusLabel } from "@/lib/control-plane"

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

  const filterRecord = {
    view,
    channel: filters.channel,
    creator: filters.creator,
    assignee: filters.assignee,
    status: filters.status,
  }

  return (
    <div>
      {view === "board" ? (
        <TaskBoard
          key={boardKey}
          tasks={localTasks}
          initialView="board"
          showViewToggle={false}
          showDetail={false}
          dragDisabled={false}
          sessionToken={sessionToken}
          onTaskMoved={handleTaskMoved}
        />
      ) : (
        <div className="overflow-hidden rounded-none border-2 border-[var(--ink)] bg-card">
          {localTasks.map((task) => (
            <Link
              key={task.id}
              href={taskHref(task, filterRecord)}
              className="grid gap-2 border-b px-3 py-3 text-sm last:border-b-0 hover:bg-muted/40 md:grid-cols-[auto_1fr_auto_auto] md:items-center"
            >
              <div className="font-mono text-xs text-muted-foreground">{task.channel} #{task.number}</div>
              <div className="min-w-0">
                <div className="truncate font-medium">{task.title}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {task.creator && <span>by @{task.creator}</span>}
                  {task.assignee && <span>assigned @{task.assignee}</span>}
                  {task.data?.source && <span>source message</span>}
                  <span>updated {new Date(task.updatedAt || task.createdAt || 0).toLocaleString()}</span>
                </div>
              </div>
              <StatusPill status={task.status} label={statusLabel(task.status)} />
              <ListChecks className="size-4 text-muted-foreground" />
            </Link>
          ))}
          {localTasks.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">No tasks match filters</div>
          )}
        </div>
      )}
    </div>
  )
}
