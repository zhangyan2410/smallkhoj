import type { MemoryEntry } from "./control-plane"

export type MemoryArtifactViewer =
  | "image"
  | "video"
  | "file"
  | "code"
  | "api_proof"
  | "db_proof"
  | "trace"
  | "review"
  | "text"

export type MemoryArtifactView = {
  entry: MemoryEntry
  viewer: MemoryArtifactViewer
  href: string | null
  sourceLabel: string | null
  label: string
  summary: string | null
}

export type MemoryChecklistItem = {
  text: string
  done: boolean
  sourcePath: string
}

export type TaskRecoveryModel = {
  brief: MemoryEntry | null
  plan: MemoryEntry | null
  progress: MemoryEntry | null
  finalSummary: MemoryEntry | null
  subtasks: MemoryChecklistItem[]
  outputs: MemoryArtifactView[]
  evidence: MemoryEntry[]
  artifacts: MemoryEntry[]
  reviews: MemoryEntry[]
  promotions: MemoryEntry[]
  recoveryCompleteness: {
    hasBrief: boolean
    hasPlan: boolean
    hasProgress: boolean
    hasOutput: boolean
    score: number
  }
}

export type MemoryEntryGroups = {
  knowledge: MemoryEntry[]
  taskSummaries: MemoryEntry[]
  outputs: MemoryEntry[]
  promotions: MemoryEntry[]
  other: MemoryEntry[]
}

const KNOWLEDGE_PATHS = new Set(["MEMORY.md"])

export function groupMemoryEntries(entries: MemoryEntry[]): MemoryEntryGroups {
  const knowledge = entries.filter(isChannelKnowledgeEntry)
  const taskSummaries = entries.filter(isTaskSummaryEntry)
  const outputs = entries.filter((entry) => !knowledge.includes(entry) && !taskSummaries.includes(entry) && isOutputEntry(entry))
  const promotions = entries.filter((entry) => isPromotionEntry(entry))
  const other = entries.filter(
    (entry) =>
      !knowledge.includes(entry) &&
      !taskSummaries.includes(entry) &&
      !outputs.includes(entry) &&
      !promotions.includes(entry)
  )
  return { knowledge, taskSummaries, outputs, promotions, other }
}

export function buildTaskRecoveryModel(entries: MemoryEntry[]): TaskRecoveryModel {
  const brief = findFirst(entries, ["brief.md", "task.md"])
  const plan = findFirst(entries, ["plan.md"])
  const progress = findFirst(entries, ["progress.md"])
  const finalSummary = findFirst(entries, ["final-summary.md", "summary.md"])
  const evidence = entries.filter(isEvidenceEntry)
  const artifacts = entries.filter(isArtifactEntry)
  const reviews = entries.filter((entry) => entry.entryKind === "review" || entry.path === "review.md" || entry.path.startsWith("review/"))
  const promotions = entries.filter(isPromotionEntry)
  const outputs = entries.filter(isOutputEntry).map(artifactViewForEntry)
  const subtasks = uniqueChecklistItems([
    ...extractChecklistItems(plan),
    ...extractChecklistItems(progress),
    ...extractMetadataSubtasks(plan),
    ...extractMetadataSubtasks(progress),
  ])
  const completenessParts = [brief, plan, progress, outputs.length > 0]
  const score = completenessParts.filter(Boolean).length

  return {
    brief,
    plan,
    progress,
    finalSummary,
    subtasks,
    outputs,
    evidence,
    artifacts,
    reviews,
    promotions,
    recoveryCompleteness: {
      hasBrief: Boolean(brief),
      hasPlan: Boolean(plan),
      hasProgress: Boolean(progress),
      hasOutput: outputs.length > 0,
      score,
    },
  }
}

export function artifactViewForEntry(entry: MemoryEntry): MemoryArtifactView {
  const viewer = classifyArtifactViewer(entry)
  return {
    entry,
    viewer,
    href: artifactHref(entry),
    sourceLabel: sourceLabel(entry),
    label: entry.title || entry.path,
    summary: entry.contentText?.trim() || null,
  }
}

