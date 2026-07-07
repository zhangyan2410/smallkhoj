"use client"

/**
 * 主题切换器（三主题：water / dark / shuimo）。
 *
 * 机制（见 .trellis/tasks/06-30-ink-wash-theme-exploration/prd.md）：
 * - water = 不加任何 html class（默认）。
 * - dark / shuimo = 在 <html> 上加对应 class。
 * - 持久化走 localStorage.theme，取值 'dark' | 'shuimo' | null(=water)。
 *
 * Hydration 安全：用 useSyncExternalStore 在服务端恒返回 water（默认），
 * 挂载后订阅 localStorage 的当前值，避免 SSR/CSR 不一致（不会在 effect
 * 里同步 setState）。
 */
import { useCallback, useSyncExternalStore } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Theme = "water" | "dark" | "shuimo"

const THEME_STORAGE_VALUE: Record<Theme, string | null> = {
  water: null,
  dark: "dark",
  shuimo: "shuimo",
}

function readStoredTheme(): Theme {
  const v = window.localStorage.getItem("theme")
  if (v === "dark") return "dark"
  if (v === "shuimo") return "shuimo"
  return "water"
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.classList.remove("dark", "shuimo")
  const cls = THEME_STORAGE_VALUE[theme]
  if (cls) root.classList.add(cls)
}

// useSyncExternalStore 订阅 localStorage 变化（跨 tab / 同 tab 切换）。
const listeners = new Set<() => void>()
function subscribe(cb: () => void) {
  listeners.add(cb)
  const onStorage = (e: StorageEvent) => {
    if (e.key === "theme") cb()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(cb)
    window.removeEventListener("storage", onStorage)
  }
}
// 服务端快照 = water（默认），保证 hydration 一致；客户端 getSnapshot 读真实值。
function getSnapshot(): Theme {
  return readStoredTheme()
}
function getServerSnapshot(): Theme {
  return "water"
}

export function ThemeSwitcher() {
  const t = useTranslations("settings.appearance")
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const choose = useCallback((next: Theme) => {
    const value = THEME_STORAGE_VALUE[next]
    if (value === null) {
      window.localStorage.removeItem("theme")
    } else {
      window.localStorage.setItem("theme", value)
    }
    applyTheme(next)
    listeners.forEach((fn) => fn())
  }, [])

  const options: Array<{ key: Theme; labelKey: "water" | "dark" | "shuimo" }> = [
    { key: "water", labelKey: "water" },
    { key: "dark", labelKey: "dark" },
    { key: "shuimo", labelKey: "shuimo" },
  ]

  return (
    <div
      role="radiogroup"
      aria-label={t("label")}
      className="inline-flex flex-wrap gap-2"
    >
      {options.map(({ key, labelKey }) => {
        const active = theme === key
        return (
          <Button
            key={key}
            type="button"
            variant={active ? "default" : "outline"}
            size="sm"
            role="radio"
            aria-checked={active}
            onClick={() => choose(key)}
            className={cn(
              "min-w-16",
              active
                ? "bg-[var(--ink)] text-[var(--paper)]"
                : "bg-[var(--paper)] text-foreground",
            )}
          >
            {t(labelKey)}
          </Button>
        )
      })}
    </div>
  )
}
