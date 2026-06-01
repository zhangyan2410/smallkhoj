import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store } from "@/lib/daemon-store"

/**
 * POST /internal/agent-api/tasks/claim
 * Body: { taskId } or { messageId }
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
    const { taskId } = body

    if (!taskId) {
      return NextResponse.json(
        { ok: false, code: "MISSING_PARAMS", message: "taskId is required" },
        { status: 400 }
      )
    }

    const task = store.claimTask(Number(taskId), auth.agentId!)

    if (!task) {
      return NextResponse.json(
        { ok: false, code: "CLAIM_FAILED", message: "Task not found or already claimed" },
        { status: 409 }
      )
    }

    return NextResponse.json({ ok: true, task })
  } catch (e) {
    return NextResponse.json(
      { ok: false, code: "PARSE_ERROR", message: "Invalid JSON body" },
      { status: 400 }
    )
  }
}
