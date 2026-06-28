"use client"

import Link from "next/link"
import { CheckSquare, Plus } from "lucide-react"

import type { Task } from "@/components/task-board"
import { StatusPill } from "@/components/product-ui"
import { statusLabel, badgeClass } from "@/lib/control-plane"
import { cn } from "@/lib/utils"

/**
 * 任务列表栏（三栏模式的 Col1）。
 * 精简列表：每项显示 #编号、标题、状态徽章。点击选中（走 URL ?task=）。
 * 选中项高亮。顶部有「新建任务」按钮（触发外部传入的 onOpenCreate）。
 */
export function TaskListPanel({
  tasks,
  selectedTaskId,
  filters,
  onOpenCreate,
  createLabel,
  emptyLabel,
}: {
  tasks: Task[]
  selectedTaskId?: string | null
  filters: Record<string, string | undefined>
  onOpenCreate?: () => void
  createLabel?: string
  emptyLabel?: string
}) {
  // 把当前 filters（不含 task）拼成查询串，切换 task 时保留其他筛选
  const baseQuery = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v) baseQuery.set(k, v)
  })

  return (
    <div className="flex h-full flex-col">
      {onOpenCreate && (
        <div className="border-b border-sand-border p-2">
          <button
            type="button"
            onClick={onOpenCreate}
            className="flex w-full items-center justify-center gap-1.5 rounded-none border-2 border-[var(--ink)] bg-sand-card px-3 py-2 text-sm font-medium text-sand-ink sk-hard-shadow-sm transition-colors hover:bg-white"
          >
            <Plus className="size-4" />
            {createLabel ?? "New task"}
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <CheckSquare className="size-5 text-sand-muted" />
            <p className="text-xs text-sand-muted">{emptyLabel ?? "No tasks"}</p>
          </div>
        ) : (
          <ul className="space-y-0.5 p-1.5">
            {tasks.map((task) => {
              const isActive = task.id === selectedTaskId
              const q = new URLSearchParams(baseQuery)
              q.set("task", task.id)
              return (
                <li key={task.id}>
                  <Link
                    href={`/tasks?${q.toString()}`}
                    className={cn(
                      "block rounded-none px-2.5 py-2 transition-colors",
                      isActive
                        ? "bg-white sk-hard-shadow-sm ring-1 ring-sand-border"
                        : "hover:bg-white/60",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-xs font-mono text-sand-muted">
                        #{task.number}
                      </span>
                      <StatusPill
                        status={task.status}
                        label={statusLabel(task.status)}
                        className={cn("shrink-0", badgeClass(task.status))}
                      />
                    </div>
                    <p
                      className={cn(
                        "mt-1 line-clamp-2 text-sm",
                        isActive ? "font-medium text-sand-ink" : "text-sand-ink/85",
                      )}
                    >
                      {task.title}
                    </p>
                    {task.assigneeMember?.displayName && (
                      <p className="mt-0.5 truncate text-xs text-sand-muted">
                        @ {task.assigneeMember.displayName}
                      </p>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
