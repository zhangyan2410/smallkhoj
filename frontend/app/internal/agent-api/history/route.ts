import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store } from "@/lib/daemon-store"

/**
 * GET /internal/agent-api/history?channel=&limit=
 * Returns message history for a channel
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
  const channel = searchParams.get("channel") || "#all"
  const limit = parseInt(searchParams.get("limit") || "50", 10)

  const messages = store.getHistory(channel, limit)

  return NextResponse.json({
    ok: true,
    messages,
    channel,
    count: messages.length,
  })
}
