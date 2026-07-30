import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8")

test("task routes and dashboard consume the shared task projection", async () => {
  const [taskPage, homePage, routeProjection, dashboardProjection, provider] = await Promise.all([
    read("../app/(app)/tasks/page.tsx"),
    read("../app/(app)/page.tsx"),
    read("../components/task-route-projection.tsx"),
    read("../components/task-dashboard-projection.tsx"),
    read("../components/task-projection-provider.tsx"),
  ])

  assert.match(taskPage, /<TaskProjectionProvider/)
  assert.match(taskPage, /<TaskRouteList/)
  assert.match(taskPage, /<TaskRouteWorkspace/)
  assert.match(taskPage, /<TaskRouteDetail/)
  assert.match(taskPage, /<TaskRouteFormDialogs/)
  assert.doesNotMatch(taskPage, /<RealtimeRefresh/)

  assert.match(homePage, /<TaskProjectionProvider/)
  assert.match(homePage, /<TaskDashboardProjection/)
  assert.match(dashboardProjection, /partitionPendingTasks/)

  assert.match(provider, /fetchAllTaskPages<TaskProjectionTask>/)
  assert.match(provider, /apiGetCritical<TaskCursorPage<TaskProjectionTask>>/)
  assert.match(provider, /<TaskProjectionScopeProvider key=\{scopeKey\}/)
  assert.match(provider, /useState\(\(\) => new TaskProjectionOwner/)
  assert.match(provider, /owner\.activate\(\)/)
  assert.match(provider, /owner\.hydrate\(initialTasks\)/)
  assert.match(provider, /TASK_DATA_INVALIDATED_EVENT/)
  assert.match(provider, /removeTask/)
  assert.match(provider, /role="alert"/)
  assert.match(provider, /retry/)

  for (const consumer of [routeProjection, dashboardProjection]) {
    assert.match(consumer, /useTaskProjection/)
  }
})

test("selected task deletion is exact, authorized server-side, and clears the URL without refresh", async () => {
  const [taskPage, routeProjection] = await Promise.all([
    read("../app/(app)/tasks/page.tsx"),
    read("../components/task-route-projection.tsx"),
  ])

  assert.match(taskPage, /canManageActiveServer\(session\)/)
  assert.match(taskPage, /selectTaskProjection\(tasks, filters, selectedTaskId\)/)
  assert.equal(taskPage.match(/deleteConfig=/g)?.length, 1)
  assert.match(taskPage, /deleteConfig=\{canManageServer && selectedTaskId/)
  assert.match(taskPage, /clearSelectionHref: tasksBaseHref/)

  assert.match(routeProjection, /<DestructiveActionDialog/)
  assert.match(routeProjection, /apiDelete<unknown>/)
  assert.match(routeProjection, /isTaskDeleteResult\(result, task\.id\)/)
  assert.match(routeProjection, /removeTask\(task\.id\)/)
  assert.match(routeProjection, /router\.replace\(config\.clearSelectionHref, \{ scroll: false \}\)/)
  assert.doesNotMatch(routeProjection, /window\.confirm/)
  assert.doesNotMatch(routeProjection, /router\.refresh/)
  assert.doesNotMatch(routeProjection, /window\.location/)
})

test("controlled TaskBoard never owns a second task refresh loop", async () => {
  const [taskBoard, dndBoard] = await Promise.all([
    read("../components/task-board.tsx"),
    read("../components/task-dnd-board.tsx"),
  ])

  assert.match(taskBoard, /const controlled = preloadedTasks !== undefined/)
  assert.match(taskBoard, /if \(controlled\) return/)
  assert.match(taskBoard, /onTaskUpdated/)

  assert.doesNotMatch(dndBoard, /statusOverrides/)
  assert.doesNotMatch(dndBoard, /boardKey/)
  assert.doesNotMatch(dndBoard, /key=\{`\$\{boardKey\}/)
  assert.match(dndBoard, /useTaskProjection/)
})
