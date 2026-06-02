# Daemon Store (Protocol MVP)

⚠️ **This is a protocol MVP, not the final data structure.**

## Purpose

In-memory store for rapid daemon protocol validation. All data is lost on server restart.

## Replaceability

The `DaemonStore` class defines the minimal interface needed by daemon API routes:
- `agents`, `channels`, `messages`, `events`, `tasks`
- `addMessage()`, `getEvents()`, `getHistory()`, `claimTask()`, `updateTaskStatus()`

When the backend data structure is finalized, replace this module with a database-backed implementation (SQLite/Postgres). The route handlers in `app/internal/agent-api/` should not need to change — they only call store methods.

## Event Shape (Tentative)

```ts
interface Event {
  id: string
  type: "message" | "task_claimed" | "task_updated" | "connected" | "disconnected"
  payload: Record<string, unknown>
  timestamp: string
  seq: number  // monotonic cursor for polling
}
```

This shape is shared between HTTP polling (`/events`) and future WebSocket push.

## Auth Tokens (Test Only)

Valid tokens are hardcoded in `lib/daemon-auth.ts` for MVP testing:
- `sk_test_aaa` → agent `aaa`
- `sk_test_deepseek` → agent `deepseek`
- `sk_test_codex` → agent `codex-mac`

Replace with proper token management before production use.
