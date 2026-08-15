import { cache } from "react"

import { API_BASE, type Member } from "@/lib/control-plane"
import { currentAccount, getSessionToken } from "@/lib/server-auth"

import type { ChannelInfo, DmInfo } from "./chat-data-context"

/**
 * 服务端 chat 取数助手。
 *
 * 去重原理（重要）：
 * React 的 `cache(fn)` 按「函数身份 + 参数的引用相等」缓存。
 * 若把 `headers`（每次都是新对象）当参数传入，layout 和 page 各自 `serverApiHeaders()`
 * 拿到的是两个不同的 headers 对象 → cache miss → 同 pass 内 members/dms 被抓两次。
 *
 * 正确做法：让 helper 不接收 headers 参数，自己在内部通过同样被 cache() 包装的
 * `currentAccount` / `getSessionToken` 拿到 session（这些是 per-request 单例），
 * 再构造请求头。这样 `fetchChatMembers` 这类零参函数在同一 render pass 内
 * 必然命中缓存、只发一次网络请求。
 *
 * 注意：`cache()` 是 per-request（一次 server 渲染请求）的，跨请求不共享。
 */

const cachedCurrentAccount = cache(currentAccount)
export { cachedCurrentAccount }
const cachedSessionToken = cache(getSessionToken)

async function buildChatHeaders(): Promise<Record<string, string>> {
  const [token, account] = await Promise.all([cachedSessionToken(), cachedCurrentAccount()])
  const headers: Record<string, string> = { "X-Public-Key": process.env.NEXT_PUBLIC_API_KEY ?? "sk_public_local" }
  if (account?.server.id) headers["X-Server-Id"] = account.server.id
  if (token) headers["X-Account-Token"] = token
  return headers
}

/** 抓取频道列表。同 pass 内重复调用只发一次请求。 */
export const fetchChatChannels = cache(async (): Promise<ChannelInfo[]> => {
  const headers = await buildChatHeaders()
  const res = await fetch(`${API_BASE}/api/v1/channels`, { headers, cache: "no-store" })
  if (!res.ok) return []
  const data = await res.json() as { channels?: ChannelInfo[] }
  return data.channels ?? []
})

/** 抓取 DM 列表。同 pass 内重复调用只发一次请求。 */
export const fetchChatDms = cache(async (): Promise<DmInfo[]> => {
  const headers = await buildChatHeaders()
  const res = await fetch(`${API_BASE}/api/v1/dms`, { headers, cache: "no-store" })
  if (!res.ok) return []
  const data = await res.json() as { dms?: DmInfo[] }
  return data.dms ?? []
})

/** 抓取成员列表。同 pass 内重复调用只发一次请求。 */
export const fetchChatMembers = cache(async (): Promise<Member[]> => {
  const headers = await buildChatHeaders()
  const res = await fetch(`${API_BASE}/api/v1/members`, { headers, cache: "no-store" })
  if (!res.ok) return []
  const data = await res.json() as { members?: Member[] }
  return data.members ?? []
})

/** 抓取已读游标。同 pass 内重复调用只发一次请求。 */
export const fetchChatReadCursors = cache(async (): Promise<unknown[]> => {
  const headers = await buildChatHeaders()
  const res = await fetch(`${API_BASE}/api/v1/chat/read-cursors`, { headers, cache: "no-store" })
  if (!res.ok) return []
  const data = await res.json() as { cursors?: unknown[] }
  return data.cursors ?? []
})
