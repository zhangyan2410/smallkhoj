import Link from "next/link"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { KeyRound, Server, Shield, SlidersHorizontal } from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { RuntimeChip } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Panel } from "@/components/ui/panel"
import { apiGet, formatTime } from "@/lib/control-plane"
import { getSessionToken, requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

export default async function SettingsPage() {
  const session = await requireCurrentAccount()
  const sessionToken = await getSessionToken()
  const apiKeys = await getApiKeys(sessionToken)
  const lastSecret = parseLastApiKeyCookie((await cookies()).get("smallkhoj_last_api_key")?.value)

  return (
    <ProductShell
      active="settings"
      title="Settings"
      description="Server, account, runtime defaults, API keys, and safety controls for the local product."
      session={session}
      sidebarTitle="Admin Links"
      sidebarDescription="Secondary surfaces stay reachable without taking over the main app."
      sidebar={
        <div className="grid gap-2">
          <a href="http://localhost:8000/docs" target="_blank" className="rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent">
            API Docs
          </a>
          <Link href="/daemon" className="rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent">
            Control Plane
          </Link>
          <Link href="/computers" className="rounded-md border bg-background px-3 py-2 text-sm hover:bg-accent">
            Daemon Onboarding
          </Link>
        </div>
      }
    >
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="size-4 text-primary" />
              Account / Server
            </CardTitle>
            <CardDescription>Current authenticated local workspace context.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border bg-background p-3">
              <div className="text-xs text-muted-foreground">Account</div>
              <div className="mt-1 truncate text-sm font-medium">{session.account.displayName || session.account.name}</div>
            </div>
            <div className="rounded-md border bg-background p-3">
              <div className="text-xs text-muted-foreground">Server</div>
              <div className="mt-1 truncate text-sm font-medium">{session.server.name}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <SlidersHorizontal className="size-4 text-primary" />
              Runtime Defaults
            </CardTitle>
            <CardDescription>Provider defaults are scoped for the runtime expansion task.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input placeholder="claude_code" disabled />
              <Input placeholder="model default" disabled />
            </div>
            <RuntimeChip>Disabled until provider expansion</RuntimeChip>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-primary" />
              API Keys
            </CardTitle>
            <CardDescription>Prefixes, owners, one-time secret display, and revocation state.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {lastSecret && (
              <Panel variant="flat" className="sk-cat-warning space-y-2 p-3">
                <div className="text-xs font-semibold">New Secret</div>
                <code className="block break-all rounded-none border-2 border-[var(--ink)] bg-background p-2 text-xs">
                  {lastSecret.secret}
                </code>
                <div className="text-xs">This is the only time the full secret is shown.</div>
              </Panel>
            )}
            <form action={createApiKeyAction} className="flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="api-key-type" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                  Type
                </label>
                <select id="api-key-type" name="resourceType" className="h-9 rounded-md border bg-background px-3 text-sm">
                  <option value="human">Human</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <Button type="submit" size="sm" variant="outline">Create Key</Button>
            </form>
            <div className="overflow-hidden rounded-md border">
              <div className="hidden grid-cols-[0.9fr_0.7fr_1fr_0.8fr_0.7fr] gap-2 border-b bg-muted/60 px-3 py-2 text-xs font-medium uppercase text-muted-foreground md:grid">
                <span>Prefix</span>
                <span>Type</span>
                <span>Owner</span>
                <span>Created</span>
                <span>State</span>
              </div>
              {apiKeys.apiKeys.map((apiKey) => (
                <div key={apiKey.id} className="grid gap-2 border-b px-3 py-3 text-sm last:border-b-0 md:grid-cols-[0.9fr_0.7fr_1fr_0.8fr_0.7fr] md:items-center">
                  <div className="font-mono text-xs">{apiKey.prefix}</div>
                  <div className="text-xs text-muted-foreground">{apiKey.resourceType}</div>
                  <div className="truncate">{apiKey.owner?.name ?? apiKey.resourceId.slice(0, 8)}</div>
                  <div className="text-xs text-muted-foreground">{formatTime(apiKey.createdAt)}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RuntimeChip tone={apiKey.revoked ? "danger" : "success"}>
                      {apiKey.revoked ? "revoked" : "active"}
                    </RuntimeChip>
                    {!apiKey.revoked && (
                      <form action={revokeApiKeyAction} className="flex items-center gap-1">
                        <input type="hidden" name="keyId" value={apiKey.id} />
                        <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <input type="checkbox" name="confirm" required />
                          Confirm
                        </label>
                        <Button type="submit" size="sm" variant="outline">Revoke</Button>
                      </form>
                    )}
                  </div>
                </div>
              ))}
              {apiKeys.apiKeys.length === 0 && (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">No API keys found.</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Shield className="size-4 text-primary" />
              Safety Controls
            </CardTitle>
            <CardDescription>Experimental toggles require explicit persisted backend support.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <RuntimeChip tone="warning">Feature flags planned</RuntimeChip>
            <RuntimeChip tone="danger">Destructive actions require confirm</RuntimeChip>
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

async function getApiKeys(sessionToken?: string | null) {
  return apiGet<ApiKeyList>("/api/v1/api-keys", { apiKeys: [], count: 0 }, sessionToken)
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
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/api/v1/api-keys`, {
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
  const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/api/v1/api-keys/${keyId}/revoke`, {
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
