export type OnboardingPlatform = "windows" | "unix"
export type OnboardingPhase = "install" | "setup" | "connect"

export type PhaseCommand = {
  command: string | null
  commandTemplate?: string | null
  label?: string
  requiresTicket?: boolean
}

export type PlatformRelease = {
  daemonVersion?: string | null
  platform?: string | null
  artifactUrl?: string | null
  sha256?: string | null
  minimumDaemonVersion?: string | null
  available?: boolean
  manifestUrl?: string | null
}

export type PlatformCommands = {
  platform?: string
  shell: "powershell" | "bash"
  available?: boolean
  release?: PlatformRelease | null
  install: PhaseCommand
  setup: PhaseCommand
  connect: PhaseCommand
}

export type PlatformCommandMap = Record<OnboardingPlatform, PlatformCommands>

export type OnboardingPreview = {
  name: string
  serverId?: string | null
  serverName?: string | null
  platforms: PlatformCommandMap
  ticket?: { expiresAt?: string | null; ttlSeconds?: number | null } | null
  expiresAt?: string | null
}

/** Browser hints choose only the initial tab; the user can always override it. */
export function detectInitialPlatform(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
  platform = typeof navigator === "undefined" ? "" : navigator.platform,
): OnboardingPlatform {
  return /win/i.test(`${userAgent} ${platform}`) ? "windows" : "unix"
}

export function oppositePlatform(platform: OnboardingPlatform): OnboardingPlatform {
  return platform === "windows" ? "unix" : "windows"
}

export function phaseCommand(
  platforms: PlatformCommandMap | null | undefined,
  platform: OnboardingPlatform,
  phase: OnboardingPhase,
): PhaseCommand | null {
  const selected = platforms?.[platform]
  return selected ? selected[phase] : null
}

/** Replace the non-secret name placeholder returned by the preview API. */
export function renderPhaseCommand(
  command: PhaseCommand | null,
  name: string,
  platform: OnboardingPlatform = "unix",
): string | null {
  if (!command) return null
  const template = command.commandTemplate || command.command
  if (!template) return null
  const normalizedName = name.trim() || "my-computer"
  const escapedName = platform === "windows"
    ? normalizedName.replaceAll("'", "''")
    : normalizedName.replaceAll("'", "'\"'\"'")
  return template.replaceAll("{{name}}", escapedName)
}

export function isExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false
  const timestamp = Date.parse(expiresAt)
  return Number.isFinite(timestamp) && timestamp <= now
}
