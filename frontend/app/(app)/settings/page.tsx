import Link from "next/link"
import { revalidatePath } from "next/cache"
import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { KeyRound, Bell, Palette, Server, Shield, SlidersHorizontal } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { AttachmentSheet, ChannelDivider, ObjectField } from "@/components/inkframe-object-ui"
import { NotificationSettings } from "@/components/notification-settings"
import { ProductShell } from "@/components/product-shell"
import { EmptyState, ProductRow, RuntimeChip } from "@/components/product-ui"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { API_BASE, apiGet, formatTime } from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"
import { resolvePublicApiBaseFromHeaders } from "@/lib/runtime-url"

export default async function SettingsPage() {
  const t = await getTranslations("settings")
  const session = await requireCurrentAccount()
  const sessionToken = await getSessionToken()
  const activeServerId = session.server.id
  const apiKeys = await getApiKeys(sessionToken, activeServerId)
  const lastSecret = parseLastApiKeyCookie((await cookies()).get("smallkhoj_last_api_key")?.value)
  const publicApiBase = resolvePublicApiBaseFromHeaders(process.env, await headers())

  return (
    <ProductShell
      title={t("title")}
      description={t("description")}
      sidebarTitle={t("sidebarTitle")}
      sidebarDescription={t("sidebarDescription")}
      sidebar={
        <div className="grid gap-2">
          <a href={`${publicApiBase}/docs`} target="_blank" className="block text-sm">
            <ChannelDivider kind="thread" className="w-full justify-between">
              <span>{t("apiDocs")}</span>
            </ChannelDivider>
          </a>
          <Link href="/daemon" className="block text-sm">
            <ChannelDivider kind="channel" className="w-full justify-between">
              <span>{t("controlPlane")}</span>
            </ChannelDivider>
          </Link>
          <Link href="/computers" className="block text-sm">
            <ChannelDivider kind="channel" className="w-full justify-between">
              <span>{t("daemonOnboarding")}</span>
            </ChannelDivider>
          </Link>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="size-4 text-accent-rose" />
              {t("appearance.title")}
            </CardTitle>
            <CardDescription>{t("appearance.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeSwitcher />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4 text-accent-blue" />
              {t("accountServerTitle")}
            </CardTitle>
            <CardDescription>{t("accountServerDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <ObjectField label={t("account")} value={session.account.displayName || session.account.name} mono={false} />
            <ObjectField label={t("server")} value={session.server.name} mono={false} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="size-4 text-accent-mint" />
              {t("notifications.title")}
            </CardTitle>
            <CardDescription>{t("notifications.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationSettings />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="size-4 text-accent-mint" />
              {t("runtimeDefaultsTitle")}
            </CardTitle>
            <CardDescription>{t("runtimeDefaultsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="claude_code" disabled />
              <Input placeholder={t("modelDefaultPlaceholder")} disabled />
            </div>
            <RuntimeChip>{t("disabledProviderExpansion")}</RuntimeChip>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-accent-rose" />
              {t("apiKeysTitle")}
            </CardTitle>
            <CardDescription>{t("apiKeysDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastSecret && (
              <AttachmentSheet kind="proof" className="space-y-2 p-3">
                <div className="text-xs font-semibold">{t("newSecret")}</div>
                <code className="block break-all border-2 border-[var(--ink)] bg-[var(--paper)] p-2 text-xs">
                  {lastSecret.secret}
                </code>
                <div className="text-xs">{t("onlyTimeSecretShown")}</div>
              </AttachmentSheet>
            )}
            <form action={createApiKeyAction} className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="api-key-type" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  {t("type")}
                </label>
                <Select
                  id="api-key-type"
                  name="resourceType"
                  items={[`human|${t("human")}`, `admin|${t("admin")}`]}
                  splitValue
                  className="h-9"
                />
              </div>
              <Button type="submit" size="sm" variant="outline">{t("createKey")}</Button>
            </form>
            <div className="sk-object-surface overflow-hidden">
              <div className="hidden grid-cols-[0.9fr_0.7fr_1fr_0.8fr_0.7fr] gap-2 border-b-2 border-[var(--ink)] bg-[var(--paper)] px-3 py-2 text-xs font-medium text-muted-foreground md:grid">
                <span>{t("prefix")}</span>
                <span>{t("type")}</span>
                <span>{t("owner")}</span>
                <span>{t("created")}</span>
                <span>{t("state")}</span>
              </div>
              {apiKeys.apiKeys.map((apiKey) => (
                <ProductRow key={apiKey.id} className="md:grid-cols-[0.9fr_0.7fr_1fr_0.8fr_0.7fr]">
                  <div className="font-mono text-xs">{apiKey.prefix}</div>
                  <div className="text-xs text-muted-foreground">{apiKey.resourceType}</div>
                  <div className="truncate">{apiKey.owner?.name ?? apiKey.resourceId.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{formatTime(apiKey.createdAt)}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RuntimeChip tone={apiKey.revoked ? "danger" : "success"}>
                      {apiKey.revoked ? t("revoked") : t("active")}
                    </RuntimeChip>
                    {!apiKey.revoked && (
                      <form action={revokeApiKeyAction} className="flex items-center gap-1">
                        <input type="hidden" name="keyId" value={apiKey.id} />
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <input type="checkbox" name="confirm" required />
                          {t("confirm")}
                        </label>
                        <Button type="submit" size="sm" variant="outline">{t("revoke")}</Button>
                      </form>
                    )}
                  </div>
                </ProductRow>
              ))}
              {apiKeys.apiKeys.length === 0 && (
                <EmptyState title={t("noApiKeys")} className="my-0 border-0 shadow-none" />
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="size-4 text-accent-rose" />
              {t("safetyControlsTitle")}
            </CardTitle>
            <CardDescription>{t("safetyControlsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <RuntimeChip tone="warning">{t("featureFlagsPlanned")}</RuntimeChip>
            <RuntimeChip tone="danger">{t("destructiveActionsRequireConfirm")}</RuntimeChip>
          </CardContent>
        </Card>
      </div>
    </ProductShell>
  )
}

type ApiKeyItem = {
  id: string
  prefix: string
  resourceType: string
  resourceId: string
  owner?: { id: string; name: string; type: string } | null
  createdAt?: string | null
  revokedAt?: string | null
  revoked: boolean
}

type ApiKeyList = {
  apiKeys: ApiKeyItem[]
  count: number
}

async function getApiKeys(sessionToken?: string | null, activeServerId?: string | null) {
  return apiGet<ApiKeyList>("/api/v1/api-keys", { apiKeys: [], count: 0 }, sessionToken, activeServerId)
}

function parseLastApiKeyCookie(value?: string) {
  if (!value) return null
  try {
    const data = JSON.parse(value) as { secret?: unknown; prefix?: unknown }
    if (typeof data.secret !== "string" || typeof data.prefix !== "string") return null
    return { secret: data.secret, prefix: data.prefix }
  } catch {
    return null
  }
}

async function createApiKeyAction(formData: FormData) {
  "use server"

  const resourceType = String(formData.get("resourceType") || "human")
  const response = await fetch(`${API_BASE}/api/v1/api-keys`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({ resourceType }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/settings?error=${encodeURIComponent(detail)}`)
  }
  const data = await response.json() as { secret?: string; apiKey?: { prefix?: string } }
  if (data.secret && data.apiKey?.prefix) {
    const cookieStore = await cookies()
    cookieStore.set("smallkhoj_last_api_key", JSON.stringify({
      secret: data.secret,
      prefix: data.apiKey.prefix,
    }), {
      httpOnly: true,
      maxAge: 300,
      path: "/settings",
      sameSite: "lax",
    })
  }
  revalidatePath("/settings")
  redirect("/settings?createdKey=1")
}

async function revokeApiKeyAction(formData: FormData) {
  "use server"

  const keyId = String(formData.get("keyId") || "")
  const confirmed = formData.get("confirm") === "on"
  if (!keyId || !confirmed) redirect("/settings?error=Confirmation%20required")
  const response = await fetch(`${API_BASE}/api/v1/api-keys/${keyId}/revoke`, {
    method: "POST",
    headers: await serverApiHeaders(true),
    body: JSON.stringify({}),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${response.status}`
    redirect(`/settings?error=${encodeURIComponent(detail)}`)
  }
  revalidatePath("/settings")
  redirect("/settings?revokedKey=1")
}
