/**
 * Standalone WebSocket server for daemon real-time events
 * Runs alongside Next.js on a separate port
 */

import { WebSocketServer, WebSocket } from "ws"
import { validateAuth } from "./lib/daemon-auth"
import { store, Event } from "./lib/daemon-store"

interface WSClient {
  ws: WebSocket
  agentId: string
  cursor: number
  heartbeatTimer?: NodeJS.Timeout
}

const clients = new Map<WebSocket, WSClient>()
const PORT = parseInt(process.env.WS_PORT || "3001", 10)

function broadcastEvent(event: Event) {
  for (const client of clients.values()) {
    if (event.seq > client.cursor) {
      try {
        client.ws.send(JSON.stringify(event))
        client.cursor = event.seq
      } catch {
        // Client disconnected
      }
    }
  }
}

// Subscribe to store events
store.subscribe((event) => {
  broadcastEvent(event)
})

const wss = new WebSocketServer({ port: PORT })

wss.on("connection", (ws: WebSocket, req) => {
  // Auth via query params: ?token=sk_test_aaa&agentId=aaa
  const url = new URL(req.url || "/", `http://${req.headers.host}`)
  const token = `Bearer ${url.searchParams.get("token") || ""}`
  const agentId = url.searchParams.get("agentId") || ""

  const auth = validateAuth(token, agentId)
  if (!auth.ok) {
    ws.send(JSON.stringify({ ok: false, code: auth.code, message: auth.error }))
    ws.close(1008, "Auth failed")
    return
  }

  // Initialize cursor to current max seq
  const maxSeq = store.events.length > 0 ? store.events[store.events.length - 1].seq : 0
  const client: WSClient = { ws, agentId: auth.agentId!, cursor: maxSeq }
  clients.set(ws, client)

  console.log(`[WS] Client connected: ${auth.agentId}, cursor=${maxSeq}`)

  // Send connected ack
  ws.send(JSON.stringify({
    type: "connected",
    payload: { agentId: auth.agentId, clients: clients.size },
    timestamp: new Date().toISOString(),
  }))

  // Heartbeat
  client.heartbeatTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    }
  }, 30000)

  ws.on("pong", () => {
    // Client is alive
  })

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString())
      if (msg.type === "ack" && msg.seq) {
        client.cursor = Math.max(client.cursor, msg.seq)
      }
    } catch {
      // Ignore invalid messages
    }
  })

  ws.on("close", () => {
    if (client.heartbeatTimer) clearInterval(client.heartbeatTimer)
    clients.delete(ws)
    console.log(`[WS] Client disconnected: ${auth.agentId}, remaining=${clients.size}`)
  })

  ws.on("error", (err) => {
    console.error(`[WS] Error for ${auth.agentId}:`, err.message)
  })
})

console.log(`[WS] WebSocket server running on ws://localhost:${PORT}`)
console.log(`[WS] Connect with: ws://localhost:${PORT}?token=sk_test_aaa&agentId=aaa`)
