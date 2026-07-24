"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"

import { API_BASE } from "@/lib/control-plane"
import { serverApiHeaders } from "@/lib/server-auth"

/**
 * Member agent lifecycle control (start/stop/restart).
 * Shared between MembersList (sidebar inline controls) and the legacy
 * AgentControls. Native form submission per quality-guidelines.
 */
export async function controlMemberLifecycleAction(formData: FormData) {
  const memberId = String(formData.get("memberId") || "")
  const workspaceId = String(formData.get("workspaceId") || "")
  const action = String(formData.get("action") || "").trim()
  if (!memberId || !workspaceId || !action) {
    redirect(`/members?member=${encodeURIComponent(memberId)}&error=${encodeURIComponent("Missing member, workspace, or action")}`)
  }

  const response = await fetch(`${API_BASE}/api/v1/workspaces/${workspaceId}/lifecycle`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ action }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/members?member=${encodeURIComponent(memberId)}&error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/members")
  redirect(`/members?member=${encodeURIComponent(memberId)}`)
}
