import type { Member } from "./control-plane"

export type TaskEvidenceEntry = {
  type: "screenshot" | "trace" | "api_proof" | "note" | "reviewer_decision" | "review_note"
  path?: string
  content?: string
  note?: string
  reviewer?: string
  decision?: string
  timestamp?: string
}

export type TaskEvidence = {
  notes?: string[]
  links?: Array<{ label?: string; href?: string }>
  entries?: TaskEvidenceEntry[]
}

export type TaskSource = {
  type?: string
  messageId?: string
  messageShortId?: string
  threadId?: string
  channel?: string
}

export type TaskProjectionTask = {
  id: string
  number: number
  taskNumber?: number
  channel?: string | null
  channelId?: string | null
  messageId?: string | null
  title: string
  description?: string | null
  status: string
  creator?: string | null
  assignee?: string | null
  assigneeMember?: Member | null
  assigneeName?: string | null
  data?: {
    source?: TaskSource
    evidence?: TaskEvidence
  } | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type TaskProjectionFilters = {
  channel?: string
  creator?: string
  assignee?: string
  status?: string
}

export function filterTaskProjection(
  tasks: readonly TaskProjectionTask[],
  filters: TaskProjectionFilters,
): TaskProjectionTask[] {
  return tasks.filter((task) => {
    if (filters.channel && task.channel !== filters.channel) return false
    if (filters.creator && task.creator !== filters.creator) return false
    if (filters.assignee && task.assignee !== filters.assignee) return false
    if (filters.status && task.status !== filters.status) return false
    return true
  })
}

export function selectTaskProjection(
  tasks: readonly TaskProjectionTask[],
  filters: TaskProjectionFilters,
  selectedTaskId?: string | null,
): TaskProjectionTask | undefined {
  if (selectedTaskId) {
    return tasks.find((task) => task.id === selectedTaskId)
  }
  return filterTaskProjection(tasks, filters)[0]
}

export function partitionPendingTasks(tasks: readonly TaskProjectionTask[]) {
  const todo = tasks.filter((task) => task.status === "todo" || task.status === "open")
  const inProgress = tasks.filter((task) => task.status === "in_progress")
  return { todo, inProgress, all: [...todo, ...inProgress] }
}

export type TaskProjectionPhase = "ready" | "refreshing" | "error"

export type TaskProjectionSnapshot = {
  scopeKey: string
  tasks: TaskProjectionTask[]
  phase: TaskProjectionPhase
  error: string | null
  revision: number
}

export type TaskProjectionScope = {
  scopeKey: string
  initialTasks: TaskProjectionTask[]
  fetchTasks: (signal: AbortSignal) => Promise<TaskProjectionTask[]>
}

type ActiveRefresh = {
  generation: number
  trailing: boolean
  controller: AbortController | null
  promise: Promise<void>
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Task refresh failed"
}

/**
 * Owns one complete task snapshot for one account/Server scope.
 *
 * A fetcher must resolve only after every cursor page has been consumed. The
 * owner never accepts partial pages: it retains the previous array while the
 * traversal runs and swaps the full result in one notification. Repeated
 * invalidations during an active traversal collapse into one trailing run.
 */
export class TaskProjectionOwner {
  private listeners = new Set<() => void>()
  private snapshot: TaskProjectionSnapshot
  private fetchTasks: TaskProjectionScope["fetchTasks"]
  private generation = 0
  private activeRefresh: ActiveRefresh | null = null
  private removedTaskIds = new Set<string>()
  private disposed = false

  constructor(scope: TaskProjectionScope) {
    this.fetchTasks = scope.fetchTasks
    this.snapshot = {
      scopeKey: scope.scopeKey,
      tasks: scope.initialTasks,
      phase: "ready",
      error: null,
      revision: 0,
    }
  }

  getSnapshot = (): TaskProjectionSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  setScope(scope: TaskProjectionScope) {
    this.disposed = false
    this.generation += 1
    this.activeRefresh?.controller?.abort()
    this.activeRefresh = null
    this.removedTaskIds.clear()
    this.fetchTasks = scope.fetchTasks
    this.snapshot = {
      scopeKey: scope.scopeKey,
      tasks: scope.initialTasks,
      phase: "ready",
      error: null,
      revision: this.snapshot.revision + 1,
    }
    this.emit()
  }

  hydrate(tasks: TaskProjectionTask[]) {
    if (this.disposed || this.snapshot.tasks === tasks) return
    const visibleTasks = this.withoutRemovedTasks(tasks)
    this.generation += 1
    this.activeRefresh?.controller?.abort()
    this.activeRefresh = null
    this.snapshot = {
      ...this.snapshot,
      tasks: visibleTasks,
      phase: "ready",
      error: null,
      revision: this.snapshot.revision + 1,
    }
    this.emit()
  }

  setFetchTasks(fetchTasks: TaskProjectionScope["fetchTasks"]) {
    if (this.disposed) return
    this.fetchTasks = fetchTasks
  }

  activate() {
    this.disposed = false
  }

  updateTask(taskId: string, updater: (task: TaskProjectionTask) => TaskProjectionTask) {
    const index = this.snapshot.tasks.findIndex((task) => task.id === taskId)
    if (index < 0) return
    const current = this.snapshot.tasks[index]
    const updated = updater(current)
    if (updated === current) return
    const tasks = [...this.snapshot.tasks]
    tasks[index] = updated
    this.snapshot = {
      ...this.snapshot,
      tasks,
      revision: this.snapshot.revision + 1,
    }
    this.emit()
  }

  replaceTask(task: TaskProjectionTask) {
    if (this.removedTaskIds.has(task.id)) return
    this.updateTask(task.id, () => task)
  }

  removeTask(taskId: string) {
    if (this.disposed || !taskId) return
    this.removedTaskIds.add(taskId)
    const tasks = this.snapshot.tasks.filter((task) => task.id !== taskId)
    if (tasks.length === this.snapshot.tasks.length) return
    this.snapshot = {
      ...this.snapshot,
      tasks,
      revision: this.snapshot.revision + 1,
    }
    this.emit()
  }

  refresh(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const current = this.activeRefresh
    if (current?.generation === this.generation) {
      current.trailing = true
      return current.promise
    }

    const active: ActiveRefresh = {
      generation: this.generation,
      trailing: false,
      controller: null,
      promise: Promise.resolve(),
    }
    this.activeRefresh = active
    active.promise = this.runRefreshLoop(active)
    return active.promise
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.activeRefresh?.controller?.abort()
    this.activeRefresh = null
    this.listeners.clear()
  }

  private async runRefreshLoop(active: ActiveRefresh) {
    do {
      active.trailing = false
      const controller = new AbortController()
      active.controller = controller
      if (!this.isCurrent(active)) return
      this.snapshot = { ...this.snapshot, phase: "refreshing", error: null }
      this.emit()

      try {
        const tasks = await this.fetchTasks(controller.signal)
        if (!this.isCurrent(active)) return
        this.snapshot = {
          ...this.snapshot,
          tasks: this.withoutRemovedTasks(tasks),
          phase: active.trailing ? "refreshing" : "ready",
          error: null,
          revision: this.snapshot.revision + 1,
        }
        this.emit()
      } catch (error) {
        if (!this.isCurrent(active)) return
        this.snapshot = {
          ...this.snapshot,
          phase: active.trailing ? "refreshing" : "error",
          error: active.trailing ? null : errorMessage(error),
        }
        this.emit()
      } finally {
        if (active.controller === controller) active.controller = null
      }
    } while (this.isCurrent(active) && active.trailing)

    if (this.activeRefresh === active) this.activeRefresh = null
  }

  private isCurrent(active: ActiveRefresh) {
    return !this.disposed
      && active.generation === this.generation
      && (this.activeRefresh === null || this.activeRefresh === active)
  }

  private withoutRemovedTasks(tasks: readonly TaskProjectionTask[]) {
    if (this.removedTaskIds.size === 0) return [...tasks]
    return tasks.filter((task) => !this.removedTaskIds.has(task.id))
  }

  private emit() {
    for (const listener of [...this.listeners]) listener()
  }
}
