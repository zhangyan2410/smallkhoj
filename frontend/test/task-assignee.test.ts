import assert from "node:assert/strict"
import test from "node:test"

import { directMessageAgentHandle, mentionedAgentHandle } from "../lib/task-assignee"

test("task assignment trusts mentioned Member IDs and preserves a Unicode Agent Name", () => {
  const members = [
    { id: "human-1", kind: "human", handle: "张翰" },
    { id: "agent-1", kind: "agent", handle: "排障专家" },
  ]

  assert.equal(mentionedAgentHandle(["human-1", "agent-1"], members), "排障专家")
  assert.equal(mentionedAgentHandle(["missing"], members), null)
})

test("task assignment never falls back to an Agent display label or message text", () => {
  const members = [
    { id: "agent-1", kind: "agent", handle: "@canonical-name", displayName: "Wrong" },
  ]

  assert.equal(mentionedAgentHandle(["agent-1"], members), "canonical-name")
  assert.equal(mentionedAgentHandle([], members), null)
  assert.equal(directMessageAgentHandle(members[0]), "canonical-name")
})
