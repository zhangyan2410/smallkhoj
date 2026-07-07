import assert from "node:assert/strict"
import test from "node:test"

import {
  createMaterialSurfaceCoordinator,
  type ActiveMaterialSurfaceRecord,
} from "../components/inkframe/material-surface-store"

function record(ownerId: string, calls: string[], region = "chat-main"): ActiveMaterialSurfaceRecord {
  return {
    region,
    ownerId,
    ownerKind: "message",
    deactivate: async (keep) => {
      calls.push(`${ownerId}:${keep ? "keep" : "drop"}`)
    },
  }
}

test("activating a surface deactivates the previous surface in the same region", async () => {
  const calls: string[] = []
  const coordinator = createMaterialSurfaceCoordinator()
  const first = record("message-1", calls)
  const second = record("message-2", calls)

  await coordinator.activate(first)
  await coordinator.activate(second, { keepPrevious: true })

  assert.deepEqual(calls, ["message-1:keep"])
  assert.equal(coordinator.getActive("chat-main"), second)
})

test("activating the same owner replaces the record without deactivating itself", async () => {
  const calls: string[] = []
  const coordinator = createMaterialSurfaceCoordinator()
  const first = record("message-1", calls)
  const updated = record("message-1", calls)

  await coordinator.activate(first)
  await coordinator.activate(updated)

  assert.deepEqual(calls, [])
  assert.equal(coordinator.getActive("chat-main"), updated)
})

test("active surfaces are isolated by workspace region", async () => {
  const calls: string[] = []
  const coordinator = createMaterialSurfaceCoordinator()
  const chat = record("message-1", calls, "chat-main")
  const task = record("task-1", calls, "task-main")

  await coordinator.activate(chat)
  await coordinator.activate(task)

  assert.deepEqual(calls, [])
  assert.equal(coordinator.getActive("chat-main"), chat)
  assert.equal(coordinator.getActive("task-main"), task)
})

test("deactivate clears the active surface only for the requested region", async () => {
  const calls: string[] = []
  const coordinator = createMaterialSurfaceCoordinator()
  const chat = record("message-1", calls, "chat-main")
  const task = record("task-1", calls, "task-main")

  await coordinator.activate(chat)
  await coordinator.activate(task)
  await coordinator.deactivate("chat-main", { keep: false })

  assert.deepEqual(calls, ["message-1:drop"])
  assert.equal(coordinator.getActive("chat-main"), null)
  assert.equal(coordinator.getActive("task-main"), task)
})

test("deactivateAll waits for every active surface and clears the registry", async () => {
  const calls: string[] = []
  const coordinator = createMaterialSurfaceCoordinator()

  await coordinator.activate(record("message-1", calls, "chat-main"))
  await coordinator.activate(record("task-1", calls, "task-main"))
  await coordinator.deactivateAll({ keep: true })

  assert.deepEqual(calls.sort(), ["message-1:keep", "task-1:keep"])
  assert.equal(coordinator.getActive("chat-main"), null)
  assert.equal(coordinator.getActive("task-main"), null)
})

test("release clears a stale owner without calling deactivate", async () => {
  const calls: string[] = []
  const coordinator = createMaterialSurfaceCoordinator()
  const first = record("message-1", calls, "chat-main")
  const second = record("message-2", calls, "chat-main")

  await coordinator.activate(first)
  coordinator.release("chat-main", "other-owner")
  assert.equal(coordinator.getActive("chat-main"), first)

  coordinator.release("chat-main", "message-1")
  assert.equal(coordinator.getActive("chat-main"), null)
  assert.deepEqual(calls, [])

  await coordinator.activate(second)
  assert.equal(coordinator.getActive("chat-main"), second)
})
