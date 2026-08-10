import { resolveApiBase, resolvePublicApiBase, resolvePublicApiKey } from "./runtime-url"

export const PUBLIC_RUNTIME_ENV = {
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
  NEXT_PUBLIC_WS_BASE_URL: process.env.NEXT_PUBLIC_WS_BASE_URL,
  NEXT_PUBLIC_API_KEY: process.env.NEXT_PUBLIC_API_KEY,
  NEXT_PUBLIC_DEPLOYMENT_ENV: process.env.NEXT_PUBLIC_DEPLOYMENT_ENV,
  NODE_ENV: process.env.NODE_ENV,
}

const SERVER_RUNTIME_ENV = {
  ...PUBLIC_RUNTIME_ENV,
  INTERNAL_API_BASE_URL: process.env.INTERNAL_API_BASE_URL,
}

export const BROWSER_API_BASE = resolvePublicApiBase(PUBLIC_RUNTIME_ENV, "browser")
export const SERVER_API_BASE = resolveApiBase(SERVER_RUNTIME_ENV, "server")
export const API_BASE = typeof window === "undefined" ? SERVER_API_BASE : BROWSER_API_BASE
export const PUBLIC_KEY = resolvePublicApiKey(PUBLIC_RUNTIME_ENV)
export const SESSION_COOKIE_NAME = "smallkhoj_session"
export const ACTIVE_SERVER_COOKIE_NAME = "smallkhoj_active_server"

export type RuntimeInfo = string | {
  type?: string
  status?: string
  command?: string
  model?: string
  version?: string
  provider?: string
  runtimeProvider?: string
  source?: string
}

export type MemberProfile = {
  displayName?: string | null
  description?: string | null
  avatarUrl?: string | null
}

export type Member = {
  id: string
  memberId?: string
  name: string
  displayName?: string
  handle?: string
  reference?: string
  originServerName?: string | null
  kind: "human" | "agent" | string
  type?: string
  profile?: MemberProfile
  status: string
  description?: string | null
  avatarUrl?: string | null
  skills?: string[]
  config?: Record<string, unknown> & {
    permissions?: Record<string, boolean>
    actions?: Record<string, boolean>
    backend?: string
    runtimeProvider?: string
    provider?: string
  }
  computerId?: string | null
  workspaceId?: string | null
  backend?: string | null
  runtimeProvider?: string | null
  /** Agent workspace runtime status (pending_start/running/stopped/...).
   *  Surfaces "agent starting" state — member.status is only online/offline. */
  runtimeStatus?: string | null
  permissions?: Record<string, boolean>
  actions?: Record<string, boolean>
}

export type AccountSession = {
  account: {
    id: string
    name: string
    displayName?: string | null
  }
  server: {
    id: string
    name: string
  }
  member: Member
  memberships?: AccountServerMembership[]
  sessionToken?: string
}

export type AccountServerMembership = {
  server: {
    id: string
    name: string
  }
  member: {
    id: string
    displayName: string
    kind: string
  }
  role: "owner" | "admin" | "member" | string
  status: "active" | string
  isDefault: boolean
}

export type ServerInvite = {
  id: string
  serverId: string
  serverName: string
  role: "admin" | "member" | string
  invitedName?: string | null
  expiresAt?: string | null
  acceptedAt?: string | null
  joinUrl?: string
  alreadyMember?: boolean
}

export type ServerInviteResponse = {
  invite: ServerInvite
}

function browserCookieValue(name: string) {
  if (typeof document === "undefined") return null
  const match = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null
}

function browserSessionToken() {
  return browserCookieValue(SESSION_COOKIE_NAME)
}

export function browserActiveServerId() {
  return browserCookieValue(ACTIVE_SERVER_COOKIE_NAME)
}

export function apiHeaders(sessionToken?: string | null, contentType?: boolean, activeServerId?: string | null) {
  const token = sessionToken ?? browserSessionToken()
  const serverId = activeServerId ?? browserActiveServerId()
  const headers: Record<string, string> = { "X-Public-Key": PUBLIC_KEY }
  if (contentType) headers["Content-Type"] = "application/json"
  if (serverId) headers["X-Server-Id"] = serverId
  if (token) headers["X-Account-Token"] = token
  return headers
}

