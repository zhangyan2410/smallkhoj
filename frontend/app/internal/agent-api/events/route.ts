import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store, getAgentCursor, setAgentCursor } from "@/lib/daemon-store"

/**
 * GET /internal/agent-api/events?since=latest|<cursor>
 * Returns incremental events and next cursor.
 * "latest" uses per-agent consumed cursor to avoid replaying history.
 */
export async function GET(request: NextRequest) {
  const auth = validateAuth(
    request.headers.get("authorization"),
    request.headers.get("x-agent-id")
  )

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code || "UNAUTHORIZED", message: auth.error },
      { status: auth.code === "FORBIDDEN" ? 403 : 401 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const sinceParam = searchParams.get("since") || "0"
  const agentId = auth.agentId!

  let since = 0
  if (sinceParam === "latest") {
    const cursor = getAgentCursor(agentId)
    if (cursor === undefined) {
      // First time: initialize to current max seq, return empty
      since = store.events.length > 0 ? store.events[store.events.length - 1].seq : 0
      setAgentCursor(agentId, since)
    } else {
      // Already initialized: use stored cursor
      since = cursor
    }
  } else {
    since = parseInt(sinceParam, 10) || 0
  }

  const { events, nextCursor } = store.getEvents(since)

  // Advance cursor for this agent
  const currentCursor = getAgentCursor(agentId) ?? 0
  if (nextCursor > currentCursor) {
    setAgentCursor(agentId, nextCursor)
  }

  return NextResponse.json({
    ok: true,
    events,
    nextCursor: String(nextCursor),
    count: events.length,
  })
}
