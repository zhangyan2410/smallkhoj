import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store } from "@/lib/daemon-store"

/**
 * POST /internal/agent-api/tasks/update-status
 * Body: { channel, task_number, status }
 * Compatible with real slock CLI shape.
 */
export async function POST(request: NextRequest) {
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

  try {
    const body = await request.json()
    // Support both real CLI shape { channel, task_number } and MVP shape { taskId }
    const taskNumber = body.task_number || body.taskId
    const status = body.status

    if (!taskNumber || !status) {
      return NextResponse.json(
        { ok: false, code: "MISSING_PARAMS", message: "task_number (or taskId) and status are required" },
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

    const task = store.updateTaskStatus(Number(taskNumber), status, auth.agentId!)

    if (!task) {
      return NextResponse.json(
        { ok: false, code: "UPDATE_FAILED", message: "Task not found or not assigned to you" },
        { status: 403 }
      )
    }

    return NextResponse.json({ ok: true, task })
  } catch {
    return NextResponse.json(
      { ok: false, code: "PARSE_ERROR", message: "Invalid JSON body" },
      { status: 400 }
    )
  }
}
