"use server"

import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { LOCALE_COOKIE, locales } from "@/i18n/config"

/**
 * Persist the chosen locale in a long-lived cookie so the per-request
 * i18n config picks it up on the next navigation, then revalidate + reload.
 */
export async function setLocaleAction(formData: FormData) {
  const requested = String(formData.get("locale") || "")
  const locale = (locales as readonly string[]).includes(requested) ? requested : "zh-CN"
  const cookieStore = await cookies()
  cookieStore.set(LOCALE_COOKIE, locale, {
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
    sameSite: "lax",
  })
  revalidatePath("/", "layout")
  redirect("/")
}
