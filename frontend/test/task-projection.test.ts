import assert from "node:assert/strict"
import test from "node:test"

import {
  TaskProjectionOwner,
  filterTaskProjection,
  partitionPendingTasks,
  selectTaskProjection,
  type TaskProjectionTask,
} from "../lib/task-projection"

function task(
  id: string,
  status = "todo",
  overrides: Partial<TaskProjectionTask> = {},
): TaskProjectionTask {
  return {
    id,
    number: Number(id.replace(/\D/g, "")) || 1,
    title: `Task ${id}`,
    status,
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test("TaskProjectionOwner atomically replaces a complete snapshot", async () => {
  const next = deferred<TaskProjectionTask[]>()
  const owner = new TaskProjectionOwner({
    scopeKey: "account-a:server-a",
    initialTasks: [task("task-1")],
    fetchTasks: () => next.promise,
  })
  const observed: TaskProjectionTask[][] = []
  const unsubscribe = owner.subscribe(() => {
    observed.push(owner.getSnapshot().tasks)
  })

  const refresh = owner.refresh()
  assert.equal(owner.getSnapshot().phase, "refreshing")
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-1"])

  next.resolve([task("task-2"), task("task-3")])
  await refresh

  assert.equal(owner.getSnapshot().phase, "ready")
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-2", "task-3"])
  assert.equal(
    observed.some((snapshot) => snapshot.length === 1 && snapshot[0]?.id === "task-2"),
    false,
    "a partial page must never become the shared projection",
  )
  unsubscribe()
})

test("TaskProjectionOwner preserves stale data and exposes a retryable strict failure", async () => {
  let attempts = 0
  const owner = new TaskProjectionOwner({
    scopeKey: "account-a:server-a",
    initialTasks: [task("task-1")],
    fetchTasks: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("tenant unavailable")
      return [task("task-2")]
    },
  })

  await owner.refresh()
  assert.equal(owner.getSnapshot().phase, "error")
  assert.equal(owner.getSnapshot().error, "tenant unavailable")
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-1"])

  await owner.refresh()
  assert.equal(owner.getSnapshot().phase, "ready")
  assert.equal(owner.getSnapshot().error, null)
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-2"])
})

test("TaskProjectionOwner coalesces a burst into one trailing refresh", async () => {
  const requests: Array<ReturnType<typeof deferred<TaskProjectionTask[]>>> = []
  const owner = new TaskProjectionOwner({
    scopeKey: "account-a:server-a",
    initialTasks: [task("task-0")],
    fetchTasks: () => {
      const request = deferred<TaskProjectionTask[]>()
      requests.push(request)
      return request.promise
    },
  })

  const burst = owner.refresh()
  void owner.refresh()
  void owner.refresh()
  assert.equal(requests.length, 1)

  requests[0].resolve([task("task-1")])
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(requests.length, 2, "the burst schedules exactly one trailing traversal")

  requests[1].resolve([task("task-2")])
  await burst
  assert.equal(requests.length, 2)
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-2"])
})

test("TaskProjectionOwner rejects a stale generation after scope changes", async () => {
  const oldRequest = deferred<TaskProjectionTask[]>()
  const newRequest = deferred<TaskProjectionTask[]>()
  let oldSignal: AbortSignal | undefined
  const owner = new TaskProjectionOwner({
    scopeKey: "account-a:server-a",
    initialTasks: [task("server-a-initial")],
    fetchTasks: (signal) => {
      oldSignal = signal
      return oldRequest.promise
    },
  })

  const oldRefresh = owner.refresh()
  owner.setScope({
    scopeKey: "account-a:server-b",
    initialTasks: [task("server-b-initial")],
    fetchTasks: () => newRequest.promise,
  })
  assert.equal(oldSignal?.aborted, true)

  oldRequest.resolve([task("server-a-stale")])
  await oldRefresh
  assert.equal(owner.getSnapshot().scopeKey, "account-a:server-b")
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["server-b-initial"])

  const newRefresh = owner.refresh()
  newRequest.resolve([task("server-b-fresh")])
  await newRefresh
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["server-b-fresh"])
})

test("TaskProjectionOwner tombstones a removed task across an in-flight refresh", async () => {
  const inFlight = deferred<TaskProjectionTask[]>()
  const owner = new TaskProjectionOwner({
    scopeKey: "account-a:server-a",
    initialTasks: [task("task-1"), task("task-2")],
    fetchTasks: () => inFlight.promise,
  })

  const refresh = owner.refresh()
  owner.removeTask("task-1")
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-2"])

  inFlight.resolve([task("task-1"), task("task-2"), task("task-3")])
  await refresh
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-2", "task-3"])

  owner.hydrate([task("task-1"), task("task-4")])
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-4"])

  owner.setScope({
    scopeKey: "account-a:server-b",
    initialTasks: [task("task-1")],
    fetchTasks: async () => [task("task-1")],
  })
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-1"])
})

test("TaskProjectionOwner removal stays idempotent when realtime removed the task first", async () => {
  const owner = new TaskProjectionOwner({
    scopeKey: "account-a:server-a",
    initialTasks: [task("task-1")],
    fetchTasks: async () => [task("task-1"), task("already-deleted")],
  })
  let notifications = 0
  owner.subscribe(() => { notifications += 1 })
  const revision = owner.getSnapshot().revision

  owner.removeTask("already-deleted")
  owner.removeTask("already-deleted")

  assert.equal(owner.getSnapshot().revision, revision)
  assert.equal(notifications, 0)
  await owner.refresh()
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-1"])
})

test("TaskProjectionOwner can reactivate after a Strict Mode effect cleanup", async () => {
  const owner = new TaskProjectionOwner({
    scopeKey: "account-a:server-a",
    initialTasks: [task("task-1")],
    fetchTasks: async () => [task("stale-fetcher")],
  })
  owner.dispose()
  owner.activate()
  owner.setFetchTasks(async () => [task("task-2")])

  await owner.refresh()
  assert.deepEqual(owner.getSnapshot().tasks.map((item) => item.id), ["task-2"])
})

test("an explicit stale task selection never falls back to another visible task", () => {
  const tasks = [task("task-1"), task("task-2")]
  assert.equal(selectTaskProjection(tasks, {}, "missing-task"), undefined)
  assert.equal(selectTaskProjection(tasks, {}, "task-2")?.id, "task-2")
  assert.equal(selectTaskProjection(tasks, {}, "")?.id, "task-1")
  assert.equal(selectTaskProjection(tasks, {}, null)?.id, "task-1")
})

test("task projection filters and canonical pending statuses share one vocabulary", () => {
  const tasks = [
    task("task-1", "todo", { channel: "alpha", creator: "lee" }),
    task("task-2", "open", { channel: "alpha", assignee: "worker" }),
    task("task-3", "in_progress", { channel: "beta", assignee: "worker" }),
    task("task-4", "in_review", { channel: "alpha" }),
    task("task-5", "done", { channel: "alpha" }),
  ]

  assert.deepEqual(
    filterTaskProjection(tasks, { channel: "alpha" }).map((item) => item.id),
    ["task-1", "task-2", "task-4", "task-5"],
  )
  assert.deepEqual(
    filterTaskProjection(tasks, { assignee: "worker", status: "in_progress" }).map((item) => item.id),
    ["task-3"],
  )

  const pending = partitionPendingTasks(tasks)
  assert.deepEqual(pending.todo.map((item) => item.id), ["task-1", "task-2"])
  assert.deepEqual(pending.inProgress.map((item) => item.id), ["task-3"])
  assert.deepEqual(pending.all.map((item) => item.id), ["task-1", "task-2", "task-3"])
})
