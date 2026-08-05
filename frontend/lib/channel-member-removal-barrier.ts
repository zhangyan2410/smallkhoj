export type ChannelMemberRemovalBarrier = Map<string, Set<string>>

function removedIdsForChannel(
  barrier: ChannelMemberRemovalBarrier,
  channelId: string,
) {
  let removedIds = barrier.get(channelId)
  if (!removedIds) {
    removedIds = new Set<string>()
    barrier.set(channelId, removedIds)
  }
  return removedIds
}

export function markChannelMemberRemoved(
  barrier: ChannelMemberRemovalBarrier,
  channelId: string,
  memberId: string,
) {
  removedIdsForChannel(barrier, channelId).add(memberId)
}

export function markChannelMemberPresent(
  barrier: ChannelMemberRemovalBarrier,
  channelId: string,
  memberId: string,
) {
  const removedIds = barrier.get(channelId)
  if (!removedIds) return
  removedIds.delete(memberId)
  if (removedIds.size === 0) barrier.delete(channelId)
}

export function filterRemovedChannelMembers<T extends { id: string }>(
  barrier: ChannelMemberRemovalBarrier,
  channelId: string,
  members: T[],
) {
  const removedIds = barrier.get(channelId)
  if (!removedIds?.size) return members
  return members.filter((member) => !removedIds.has(member.id))
}

export function channelMembershipEventMemberId(payload: Record<string, unknown>) {
  const member = payload.member
  if (!member || typeof member !== "object") return null
  const memberId = (member as Record<string, unknown>).memberId
  return typeof memberId === "string" && memberId ? memberId : null
}
