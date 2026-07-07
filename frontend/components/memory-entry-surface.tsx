import {
  Camera,
  CheckCircle2,
  Circle,
  ClipboardList,
  Database,
  ExternalLink,
  FileText,
  Film,
  ImageIcon,
  LinkIcon,
  XCircle,
  Shield,
  Sparkles,
} from "lucide-react"

import { AttachmentSheet, InkframeObjectSurface, MemoryFixedNote, ReviewStamp } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { RuntimeChip } from "@/components/product-ui"
import {
  BROWSER_API_BASE,
  formatTime,
  type MemoryEntry,
  type MemoryProposal,
} from "@/lib/control-plane"
import {
  artifactViewForEntry,
  buildTaskRecoveryModel,
  classifyArtifactViewer,
  groupMemoryEntries,
  type MemoryArtifactView,
} from "@/lib/memory-presentation"

export type TaskRecoveryCopy = {
  title: string
  scoreLabel: (score: number) => string
  brief: string
  plan: string
  progress: string
  output: string
  noMemory: string
  taskBreakdown: string
  outputsAndEvidence: string
}

export type ChannelMemoryCopy = {
  title: string
  entryCount: (count: number) => string
  loading: string
  empty: string
  channelKnowledge: string
  taskOutputs: string
  artifactsAndProofs: string
  promotions: string
  otherMemory: string
}

export type MemoryProposalCopy = {
  reviewQueue: string
  loading: string
  openProposals: string
  accept: string
  reject: string
  acceptAria: (path: string) => string
  rejectAria: (path: string) => string
  base: string
}

const defaultTaskRecoveryCopy: TaskRecoveryCopy = {
  title: "Task Recovery",
  scoreLabel: (score) => `${score}/4 recovery signals`,
  brief: "Brief",
  plan: "Plan",
  progress: "Progress",
  output: "Output",
  noMemory: "No server-owned task memory has been written yet.",
  taskBreakdown: "Task breakdown",
  outputsAndEvidence: "Outputs and evidence",
}

const defaultChannelMemoryCopy: ChannelMemoryCopy = {
  title: "Memory",
  entryCount: (count) => `${count} entries`,
  loading: "Loading memory...",
  empty: "No channel memory has been written yet.",
  channelKnowledge: "Channel knowledge",
  taskOutputs: "Task outputs",
  artifactsAndProofs: "Artifacts and proofs",
  promotions: "Promotions",
  otherMemory: "Other memory",
}

const defaultMemoryProposalCopy: MemoryProposalCopy = {
  reviewQueue: "Review queue",
  loading: "Loading memory proposals...",
  openProposals: "Open channel memory proposals",
  accept: "Accept",
  reject: "Reject",
  acceptAria: (path) => `Accept ${path}`,
  rejectAria: (path) => `Reject ${path}`,
  base: "base",
}

function formatFileSize(bytes?: number) {
  const value = bytes || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function artifactUrl(href: string | null) {
  if (!href) return null
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("data:")) return href
  if (href.startsWith("/api/")) return `${BROWSER_API_BASE}${href}`
  return href
}

function MemoryEntryIcon({ entry }: { entry: MemoryEntry }) {
  const viewer = classifyArtifactViewer(entry)
  if (viewer === "image") return <ImageIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  if (viewer === "video") return <Film className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  if (viewer === "api_proof" || viewer === "db_proof" || viewer === "trace") return <Database className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  if (viewer === "review") return <Shield className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  if (entry.entryKind === "decision") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  if (entry.entryKind === "promotion") return <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  if (entry.entryKind === "plan" || entry.entryKind === "progress") return <ClipboardList className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
  return <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
}

function MemoryArtifactPreview({ view, compact = false }: { view: MemoryArtifactView; compact?: boolean }) {
  const src = artifactUrl(view.href)
  if (view.viewer === "image" && src) {
    return (
      <AttachmentSheet kind="image" className="mt-2 overflow-hidden p-0">
        <a href={src} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={view.label} className={compact ? "max-h-28 w-full object-cover" : "max-h-48 w-full object-cover"} />
        </a>
      </AttachmentSheet>
    )
  }
  if (view.viewer === "video" && src) {
    return (
      <AttachmentSheet kind="video" className="mt-2 overflow-hidden p-0">
        <video
          suppressHydrationWarning
          className={compact ? "max-h-28 w-full bg-black" : "max-h-48 w-full bg-black"}
          controls
          src={src}
        >
          <a href={src}>Open video</a>
        </video>
      </AttachmentSheet>
    )
  }
  if (src) {
    return (
      <AttachmentSheet kind="proof" className="mt-2 inline-flex p-0">
        <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-1 text-[0.7rem] text-accent-mint hover:bg-muted">
          <ExternalLink className="size-3" />
          Open output
        </a>
      </AttachmentSheet>
    )
  }
  return null
}

