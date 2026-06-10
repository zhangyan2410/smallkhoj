import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import {
  API_BASE,
  SESSION_COOKIE_NAME,
  type AccountSession,
  apiHeaders,
} from "@/lib/control-plane"

export async function getSessionToken() {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null
}

export async function currentAccount(): Promise<AccountSession | null> {
  const token = await getSessionToken()
  if (!token) return null
  const response = await fetch(`${API_BASE}/api/v1/auth/me`, {
    cache: "no-store",
    headers: apiHeaders(token),
  })
  if (!response.ok) return null
  return response.json()
}

export async function requireCurrentAccount() {
  const account = await currentAccount()
  if (!account) redirect("/login")
  return account
}

export async function serverApiHeaders(contentType = false) {
  return apiHeaders(await getSessionToken(), contentType)
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
}
