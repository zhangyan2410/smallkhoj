import { getRequestConfig } from "next-intl/server"
import { headers } from "next/headers"

import { defaultLocale, LOCALE_COOKIE, locales, type Locale } from "./config"

// Re-export for server-only consumers that already import from here.
export { locales, defaultLocale, LOCALE_COOKIE }
export type { Locale }

function pickLocale(raw: string | null | undefined): Locale | null {
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (lower.startsWith("zh")) return "zh-CN"
  if (lower.startsWith("en")) return "en"
  return null
}

function parseAcceptLanguage(headerValue: string | null | undefined): Locale | null {
  if (!headerValue) return null
  // "zh-CN,zh;q=0.9,en;q=0.8" -> pick the highest-q preferred we support.
  const entries = headerValue
    .split(",")
    .map((part) => {
      const [tag, q = "q=1"] = part.trim().split(";")
      const qVal = Number(q.split("=")[1] ?? 1)
      return { tag, q: Number.isFinite(qVal) ? qVal : 0 }
    })
    .sort((a, b) => b.q - a.q)
  for (const { tag } of entries) {
    const match = pickLocale(tag)
    if (match) return match
  }
  return null
}

export default getRequestConfig(async () => {
  const headerList = await headers()
  const cookieHeader = headerList.get("cookie") || ""
  const cookieMatch = cookieHeader.match(new RegExp(`${LOCALE_COOKIE}=([^;\\s]+)`))
  const fromCookie = pickLocale(cookieMatch?.[1])
  const fromAccept = parseAcceptLanguage(headerList.get("accept-language"))
  const locale: Locale = fromCookie ?? fromAccept ?? defaultLocale

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
