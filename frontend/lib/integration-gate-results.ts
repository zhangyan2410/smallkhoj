import { readFileSync, statSync } from "node:fs"
import path from "node:path"

export const INTEGRATION_GATE_MODES = [
  "foundation-only",
  "chat-reply-channel-base",
  "chat-reply-channel-group",
  "chat-reply-dm",
  "collab-channel-v1",
  "collab-channel-v2",
  "collab-channel-v3",
] as const

export type IntegrationGateMode = (typeof INTEGRATION_GATE_MODES)[number]
export type IntegrationGateState = "missing" | "invalid" | "stale" | "running" | "passed" | "failed"
export type IntegrationGateOutcome = "running" | "passed" | "failed"

export type IntegrationGateStep = {
  id: string
  label: string
  status: "running" | "passed" | "failed" | "warning" | "unknown"
  evidence?: string
  failure?: {
    category?: string
    code?: string
    message?: string
  }
}

export type IntegrationGateResult = {
  mode: IntegrationGateMode
  state: IntegrationGateState
  outcome?: IntegrationGateOutcome
  reason?: "RESULT_NOT_FOUND" | "RESULT_UNREADABLE" | "REPORT_TOO_LARGE" | "REPORT_INVALID"
  runId?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  ageMs?: number
  summary?: {
    passed: number
    total: number
    failed: number
    warning: number
  }
  target?: {
    serverId: string
  }
  failure?: {
    category?: string
    code?: string
    step?: string
    message?: string
  }
  steps: IntegrationGateStep[]
}