export type AgentWorkspace = {
  id: string
  workspaceId?: string
  computerId: string
  agentId: string
  agentName?: string | null
  agentHandle?: string | null
  agentStatus?: string | null
  backend?: string | null
  agent?: Partial<Member> | null
  runtime?: string | null
  runtimeCommand?: string | null
  runtimeModel?: string | null
  runtimeProvider?: string | null
  runtimeLastError?: string | null
  status: string
  sessionId?: string | null
  cwd?: string | null
  pid?: number | null
  startedAt?: string | null
  stoppedAt?: string | null
}

export type Computer = {
  id: string
  serverId?: string
  name: string
  machineId?: string | null
  os?: string | null
  daemonVersion?: string | null
  apiKeyPrefix?: string | null
  status: string
  activeDaemonId?: string | null
  daemonLeaseExpiresAt?: string | null
  detectedRuntimes: RuntimeInfo[]
  agentWorkspaces: AgentWorkspace[]
  createdAt?: string | null
  updatedAt?: string | null
  lastHeartbeatAt?: string | null
}

export type MemoryEntry = {
  id: string
  serverId?: string
  scopeType: "agent" | "channel" | "task" | "thread" | string
  scopeId: string
  path: string
  title?: string | null
  entryKind?: string | null
  contentText?: string | null
  blobKey?: string | null
  fileId?: string | null
  mimeType?: string | null
  sizeBytes?: number
  contentSha256?: string
  version?: number
  sourceMessageId?: string | null
  sourceChannelId?: string | null
  sourceThreadId?: string | null
  sourceTaskId?: string | null
  sourcePath?: string | null
  authorMemberId?: string | null
  visibility?: string | null
  metadata?: Record<string, unknown>
  createdAt?: string | null
  updatedAt?: string | null
  deletedAt?: string | null
}

export type MemoryProposal = {
  id: string
  serverId?: string
  scopeType: "agent" | "channel" | "task" | "thread" | string
  scopeId: string
  path: string
  baseEntryId?: string | null
  baseSha256?: string | null
  proposedContentText?: string | null
  authorMemberId?: string | null
  reason?: string | null
  status: "open" | "accepted" | "rejected" | "superseded" | string
  reviewerMemberId?: string | null
  reviewNote?: string | null
  metadata?: Record<string, unknown>
  createdAt?: string | null
  updatedAt?: string | null
  resolvedAt?: string | null
}

