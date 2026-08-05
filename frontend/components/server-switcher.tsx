"use client"

import { useMemo } from "react"
import { Check, GripVertical, LogOut, Server } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"

import { logoutAction, switchActiveServerAction } from "@/app/server-actions"
import { InkframeObjectSurface, ObjectField } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import type { AccountServerMembership, AccountSession } from "@/lib/control-plane"
import { switchableMemberships } from "@/lib/server-switcher-state"

function membershipFallback(session: AccountSession): AccountServerMembership {
  return {
    server: session.server,
    member: {
      id: session.member.id,
      displayName: session.member.displayName || session.member.name,
      kind: session.member.kind,
    },
    role: "owner",
    status: "active",
    isDefault: true,
  }
}

function roleKey(role: string) {
  if (role === "owner") return "roleOwner"
  if (role === "admin") return "roleAdmin"
  return "roleMember"
}

function accountInitial(label: string) {
  const trimmed = label.trim()
  return (trimmed[0] || "S").toUpperCase()
}

export function ServerSwitcher({ session }: { session: AccountSession }) {
  const t = useTranslations("serverSwitcher")
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const returnTo = useMemo(() => {
    const query = searchParams.toString()
    return query ? `${pathname}?${query}` : pathname
  }, [pathname, searchParams])
  const memberships = session.memberships?.length ? session.memberships : [membershipFallback(session)]
  const active = memberships.find((item) => item.server.id === session.server.id) ?? memberships[0]
  const switchableServers = switchableMemberships(memberships, active.server.id)
  const accountLabel = session.account.displayName || session.account.name
  const accountHandle =
    session.account.name && session.account.name !== accountLabel && !session.account.name.startsWith("ba_")
      ? `/${session.account.name}`
      : t("account")
  const activeRole = t(roleKey(active.role))

  return (
    <details data-region="server-switcher" className="group/server-switcher relative">
      <summary
        aria-label={t("ariaServer", { name: active.server.name })}
        title={active.server.name}
        className="sk-rail-logo relative flex size-9 cursor-pointer list-none items-center justify-center rounded-none text-sm font-semibold marker:hidden transition-transform active:translate-y-px group-open/server-switcher:translate-x-px group-open/server-switcher:translate-y-px [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden>{accountInitial(accountLabel)}</span>
      </summary>
      <InkframeObjectSurface raised className="fixed left-14 top-3 z-50 w-[min(20rem,calc(100vw-4.5rem))] text-sand-ink">
        <div className="border-b-2 border-[var(--ink)] bg-sand-card px-2.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-none border-2 border-[var(--ink)] bg-primary text-sm font-semibold text-primary-foreground">
              {accountInitial(accountLabel)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-xs text-sand-muted">
                <Check className="size-3.5 shrink-0" />
                <span className="truncate">{accountLabel}</span>
              </div>
              <div className="truncate text-xs text-muted-foreground">{accountHandle}</div>
            </div>
            <GripVertical className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </div>
        </div>

        <div className="px-2.5 py-2">
          <ObjectField
            label={`${t("currentServer")} · ${activeRole}`}
            mono={false}
            value={
              <span className="inline-flex min-w-0 items-center gap-2">
                <Server className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{active.server.name}</span>
              </span>
            }
          />
        </div>

        {switchableServers.length > 0 ? (
          <div className="space-y-1 px-2.5 pb-2" aria-label={t("serverList")}>
            {switchableServers.map((item) => {
              return (
                <form key={item.server.id} action={switchActiveServerAction}>
                  <input type="hidden" name="serverId" value={item.server.id} />
                  <input type="hidden" name="returnTo" value={returnTo} />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2"
                    aria-label={t("switchTo", { name: item.server.name })}
                  >
                    <Server className="size-3.5" />
                    <span className="min-w-0 flex-1 truncate text-left">{item.server.name}</span>
                    <span className="shrink-0 text-[0.68rem] uppercase text-muted-foreground">{t(roleKey(item.role))}</span>
                  </Button>
                </form>
              )
            })}
          </div>
        ) : null}

        <form action={logoutAction} className="border-t-2 border-[var(--ink)] px-2.5 py-2">
          <Button type="submit" variant="ghost" size="sm" className="w-full justify-start gap-2" aria-label={t("signOut")}>
            <LogOut className="size-3.5" />
            <span className="min-w-0 flex-1 truncate text-left">{t("signOut")}</span>
          </Button>
        </form>
      </InkframeObjectSurface>
    </details>
  )
}
