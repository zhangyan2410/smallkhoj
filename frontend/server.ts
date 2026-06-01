/**
 * Custom Next.js server with integrated WebSocket support
 * Runs both HTTP (Next.js) and WS on the same port + 1
 */

import { createServer } from "http"
import { parse } from "url"
import next from "next"
import { WebSocketServer, WebSocket } from "ws"
import { validateAuth } from "./lib/daemon-auth"
import { store, Event } from "./lib/daemon-store"

const dev = process.env.NODE_ENV !== "production"
const hostname = "localhost"
const port = parseInt(process.env.PORT || "3000", 10)

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

interface WSClient {
  ws: WebSocket
  agentId: string
  cursor: number
}

const clients = new Map<WebSocket, WSClient>()

// Subscribe to store events and broadcast to WS clients
store.subscribe((event: Event) => {
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
})

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error("Error handling request:", err)
      res.statusCode = 500
      res.end("Internal Server Error")
    }
  })

  // Attach WebSocket server to the same HTTP server
  const wss = new WebSocketServer({ server })

  wss.on("connection", (ws: WebSocket, req) => {
    // Auth via query params
    const parsedUrl = parse(req.url || "/", true)
    const token = `Bearer ${parsedUrl.query.token || ""}`
    const agentId = (parsedUrl.query.agentId as string) || ""

    const auth = validateAuth(token, agentId)
    if (!auth.ok) {
      ws.send(JSON.stringify({ ok: false, code: auth.code, message: auth.error }))
      ws.close(1008, "Auth failed")
      return
    }

    const maxSeq = store.events.length > 0 ? store.events[store.events.length - 1].seq : 0
    const client: WSClient = { ws, agentId: auth.agentId!, cursor: maxSeq }
    clients.set(ws, client)

    console.log(`[WS] Client connected: ${auth.agentId}, cursor=${maxSeq}`)

    ws.send(JSON.stringify({
      type: "connected",
      payload: { agentId: auth.agentId, clients: clients.size },
      timestamp: new Date().toISOString(),
    }))

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
      clients.delete(ws)
      console.log(`[WS] Client disconnected: ${auth.agentId}, remaining=${clients.size}`)
    })

    ws.on("error", (err) => {
      console.error(`[WS] Error for ${auth.agentId}:`, (err as Error).message)
    })
  })

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket on ws://${hostname}:${port}`)
  })
})