export type TaskRunTemplate = {
  id: string
  slug: string
  name: string
  description?: string | null
  category?: string | null
  systemInstruction: string
  toolPolicy?: Record<string, unknown>
  skillPolicy?: Record<string, unknown>
  memoryPolicy?: Record<string, unknown>
  outputPolicy?: Record<string, unknown>
  runtimePolicy?: Record<string, unknown>
  startPolicy?: Record<string, unknown>
  rolePresets?: Array<Record<string, unknown>>
  visibility: "builtin" | "server" | "user" | string
  status: "active" | "disabled" | string
  createdBy?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type TaskDeleteResult = {
  deleted: true
  taskId: string
  taskNumber: number
}

export type FileDeleteResult = {
  deleted: true
  fileId: string
  storageCleanup: "deleted" | "quarantined"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function isTaskDeleteResult(
  value: unknown,
  expectedTaskId: string,
): value is TaskDeleteResult {
  return expectedTaskId.length > 0
    && isRecord(value)
    && value.deleted === true
    && value.taskId === expectedTaskId
    && typeof value.taskNumber === "number"
    && Number.isInteger(value.taskNumber)
    && value.taskNumber > 0
}

export function isFileDeleteResult(
  value: unknown,
  expectedFileId: string,
): value is FileDeleteResult {
  return expectedFileId.length > 0
    && isRecord(value)
    && value.deleted === true
    && value.fileId === expectedFileId
    && (value.storageCleanup === "deleted" || value.storageCleanup === "quarantined")
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") return fallback
  const detail = (error as { detail?: unknown }).detail
  if (typeof detail === "string") return detail
  if (detail && typeof detail === "object") {
    const record = detail as { instruction?: unknown; code?: unknown }
    if (typeof record.instruction === "string") return record.instruction
    if (typeof record.code === "string") return record.code
  }
  return fallback
}

export type ApiRequestOptions = {
  timeoutMs?: number
  signal?: AbortSignal
}

type JsonRequestOptions = ApiRequestOptions & {
  method: "GET" | "DELETE"
  sessionToken?: string | null
  activeServerId?: string | null
  cache?: RequestCache
  timeoutLabel: string
}

async function apiRequestJson<T>(path: string, options: JsonRequestOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 15_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${options.timeoutLabel} timeout must be a positive finite number`)
  }

  const controller = new AbortController()
  let abortSource: "caller" | "timeout" | null = null
  const abortFromCaller = () => {
    if (abortSource) return
    abortSource = "caller"
    controller.abort(options.signal?.reason ?? new DOMException("Request aborted", "AbortError"))
  }

  if (options.signal?.aborted) {
    abortFromCaller()
  } else {
    options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  }

  const timeout = setTimeout(() => {
    if (abortSource) return
    abortSource = "timeout"
    controller.abort(new DOMException("Request timed out", "TimeoutError"))
  }, timeoutMs)

  const abortPromise = new Promise<never>((_resolve, reject) => {
    const rejectForAbort = () => {
      reject(controller.signal.reason ?? new DOMException("Request aborted", "AbortError"))
    }
    if (controller.signal.aborted) rejectForAbort()
    else controller.signal.addEventListener("abort", rejectForAbort, { once: true })
  })

  try {
    const response = await Promise.race([
      fetch(`${API_BASE}${path}`, {
        method: options.method,
        cache: options.cache,
        headers: apiHeaders(options.sessionToken, false, options.activeServerId),
        signal: controller.signal,
      }),
      abortPromise,
    ])
    if (!response.ok) {
      const error = await Promise.race([
        response.json().catch(() => ({})),
        abortPromise,
      ])
      throw new Error(apiErrorMessage(error, `HTTP ${response.status}`))
    }
    return await Promise.race([response.json(), abortPromise])
  } catch (error) {
    if (abortSource === "timeout") {
      throw new Error(`Request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }
}

export async function apiGet<T>(path: string, fallback: T, sessionToken?: string | null, activeServerId?: string | null): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      headers: apiHeaders(sessionToken, false, activeServerId),
    })
    if (!response.ok) return fallback
    return response.json()
  } catch {
    return fallback
  }
}

export async function apiGetCritical<T>(
  path: string,
  sessionToken?: string | null,
  activeServerId?: string | null,
  options: ApiRequestOptions = {},
): Promise<T> {
  return apiRequestJson<T>(path, {
    method: "GET",
    cache: "no-store",
    sessionToken,
    activeServerId,
    timeoutLabel: "Critical GET",
    ...options,
  })
}

export async function apiPost<T>(path: string, body: Record<string, unknown>, sessionToken?: string | null, activeServerId?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: apiHeaders(sessionToken, true, activeServerId),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(apiErrorMessage(error, `HTTP ${response.status}`))
  }
  return response.json()
}

export async function apiPut<T>(path: string, body: Record<string, unknown>, sessionToken?: string | null, activeServerId?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: apiHeaders(sessionToken, true, activeServerId),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(apiErrorMessage(error, `HTTP ${response.status}`))
  }
  return response.json()
}

export async function apiDelete<T>(
  path: string,
  sessionToken?: string | null,
  activeServerId?: string | null,
  options: ApiRequestOptions = {},
): Promise<T> {
  return apiRequestJson<T>(path, {
    method: "DELETE",
    sessionToken,
    activeServerId,
    timeoutLabel: "DELETE",
    ...options,
  })
}

export async function apiPatch<T>(path: string, body: Record<string, unknown>, sessionToken?: string | null, activeServerId?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: apiHeaders(sessionToken, true, activeServerId),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(apiErrorMessage(error, `HTTP ${response.status}`))
  }
  return response.json()
}

