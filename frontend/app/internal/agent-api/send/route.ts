import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store } from "@/lib/daemon-store"

/**
 * POST /internal/agent-api/send
 * Body: { target, content, type? }
 */
export async function POST(request: NextRequest) {
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

  try {
    const body = await request.json()
    const { target, content, type = "agent" } = body

    if (!target || !content) {
      return NextResponse.json(
        { ok: false, code: "MISSING_PARAMS", message: "target and content are required" },
        { status: 400 }
      )
    }

    const message = store.addMessage({
      target,
      sender: auth.agentId!,
      content,
      type,
    })

    return NextResponse.json({ ok: true, message })
  } catch (e) {
    return NextResponse.json(
      { ok: false, code: "PARSE_ERROR", message: "Invalid JSON body" },
      { status: 400 }
    )
  }
}
