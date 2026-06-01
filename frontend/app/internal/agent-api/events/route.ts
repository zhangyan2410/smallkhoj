import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store } from "@/lib/daemon-store"

/**
 * GET /internal/agent-api/events?since=latest|<cursor>
 * Returns incremental events and next cursor
 */
export async function GET(request: NextRequest) {
  const auth = validateAuth(
    request.headers.get("authorization"),
    request.headers.get("x-agent-id")
  )

  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code || "UNAUTHORIZED", message: auth.error },
      { status: 401 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const sinceParam = searchParams.get("since") || "0"

  let since = 0
  if (sinceParam !== "latest") {
    since = parseInt(sinceParam, 10) || 0
  }

  const { events, nextCursor } = store.getEvents(since)

  return NextResponse.json({
    ok: true,
    events,
    nextCursor: String(nextCursor),
    count: events.length,
  })
}
