"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { API_BASE, type AccountSession } from "@/lib/control-plane"
import { auth } from "@/lib/auth"
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

// Clear both session layers so the next /login render picks signin mode:
//   A) better-auth session (DB row + better-auth.session_token cookie) via auth.api.signOut
//   B) SmallKhoj session (smallkhoj_session / smallkhoj_active_server cookies)
// Without clearing A, /login sees a live better-auth session and forces the
// immutable-name "setup" mode, hiding the sign-in entry and locking the user
// out of logging into a different account. signOut is best-effort: a stale/
// dirty B cookie must not block A cleanup or the redirect to /login.
async function clearAllSessions() {
  try {
    await auth.api.signOut({ headers: await headers() })
  } catch {
    // B already invalid or cookie dirty — fall through to clearing A.
  }
  await clearSessionCookie()
}

export async function logoutAction() {
  await clearAllSessions()
  revalidatePath("/", "layout")
  redirect("/login")
}

// Escape hatch rendered on the /login setup screen: when a better-auth session
// is stuck (multi-tab, dirty cookie, expired DB row not yet synced), the user
// can force-clear both layers and return to a clean sign-in form.
export async function switchAccountAction() {
  await clearAllSessions()
  revalidatePath("/", "layout")
  redirect("/login?mode=signin")
}
