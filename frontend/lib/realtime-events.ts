import { API_BASE } from "./control-plane"

export type EventScope = {
  kind: "channel" | "dm" | "task" | "workspace" | "member" | "computer" | "server" | string
  id?: string
  name?: string
}

export type PublicEventEnvelope = {
  id: string
  type: string
  scope: EventScope
  seq: number
  epoch: string
  createdAt?: string | null
  payload: Record<string, unknown>
}

export type SSEMessage = {
  event?: string
  id?: string
  data: string
}

export type HighWater = {
  epoch: string
  seq: number
}

export type HighWaterResult = {
  action: "apply" | "drop" | "catch_up"
  reason: "first" | "next" | "duplicate" | "gap" | "epoch"
}

export function parseSSEText(text: string): SSEMessage[] {
  const frames: SSEMessage[] = []
  const normalized = text.replace(/\r\n/g, "\n")
  for (const rawFrame of normalized.split("\n\n")) {
    const lines = rawFrame.split("\n")
    let event: string | undefined
    let id: string | undefined
    const data: string[] = []
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue
      const separator = line.indexOf(":")
      const field = separator >= 0 ? line.slice(0, separator) : line
      const rawValue = separator >= 0 ? line.slice(separator + 1) : ""
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue
      if (field === "event") event = value
      if (field === "id") id = value
      if (field === "data") data.push(value)
    }
    if (data.length > 0) frames.push({ event, id, data: data.join("\n") })
  }
  return frames
}

export async function* readSSE(response: Response, signal?: AbortSignal): AsyncGenerator<SSEMessage> {
  if (!response.body) throw new Error("SSE response body is empty")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const boundary = buffer.lastIndexOf("\n\n")
      if (boundary < 0) continue
      const complete = buffer.slice(0, boundary + 2)
      buffer = buffer.slice(boundary + 2)
      for (const frame of parseSSEText(complete)) yield frame
    }
    buffer += decoder.decode()
    for (const frame of parseSSEText(buffer)) yield frame
  } finally {
    reader.releaseLock()
  }
}

export function scopeKey(scope: EventScope) {
  return `${scope.kind}:${scope.id ?? scope.name ?? "all"}`
}

export function applyHighWater(marks: Map<string, HighWater>, event: PublicEventEnvelope): HighWaterResult {
  const key = scopeKey(event.scope)
  const current = marks.get(key)
  if (!current) {
    marks.set(key, { epoch: event.epoch, seq: event.seq })
    return { action: "apply", reason: "first" }
  }
  if (current.epoch !== event.epoch) {
    marks.set(key, { epoch: event.epoch, seq: event.seq })
    return { action: "catch_up", reason: "epoch" }
  }
  if (event.seq <= current.seq) return { action: "drop", reason: "duplicate" }
  marks.set(key, { epoch: event.epoch, seq: event.seq })
  if (event.seq === current.seq + 1) return { action: "apply", reason: "next" }
  return { action: "catch_up", reason: "gap" }
}

export function shouldHandleRealtimeEvent(
  event: PublicEventEnvelope,
  current: { channelId?: string | null; channelName?: string | null },
) {
  // Defensive: some events (e.g. workspace broadcasts) may arrive without a
  // scope. Treat them as out-of-scope rather than throwing — callers refresh
  // sidebar lists when this returns false.
  if (!event.scope) return false
  if (event.scope.kind !== "channel" && event.scope.kind !== "dm") return true
  const normalizedName = current.channelName?.replace(/^#/, "")
  return Boolean(
    (current.channelId && event.scope.id === current.channelId)
    || (normalizedName && event.scope.name?.replace(/^#/, "") === normalizedName),
  )
}

export function mergeMessageById<T extends { id: string }>(messages: T[], message: T): T[] {
  if (messages.some((item) => item.id === message.id)) {
    return messages.map((item) => (item.id === message.id ? { ...item, ...message } : item))
  }
  return [...messages, message]
}

export type RealtimeConnectionStatus =
  | { state: "connecting"; attempt: number }
  | { state: "connected" }
  | { state: "disconnected"; reason?: string }
  | { state: "reconnecting"; attempt: number; delayMs: number; reason?: string }
  | { state: "error"; error: string }

export function connectRealtimeEvents({
  headers,
  signal,
  scope,
  onEvent,
  onStatus,
}: {
  headers: Record<string, string>
  signal: AbortSignal
  scope?: { kind?: string; id?: string }
  onEvent: (event: PublicEventEnvelope) => void
  onStatus?: (status: RealtimeConnectionStatus) => void
}) {
  let stopped = false
  const stop = () => { stopped = true }
  const url = new URL(`${API_BASE}/api/v1/events/stream`)
  if (scope?.kind) url.searchParams.set("scopeKind", scope.kind)
  if (scope?.id) url.searchParams.set("scopeId", scope.id)

  async function run() {
    let attempt = 0
    while (!stopped && !signal.aborted) {
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener("abort", abort, { once: true })
      try {
        onStatus?.({ state: "connecting", attempt })
        const response = await fetch(url, {
          headers,
          cache: "no-store",
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        attempt = 0
        onStatus?.({ state: "connected" })
        for await (const frame of readSSE(response, controller.signal)) {
          if (!frame.data) continue
          try {
            const parsed = JSON.parse(frame.data) as PublicEventEnvelope
            // Drop empty / non-envelope payloads (backend heartbeat, keepalive,
            // or malformed frame) before they reach shouldHandleRealtimeEvent.
            if (!parsed || typeof parsed !== "object" || !parsed.type || !parsed.scope) {
              continue
            }
            onEvent(parsed)
          } catch (error) {
            console.warn("[realtime] malformed event dropped", error)
          }
        }
        onStatus?.({ state: "disconnected" })
      } catch (error) {
        if (signal.aborted || stopped) break
        const message = error instanceof Error ? error.message : String(error)
        onStatus?.({ state: "error", error: message })
      } finally {
        signal.removeEventListener("abort", abort)
      }
      if (signal.aborted || stopped) break
      attempt += 1
      // Exponential backoff capped at 30s; reset to 0 on every successful connect
      // (see `attempt = 0` after the `response.ok` check above).
      const delayMs = Math.min(1000 * 2 ** Math.min(attempt, 5), 30000)
      onStatus?.({ state: "reconnecting", attempt, delayMs })
      await new Promise((resolve) => window.setTimeout(resolve, delayMs))
    }
  }

  void run()
  return stop
}
