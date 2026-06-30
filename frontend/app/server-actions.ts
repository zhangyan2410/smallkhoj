"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { API_BASE, type AccountSession } from "@/lib/control-plane"
import { clearSessionCookie, serverApiHeaders, setActiveServerCookie } from "@/lib/server-auth"

function safeReturnTo(value: FormDataEntryValue | null) {
  const raw = String(value || "").trim()
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}

function appendError(path: string, message: string) {
  const separator = path.includes("?") ? "&" : "?"
  return `${path}${separator}error=${encodeURIComponent(message)}`
}

export async function switchActiveServerAction(formData: FormData) {
  const serverId = String(formData.get("serverId") || "").trim()
  const returnTo = safeReturnTo(formData.get("returnTo"))
  if (!serverId) redirect(appendError(returnTo, "Missing Server"))

  await setActiveServerCookie(serverId)
  revalidatePath("/", "layout")
  redirect(returnTo)
}

export async function createServerAction(formData: FormData) {
  const name = String(formData.get("name") || "").trim()
  const returnTo = safeReturnTo(formData.get("returnTo"))
  if (!name) redirect(appendError(returnTo, "Missing Server name"))

  const response = await fetch(`${API_BASE}/api/v1/servers`, {
    method: "POST",
    cache: "no-store",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ name }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(appendError(returnTo, detail))
  }

  const data = (await response.json()) as AccountSession
  if (data.server?.id) await setActiveServerCookie(data.server.id)
  revalidatePath("/", "layout")
  redirect(returnTo)
}

export async function acceptServerInviteAction(formData: FormData) {
  const token = String(formData.get("token") || "").trim()
  if (!token) redirect("/members?error=Missing%20invite")

  const response = await fetch(`${API_BASE}/api/v1/server-invites/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    cache: "no-store",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({}),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/join/${encodeURIComponent(token)}?error=${encodeURIComponent(detail)}`)
  }

  const data = (await response.json()) as AccountSession
  if (data.server?.id) await setActiveServerCookie(data.server.id)
  revalidatePath("/", "layout")
  redirect("/members")
}

export async function logoutAction() {
  await clearSessionCookie()
  revalidatePath("/", "layout")
  redirect("/login")
}