export function classifyArtifactViewer(entry: MemoryEntry): MemoryArtifactViewer {
  const mime = entry.mimeType || ""
  const kind = (entry.entryKind || "").toLowerCase()
  const artifactKind = metadataString(entry, "artifactKind") || metadataString(entry, "kind") || kind
  const path = entry.path.toLowerCase()

  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (artifactKind === "screenshot") return "image"
  if (artifactKind === "video") return "video"
  if (artifactKind === "api_proof" || artifactKind === "api-proof") return "api_proof"
  if (artifactKind === "db_proof" || artifactKind === "db-proof") return "db_proof"
  if (artifactKind === "trace" || path.includes("trace")) return "trace"
  if (kind === "review" || artifactKind === "review") return "review"
  if (artifactKind === "code" || path.endsWith(".diff") || path.endsWith(".patch")) return "code"
  if (kind === "artifact" || entry.fileId || entry.blobKey) return "file"
  return "text"
}

export function extractChecklistItems(entry: MemoryEntry | null): MemoryChecklistItem[] {
  if (!entry?.contentText) return []
  return entry.contentText
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*[-*]\s+\[(x|X| )\]\s+(.+?)\s*$/)
      if (!match) return null
      return {
        done: match[1].toLowerCase() === "x",
        text: match[2].trim(),
        sourcePath: entry.path,
      }
    })
    .filter((item): item is MemoryChecklistItem => Boolean(item))
}

function extractMetadataSubtasks(entry: MemoryEntry | null): MemoryChecklistItem[] {
  const raw = entry?.metadata?.subtasks
  if (!entry || !Array.isArray(raw)) return []
  return raw
    .map((item) => {
      if (typeof item === "string") return { text: item, done: false, sourcePath: entry.path }
      if (!item || typeof item !== "object") return null
      const value = item as Record<string, unknown>
      const text = typeof value.text === "string" ? value.text.trim() : ""
      if (!text) return null
      return { text, done: Boolean(value.done), sourcePath: entry.path }
    })
    .filter((item): item is MemoryChecklistItem => Boolean(item))
}

function uniqueChecklistItems(items: MemoryChecklistItem[]): MemoryChecklistItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.text.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function findFirst(entries: MemoryEntry[], paths: string[]): MemoryEntry | null {
  return entries.find((entry) => paths.includes(entry.path)) ?? null
}

function isChannelKnowledgeEntry(entry: MemoryEntry): boolean {
  return KNOWLEDGE_PATHS.has(entry.path) || entry.path.startsWith("decisions/") || entry.path.startsWith("references/")
}

function isTaskSummaryEntry(entry: MemoryEntry): boolean {
  return entry.path.startsWith("tasks/") || entry.path.startsWith("task-summaries/")
}

function isEvidenceEntry(entry: MemoryEntry): boolean {
  return entry.entryKind === "evidence" || entry.path === "evidence.md" || entry.path.startsWith("evidence/")
}

function isArtifactEntry(entry: MemoryEntry): boolean {
  return entry.entryKind === "artifact" || entry.path === "artifacts.md" || entry.path.startsWith("artifacts/")
}

function isPromotionEntry(entry: MemoryEntry): boolean {
  return entry.entryKind === "promotion" || entry.path.startsWith("promotions/")
}

function isOutputEntry(entry: MemoryEntry): boolean {
  return isEvidenceEntry(entry) || isArtifactEntry(entry) || classifyArtifactViewer(entry) !== "text"
}

function artifactHref(entry: MemoryEntry): string | null {
  const explicit = metadataString(entry, "url") || metadataString(entry, "href") || metadataString(entry, "previewUrl")
  if (explicit) return explicit
  if (entry.fileId) return `/api/v1/attachments/${entry.fileId}`
  if (entry.sourcePath?.startsWith("http://") || entry.sourcePath?.startsWith("https://")) return entry.sourcePath
  return null
}

function sourceLabel(entry: MemoryEntry): string | null {
  return entry.sourcePath || entry.sourceMessageId || entry.sourceTaskId || entry.sourceThreadId || null
}

function metadataString(entry: MemoryEntry, key: string): string | null {
  const value = entry.metadata?.[key]
  return typeof value === "string" && value.trim() ? value.trim() : null
}
