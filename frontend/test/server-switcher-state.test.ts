import assert from "node:assert/strict"
import test from "node:test"

import { switchableMemberships } from "../lib/server-switcher-state"
import type { AccountServerMembership } from "../lib/control-plane"

function membership(id: string, name = id): AccountServerMembership {
  return {
    server: { id, name },
    member: { id: `member-${id}`, displayName: name, kind: "human" },
    role: "owner",
    status: "active",
    isDefault: false,
  }
}

test("switchableMemberships excludes the active Server from the switch list", () => {
  const memberships = [membership("server-a"), membership("server-b")]

  assert.deepEqual(
    switchableMemberships(memberships, "server-a").map((item) => item.server.id),
    ["server-b"],
  )
})

test("switchableMemberships returns an empty list when the account only has the active Server", () => {
  assert.deepEqual(switchableMemberships([membership("server-a")], "server-a"), [])
})
