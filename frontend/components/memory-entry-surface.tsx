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

import {
  API_BASE,
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

function formatFileSize(bytes?: number) {
  const value = bytes || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function artifactUrl(href: string | null) {
  if (!href) return null
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("data:")) return href
  if (href.startsWith("/api/")) return `${API_BASE}${href}`
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
      <a href={src} target="_blank" rel="noreferrer" className="mt-2 block overflow-hidden rounded-md border bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={view.label} className={compact ? "max-h-28 w-full object-cover" : "max-h-48 w-full object-cover"} />
      </a>
    )
  }
  if (view.viewer === "video" && src) {
    return (
      <video className={compact ? "mt-2 max-h-28 w-full rounded-md border bg-black" : "mt-2 max-h-48 w-full rounded-md border bg-black"} controls src={src}>
        <a href={src}>Open video</a>
      </video>
    )
  }
  if (src) {
    return (
      <a href={src} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[0.7rem] text-primary hover:bg-muted">
        <ExternalLink className="size-3" />
        Open output
      </a>
    )
  }
  return null
}

export function MemoryEntryRow({ entry, compact = false, showPreview = true }: { entry: MemoryEntry; compact?: boolean; showPreview?: boolean }) {
  const view = artifactViewForEntry(entry)
  const text = entry.contentText?.trim()
  return (
    <div className="flex items-start gap-2 rounded-md border bg-background px-2.5 py-2">
      <MemoryEntryIcon entry={entry} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className={compact ? "truncate text-xs font-medium" : "truncate text-sm font-medium"}>{entry.title || entry.path}</span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">{entry.entryKind || view.viewer}</span>
        </div>
        <div className="mt-1 truncate font-mono text-[0.7rem] text-primary">{entry.path}</div>
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
    </div>
  )
}

export function TaskRecoveryCockpit({ entries, compact = false }: { entries: MemoryEntry[]; compact?: boolean }) {
  const model = buildTaskRecoveryModel(entries)
  const completeness = model.recoveryCompleteness
  const scoreLabel = `${completeness.score}/4 recovery signals`
  const primaryEntries = [model.brief, model.plan, model.progress, model.finalSummary].filter((entry): entry is MemoryEntry => Boolean(entry))
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Task Recovery</h3>
          <p className="text-xs text-muted-foreground">{scoreLabel}</p>
        </div>
        <div className="grid grid-cols-4 gap-1 text-[0.65rem] text-muted-foreground">
          {[
            ["Brief", completeness.hasBrief],
            ["Plan", completeness.hasPlan],
            ["Progress", completeness.hasProgress],
            ["Output", completeness.hasOutput],
          ].map(([label, active]) => (
            <span key={String(label)} className={active ? "rounded bg-primary/10 px-1.5 py-0.5 text-primary" : "rounded bg-muted px-1.5 py-0.5"}>
              {label}
            </span>
          ))}
        </div>
      </div>
      {entries.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">No server-owned task memory has been written yet.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {model.subtasks.length > 0 && (
            <div className="rounded-md bg-muted/50 p-2">
              <div className="mb-1 text-xs font-medium">Task breakdown</div>
              <div className="space-y-1">
                {model.subtasks.slice(0, compact ? 4 : 8).map((item) => (
                  <div key={`${item.sourcePath}:${item.text}`} className="flex items-start gap-2 text-xs">
                    {item.done ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />}
                    <span className={item.done ? "text-muted-foreground line-through" : ""}>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>
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
                Outputs and evidence
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
    </div>
  )
}

export function ChannelMemorySurface({ entries, loading, channelTitle }: { entries: MemoryEntry[]; loading: boolean; channelTitle: string }) {
  const groups = groupMemoryEntries(entries)
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Memory</h2>
          <p className="text-xs text-muted-foreground">{channelTitle}</p>
        </div>
        <span className="text-xs text-muted-foreground">{entries.length} entries</span>
      </div>
      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading memory...</p>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-dashed py-12 text-center">
          <Database className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">No channel memory has been written yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.knowledge.length > 0 && (
            <MemorySection title="Channel knowledge" entries={groups.knowledge} />
          )}
          {groups.taskSummaries.length > 0 && (
            <MemorySection title="Task outputs" entries={groups.taskSummaries} />
          )}
          {groups.outputs.length > 0 && (
            <MemorySection title="Artifacts and proofs" entries={groups.outputs} preview />
          )}
          {groups.promotions.length > 0 && (
            <MemorySection title="Promotions" entries={groups.promotions} />
          )}
          {groups.other.length > 0 && (
            <MemorySection title="Other memory" entries={groups.other} />
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
}: {
  proposals: MemoryProposal[]
  loading: boolean
  onAccept?: (proposal: MemoryProposal) => void
  onReject?: (proposal: MemoryProposal) => void
}) {
  if (loading && proposals.length === 0) {
    return (
      <section className="mb-4 rounded-md border bg-muted/30 p-3">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Review queue</h3>
        <p className="mt-2 text-xs text-muted-foreground">Loading memory proposals...</p>
      </section>
    )
  }
  if (proposals.length === 0) return null
  return (
    <section className="mb-4 rounded-md border bg-background p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Review queue</h3>
          <p className="text-xs text-muted-foreground">Open channel memory proposals</p>
        </div>
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[0.65rem] text-primary">{proposals.length}</span>
      </div>
      <div className="space-y-2">
        {proposals.map((proposal) => (
          <div key={proposal.id} className="rounded-md border bg-muted/20 p-2">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <Sparkles className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate text-sm font-medium">{proposal.path}</span>
                  <span className="shrink-0 rounded bg-background px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">{proposal.status}</span>
                </div>
                {proposal.reason && <p className="mt-1 text-xs text-muted-foreground">{proposal.reason}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {onAccept && (
                  <button
                    type="button"
                    onClick={() => onAccept(proposal)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[0.7rem] text-emerald-700 hover:bg-emerald-50"
                    aria-label={`Accept ${proposal.path}`}
                  >
                    <CheckCircle2 className="size-3.5" />
                    Accept
                  </button>
                )}
                {onReject && (
                  <button
                    type="button"
                    onClick={() => onReject(proposal)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border bg-background px-2 text-[0.7rem] text-destructive hover:bg-destructive/10"
                    aria-label={`Reject ${proposal.path}`}
                  >
                    <XCircle className="size-3.5" />
                    Reject
                  </button>
                )}
              </div>
            </div>
            {proposal.proposedContentText && (
              <pre className="mt-2 max-h-32 overflow-auto rounded bg-background p-2 text-xs whitespace-pre-wrap text-muted-foreground">
                {proposal.proposedContentText}
              </pre>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-[0.65rem] text-muted-foreground">
              {proposal.baseSha256 && <span className="font-mono">base {proposal.baseSha256.slice(0, 8)}</span>}
              <span>{formatTime(proposal.updatedAt || proposal.createdAt)}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
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
