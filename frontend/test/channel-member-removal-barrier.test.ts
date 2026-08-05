import assert from "node:assert/strict"
import test from "node:test"

import {
  channelMembershipEventMemberId,
  filterRemovedChannelMembers,
  markChannelMemberPresent,
  markChannelMemberRemoved,
  type ChannelMemberRemovalBarrier,
} from "../lib/channel-member-removal-barrier"

test("a stale roster response cannot resurrect a locally removed Channel member", () => {
  const barrier: ChannelMemberRemovalBarrier = new Map()
  const members = [{ id: "agent-1" }, { id: "agent-2" }]

  markChannelMemberRemoved(barrier, "channel-1", "agent-1")

  assert.deepEqual(
    filterRemovedChannelMembers(barrier, "channel-1", members),
    [{ id: "agent-2" }],
  )
  assert.deepEqual(
    filterRemovedChannelMembers(barrier, "channel-2", members),
    members,
  )
})

test("an explicit rejoin clears the removal barrier", () => {
  const barrier: ChannelMemberRemovalBarrier = new Map()
  const members = [{ id: "agent-1" }]

  markChannelMemberRemoved(barrier, "channel-1", "agent-1")
  markChannelMemberPresent(barrier, "channel-1", "agent-1")

  assert.deepEqual(
    filterRemovedChannelMembers(barrier, "channel-1", members),
    members,
  )
})

test("membership event member IDs are read only from the compact member payload", () => {
  assert.equal(
    channelMembershipEventMemberId({ member: { memberId: "agent-1" } }),
    "agent-1",
  )
  assert.equal(channelMembershipEventMemberId({ memberId: "agent-1" }), null)
  assert.equal(channelMembershipEventMemberId({ member: { handle: "agent-1" } }), null)
})
