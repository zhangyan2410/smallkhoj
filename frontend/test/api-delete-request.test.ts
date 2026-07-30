import assert from "node:assert/strict"
import test from "node:test"

import { apiDelete } from "../lib/control-plane"

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test("DELETE sends scoped headers and returns JSON through a bounded request", async () => {
  let requestInit: RequestInit | undefined
  globalThis.fetch = async (_input, init) => {
    requestInit = init
    return Response.json({ deleted: true, taskId: "task-1", taskNumber: 1 })
  }

  const result = await apiDelete(
    "/api/v1/tasks/task-1",
    "session-token",
    "server-a",
    { timeoutMs: 100 },
  )

  assert.deepEqual(result, { deleted: true, taskId: "task-1", taskNumber: 1 })
  assert.equal(requestInit?.method, "DELETE")
  assert.equal((requestInit?.headers as Record<string, string>)["X-Account-Token"], "session-token")
  assert.equal((requestInit?.headers as Record<string, string>)["X-Server-Id"], "server-a")
  assert.ok(requestInit?.signal)
})

test("DELETE preserves backend detail and network failures", async () => {
  globalThis.fetch = async () => Response.json(
    { detail: { instruction: "Choose an active Server" } },
    { status: 403 },
  )
  await assert.rejects(
    apiDelete("/api/v1/tasks/task-1", null, "server-a", { timeoutMs: 100 }),
    /Choose an active Server/,
  )

  globalThis.fetch = async () => {
    throw new TypeError("network unavailable")
  }
  await assert.rejects(
    apiDelete("/api/v1/tasks/task-1", null, "server-a", { timeoutMs: 100 }),
    /network unavailable/,
  )
})

test("DELETE aborts on its bounded timeout and propagates a caller AbortSignal", async () => {
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason ?? new DOMException("aborted", "AbortError"))
    })
  })

  await assert.rejects(
    Promise.race([
      apiDelete("/api/v1/tasks/task-1", null, "server-a", { timeoutMs: 5 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("DELETE did not abort")), 75)),
    ]),
    /timed out/i,
  )

  const caller = new AbortController()
  const pending = apiDelete(
    "/api/v1/tasks/task-1",
    null,
    "server-a",
    { timeoutMs: 100, signal: caller.signal },
  )
  caller.abort(new Error("caller cancelled"))
  await assert.rejects(pending, /caller cancelled/)
})

test("DELETE timeout remains active while a successful JSON body stalls", async () => {
  globalThis.fetch = async () => new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"deleted":'))
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )

  await assert.rejects(
    Promise.race([
      apiDelete("/api/v1/tasks/task-1", null, "server-a", { timeoutMs: 5 }),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("successful response body remained unbounded")),
        75,
      )),
    ]),
    /timed out/i,
  )
})

test("DELETE propagates caller cancellation after successful headers arrive", async () => {
  let bodyStarted: (() => void) | undefined
  const bodyHasStarted = new Promise<void>((resolve) => {
    bodyStarted = resolve
  })
  globalThis.fetch = async () => new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"deleted":'))
        bodyStarted?.()
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )
  const caller = new AbortController()
  const pending = apiDelete(
    "/api/v1/tasks/task-1",
    null,
    "server-a",
    { timeoutMs: 100, signal: caller.signal },
  )

  await bodyHasStarted
  caller.abort(new Error("caller cancelled after headers"))

  await assert.rejects(pending, /caller cancelled after headers/)
})
