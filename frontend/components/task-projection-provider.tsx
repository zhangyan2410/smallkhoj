"use client"

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react"

import { InkframeObjectSurface } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { apiGetCritical } from "@/lib/control-plane"
import { fetchAllTaskPages, type TaskCursorPage } from "@/lib/cursor-pagination"
import { TASK_DATA_INVALIDATED_EVENT } from "@/lib/realtime-owner"
import {
  TaskProjectionOwner,
  type TaskProjectionSnapshot,
  type TaskProjectionTask,
} from "@/lib/task-projection"

type TaskProjectionContextValue = TaskProjectionSnapshot & {
  refresh: () => Promise<void>
  updateTask: (taskId: string, updater: (task: TaskProjectionTask) => TaskProjectionTask) => void
  replaceTask: (task: TaskProjectionTask) => void
  removeTask: (taskId: string) => void
}

const TaskProjectionContext = createContext<TaskProjectionContextValue | null>(null)

function createTaskProjectionFetcher(
  sessionToken?: string | null,
  activeServerId?: string | null,
) {
  return (signal: AbortSignal) => fetchAllTaskPages<TaskProjectionTask>((path) => (
    apiGetCritical<TaskCursorPage<TaskProjectionTask>>(
      path,
      sessionToken,
      activeServerId,
      { signal },
    )
  ))
}

type TaskProjectionProviderProps = {
  scopeKey: string
  initialTasks: TaskProjectionTask[]
  sessionToken?: string | null
  activeServerId?: string | null
  children: ReactNode
}

export function TaskProjectionProvider(props: TaskProjectionProviderProps) {
  const { scopeKey } = props
  return <TaskProjectionScopeProvider key={scopeKey} {...props} />
}

function TaskProjectionScopeProvider({
  scopeKey,
  initialTasks,
  sessionToken,
  activeServerId,
  children,
}: TaskProjectionProviderProps) {
  const [owner] = useState(() => new TaskProjectionOwner({
    scopeKey,
    initialTasks,
    fetchTasks: createTaskProjectionFetcher(sessionToken, activeServerId),
  }))

  const snapshot = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot,
  )

  useEffect(() => {
    owner.activate()
    return () => owner.dispose()
  }, [owner])

  useEffect(() => {
    owner.setFetchTasks(createTaskProjectionFetcher(sessionToken, activeServerId))
    owner.hydrate(initialTasks)
  }, [activeServerId, initialTasks, owner, sessionToken])

  useEffect(() => {
    const invalidateTasks = () => {
      void owner.refresh()
    }
    window.addEventListener(TASK_DATA_INVALIDATED_EVENT, invalidateTasks)
    return () => window.removeEventListener(TASK_DATA_INVALIDATED_EVENT, invalidateTasks)
  }, [owner])

  const refresh = useCallback(() => owner.refresh(), [owner])
  const updateTask = useCallback((
    taskId: string,
    updater: (task: TaskProjectionTask) => TaskProjectionTask,
  ) => owner.updateTask(taskId, updater), [owner])
  const replaceTask = useCallback((task: TaskProjectionTask) => owner.replaceTask(task), [owner])
  const removeTask = useCallback((taskId: string) => owner.removeTask(taskId), [owner])

  const value = useMemo<TaskProjectionContextValue>(() => ({
    ...snapshot,
    refresh,
    updateTask,
    replaceTask,
    removeTask,
  }), [refresh, removeTask, replaceTask, snapshot, updateTask])

  return (
    <TaskProjectionContext.Provider value={value}>
      {children}
    </TaskProjectionContext.Provider>
  )
}

export function useTaskProjection() {
  const value = useContext(TaskProjectionContext)
  if (!value) {
    throw new Error("useTaskProjection must be used inside <TaskProjectionProvider>")
  }
  return value
}

export function TaskProjectionStatus({
  refreshingLabel,
  errorLabel,
  retryLabel,
}: {
  refreshingLabel: string
  errorLabel: string
  retryLabel: string
}) {
  const { phase, error, refresh } = useTaskProjection()

  if (phase === "error") {
    return (
      <InkframeObjectSurface
        material="drying"
        role="alert"
        data-slot="task-projection-error"
        className="flex min-w-0 items-start justify-between gap-3 px-3 py-2"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">{errorLabel}</p>
          {error && <p className="mt-0.5 break-words text-xs text-muted-foreground">{error}</p>}
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
          {retryLabel}
        </Button>
      </InkframeObjectSurface>
    )
  }

  if (phase === "refreshing") {
    return (
      <p
        role="status"
        aria-live="polite"
        data-slot="task-projection-refreshing"
        className="text-xs text-muted-foreground"
      >
        {refreshingLabel}
      </p>
    )
  }

  return null
}
