import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  ACTIVE_SERVER_COOKIE_NAME,
  API_BASE,
  SESSION_COOKIE_NAME,
  type AccountSession,
  apiHeaders,
} from "@/lib/control-plane"

export async function getSessionToken() {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
}

export async function getActiveServerId() {
  const cookieStore = await cookies()
  return cookieStore.get(ACTIVE_SERVER_COOKIE_NAME)?.value ?? null
}

export async function currentAccount(): Promise<AccountSession | null> {
  const token = await getSessionToken()
  if (!token) return null
  const activeServerId = await getActiveServerId()
  const response = await fetch(`${API_BASE}/api/v1/auth/me`, {
    cache: "no-store",
    headers: apiHeaders(token, false, activeServerId),
  })
  if (response.status === 403 && activeServerId) {
    await clearActiveServerCookie()
    const fallback = await fetch(`${API_BASE}/api/v1/auth/me`, {
      cache: "no-store",
      headers: apiHeaders(token),
    })
    if (!fallback.ok) return null
    return fallback.json()
  }
  if (!response.ok) return null
  return response.json()
}

export async function requireCurrentAccount() {
  const account = await currentAccount()
  if (!account) redirect("/login")
  return account
}

export async function serverApiHeaders(contentType = false) {
  return apiHeaders(await getSessionToken(), contentType, await getActiveServerId())
}

export async function setSessionCookie(sessionToken: string) {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE_NAME, sessionToken, {
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
  })
}

export async function clearSessionCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE_NAME)
  cookieStore.delete(ACTIVE_SERVER_COOKIE_NAME)
}

export async function setActiveServerCookie(serverId: string) {
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_SERVER_COOKIE_NAME, serverId, {
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
    sameSite: "lax",
  })
}

export async function clearActiveServerCookie() {
  const cookieStore = await cookies()
  cookieStore.delete(ACTIVE_SERVER_COOKIE_NAME)
}
