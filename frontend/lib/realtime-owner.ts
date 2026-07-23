import {
  applyHighWater,
  type HighWater,
  type HighWaterResult,
  type PublicEventEnvelope,
} from "./realtime-events"

export type RealtimeOwnerScope = {
  key: string
  headers: Record<string, string>
}

export type RealtimeDelivery = {
  event: PublicEventEnvelope
  decision: HighWaterResult
}

export type RealtimeTransportFactory = (options: {
  headers: Record<string, string>
  signal: AbortSignal
  onEvent: (event: PublicEventEnvelope) => void
}) => () => void

type Subscription = {
  callback: (delivery: RealtimeDelivery) => void
}

type ActiveTransport = {
  controller: AbortController
  stop: () => void
}

export class RealtimeTransportOwner {
  private readonly factory: RealtimeTransportFactory
  private readonly subscribers = new Set<Subscription>()
  private readonly highWater = new Map<string, HighWater>()
  private scope: RealtimeOwnerScope | null = null
  private transport: ActiveTransport | null = null
  private generation = 0

  constructor(factory: RealtimeTransportFactory) {
    this.factory = factory
  }

  setScope(scope: RealtimeOwnerScope | null) {
    if (this.scope?.key === scope?.key) return
    this.generation += 1
    this.stopTransport()
    this.highWater.clear()
    this.scope = scope
    this.ensureTransport()
  }

  subscribe(callback: (delivery: RealtimeDelivery) => void): () => void {
    const subscription = { callback }
    this.subscribers.add(subscription)
    this.ensureTransport()
    return () => {
      this.subscribers.delete(subscription)
      if (this.subscribers.size === 0) this.stopTransport()
    }
  }

  dispose() {
    this.generation += 1
    this.stopTransport()
    this.highWater.clear()
    this.scope = null
    this.subscribers.clear()
  }

  private ensureTransport() {
    if (this.transport || !this.scope || this.subscribers.size === 0) return
    const generation = this.generation
    const controller = new AbortController()
    const stop = this.factory({
      headers: this.scope.headers,
      signal: controller.signal,
      onEvent: (event) => {
        if (generation !== this.generation || controller.signal.aborted) return
        const decision = applyHighWater(this.highWater, event)
        if (decision.action === "drop") return
        for (const subscription of [...this.subscribers]) {
          subscription.callback({ event, decision })
        }
      },
    })
    this.transport = { controller, stop }
  }

  private stopTransport() {
    const transport = this.transport
    this.transport = null
    if (!transport) return
    transport.stop()
    transport.controller.abort()
  }
}

export type RealtimeProjection = "tasks" | "route" | "ignore"
export const TASK_DATA_INVALIDATED_EVENT = "smallkhoj:tasks-invalidated"

export function projectRealtimeEvent(
  event: PublicEventEnvelope,
  acceptedEventTypes: ReadonlySet<string>,
): RealtimeProjection {
  if (!acceptedEventTypes.has(event.type)) return "ignore"
  if (event.type.startsWith("task.")) return "tasks"
  return "route"
}
