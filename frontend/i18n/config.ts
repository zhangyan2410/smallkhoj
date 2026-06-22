/**
 * Locale constants shared between client and server. Keep this file free of
 * `next/headers` imports so it can be imported from client components.
 */
export const locales = ["zh-CN", "en"] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = "zh-CN"
export const LOCALE_COOKIE = "smallkhoj_locale"
