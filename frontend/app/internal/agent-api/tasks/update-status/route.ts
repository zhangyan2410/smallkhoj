import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store } from "@/lib/daemon-store"

/**
 * POST /internal/agent-api/tasks/update-status
 * Body: { taskId, status }
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
    const { taskId, status } = body

    if (!taskId || !status) {
      return NextResponse.json(
        { ok: false, code: "MISSING_PARAMS", message: "taskId and status are required" },
        { status: 400 }
      )
    }

    const validStatuses = ["todo", "in_progress", "in_review", "done"]
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_STATUS", message: `Status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      )
    }

    const task = store.updateTaskStatus(Number(taskId), status, auth.agentId!)

    if (!task) {
      return NextResponse.json(
        { ok: false, code: "UPDATE_FAILED", message: "Task not found or not assigned to you" },
        { status: 403 }
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
