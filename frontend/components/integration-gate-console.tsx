import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  PlayCircle,
  XCircle,
} from "lucide-react"
import { getLocale, getTranslations } from "next-intl/server"

import { EmptyState, ProductRow, RuntimeChip, StatusPill } from "@/components/product-ui"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Panel } from "@/components/ui/panel"
import type { IntegrationGateResult, IntegrationGateState } from "@/lib/integration-gate-results"
import { cn } from "@/lib/utils"

type Translate = (key: string, values?: Record<string, string | number>) => string

export async function IntegrationGateConsole({ results }: { results: IntegrationGateResult[] }) {
  const translator = await getTranslations("integrationGate")
  const locale = await getLocale()
  const t: Translate = (key, values) => translator(key as never, values as never)
  const modeLabels: Record<IntegrationGateResult["mode"], string> = {
    "foundation-only": t("modes.foundation"),
    "chat-reply-channel-base": t("modes.channelBase"),
    "chat-reply-channel-group": t("modes.channelGroup"),
    "chat-reply-dm": t("modes.dm"),
    "collab-channel-v1": t("modes.collabV1"),
    "collab-channel-v2": t("modes.collabV2"),
    "collab-channel-v3": t("modes.collabV3"),
  }
  const stateLabels: Record<IntegrationGateState, string> = {
    missing: t("states.missing"),
    invalid: t("states.invalid"),
    stale: t("states.stale"),
    running: t("states.running"),
    passed: t("states.passed"),
    failed: t("states.failed"),
  }
  const passed = results.filter((result) => result.state === "passed").length
  const failed = results.filter((result) => result.state === "failed").length
  const needsAttention = results.filter((result) => ["failed", "invalid", "stale"].includes(result.state)).length

  return (
    <div className="space-y-5">
      <section data-region="integration-gate-summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryMetric label={t("summary.passed")} value={`${passed} / ${results.length}`} detail={t("summary.passedDetail")} state="passed" />
        <SummaryMetric label={t("summary.failed")} value={`${failed}`} detail={t("summary.failedDetail")} state={failed ? "failed" : "passed"} />
        <SummaryMetric label={t("summary.attention")} value={`${needsAttention}`} detail={t("summary.attentionDetail")} state={needsAttention ? "stale" : "passed"} />
        <SummaryMetric label={t("summary.store")} value={t("summary.hostLocal")} detail={t("summary.storeDetail")} state="running" />
      </section>

      <Card data-region="integration-gate-modes">
        <CardHeader className="border-b">
          <CardTitle>{t("listTitle")}</CardTitle>
          <CardDescription>
            {t("listDescription")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {results.map((result) => (
            <GateModeRow
              key={result.mode}
              result={result}
              modeLabel={modeLabels[result.mode]}
              stateLabel={stateLabels[result.state]}
              t={t}
              locale={locale}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function GateModeRow({
  result,
  modeLabel,
  stateLabel,
  t,
  locale,
}: {
  result: IntegrationGateResult
  modeLabel: string
  stateLabel: string
  t: Translate
  locale: string
}) {
  const summary = result.summary
  const failure = result.failure
  return (
    <ProductRow className="md:grid-cols-[minmax(14rem,0.9fr)_minmax(0,1.6fr)_auto] md:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <GateStateIcon state={result.state} label={stateLabel} />
          <span className="font-semibold">{modeLabel}</span>
          <StatusPill status={statusPillState(result.state)} label={stateLabel} />
        </div>
        <code className="mt-1 block truncate text-xs text-muted-foreground">{result.mode}</code>
      </div>

      <div className="min-w-0 space-y-2 text-sm">
        {summary ? (
          <div className="flex flex-wrap gap-2">
            <RuntimeChip tone={result.outcome === "failed" ? "danger" : "success"}>
              {t("stepsPassed", { passed: summary.passed, total: summary.total })}
            </RuntimeChip>
            {summary.warning > 0 && <RuntimeChip tone="warning">{t("warningCount", { count: summary.warning })}</RuntimeChip>}
            {result.target?.serverId && <RuntimeChip tone="paper">{t("serverTarget", { serverId: result.target.serverId })}</RuntimeChip>}
          </div>
        ) : (
          <EmptyState
            title={result.state === "missing" ? t("empty.missingTitle") : t("empty.invalidTitle")}
            description={resultReason(result, t)}
            className="py-2"
          />
        )}

        {failure && (
          <Panel className="sk-cat-danger px-3 py-2 text-xs">
            <div className="font-semibold">
              {[failure.category, failure.code, failure.step].filter(Boolean).join(" · ")}
            </div>
            {failure.message && <p className="mt-1 text-muted-foreground">{failure.message}</p>}
          </Panel>
        )}

        {result.steps.length > 0 && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">{t("viewEvidence")}</summary>
            <div className="mt-2 space-y-1.5">
              {result.steps.map((step) => (
                <div key={step.id} className="border-l-2 border-[var(--ink)] pl-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusPill status={statusPillState(step.status)} label={stepStatusLabel(step.status, t)} />
                    <span className="font-medium text-foreground">{step.label}</span>
                  </div>
                  {step.evidence && <code className="mt-1 block break-words">{step.evidence}</code>}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      <div className="text-xs text-muted-foreground md:text-right">
        <div>{result.completedAt ? formatTimestamp(result.completedAt, locale) : result.startedAt ? t("startedAt", { time: formatTimestamp(result.startedAt, locale) }) : t("noTimestamp")}</div>
        <div className="mt-1">{result.durationMs !== undefined ? t("duration", { duration: formatDuration(result.durationMs) }) : t("durationMissing")}</div>
        {result.runId && <code className="mt-1 block max-w-48 truncate">{result.runId}</code>}
      </div>
    </ProductRow>
  )
}

function SummaryMetric({
  label,
  value,
  detail,
  state,
}: {
  label: string
  value: string
  detail: string
  state: IntegrationGateState
}) {
  return (
    <Panel variant="raised" className={cn("p-4", stateSurface(state))}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold">{value}</div>
        </div>
        <GateStateIcon state={state} label={label} className="size-5" />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">{detail}</div>
    </Panel>
  )
}

function GateStateIcon({ state, label, className = "size-4" }: { state: IntegrationGateState; label: string; className?: string }) {
  if (state === "passed") return <CheckCircle2 aria-label={label} className={cn(className, "text-success")} />
  if (state === "failed" || state === "invalid") return <XCircle aria-label={label} className={cn(className, "text-destructive")} />
  if (state === "stale") return <AlertTriangle aria-label={label} className={cn(className, "text-warning")} />
  if (state === "running") return <PlayCircle aria-label={label} className={cn(className, "text-info")} />
  return <CircleDashed aria-label={label} className={cn(className, "text-muted-foreground")} />
}

function statusPillState(state: string) {
  if (state === "passed") return "done"
  if (state === "failed" || state === "invalid") return "failed"
  if (state === "stale" || state === "warning") return "warning"
  if (state === "running") return "running"
  return "idle"
}

function stateSurface(state: IntegrationGateState) {
  if (state === "passed") return "sk-cat-success"
  if (state === "failed" || state === "invalid") return "sk-cat-danger"
  if (state === "stale") return "sk-cat-warning"
  if (state === "running") return "sk-cat-info"
  return "sk-cat-neutral"
}

function stepStatusLabel(status: string, t: Translate) {
  if (status === "passed") return t("stepStates.passed")
  if (status === "failed") return t("stepStates.failed")
  if (status === "warning") return t("stepStates.warning")
  if (status === "running") return t("stepStates.running")
  return t("stepStates.unknown")
}

function resultReason(result: IntegrationGateResult, t: Translate) {
  if (result.reason === "REPORT_TOO_LARGE") return t("empty.tooLarge")
  if (result.reason === "REPORT_INVALID") return t("empty.malformed")
  if (result.reason === "RESULT_UNREADABLE") return t("empty.unreadable")
  return t("empty.notRun")
}

function formatTimestamp(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value))
}

function formatDuration(value: number) {
  const seconds = Math.round(value / 1_000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}
