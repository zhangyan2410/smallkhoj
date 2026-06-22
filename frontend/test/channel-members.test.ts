import assert from "node:assert/strict"
import test from "node:test"

import { channelMemberAddPayload } from "../lib/channel-members"

test("channel member add payload matches public API contract", () => {
  assert.deepEqual(channelMemberAddPayload("member-1"), { memberId: "member-1" })
})

