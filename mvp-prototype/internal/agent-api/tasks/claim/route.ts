import { NextRequest, NextResponse } from "next/server"
import { validateAuth } from "@/lib/daemon-auth"
import { store } from "@/lib/daemon-store"

/**
 * POST /internal/agent-api/tasks/claim
 * Body: { channel, task_numbers?: number[], message_ids?: string[] }
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
    // Support both real CLI shape { channel, task_numbers } and MVP shape { taskId }
    const taskNumbers: number[] = body.task_numbers || (body.taskId ? [body.taskId] : [])
    const channel = body.channel || "#window"

    if (!taskNumbers.length) {
      return NextResponse.json(
        { ok: false, code: "MISSING_PARAMS", message: "task_numbers or taskId is required" },
        { status: 400 }
      )
    }

    const results = []
    for (const num of taskNumbers) {
      const task = store.claimTaskByNumber(num, channel, auth.agentId!)
      results.push({
        taskId: num,
        claimed: !!task,
        task: task || undefined,
      })
    }

    const allFailed = results.every((r) => !r.claimed)
    if (allFailed && results.length === 1) {
      return NextResponse.json(
        { ok: false, code: "CLAIM_FAILED", message: "Task not found or already claimed" },
        { status: 409 }
      )
    }

    return NextResponse.json({ ok: true, results })
  } catch {
    return NextResponse.json(
      { ok: false, code: "PARSE_ERROR", message: "Invalid JSON body" },
      { status: 400 }
    )
  }
}
