import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { fetchAllCursorPages, fetchAllTaskPages } from "../lib/cursor-pagination"

test("fetchAllCursorPages merges every page until nextCursor is null", async () => {
  const requestedCursors: Array<string | null> = []
  const items = await fetchAllCursorPages<number>(async (cursor) => {
    requestedCursors.push(cursor)
    if (cursor === null) return { items: [1, 2], nextCursor: "page two" }
    if (cursor === "page two") return { items: [3], nextCursor: "page/three" }
    return { items: [4, 5], nextCursor: null }
  })

  assert.deepEqual(items, [1, 2, 3, 4, 5])
  assert.deepEqual(requestedCursors, [null, "page two", "page/three"])
})

test("fetchAllCursorPages rejects a repeated cursor instead of looping", async () => {
  let calls = 0

  await assert.rejects(
    fetchAllCursorPages(async () => {
      calls += 1
      return { items: [calls], nextCursor: "repeated" }
    }),
    /Cursor pagination repeated cursor/,
  )
  assert.equal(calls, 2)
})

test("fetchAllCursorPages rejects traversal beyond the configured page bound", async () => {
  let calls = 0

  await assert.rejects(
    fetchAllCursorPages(
      async () => {
        calls += 1
        return { items: [calls], nextCursor: `page-${calls}` }
      },
      { maxPages: 2 },
    ),
    /Cursor pagination exceeded 2 pages/,
  )
  assert.equal(calls, 2)
})

test("fetchAllTaskPages owns the bounded task URL and encodes cursors", async () => {
  const requestedPaths: string[] = []
  const tasks = await fetchAllTaskPages<{ id: string }>(async (path) => {
    requestedPaths.push(path)
    if (requestedPaths.length === 1) {
      return { tasks: [{ id: "task-1" }], nextCursor: "cursor + / ?" }
    }
    return { tasks: [{ id: "task-2" }], nextCursor: null }
  })

  assert.deepEqual(tasks, [{ id: "task-1" }, { id: "task-2" }])
  assert.deepEqual(requestedPaths, [
    "/api/v1/tasks?limit=200",
    "/api/v1/tasks?limit=200&cursor=cursor%20%2B%20%2F%20%3F",
  ])
})

test("every task-list consumer uses the shared all-pages contract", () => {
  const consumers = [
    "app/page.tsx",
    "app/tasks/page.tsx",
    "app/daemon/page.tsx",
    "app/control/integration/page.tsx",
    "components/task-board.tsx",
  ]

  for (const consumer of consumers) {
    const source = readFileSync(path.join(process.cwd(), consumer), "utf8")
    assert.match(source, /fetchAllTaskPages<Task>/, consumer)
    assert.doesNotMatch(
      source,
      /apiGet<\{ tasks: Task\[\] \}>\("\/api\/v1\/tasks"/,
      consumer,
    )
  }
})
