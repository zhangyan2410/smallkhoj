"use client"

import { useLocale, useTranslations } from "next-intl"
import { Languages } from "lucide-react"

import { setLocaleAction } from "@/app/actions"
import { locales, type Locale } from "@/i18n/config"

/**
 * Small language dropdown. Persists the choice in the `smallkhoj_locale`
 * cookie via a server action and reloads so the new locale takes effect.
 */
export function LanguageSwitcher() {
  const locale = useLocale() as Locale
  const t = useTranslations("language")

  return (
    <form action={setLocaleAction} className="inline-flex items-center">
      <label htmlFor="locale-select" className="sr-only">
        {t("label")}
      </label>
      <span className="inline-flex items-center gap-1.5 rounded-none border border-border bg-background px-2 py-1 text-xs">
        <Languages className="size-3.5 text-muted-foreground" />
        <select
          id="locale-select"
          name="locale"
          defaultValue={locale}
          onChange={(event) => event.currentTarget.form?.requestSubmit()}
          className="bg-transparent text-xs outline-none"
          aria-label={t("label")}
        >
          {locales.map((value) => (
            <option key={value} value={value}>
              {value === "zh-CN" ? t("zhCN") : t("en")}
            </option>
          ))}
        </select>
      </span>
    </form>
  )
}
