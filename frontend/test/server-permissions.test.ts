import assert from "node:assert/strict"
import test from "node:test"

import { canManageActiveServer } from "../lib/server-permissions"

function sessionWith(
  activeServerId: string,
  memberships?: Array<{
    serverId: string
    role: string
    status?: string
  }>,
) {
  return {
    server: { id: activeServerId },
    memberships: memberships?.map((membership) => ({
      server: { id: membership.serverId },
      role: membership.role,
      status: membership.status ?? "active",
    })),
  }
}

test("active Server owners and admins can manage destructive actions", () => {
  assert.equal(
    canManageActiveServer(sessionWith("server-a", [
      { serverId: "server-a", role: "owner" },
    ])),
    true,
  )
  assert.equal(
    canManageActiveServer(sessionWith("server-a", [
      { serverId: "server-a", role: "admin" },
    ])),
    true,
  )
})

test("management permission fails closed outside an active matching membership", () => {
  assert.equal(canManageActiveServer(null), false)
  assert.equal(canManageActiveServer(sessionWith("server-a")), false)
  assert.equal(
    canManageActiveServer(sessionWith("server-a", [
      { serverId: "server-b", role: "owner" },
    ])),
    false,
  )
  assert.equal(
    canManageActiveServer(sessionWith("server-a", [
      { serverId: "server-a", role: "member" },
    ])),
    false,
  )
  assert.equal(
    canManageActiveServer(sessionWith("server-a", [
      { serverId: "server-a", role: "owner", status: "disabled" },
    ])),
    false,
  )
})
