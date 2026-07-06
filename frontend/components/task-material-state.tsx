"use client"

import { createContext, useContext, type ReactNode } from "react"

import { TaskMaterialSurface } from "@/components/inkframe-object-ui"
import { cn } from "@/lib/utils"

type TaskMaterialState = {
  activeMaterialTaskId: string | null
  toggleTaskMaterial: (taskId: string) => void
  clearTaskMaterial: () => void
}

const TaskMaterialStateContext = createContext<TaskMaterialState | null>(null)

export function TaskMaterialStateProvider({
  children,
}: {
  initialTaskId?: string | null
  children: ReactNode
}) {
  return (
    <TaskMaterialStateContext.Provider value={STATIC_TASK_MATERIAL_STATE}>
      {children}
    </TaskMaterialStateContext.Provider>
  )
}

export function useOptionalTaskMaterialState() {
  return useContext(TaskMaterialStateContext)
}

export function useTaskMaterialState() {
  const value = useOptionalTaskMaterialState()
  if (!value) {
    throw new Error("useTaskMaterialState must be used inside <TaskMaterialStateProvider>")
  }
  return value
}

export function TaskRouteDetailMaterialFrame({
  taskId,
  status,
  className,
  children,
}: {
  taskId: string
  status: string
  className?: string
  children: ReactNode
}) {
  return (
    <TaskMaterialSurface
      status={status}
      data-inkframe-mobile-role="task-detail"
      materialSurface={{
        ownerId: taskId,
        mode: "static",
        pointerMode: "none",
      }}
      className={cn("min-w-0 space-y-4 overflow-x-hidden p-4", className)}
    >
      {children}
    </TaskMaterialSurface>
  )
}

const STATIC_TASK_MATERIAL_STATE: TaskMaterialState = {
  activeMaterialTaskId: null,
  toggleTaskMaterial: () => {},
  clearTaskMaterial: () => {},
}
