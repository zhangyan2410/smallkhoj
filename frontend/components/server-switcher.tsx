"use client"

import { useMemo } from "react"
import { Check, GripVertical, Plus, Server } from "lucide-react"
import { usePathname, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"

import { createServerAction, switchActiveServerAction } from "@/app/server-actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { AccountServerMembership, AccountSession } from "@/lib/control-plane"

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
      <div className="fixed left-14 top-3 z-50 w-[min(20rem,calc(100vw-4.5rem))] border-2 border-[var(--ink)] bg-sand-card text-sand-ink shadow-[2px_2px_0_var(--ink)]">
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
          <div className="mb-1 flex items-center justify-between gap-2 text-[0.68rem] font-medium text-muted-foreground">
            <span>{t("currentServer")}</span>
            <span>{activeRole}</span>
          </div>
          <div className="flex min-w-0 items-center gap-2 border-2 border-[var(--ink)] px-2 py-1.5 sk-accent-mint">
            <Server className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{active.server.name}</span>
          </div>
        </div>

        <div className="space-y-1 px-2.5 pb-2" aria-label={t("serverList")}>
          {memberships.map((item) => {
            const selected = item.server.id === active.server.id
            return (
              <form key={item.server.id} action={switchActiveServerAction}>
                <input type="hidden" name="serverId" value={item.server.id} />
                <input type="hidden" name="returnTo" value={returnTo} />
                <Button
                  type="submit"
                  variant={selected ? "secondary" : "ghost"}
                  size="sm"
                  className={selected ? "w-full justify-start gap-2 sk-accent-mint-soft" : "w-full justify-start gap-2"}
                  disabled={selected}
                  aria-label={selected ? t("selectedServer", { name: item.server.name }) : t("switchTo", { name: item.server.name })}
                >
                  {selected ? <Check className="size-3.5" /> : <Server className="size-3.5" />}
                  <span className="min-w-0 flex-1 truncate text-left">{item.server.name}</span>
                  <span className="shrink-0 text-[0.68rem] uppercase text-muted-foreground">{t(roleKey(item.role))}</span>
                </Button>
              </form>
            )
          })}
        </div>

        <form action={createServerAction} className="border-t-2 border-[var(--ink)] px-2.5 py-2">
          <input type="hidden" name="returnTo" value={returnTo} />
          <label htmlFor="create-server-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t("createServer")}
          </label>
          <div className="flex gap-1.5">
            <Input id="create-server-name" name="name" required placeholder={t("newServerPlaceholder")} className="h-7 text-xs" />
            <Button type="submit" size="icon-sm" variant="outline" aria-label={t("createServer")}>
              <Plus className="size-3.5" />
            </Button>
          </div>
        </form>
      </div>
    </details>
  )
}
