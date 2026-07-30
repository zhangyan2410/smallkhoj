/**
 * Custom Next.js server with integrated WebSocket support
 * Runs both HTTP (Next.js) and WS on the same HTTP server (same port)
 */

import { createServer } from "http"
import { parse } from "url"
import next from "next"
import { WebSocketServer, WebSocket } from "ws"
import {
  AGENT_WEBSOCKET_PROTOCOL,
  parseWebSocketAuthProtocols,
  validateAuth,
} from "./lib/daemon-auth"
import { store, ServerEvent } from "./lib/daemon-store"

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
store.subscribe((event: ServerEvent) => {
  console.log(`[WS] Broadcasting event seq=${event.seq} type=${event.type} to ${clients.size} clients`)
  for (const client of clients.values()) {
    if (event.seq > client.cursor) {
      try {
        client.ws.send(JSON.stringify(event))
        client.cursor = event.seq
        console.log(`[WS] Sent to ${client.agentId}`)
      } catch (err) {
        console.error(`[WS] Send failed for ${client.agentId}:`, (err as Error).message)
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
    // Next.js dev mode lazily adds an upgrade listener after the first HTTP
    // request that conflicts with our WebSocket server. Remove it.
    for (const listener of server.listeners("upgrade")) {
      if (listener !== handleUpgrade) {
        server.removeListener("upgrade", listener as (...args: unknown[]) => void)
      }
    }
  })

  // Attach WebSocket server to the same HTTP server
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols(protocols) {
      return protocols.has(AGENT_WEBSOCKET_PROTOCOL)
        ? AGENT_WEBSOCKET_PROTOCOL
        : false
    },
  })

  function handleUpgrade(request: Parameters<typeof wss.handleUpgrade>[0], socket: Parameters<typeof wss.handleUpgrade>[1], head: Parameters<typeof wss.handleUpgrade>[2]) {
    const { pathname } = parse(request.url || "/", true)
    if (pathname === "/ws" || pathname === "/") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request)
      })
    }
  }

  server.on("upgrade", handleUpgrade)

  wss.on("connection", (ws: WebSocket, req) => {
    const protocolAuth = parseWebSocketAuthProtocols(req.headers["sec-websocket-protocol"])
    const authorization = Array.isArray(req.headers.authorization)
      ? req.headers.authorization[0]
      : req.headers.authorization
    const agentHeader = req.headers["x-agent-id"]
    const agentId = (Array.isArray(agentHeader) ? agentHeader[0] : agentHeader)
      || protocolAuth?.agentId
      || ""
    const token = authorization || protocolAuth?.authHeader || ""

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

    ws.on("close", (code, reason) => {
      clients.delete(ws)
      console.log(`[WS] Client disconnected: ${auth.agentId}, code=${code}, reason=${reason?.toString() || 'none'}, remaining=${clients.size}`)
    })

    ws.on("error", (err) => {
      console.error(`[WS] Error for ${auth.agentId}:`, (err as Error).message)
    })

    ws.on("ping", () => {
      console.log(`[WS] Ping from ${auth.agentId}`)
    })
  })

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
    console.log(`> WebSocket on ws://${hostname}:${port}`)
  })
})
