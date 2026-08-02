"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  readNotificationPreferences,
  writeNotificationPreferences,
  type NotificationDomain,
  type NotificationPreferences,
} from "@/lib/notification-preferences"

type PermissionState = "granted" | "denied" | "default" | "unsupported"

function currentPermission(): PermissionState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported"
  return Notification.permission
}

const DOMAIN_KEYS: NotificationDomain[] = ["chat", "tasks", "memory"]

/**
 * 通知设置（任务 07-30-background-notifications R1）：
 * 权限状态展示 + 申请入口 + 按域细粒度开关（localStorage 持久化，默认全开）。
 * 拒绝授权后显示引导文案，功能静默降级。
 */
export function NotificationSettings() {
  const t = useTranslations("settings.notifications")
  // SSR 与首渲一致：挂载后再读真实权限与偏好（hydration 安全）。
  const [permission, setPermission] = useState<PermissionState>("unsupported")
  const [prefs, setPrefs] = useState<NotificationPreferences>({ ...DEFAULT_NOTIFICATION_PREFERENCES })

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPermission(currentPermission())
      setPrefs(readNotificationPreferences(window.localStorage))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const requestPermission = () => {
    if (typeof Notification === "undefined") return
    void Notification.requestPermission()
      .then((result) => setPermission(result))
      .catch(() => setPermission(currentPermission()))
  }

  const toggleDomain = (domain: NotificationDomain, enabled: boolean) => {
    setPrefs((previous) => {
      const next = { ...previous, [domain]: enabled }
      writeNotificationPreferences(window.localStorage, next)
      return next
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t("permissionLabel")}</span>
        <span
          data-slot="notification-permission"
          data-state={permission}
          className="rounded-none border-2 border-[var(--ink)] bg-[var(--paper)] px-1.5 py-0.5 text-[11px] font-semibold"
        >
          {t(`status.${permission}`)}
        </span>
        {(permission === "default" || permission === "unsupported") && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={permission === "unsupported"}
            onClick={requestPermission}
          >
            {t("enable")}
          </Button>
        )}
      </div>
      {permission === "denied" && (
        <p className="text-xs text-muted-foreground">{t("deniedHint")}</p>
      )}
      {permission === "unsupported" && (
        <p className="text-xs text-muted-foreground">{t("unsupportedHint")}</p>
      )}
      <fieldset className="space-y-1.5">
        <legend className="text-xs font-medium text-muted-foreground">{t("domainsTitle")}</legend>
        {DOMAIN_KEYS.map((domain) => (
          <label key={domain} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={prefs[domain]}
              onChange={(event) => toggleDomain(domain, event.target.checked)}
            />
            {t(`domains.${domain}`)}
          </label>
        ))}
      </fieldset>
    </div>
  )
}
