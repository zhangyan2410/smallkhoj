import { NextRequest } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store, Event } from "@/lib/daemon-store"

/**
 * GET /internal/agent-api/stream
 * Server-Sent Events endpoint for real-time event push.
 * Alternative to WebSocket for environments where WS is unavailable.
 */
export async function GET(request: NextRequest) {
  const auth = validateAuth(
    request.headers.get("authorization"),
    request.headers.get("x-agent-id")
  )

  if (!auth.ok) {
    return new Response(
      JSON.stringify({ ok: false, code: auth.code || "UNAUTHORIZED", message: auth.error }),
      { status: auth.code === "FORBIDDEN" ? 403 : 401, headers: { "Content-Type": "application/json" } }
    )
  }

  const lastEventId = request.headers.get("last-event-id")
    ? parseInt(request.headers.get("last-event-id")!, 10)
    : undefined

  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      // Send SSE headers
      controller.enqueue(encoder.encode(":ok\n\n"))

      const agentId = auth.agentId!
      const cursor = lastEventId ?? (store.events.length > 0 ? store.events[store.events.length - 1].seq : 0)

      // Send any missed events immediately
      const { events } = store.getEvents(cursor)
      for (const event of events) {
        sendEvent(controller, event)
      }

      // Subscribe to new events
      unsubscribe = store.subscribe((event: Event) => {
        if (event.seq > cursor) {
          sendEvent(controller, event)
        }
      })

      // Send connected ack
      const connectedEvent = {
        id: `conn_${Date.now()}`,
        type: "connected" as const,
        payload: { agentId, clients: 1 },
        timestamp: new Date().toISOString(),
        seq: 0,
      }
      controller.enqueue(
        encoder.encode(`id: 0\nevent: connected\ndata: ${JSON.stringify(connectedEvent)}\n\n`)
      )
    },
    cancel() {
      if (unsubscribe) unsubscribe()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  })
}

function sendEvent(controller: ReadableStreamDefaultController, event: Event) {
  const encoder = new TextEncoder()
  const data = JSON.stringify(event)
  controller.enqueue(
    encoder.encode(`id: ${event.seq}\nevent: ${event.type}\ndata: ${data}\n\n`)
  )
}
