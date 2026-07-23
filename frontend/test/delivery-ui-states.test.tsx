import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import type { ReactElement, ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

import { RouteErrorState } from "../components/route-error-state"
import { RouteLoadingState } from "../components/route-loading-state"
import { apiGet, apiGetCritical } from "../lib/control-plane"

const originalFetch = globalThis.fetch

test.afterEach(() => {
  globalThis.fetch = originalFetch
})

test("critical GET returns JSON but never converts HTTP or network failure into an empty collection", async () => {
  globalThis.fetch = async () => Response.json({ tasks: [{ id: "task-1" }] })
  assert.deepEqual(await apiGetCritical<{ tasks: Array<{ id: string }> }>("/api/v1/tasks"), {
    tasks: [{ id: "task-1" }],
  })

  globalThis.fetch = async () => Response.json({ detail: "tenant unavailable" }, { status: 503 })
  await assert.rejects(apiGetCritical("/api/v1/tasks"), /tenant unavailable/)

  globalThis.fetch = async () => {
    throw new TypeError("network down")
  }
  await assert.rejects(apiGetCritical("/api/v1/tasks"), /network down/)

  globalThis.fetch = async () => Response.json({ detail: "optional unavailable" }, { status: 503 })
  assert.deepEqual(await apiGet("/api/v1/optional", { items: [] }), { items: [] })
})

test("critical GET owns a bounded timeout", async () => {
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
  })

  await assert.rejects(
    apiGetCritical("/api/v1/tasks", null, null, { timeoutMs: 5 }),
    /timed out/i,
  )
})

function findClickable(node: ReactNode): ReactElement<{ onClick: () => void }> | null {
  if (!node || typeof node !== "object" || !("props" in node)) return null
  const element = node as ReactElement<{ onClick?: () => void; children?: ReactNode }>
  if (typeof element.props.onClick === "function") {
    return element as ReactElement<{ onClick: () => void }>
  }
  const children = Array.isArray(element.props.children) ? element.props.children : [element.props.children]
  for (const child of children) {
    const found = findClickable(child)
    if (found) return found
  }
  return null
}

test("route loading and error states expose live semantics and a working retry", () => {
  const loading = renderToStaticMarkup(
    <RouteLoadingState title="Loading workspace…" description="Loading…" />,
  )
  assert.match(loading, /data-slot="route-loading"/)
  assert.match(loading, /role="status"/)
  assert.match(loading, /aria-live="polite"/)

  let retries = 0
  const errorState = RouteErrorState({
    title: "Something went wrong.",
    description: "Try the request again.",
    retryLabel: "Try again",
    onRetry: () => { retries += 1 },
  })
  const errorMarkup = renderToStaticMarkup(errorState)
  assert.match(errorMarkup, /data-slot="route-error"/)
  assert.match(errorMarkup, /role="alert"/)
  assert.match(errorMarkup, />Try again</)
  const retry = findClickable(errorState)
  assert.ok(retry)
  retry.props.onClick()
  assert.equal(retries, 1)
})

test("critical routes and heavy boards use strict loading/error and lazy boundaries", async () => {
  const loadingSource = await readFile(new URL("../app/loading.tsx", import.meta.url), "utf8")
  const errorSource = await readFile(new URL("../app/error.tsx", import.meta.url), "utf8")
  const tasksSource = await readFile(new URL("../app/tasks/page.tsx", import.meta.url), "utf8")
  const channelSource = await readFile(new URL("../app/chat/[channel]/channel-client.tsx", import.meta.url), "utf8")
  const lazyBoardSource = await readFile(new URL("../components/task-dnd-board-lazy.tsx", import.meta.url), "utf8")

  assert.match(loadingSource, /RouteLoadingState/)
  assert.match(errorSource, /RouteErrorState/)
  assert.match(errorSource, /onRetry=\{reset\}/)
  assert.match(tasksSource, /apiGetCritical/)
  assert.match(tasksSource, /TaskDndBoardLazy/)
  assert.doesNotMatch(tasksSource, /import \{ TaskDndBoard \}/)
  assert.match(channelSource, /dynamic\(/)
  assert.match(channelSource, /import\("@\/components\/markdown-message"\)/)
  assert.match(channelSource, /import\("@\/components\/task-board"\)/)
  assert.match(lazyBoardSource, /ssr:\s*false/)
  assert.match(lazyBoardSource, /role="status"/)
})
