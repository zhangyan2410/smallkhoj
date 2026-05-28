# aaa-daemon v0.2.0

Minimal Slock Agent Daemon — architecture based on [opencan-daemon](https://github.com/botiverse/opencan/tree/master/opencan-daemon).

## Architecture

```
cmd/main.ts              CLI entry (commander): start / attach / status / stop / version
    |
daemon/
├── daemon.ts            DaemonCore — orchestrator, PID file, signal handling, log buffer
├── client-handler.ts    Per-connection JSON-RPC 2.0 handler, method routing
└── session-manager.ts   Session tracking (create / list / filter / remove)

proxy/
├── agent-proxy.ts       HTTP proxy — token injection, path rewrite, freshness check
├── state.ts             State machine (Starting→Idle→Prompting→Draining→Completed→Dead)
└── event-buffer.ts      Ring buffer for notifications (100k capacity, clone-on-evict)

protocol/
├── jsonrpc.ts           JSON-RPC 2.0 types, parse/serialize, builders, error codes
└── methods.ts           Centralized method constants (daemon + ACP methods)

attach/
└── attach.ts            Client bridge: stdin/stdout ↔ daemon proxy, auto-start

websocket.ts             WebSocket manager — connect, reconnect, message dispatch
mcp-bridge.ts            MCP stdio bridge for Claude Code integration
types.ts                 Shared types: Credential, Config, Message, Task, Session
```

## Design Patterns (from opencan-daemon)

| Pattern | opencan (Go) | aaa-daemon (TypeScript) |
|---------|-------------|------------------------|
| State machine | 7 states with guarded transitions | Same, `StateMachine` class |
| Event buffer | Ring buffer with clone-on-evict | `EventBuffer` with capacity + eviction |
| Per-connection handler | `ClientHandler` per goroutine | `ClientHandler` with async routing |
| JSON-RPC framing | `\n`-delimited, no Content-Length | Same |
| ID rewriting | `map[internalID]→(originalID, proxy)` | Promise-based pending request tracking |
| Daemonization | `go-daemon` Reborn() | `child_process.spawn` with `--foreground` |
| PID locking | `lockfile` package | Simple PID file read/write |
| Log ring buffer | 2000 entries, BufferingHandler | Array with size cap, `log()` method |

## Quick Start

```bash
npm install
npm run build

# Start daemon in background
npm run daemon

# Or foreground (with MCP bridge for Claude Code)
npm start -- --mcp

# Check status
npm run status

# Attach client
npm run attach

# Stop
npm run stop
```

## Commands

| Command | Description |
|---------|-------------|
| `start` | Start the daemon (daemonizes by default, use `--foreground` to stay in front) |
| `attach` | Bridge stdin/stdout to running daemon |
| `status` | Check if daemon is running |
| `stop` | Stop the daemon via SIGTERM |
| `version` | Print version |

## Protocol

The daemon exposes a JSON-RPC 2.0 API over the HTTP proxy:

- `daemon/hello` — Health check
- `daemon/message.send` — Send message to channel/DM
- `daemon/message.check` — Poll for new messages
- `daemon/message.read` — Read message history
- `daemon/server.info` — Get server/channel info
- `daemon/session.list` — List conversations
- `daemon/conversation.create` — Create new session
- `daemon/logs` — Retrieve log buffer
- ... and more (tasks, channels, reminders)

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SLOCK_AGENT_ID` | Agent ID | — |
| `SLOCK_SERVER_ID` | Server ID | — |
| `SLOCK_SERVER_URL` | Slock server URL | `https://api.slock.ai` |
| `SLOCK_AGENT_TOKEN` | Agent API token | — |
| `AAA_DAEMON_MCP` | Enable MCP bridge (`1`) | — |
