import type { AccountServerMembership } from "@/lib/control-plane"

export function switchableMemberships(
  memberships: AccountServerMembership[],
  activeServerId: string,
) {
  return memberships.filter((item) => item.server.id !== activeServerId)
}
