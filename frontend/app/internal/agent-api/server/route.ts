import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store } from "@/lib/daemon-store"

/**
 * GET /internal/agent-api/server
 * Returns server info, channels, agents, humans
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

  const info = store.getServerInfo()

  // Mark requesting agent as online
  const agent = store.agents.get(auth.agentId!)
  if (agent) {
    agent.status = "online"
  }

  return NextResponse.json({ ok: true, ...info })
}
