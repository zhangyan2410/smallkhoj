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

export async function updateHumanAvatarUrlAction(formData: FormData) {
  const memberId = String(formData.get("memberId") || "")
  const avatarUrl = String(formData.get("avatarUrl") || "").trim()
  if (!memberId) return

  const response = await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ avatarUrl: avatarUrl || null }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/members?member=${encodeURIComponent(memberId)}&tab=profile&error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/members")
  redirect(`/members?member=${encodeURIComponent(memberId)}&tab=profile`)
}

export async function updateAgentDescriptionAction(formData: FormData) {
  const memberId = String(formData.get("memberId") || "")
  const description = String(formData.get("description") || "").trim()
  if (!memberId) return

  const response = await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ description: description || null }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string"
      ? error.detail
      : error.detail && typeof error.detail === "object" && typeof error.detail.message === "string"
        ? error.detail.message
        : `HTTP ${response.status}`
    redirect(`/members?member=${encodeURIComponent(memberId)}&tab=profile&error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/members")
  redirect(`/members?member=${encodeURIComponent(memberId)}&tab=profile`)
}

export async function updatePermissionsAction(formData: FormData) {
  const memberId = String(formData.get("memberId") || "")
  if (!memberId) return
  const permissionsRaw = String(formData.get("permissions") || "{}")
  const actionsRaw = String(formData.get("actions") || "{}")
  const permissions = JSON.parse(permissionsRaw) as Record<string, boolean>
  const actions = JSON.parse(actionsRaw) as Record<string, boolean>
  await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ permissions, actions }),
  })
  revalidatePath("/members")
}

export async function deleteMemberAction(formData: FormData) {
  const memberId = String(formData.get("memberId") || "")
  if (!memberId) return
  const response = await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "DELETE",
    headers: await serverApiHeaders(),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/members?error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/members")
  revalidatePath("/computers")
  redirect("/members?kind=agent")
}

export async function addPermissionEntryAction(formData: FormData) {
  const memberId = String(formData.get("memberId") || "")
  const type = String(formData.get("type") || "permissions")
  const key = String(formData.get("key") || "").trim()
  const value = formData.get("value") === "true"
  if (!memberId || !key) return
  const existingRaw = String(formData.get("existing") || "{}")
  const existing = JSON.parse(existingRaw) as Record<string, boolean>
  const merged = { ...existing, [key]: value }
  await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ [type]: merged }),
  })
  revalidatePath("/members")
}

export async function removePermissionEntryAction(formData: FormData) {
  const memberId = String(formData.get("memberId") || "")
  const type = String(formData.get("type") || "permissions")
  const key = String(formData.get("key") || "").trim()
  if (!memberId || !key) return
  const existingRaw = String(formData.get("existing") || "{}")
  const existing = JSON.parse(existingRaw) as Record<string, boolean>
  const rest = Object.fromEntries(Object.entries(existing).filter(([entryKey]) => entryKey !== key))
  await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ [type]: rest }),
  })
  revalidatePath("/members")
}

export async function togglePermissionEntryAction(formData: FormData) {
  const memberId = String(formData.get("memberId") || "")
  const type = String(formData.get("type") || "permissions")
  const key = String(formData.get("key") || "").trim()
  const currentValue = formData.get("currentValue") === "true"
  if (!memberId || !key) return
  const existingRaw = String(formData.get("existing") || "{}")
  const existing = JSON.parse(existingRaw) as Record<string, boolean>
  const merged = { ...existing, [key]: !currentValue }
  await fetch(`${API_BASE}/api/v1/members/${memberId}`, {
    method: "PATCH",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ [type]: merged }),
  })
  revalidatePath("/members")
}