export function MemoryEntryRow({ entry, compact = false, showPreview = true }: { entry: MemoryEntry; compact?: boolean; showPreview?: boolean }) {
  const view = artifactViewForEntry(entry)
  const text = entry.contentText?.trim()
  return (
    <MemoryFixedNote fixed={Boolean(entry.contentSha256 || entry.version)} className="flex items-start gap-2 px-2.5 py-2">
      <MemoryEntryIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={compact ? "truncate text-xs font-medium" : "truncate text-sm font-medium"}>{entry.title || entry.path}</span>
          <RuntimeChip tone="neutral" className="min-h-5 shrink-0 px-1.5 py-0 text-[0.65rem]">{entry.entryKind || view.viewer}</RuntimeChip>
        </div>
        <div className="mt-1 truncate font-mono text-[0.7rem] text-accent-mint">{entry.path}</div>
        {text && <p className={compact ? "mt-1 whitespace-pre-wrap text-xs text-muted-foreground line-clamp-3" : "mt-1 whitespace-pre-wrap text-xs text-muted-foreground line-clamp-5"}>{text}</p>}
        {showPreview && <MemoryArtifactPreview view={view} compact={compact} />}
        <div className="mt-1 flex flex-wrap gap-2 text-[0.65rem] text-muted-foreground">
          {entry.version !== undefined && <span>v{entry.version}</span>}
          {entry.contentSha256 && <span className="font-mono">{entry.contentSha256.slice(0, 8)}</span>}
          <span>{formatFileSize(entry.sizeBytes)}</span>
          <span>{formatTime(entry.updatedAt || entry.createdAt)}</span>
          {view.sourceLabel && (
            <span className="inline-flex max-w-full items-center gap-1 truncate">
              <LinkIcon className="size-3" />
              <span className="truncate">{view.sourceLabel}</span>
            </span>
          )}
        </div>
      </div>
    </MemoryFixedNote>
  )
}

