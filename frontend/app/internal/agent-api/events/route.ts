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
    // Use agent's last consumed cursor; if never checked, initialize to current max seq
    since = getAgentCursor(agentId)
    if (since === 0 && store.events.length > 0) {
      since = store.events[store.events.length - 1].seq
      setAgentCursor(agentId, since)
    }
  } else {
    since = parseInt(sinceParam, 10) || 0
  }

  const { events, nextCursor } = store.getEvents(since)

  // Advance cursor for this agent
  if (nextCursor > getAgentCursor(agentId)) {
    setAgentCursor(agentId, nextCursor)
  }

  return NextResponse.json({
    ok: true,
    events,
    nextCursor: String(nextCursor),
    count: events.length,
  })
}
