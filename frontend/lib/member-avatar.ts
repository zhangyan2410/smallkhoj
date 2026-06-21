import { Avatar as DiceBearAvatar, Style } from "@dicebear/core"
import croodlesNeutralDefinition from "@dicebear/styles/croodles-neutral.json" with { type: "json" }

export type AvatarMember = {
  id?: string | null
  name?: string | null
  displayName?: string | null
  handle?: string | null
  kind?: string | null
  status?: string | null
  avatarUrl?: string | null
  profile?: {
    displayName?: string | null
    avatarUrl?: string | null
  } | null
}

const agentStyle = new Style(croodlesNeutralDefinition)
const generatedAvatarCache = new Map<string, string>()
const AGENT_AVATAR_BACKGROUND_COLORS = ["e0f2fe", "eef2ff", "dcfce7", "fef3c7"]

export const AGENT_AVATAR_STYLE = "croodles-neutral"
export const AGENT_AVATAR_OPTIONS = {
  backgroundColor: AGENT_AVATAR_BACKGROUND_COLORS,
  borderRadius: 12,
  scale: 1,
} as const

export function memberAvatarName(member: AvatarMember) {
  return (
    member.profile?.displayName?.trim() ||
    member.displayName?.trim() ||
    member.name?.trim() ||
    member.handle?.trim() ||
    "Member"
  )
}

export function avatarSeedForMember(member: AvatarMember) {
  return (
    member.id?.trim() ||
    member.handle?.trim() ||
    member.name?.trim() ||
    member.displayName?.trim() ||
    "member"
  )
}

export function isAgentMember(member: AvatarMember) {
  return member.kind === "agent"
}

export function generatedAgentAvatarDataUri(seed: string) {
  const cacheKey = `croodles-neutral:${seed}`
  const cached = generatedAvatarCache.get(cacheKey)
  if (cached) return cached

  const avatar = new DiceBearAvatar(agentStyle, {
    seed,
    size: 128,
    ...AGENT_AVATAR_OPTIONS,
  })
  const dataUri = avatar.toDataUri()
  generatedAvatarCache.set(cacheKey, dataUri)
  return dataUri
}

export function avatarSourceForMember(member: AvatarMember) {
  if (isAgentMember(member)) {
    return generatedAgentAvatarDataUri(avatarSeedForMember(member))
  }
  return member.profile?.avatarUrl || member.avatarUrl || null
}

function normalizeIdentity(value?: string | null) {
  return (value || "").trim().replace(/^@+/, "").toLowerCase()
}

export function memberForMessageSender(sender: string, senderType: string | null | undefined, members: AvatarMember[]) {
  const normalizedSender = normalizeIdentity(sender)
  const matched = members.find((member) => {
    const names = [
      member.id,
      member.handle,
      member.name,
      member.displayName,
      member.profile?.displayName,
    ]
    return names.some((name) => normalizeIdentity(name) === normalizedSender)
  })
  if (matched) return matched

  const displayName = sender.trim().replace(/^@+/, "") || "Unknown"
  const isAgent = senderType === "agent" || senderType === "assistant"
  return {
    id: `message:${isAgent ? "agent" : "member"}:${displayName}`,
    name: displayName,
    displayName,
    handle: sender.startsWith("@") ? sender : `@${displayName}`,
    kind: isAgent ? "agent" : "human",
    status: "offline",
  } satisfies AvatarMember
}

export function statusDotClass(status?: string | null) {
  switch (status) {
    case "online":
    case "active":
      return "bg-emerald-500"
    case "running":
    case "in_progress":
      return "bg-sky-500"
    case "idle":
    case "pending":
    case "pending_start":
    case "starting":
    case "in_review":
    case "busy":
    case "stopping":
    case "restarting":
      return "bg-amber-500"
    case "failed":
    case "crashed":
    case "cancelled":
      return "bg-rose-500"
    case "offline":
    case "stopped":
      return "bg-slate-400"
    case "done":
    case "fired":
      return "bg-emerald-500"
    default:
      return "bg-muted-foreground"
  }
}
