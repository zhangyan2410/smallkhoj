import assert from "node:assert/strict"
import test from "node:test"

import {
  createDestructiveActionGate,
  destructiveActionInitialState,
  destructiveActionReducer,
  guardDestructiveActionOpenChange,
} from "../lib/destructive-action-state"

test("destructive action reducer keeps an in-flight confirmation non-dismissible", () => {
  const confirming = destructiveActionReducer(destructiveActionInitialState, { type: "open" })
  assert.deepEqual(confirming, { phase: "confirming", error: null })

  const submitting = destructiveActionReducer(confirming, { type: "submit" })
  assert.deepEqual(submitting, { phase: "submitting", error: null })
  assert.equal(destructiveActionReducer(submitting, { type: "close" }), submitting)
  assert.equal(destructiveActionReducer(submitting, { type: "submit" }), submitting)

  const succeeded = destructiveActionReducer(submitting, { type: "succeed" })
  assert.deepEqual(succeeded, { phase: "succeeded", error: null })
})

test("a failed destructive action remains visible and can be retried or cancelled", () => {
  const submitting = destructiveActionReducer(
    destructiveActionReducer(destructiveActionInitialState, { type: "open" }),
    { type: "submit" },
  )
  const failed = destructiveActionReducer(submitting, {
    type: "fail",
    error: "Server refused deletion",
  })
  assert.deepEqual(failed, { phase: "failed", error: "Server refused deletion" })
  assert.deepEqual(
    destructiveActionReducer(failed, { type: "submit" }),
    { phase: "submitting", error: null },
  )
  assert.equal(
    destructiveActionReducer(failed, { type: "close" }),
    destructiveActionInitialState,
  )
})

test("single-flight gate returns one pending Promise and opens again after settlement", async () => {
  const gate = createDestructiveActionGate<string>()
  let starts = 0
  let releaseFirst!: (value: string) => void

  const first = gate.run(() => {
    starts += 1
    return new Promise<string>((resolve) => { releaseFirst = resolve })
  })
  const duplicate = gate.run(async () => {
    starts += 1
    return "duplicate"
  })

  assert.equal(gate.isPending(), true)
  assert.equal(duplicate, first)
  assert.equal(starts, 0)

  await Promise.resolve()
  assert.equal(starts, 1)
  releaseFirst("deleted")
  assert.equal(await duplicate, "deleted")
  assert.equal(gate.isPending(), false)

  const next = gate.run(async () => {
    starts += 1
    return "retried"
  })
  assert.notEqual(next, first)
  assert.equal(await next, "retried")
  assert.equal(starts, 2)
})

test("pending Base UI dismissals are canceled before internal close bookkeeping", () => {
  let cancellations = 0
  const eventDetails = { cancel: () => { cancellations += 1 } }

  assert.equal(guardDestructiveActionOpenChange(false, true, eventDetails), false)
  assert.equal(cancellations, 1)
  assert.equal(guardDestructiveActionOpenChange(true, true, eventDetails), true)
  assert.equal(guardDestructiveActionOpenChange(false, false, eventDetails), true)
  assert.equal(cancellations, 1)
})