type ReadOptions = {
  root?: string
  cwd?: string
  env?: Record<string, string | undefined>
  now?: Date
  staleAfterMs?: number
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 1_000_000
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1_000
const MAX_STEPS = 48
const MAX_VISIBLE_TEXT = 320
const SECRET_KEY = /(?:authorization|cookie|password|secret|(?:^|_)(?:account|session|public|api|machine|connect|agent|proxy|auth)?token$)/i

export function resolveIntegrationGateResultRoot({
  cwd = process.cwd(),
  env = process.env,
}: Pick<ReadOptions, "cwd" | "env"> = {}) {
  const configured = env.SMALLKHOJ_GATE_RESULT_DIR
  if (configured) return path.resolve(configured)
  const repositoryRoot = path.basename(cwd) === "frontend" ? path.dirname(cwd) : cwd
  return path.resolve(repositoryRoot, ".runtime/integration-gate")
}

export function readIntegrationGateResults(options: ReadOptions = {}): IntegrationGateResult[] {
  return INTEGRATION_GATE_MODES.map((mode) => readIntegrationGateResult(mode, options))
}

export function readIntegrationGateResult(
  mode: IntegrationGateMode,
  options: ReadOptions = {},
): IntegrationGateResult {
  if (!INTEGRATION_GATE_MODES.includes(mode)) {
    throw new Error(`Unsupported integration gate mode: ${String(mode)}`)
  }

  const root = options.root
    ? path.resolve(options.root)
    : resolveIntegrationGateResultRoot({ cwd: options.cwd, env: options.env })
  const reportPath = path.join(root, "latest", `${mode}.json`)
  const empty = (state: IntegrationGateState, reason: IntegrationGateResult["reason"]): IntegrationGateResult => ({
    mode,
    state,
    reason,
    steps: [],
  })

  let size: number
  try {
    size = statSync(reportPath).size
  } catch (error) {
    if (isMissingFile(error)) return empty("missing", "RESULT_NOT_FOUND")
    return empty("invalid", "RESULT_UNREADABLE")
  }

  if (size > (options.maxBytes ?? DEFAULT_MAX_BYTES)) {
    return empty("invalid", "REPORT_TOO_LARGE")
  }

  let value: unknown
  try {
    value = JSON.parse(readFileSync(reportPath, "utf8"))
  } catch {
    return empty("invalid", "REPORT_INVALID")
  }

  const report = asRecord(value)
  if (!report || report.schemaVersion !== 1 || report.mode !== mode) {
    return empty("invalid", "REPORT_INVALID")
  }

  const runId = safeText(report.runId, 160)
  const summary = normalizeSummary(report.summary)
  if (!runId || !summary || !Array.isArray(report.steps)) {
    return empty("invalid", "REPORT_INVALID")
  }

  const startedAt = isoDate(report.startedAt)
  const completedAt = isoDate(report.completedAt)
  const outcome = normalizeOutcome(report)
  const nowMs = (options.now ?? new Date()).getTime()
  const completedMs = completedAt ? Date.parse(completedAt) : Number.NaN
  const ageMs = Number.isFinite(completedMs) ? Math.max(0, nowMs - completedMs) : undefined
  const stale = outcome !== "running"
    && ageMs !== undefined
    && ageMs > (options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS)
  const steps = report.steps.slice(0, MAX_STEPS).map(normalizeStep).filter((step): step is IntegrationGateStep => Boolean(step))
  const target = asRecord(report.target)
  const serverId = safeText(target?.serverId, 160)
  const topFailure = normalizeFailure(report.failure)
  const failedStep = steps.find((step) => step.status === "failed")
  const failure = topFailure || failedStep?.failure
    ? {
        ...(topFailure ?? failedStep?.failure),
        step: failedStep?.id,
      }
    : undefined

  return {
    mode,
    state: stale ? "stale" : outcome,
    outcome,
    runId,
    startedAt,
    completedAt,
    durationMs: durationMs(startedAt, completedAt),
    ageMs,
    summary,
    target: serverId ? { serverId } : undefined,
    failure,
    steps,
  }
}

function normalizeOutcome(report: Record<string, unknown>): IntegrationGateOutcome {
  const status = safeText(report.status, 40)?.toLowerCase()
  if (status === "running" || status === "pending" || (!report.completedAt && report.ok !== false)) return "running"
  return report.ok === true || status === "passed" || status === "warning" ? "passed" : "failed"
}

function normalizeSummary(value: unknown): IntegrationGateResult["summary"] | null {
  const summary = asRecord(value)
  const passed = nonNegativeInteger(summary?.passed)
  const total = nonNegativeInteger(summary?.total)
  if (passed === null || total === null || passed > total) return null
  return {
    passed,
    total,
    failed: nonNegativeInteger(summary?.failed) ?? Math.max(0, total - passed),
    warning: nonNegativeInteger(summary?.warning) ?? 0,
  }
}

function normalizeStep(value: unknown): IntegrationGateStep | null {
  const step = asRecord(value)
  const id = safeText(step?.id, 120)
  const label = safeText(step?.label, 180)
  if (!step || !id || !label) return null
  const rawStatus = safeText(step.status, 40)?.toLowerCase()
  const status = rawStatus === "pass" || rawStatus === "passed"
    ? "passed"
    : rawStatus === "fail" || rawStatus === "failed"
      ? "failed"
      : rawStatus === "running" || rawStatus === "pending"
        ? "running"
        : rawStatus === "warning" || rawStatus === "warn"
          ? "warning"
          : "unknown"

  return {
    id,
    label,
    status,
    evidence: visibleEvidence(step.evidence),
    failure: normalizeFailure(step.failure),
  }
}

function normalizeFailure(value: unknown): IntegrationGateStep["failure"] | undefined {
  const failure = asRecord(value)
  if (!failure) return undefined
  const normalized = {
    category: safeText(failure.category, 100),
    code: safeText(failure.code, 140),
    message: safeText(failure.message, MAX_VISIBLE_TEXT),
  }
  return Object.values(normalized).some(Boolean) ? normalized : undefined
}

function visibleEvidence(value: unknown) {
  if (value === undefined) return undefined
  try {
    return safeText(JSON.stringify(redact(value, 0)), MAX_VISIBLE_TEXT)
  } catch {
    return undefined
  }
}

function redact(value: unknown, depth: number, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]"
  if (depth > 5) return "[TRUNCATED]"
  if (typeof value === "string") return redactString(value)
  if (value === null || typeof value === "number" || typeof value === "boolean") return value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1))
  const record = asRecord(value)
  if (!record) return String(value ?? "")
  return Object.fromEntries(
    Object.entries(record).slice(0, 30).map(([childKey, childValue]) => [
      childKey,
      redact(childValue, depth + 1, childKey),
    ]),
  )
}

function redactString(value: string) {
  return value
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\bsk_(?:public|account|machine|connect|agent)_[A-Za-z0-9._-]+\b/g, "[REDACTED]")
    .replace(/(?:[A-Za-z]:)?[^\s"']*agent-proxy-tokens[^\s"']*/gi, "[REDACTED_PATH]")
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined
  const normalized = redactString(value).replace(/[\u0000-\u001f\u007f]/g, " ").trim()
  if (!normalized) return undefined
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}…`
}

function isoDate(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined
  return value
}

function durationMs(startedAt?: string, completedAt?: string) {
  if (!startedAt || !completedAt) return undefined
  const duration = Date.parse(completedAt) - Date.parse(startedAt)
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isMissingFile(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
