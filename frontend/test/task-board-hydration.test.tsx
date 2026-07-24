import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

import { renderToStaticMarkup } from "react-dom/server"

import { TaskBoard, type Task } from "../components/task-board"

const tasks = [
  {
    id: "task-1",
    number: 1,
    channel: "#slock",
    title: "Hydration-safe task board",
    status: "in_review",
    creator: "zy-ean",
    assignee: "kimi",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
  },
] satisfies Task[]

test("TaskBoard sortable cards use a stable DnD described-by id for hydration", () => {
  const markup = renderToStaticMarkup(
    <TaskBoard
      tasks={tasks}
      showViewToggle={false}
      showDetail={false}
    />
  )

  assert.match(markup, /aria-describedby="smallkhoj-task-board"/)
  assert.doesNotMatch(markup, /aria-describedby="DndDescribedBy-\d+"/)
  assert.match(markup, /data-slot="task-material-surface"/)
  assert.match(markup, /data-task-material="drying"/)
})

test("TaskBoard embedded detail includes the task memory reminder action", () => {
  const markup = renderToStaticMarkup(
    <TaskBoard
      tasks={tasks}
      showViewToggle={false}
      showDetail
      initialSelectedTaskId="task-1"
    />
  )

  assert.match(markup, /提醒产出记忆/)
  assert.match(markup, /data-slot="task-material-surface"/)
  assert.match(markup, /data-task-material="drying"/)
  assert.match(markup, /发送提醒/)
  assert.match(markup, /最终总结/)
  assert.match(markup, /频道提案/)
})

test("Tasks product route keeps task material visual-only without drawing controls", () => {
  const routeSource = readFileSync(new URL("../app/(app)/tasks/page.tsx", import.meta.url), "utf8")
  const dndBoardSource = readFileSync(new URL("../components/task-dnd-board.tsx", import.meta.url), "utf8")
  const stateSource = readFileSync(new URL("../components/task-material-state.tsx", import.meta.url), "utf8")
  const taskBoardSource = readFileSync(new URL("../components/task-board.tsx", import.meta.url), "utf8")

  assert.match(routeSource, /TaskMaterialStateProvider/)
  assert.doesNotMatch(routeSource, /TaskMaterialStateProvider initialTaskId/)
  assert.match(routeSource, /TaskRouteDetailMaterialFrame/)
  assert.doesNotMatch(stateSource, /data-slot="task-material-toggle"/)
  assert.doesNotMatch(dndBoardSource, /useOptionalTaskMaterialState/)
  assert.doesNotMatch(taskBoardSource, /data-slot="task-material-toggle"/)
  assert.doesNotMatch(taskBoardSource, /pointerMode:\s*[^\n]*"draw"/)
  assert.match(taskBoardSource, /pointerMode:\s*"none"/)
})
