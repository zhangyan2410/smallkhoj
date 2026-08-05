type MentionableMember = {
  id: string
  kind: string
  handle?: string | null
}

function canonicalAgentHandle(member: MentionableMember | null | undefined) {
  if (member?.kind !== "agent") return null
  const handle = member.handle?.trim().replace(/^@+/, "")
  return handle || null
}

export function mentionedAgentHandle(
  mentionMemberIds: string[],
  channelMembers: MentionableMember[],
  fallbackMembers: MentionableMember[] = [],
) {
  const membersById = new Map<string, MentionableMember>()
  for (const member of fallbackMembers) membersById.set(member.id, member)
  for (const member of channelMembers) membersById.set(member.id, member)

  for (const memberId of mentionMemberIds) {
    const handle = canonicalAgentHandle(membersById.get(memberId))
    if (handle) return handle
  }
  return null
}

export function directMessageAgentHandle(member: MentionableMember | null | undefined) {
  return canonicalAgentHandle(member)
}
