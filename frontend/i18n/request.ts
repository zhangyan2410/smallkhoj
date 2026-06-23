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

export default getRequestConfig(async () => {
  const headerList = await headers()
  const cookieHeader = headerList.get("cookie") || ""
  const cookieMatch = cookieHeader.match(new RegExp(`${LOCALE_COOKIE}=([^;\\s]+)`))
  const fromCookie = pickLocale(cookieMatch?.[1])
  const locale: Locale = fromCookie ?? defaultLocale

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
