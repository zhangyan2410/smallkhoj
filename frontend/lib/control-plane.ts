export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
export const PUBLIC_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "sk_public_local"
export const SESSION_COOKIE_NAME = "smallkhoj_session"

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
  name: string
  displayName?: string
  handle?: string
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
  sessionToken?: string
}

function browserSessionToken() {
  if (typeof document === "undefined") return null
  const match = document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${SESSION_COOKIE_NAME}=`))
  return match ? decodeURIComponent(match.split("=").slice(1).join("=")) : null
}

export function apiHeaders(sessionToken?: string | null, contentType?: boolean) {
  const token = sessionToken ?? browserSessionToken()
  const headers: Record<string, string> = { "X-Public-Key": PUBLIC_KEY }
  if (contentType) headers["Content-Type"] = "application/json"
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

export async function apiGet<T>(path: string, fallback: T, sessionToken?: string | null): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      cache: "no-store",
      headers: apiHeaders(sessionToken),
    })
    if (!response.ok) return fallback
    return response.json()
  } catch {
    return fallback
  }
}

export async function apiPost<T>(path: string, body: Record<string, unknown>, sessionToken?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: apiHeaders(sessionToken, true),
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error((error as { detail?: string }).detail || `HTTP ${response.status}`)
  }
  return response.json()
}

export async function apiDelete<T>(path: string, sessionToken?: string | null): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: apiHeaders(sessionToken),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error((error as { detail?: string }).detail || `HTTP ${response.status}`)
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
      return "bg-emerald-500"
    case "idle":
    case "pending":
    case "pending_start":
    case "starting":
    case "in_review":
    case "busy":
    case "stopping":
    case "restarting":
      return "bg-amber-500"
    case "in_progress":
      return "bg-sky-500"
    case "failed":
    case "cancelled":
    case "offline":
    case "stopped":
      return "bg-rose-500"
    default:
      return "bg-muted-foreground"
  }
}

export function badgeClass(status: string) {
  switch (status) {
    case "online":
    case "active":
    case "running":
    case "done":
    case "fired":
      return "border-emerald-200 bg-emerald-50 text-emerald-700"
    case "idle":
    case "pending":
    case "pending_start":
    case "starting":
    case "in_review":
    case "busy":
    case "stopping":
    case "restarting":
      return "border-amber-200 bg-amber-50 text-amber-700"
    case "in_progress":
      return "border-sky-200 bg-sky-50 text-sky-700"
    case "failed":
    case "cancelled":
    case "offline":
    case "stopped":
      return "border-rose-200 bg-rose-50 text-rose-700"
    default:
      return "border-border bg-muted text-muted-foreground"
  }
}

export function runtimeLabel(runtime: RuntimeInfo) {
  if (typeof runtime === "string") return runtime
  return [
    runtime.provider ?? runtime.runtimeProvider ?? runtime.type ?? "runtime",
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
