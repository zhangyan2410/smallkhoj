import { Avatar as DiceBearAvatar, Style, type StyleOptions } from "@dicebear/core"
import smallkhojCroodlesNeutralDefinition, {
  SMALLKHOJ_ENERGETIC_EYES_PATH,
  SMALLKHOJ_ENERGETIC_EYES_VARIANT,
} from "@/lib/smallkhoj-croodles-neutral"

export { SMALLKHOJ_ENERGETIC_EYES_PATH, SMALLKHOJ_ENERGETIC_EYES_VARIANT }

export type AvatarMember = {
  id?: string | null
  name?: string | null
  displayName?: string | null
  handle?: string | null
  kind?: string | null
  status?: string | null
  avatarUrl?: string | null
  config?: Record<string, unknown> & {
    avatarImageUrl?: string | null
    avatarPreset?: string | null
  } | null
  profile?: {
    displayName?: string | null
    avatarUrl?: string | null
  } | null
}

const agentStyle = new Style(smallkhojCroodlesNeutralDefinition)
const generatedAvatarCache = new Map<string, string>()
const AGENT_AVATAR_BACKGROUND_COLORS = ["e0f2fe", "eef2ff", "dcfce7", "fef3c7"]
type AgentAvatarPreset = {
  name: string
  backgroundColor: string[]
  borderRadius: number
  scale: number
  eyesVariant?: string[]
  mouthVariant?: string[]
  noseVariant?: string[]
}

export const AGENT_AVATAR_STYLE = "croodles-neutral"
export const AGENT_AVATAR_OPTIONS = {
  backgroundColor: AGENT_AVATAR_BACKGROUND_COLORS,
  borderRadius: 12,
  scale: 1,
}
export const AGENT_AVATAR_PRESETS = {
  default: {
    name: "default",
    ...AGENT_AVATAR_OPTIONS,
  },
  friendly: {
    name: "friendly",
    backgroundColor: ["fce7f3", "e0f2fe", "dcfce7"],
    borderRadius: 12,
    scale: 1,
    eyesVariant: ["variant01", "variant03", "variant05", "variant12"],
    mouthVariant: ["variant01", "variant05", "variant14", "variant15"],
    noseVariant: ["variant01", "variant04", "variant08"],
  },
  focused: {
    name: "focused",
    backgroundColor: ["eef2ff", "e0f2fe", "f1f5f9"],
    borderRadius: 12,
    scale: 1,
    eyesVariant: ["variant02", "variant04", "variant08", "variant11"],
    mouthVariant: ["variant02", "variant04", "variant06", "variant11"],
    noseVariant: ["variant02", "variant05", "variant09"],
  },
  debugger: {
    name: "debugger",
    backgroundColor: ["fef3c7", "dcfce7", "e0f2fe"],
    borderRadius: 12,
    scale: 1,
    eyesVariant: ["variant06", "variant09", "variant10", "variant13"],
    mouthVariant: ["variant03", "variant08", "variant12", "variant18"],
    noseVariant: ["variant03", "variant06", "variant07"],
  },
  energetic: {
    name: "energetic",
    backgroundColor: ["fce7f3", "fef3c7", "e0f2fe"],
    borderRadius: 12,
    scale: 1,
    eyesVariant: [SMALLKHOJ_ENERGETIC_EYES_VARIANT],
    mouthVariant: ["variant01", "variant05", "variant14"],
    noseVariant: ["variant01", "variant04", "variant08"],
  },
} satisfies Record<string, AgentAvatarPreset>

export type AgentAvatarPresetName = keyof typeof AGENT_AVATAR_PRESETS

export function agentAvatarPresetForMember(member: AvatarMember) {
  const presetName = member.config?.avatarPreset?.trim() as AgentAvatarPresetName | undefined
  if (presetName && presetName in AGENT_AVATAR_PRESETS) {
    return AGENT_AVATAR_PRESETS[presetName]
  }
  return AGENT_AVATAR_PRESETS.default
}

type CroodlesNeutralOptions = StyleOptions<typeof smallkhojCroodlesNeutralDefinition>

function diceBearOptionsForPreset(preset: (typeof AGENT_AVATAR_PRESETS)[AgentAvatarPresetName]): CroodlesNeutralOptions {
  const options = { ...preset } as Omit<AgentAvatarPreset, "name"> & { name?: string }
  delete options.name
  return options as CroodlesNeutralOptions
}

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

export function generatedAgentAvatarDataUri(seed: string, preset = AGENT_AVATAR_PRESETS.default) {
  const cacheKey = `croodles-neutral:${preset.name}:${seed}`
  const cached = generatedAvatarCache.get(cacheKey)
  if (cached) return cached

  const avatar = new DiceBearAvatar(agentStyle, {
    seed,
    size: 128,
    ...diceBearOptionsForPreset(preset),
  })
  const dataUri = avatar.toDataUri()
  generatedAvatarCache.set(cacheKey, dataUri)
  return dataUri
}

export function avatarSourceForMember(member: AvatarMember) {
  if (isAgentMember(member)) {
    const configuredImage = member.config?.avatarImageUrl?.trim()
    if (configuredImage) return configuredImage
    return generatedAgentAvatarDataUri(avatarSeedForMember(member), agentAvatarPresetForMember(member))
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