export function TaskRecoveryCockpit({ entries, compact = false, copy = defaultTaskRecoveryCopy }: { entries: MemoryEntry[]; compact?: boolean; copy?: TaskRecoveryCopy }) {
  const model = buildTaskRecoveryModel(entries)
  const completeness = model.recoveryCompleteness
  const scoreLabel = copy.scoreLabel(completeness.score)
  const primaryEntries = [model.brief, model.plan, model.progress, model.finalSummary].filter((entry): entry is MemoryEntry => Boolean(entry))
  return (
    <InkframeObjectSurface material={completeness.score >= 3 ? "fixed" : "drying"} className="p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">{copy.title}</h3>
          <p className="text-xs text-muted-foreground">{scoreLabel}</p>
        </div>
        <div className="grid grid-cols-4 gap-1 text-[0.65rem] text-muted-foreground">
          {[
            [copy.brief, completeness.hasBrief],
            [copy.plan, completeness.hasPlan],
            [copy.progress, completeness.hasProgress],
            [copy.output, completeness.hasOutput],
          ].map(([label, active]) => (
            <RuntimeChip key={String(label)} tone={active ? "success" : "neutral"} className="min-h-5 px-1.5 py-0 text-[0.62rem]">
              {label}
            </RuntimeChip>
          ))}
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{copy.noMemory}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {model.subtasks.length > 0 && (
            <InkframeObjectSurface material="dry" className="p-2">
              <div className="mb-1 text-xs font-medium">{copy.taskBreakdown}</div>
              <div className="space-y-1">
                {model.subtasks.slice(0, compact ? 4 : 8).map((item) => (
                  <div key={`${item.sourcePath}:${item.text}`} className="flex items-start gap-2 text-xs">
                    {item.done ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                    <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.text}</span>
                  </div>
                ))}
              </div>
            </InkframeObjectSurface>
          )}
          {primaryEntries.length > 0 && (
            <div className="space-y-2">
              {primaryEntries.map((entry) => (
                <MemoryEntryRow key={entry.id} entry={entry} compact showPreview={false} />
              ))}
            </div>
          )}
          {model.outputs.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs font-medium">
                <Camera className="size-3.5" />
                {copy.outputsAndEvidence}
              </div>
              <div className="space-y-2">
                {model.outputs.slice(0, compact ? 3 : 8).map((view) => (
                  <MemoryEntryRow key={view.entry.id} entry={view.entry} compact={compact} showPreview />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </InkframeObjectSurface>
  )
}

export function ChannelMemorySurface({ entries, loading, channelTitle, copy = defaultChannelMemoryCopy }: { entries: MemoryEntry[]; loading: boolean; channelTitle: string; copy?: ChannelMemoryCopy }) {
  const groups = groupMemoryEntries(entries)
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{copy.title}</h2>
          <p className="text-xs text-muted-foreground">{channelTitle}</p>
        </div>
        <span className="text-xs text-muted-foreground">{copy.entryCount(entries.length)}</span>
      </div>
      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{copy.loading}</p>
      ) : entries.length === 0 ? (
        <InkframeObjectSurface material="dry" className="py-12 text-center">
          <Database className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">{copy.empty}</p>
        </InkframeObjectSurface>
      ) : (
        <div className="space-y-4">
          {groups.knowledge.length > 0 && (
            <MemorySection title={copy.channelKnowledge} entries={groups.knowledge} />
          )}
          {groups.taskSummaries.length > 0 && (
            <MemorySection title={copy.taskOutputs} entries={groups.taskSummaries} />
          )}
          {groups.outputs.length > 0 && (
            <MemorySection title={copy.artifactsAndProofs} entries={groups.outputs} preview />
          )}
          {groups.promotions.length > 0 && (
            <MemorySection title={copy.promotions} entries={groups.promotions} />
          )}
          {groups.other.length > 0 && (
            <MemorySection title={copy.otherMemory} entries={groups.other} />
          )}
        </div>
      )}
    </div>
  )
}

export function MemoryProposalQueue({
  proposals,
  loading,
  onAccept,
  onReject,
  copy = defaultMemoryProposalCopy,
}: {
  proposals: MemoryProposal[]
  loading: boolean
  onAccept?: (proposal: MemoryProposal) => void
  onReject?: (proposal: MemoryProposal) => void
  copy?: MemoryProposalCopy
}) {
  if (loading && proposals.length === 0) {
    return (
      <InkframeObjectSurface material="drying" className="mb-4 p-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.reviewQueue}</h3>
        <p className="mt-2 text-xs text-muted-foreground">{copy.loading}</p>
      </InkframeObjectSurface>
    )
  }
  if (proposals.length === 0) return null
  return (
    <InkframeObjectSurface material="drying" raised className="mb-4 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.reviewQueue}</h3>
          <p className="text-xs text-muted-foreground">{copy.openProposals}</p>
        </div>
        <ReviewStamp tone="review" className="text-[0.65rem]">{proposals.length}</ReviewStamp>
      </div>
      <div className="space-y-2">
        {proposals.map((proposal) => (
          <MemoryFixedNote key={proposal.id} className="p-2">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Sparkles className="size-3.5 shrink-0 text-accent-mint" />
                  <span className="truncate text-sm font-medium">{proposal.path}</span>
                  <ReviewStamp tone="review" className="shrink-0 text-[0.65rem]">{proposal.status}</ReviewStamp>
                </div>
                {proposal.reason && <p className="mt-1 text-xs text-muted-foreground">{proposal.reason}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {onAccept && (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => onAccept(proposal)}
                    className="sk-cat-success hover:opacity-85"
                    aria-label={copy.acceptAria(proposal.path)}
                  >
                    <CheckCircle2 className="size-3.5" />
                    {copy.accept}
                  </Button>
                )}
                {onReject && (
                  <Button
                    type="button"
                    size="xs"
                    variant="destructive"
                    onClick={() => onReject(proposal)}
                    aria-label={copy.rejectAria(proposal.path)}
                  >
                    <XCircle className="size-3.5" />
                    {copy.reject}
                  </Button>
                )}
              </div>
            </div>
            {proposal.proposedContentText && (
              <AttachmentSheet kind="proof" className="mt-2 p-2">
                <pre className="max-h-32 overflow-auto text-xs whitespace-pre-wrap text-muted-foreground">
                  {proposal.proposedContentText}
                </pre>
              </AttachmentSheet>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem] text-muted-foreground">
              {proposal.baseSha256 && <span className="font-mono">{copy.base} {proposal.baseSha256.slice(0, 8)}</span>}
              <span>{formatTime(proposal.updatedAt || proposal.createdAt)}</span>
            </div>
          </MemoryFixedNote>
        ))}
      </div>
    </InkframeObjectSurface>
  )
}

function MemorySection({ title, entries, preview = false }: { title: string; entries: MemoryEntry[]; preview?: boolean }) {
  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
        <span className="text-[0.65rem] text-muted-foreground">{entries.length}</span>
      </div>
      <div className="space-y-2">
        {entries.map((entry) => (
          <MemoryEntryRow key={entry.id} entry={entry} compact={false} showPreview={preview} />
        ))}
      </div>
    </section>
  )
}
