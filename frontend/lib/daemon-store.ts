export type ServerEvent = {
  type: string
  seq: number
  timestamp?: string
  payload?: Record<string, unknown>
}

type EventSubscriber = (event: ServerEvent) => void

class DaemonStoreCompat {
  events: ServerEvent[] = []
  private subscribers = new Set<EventSubscriber>()

  subscribe(subscriber: EventSubscriber) {
    this.subscribers.add(subscriber)
    return () => this.subscribers.delete(subscriber)
  }

  emit(event: Omit<ServerEvent, "seq"> & { seq?: number }) {
    const nextEvent = {
      ...event,
      seq: event.seq ?? this.nextSeq(),
      timestamp: event.timestamp ?? new Date().toISOString(),
    }
    this.events.push(nextEvent)
    for (const subscriber of this.subscribers) {
      subscriber(nextEvent)
    }
  }

  private nextSeq() {
    return this.events.length > 0 ? this.events[this.events.length - 1].seq + 1 : 1
  }
}

export const store = new DaemonStoreCompat()
