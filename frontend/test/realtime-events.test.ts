import assert from "node:assert/strict"
import test from "node:test"

import {
  applyHighWater,
  parseSSEText,
  shouldHandleRealtimeEvent,
  type PublicEventEnvelope,
} from "../lib/realtime-events"

test("parseSSEText parses event id and multiline data", () => {
  const frames = parseSSEText([
    "event: message.created",
    "id: evt-1",
    "data: {\"a\":",
    "data: 1}",
    "",
    ": heartbeat",
    "",
  ].join("\n"))

  assert.equal(frames.length, 1)
  assert.equal(frames[0].event, "message.created")
  assert.equal(frames[0].id, "evt-1")
  assert.equal(frames[0].data, "{\"a\":\n1}")
})

test("applyHighWater applies next event and drops duplicates", () => {
  const event = {
    id: "evt-1",
    type: "message.created",
    scope: { kind: "channel", id: "ch-1" },
    seq: 1,
    epoch: "epoch-a",
    createdAt: "now",
    payload: {},
  } satisfies PublicEventEnvelope
  const marks = new Map<string, { epoch: string; seq: number }>()

  assert.equal(applyHighWater(marks, event).action, "apply")
  assert.deepEqual(marks.get("channel:ch-1"), { epoch: "epoch-a", seq: 1 })
  assert.equal(applyHighWater(marks, event).action, "drop")
})

test("applyHighWater catches gaps and epoch changes", () => {
  const marks = new Map<string, { epoch: string; seq: number }>([
    ["task:all", { epoch: "epoch-a", seq: 3 }],
  ])

  assert.equal(applyHighWater(marks, {
    id: "evt-5",
    type: "task.updated",
    scope: { kind: "task" },
    seq: 5,
    epoch: "epoch-a",
    createdAt: "now",
    payload: {},
  }).action, "catch_up")

  assert.equal(applyHighWater(marks, {
    id: "evt-1",
    type: "task.updated",
    scope: { kind: "task" },
    seq: 1,
    epoch: "epoch-b",
    createdAt: "now",
    payload: {},
  }).action, "catch_up")
})

test("shouldHandleRealtimeEvent filters active channel by scope id or name", () => {
  const event = {
    id: "evt-1",
    type: "message.created",
    scope: { kind: "channel", id: "ch-1", name: "all" },
    seq: 1,
    epoch: "epoch-a",
    createdAt: "now",
    payload: {},
  } satisfies PublicEventEnvelope

  assert.equal(shouldHandleRealtimeEvent(event, { channelId: "ch-1", channelName: "all" }), true)
  assert.equal(shouldHandleRealtimeEvent(event, { channelId: "ch-2", channelName: "other" }), false)
})
