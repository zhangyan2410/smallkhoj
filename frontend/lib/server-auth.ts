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
  const response = await fetchAuthMe(token, activeServerId)
  if (!response) return null
  if (response.status === 403 && activeServerId) {
    const fallback = await fetchAuthMe(token)
    if (!fallback || !fallback.ok) return null
    return fallback.json()
  }
  if (!response.ok) return null
  return response.json()
}

/**
 * 带 5s 超时 + 一次重试的 auth/me fetch。
 *
 * 后端偶尔瞬时不可达（重启、连接池冷启动）时，原生 fetch 会抛
 * `TypeError: fetch failed`，让整个 server component 500。这里兜底返回
 * null，让上层走未登录跳转 / 错误态，而不是炸掉页面。
 */
async function fetchAuthMe(
  token: string,
  activeServerId?: string | null,
): Promise<Response | null> {
  const doFetch = () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    return fetch(`${API_BASE}/api/v1/auth/me`, {
      cache: "no-store",
      headers: apiHeaders(token, false, activeServerId),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer))
  }
  try {
    return await doFetch()
  } catch {
    // 第一次失败（超时或连接拒绝），等 200ms 重试一次
    await new Promise((r) => setTimeout(r, 200))
    try {
      return await doFetch()
    } catch {
      return null
    }
  }
}

export async function requireCurrentAccount() {
  const account = await currentAccount()
  if (!account) redirect("/login")
  return account
}

export async function serverApiHeaders(contentType = false) {
  const account = await currentAccount()
  return apiHeaders(await getSessionToken(), contentType, account?.server.id)
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