export function formatTime(value?: string | null) {
  if (!value) return "never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

/**
 * 找 member 在哪台 computer 上的 agent workspace（运行时实例）。
 * 收口 members/computers/activity 三处重复的 member→workspace join：
 *   computers.find(c => c.id === member.computerId)?.agentWorkspaces.find(w => w.agentId === member.id)
 * 单一真源，改 join 逻辑只改这里。
 */
export function findMemberWorkspace(member: { computerId?: string | null; id: string }, computers: Computer[]): AgentWorkspace | undefined {
  if (!member.computerId) return undefined
  const computer = computers.find((c) => c.id === member.computerId)
  return computer?.agentWorkspaces.find((w) => w.agentId === member.id)
}

/**
 * Activity 分类 → CategoryTone 单一真源。
 * 给 ActivityTypeBadge / RuntimeChip 用，替代散落的 labelColorMap 硬编码色。
 * 改分类配色只改这里 + globals.css 的 --cat-* token。
 */
export function activityCategoryKind(label: string): "info" | "success" | "warning" | "danger" | "neutral" {
  switch (label) {
    case "Message":
    case "Output":
    case "Thread":
      return "info"
    case "Task":
    case "Reminder":
    case "Working":
    case "Thinking":
    case "Warning":
      return "warning"
    case "Runtime":
    case "Heartbeat":
    case "Idle":
    case "Integration":
      return "success"
    case "Reaction":
    case "Channel":
    case "Profile":
      return "neutral"
    case "Error":
      return "danger"
    default:
      return "neutral"
  }
}

export function statusLabel(status: string) {
  const labels: Record<string, string> = {
    todo: "待办",
    in_progress: "进行中",
    in_review: "审核中",
    done: "完成",
    closed: "关闭",
    pending: "待触发",
    pending_start: "待启动",
    starting: "启动中",
    fired: "已触发",
    cancelled: "已取消",
    online: "在线",
    offline: "离线",
    active: "活跃",
    running: "运行中",
    idle: "空闲",
    busy: "忙碌",
    stopping: "停止中",
    restarting: "重启中",
    stopped: "已停止",
    failed: "失败",
    crashed: "崩溃",
  }
  return labels[status] ?? status
}

export function dotClass(status: string) {
  switch (status) {
    case "online":
    case "active":
    case "running":
    case "done":
    case "fired":
      return "bg-success"
    case "idle":
    case "pending":
    case "pending_start":
    case "starting":
    case "in_review":
    case "busy":
    case "stopping":
    case "restarting":
      return "bg-warning"
    case "in_progress":
      return "bg-info"
    case "failed":
    case "crashed":
    case "cancelled":
    case "offline":
    case "stopped":
      return "bg-danger"
    default:
      return "bg-muted-foreground"
  }
}

/** 状态语义分类 —— 单一真源，供 badgeClass/dotClass/StatusPill 复用。 */
export function statusKind(status: string): "success" | "warning" | "info" | "danger" | "neutral" {
  switch (status) {
    case "online":
    case "active":
    case "running":
    case "done":
    case "fired":
      return "success"
    case "idle":
    case "pending":
    case "pending_start":
    case "starting":
    case "in_review":
    case "busy":
    case "stopping":
    case "restarting":
      return "warning"
    case "in_progress":
      return "info"
    case "failed":
    case "crashed":
    case "cancelled":
    case "offline":
    case "stopped":
      return "danger"
    default:
      return "neutral"
  }
}

export function badgeClass(status: string) {
  const kind = statusKind(status)
  switch (kind) {
    case "success":
      return "sk-status-success"
    case "warning":
      return "sk-status-warning"
    case "info":
      return "sk-status-info"
    case "danger":
      return "sk-status-danger"
    default:
      return "bg-muted text-muted-foreground"
  }
}

export function runtimeLabel(runtime: RuntimeInfo) {
  const labels: Record<string, string> = {
    claude_code: "Claude Code",
    codex: "Codex",
    codex_cli: "Codex",
    codex_acp: "Codex",
    opencode: "OpenCode",
    pi: "Built-in Pi",
    custom: "Custom",
  }
  if (typeof runtime === "string") return labels[runtime] ?? runtime
  return [
    runtime.provider ?? runtime.runtimeProvider ?? (runtime.type ? labels[runtime.type] ?? runtime.type : undefined) ?? "runtime",
    runtime.status,
    runtime.model,
    runtime.version,
  ]
    .filter(Boolean)
    .join(" / ")
}

export type ChannelMessage = {
  id: string
  sender: string
  senderType: "human" | "agent"
  time?: string
  createdAt?: string
  seq?: number
  content: string
}

export type Channel = {
  id: string
  name: string
  rawName?: string
  description?: string | null
  type?: "public" | "private" | string
  joined?: boolean
  unreadCount?: number
}

export function shortId(value?: string | null) {
  return value ? value.slice(0, 8) : "unbound"
}
