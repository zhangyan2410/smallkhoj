import Link from "next/link"
import { AlertTriangle, CheckCircle2, LogIn, Users } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { acceptServerInviteAction } from "@/app/server-actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Panel } from "@/components/ui/panel"
import {
  API_BASE,
  apiHeaders,
  type ServerInviteResponse,
} from "@/lib/control-plane"
import { currentAccount, getSessionToken } from "@/lib/server-auth"

function searchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function formatInviteDate(value: string | null | undefined, fallback: string) {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

async function loadInvite(token: string, activeServerId?: string | null) {
  const sessionToken = await getSessionToken()
  const response = await fetch(`${API_BASE}/api/v1/server-invites/${encodeURIComponent(token)}`, {
    cache: "no-store",
    headers: apiHeaders(sessionToken, false, activeServerId),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    return { invite: null, error: detail }
  }
  const data = (await response.json()) as ServerInviteResponse
  return { invite: data.invite, error: null }
}

export default async function JoinServerPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const resolvedSearchParams = (await searchParams) ?? {}
  const actionError = searchValue(resolvedSearchParams.error)
  const session = await currentAccount()
  const { invite, error } = await loadInvite(token, session?.server.id)
  const t = await getTranslations("join")
  const loginHref = `/login?returnTo=${encodeURIComponent(`/join/${token}`)}`

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Users className="size-5" />
            {t("title")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(error || !invite) && (
            <Panel className="p-3">
              <div className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                {t("invalidInvite")}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{error || t("invalidInvite")}</p>
            </Panel>
          )}

          {invite && (
            <Panel className="grid gap-3 p-3">
              <div>
                <div className="text-xs text-muted-foreground">{t("serverLabel")}</div>
                <div className="mt-1 text-base font-semibold">{invite.serverName}</div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted-foreground">{t("roleLabel")}</div>
                  <div className="mt-1 text-sm">{invite.role}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">{t("expiresLabel")}</div>
                  <div className="mt-1 text-sm">{formatInviteDate(invite.expiresAt, t("unknownExpiry"))}</div>
                </div>
              </div>
            </Panel>
          )}

          {actionError && (
            <p className="text-sm text-destructive" role="alert">
              {t("errorPrefix")} {actionError}
            </p>
          )}

          {invite && !session && (
            <div className="space-y-3">
              <Panel className="p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <LogIn className="size-4" />
                  {t("loginRequiredTitle")}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{t("loginRequiredDesc")}</p>
              </Panel>
              <Link href={loginHref}>
                <Button className="w-full">
                  <LogIn className="size-4" />
                  {t("loginButton")}
                </Button>
              </Link>
            </div>
          )}

          {invite && session && invite.alreadyMember && (
            <div className="space-y-3">
              <Panel className="p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="size-4" />
                  {t("alreadyMember")}
                </div>
              </Panel>
              <Link href="/members">
                <Button className="w-full">{t("openMembers")}</Button>
              </Link>
            </div>
          )}

          {invite && session && !invite.alreadyMember && (
            <form action={acceptServerInviteAction}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit" className="w-full">
                <CheckCircle2 className="size-4" />
                {t("acceptInvite")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
