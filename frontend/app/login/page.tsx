import { redirect } from "next/navigation"
import { headers } from "next/headers"
import { LogIn } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { API_BASE, PUBLIC_KEY, type AccountSession } from "@/lib/control-plane"
import { auth, ensureBetterAuthSchema } from "@/lib/auth"
import { currentAccount, setActiveServerCookie, setSessionCookie } from "@/lib/server-auth"

async function loginAction(formData: FormData) {
  "use server"

  const email = String(formData.get("email") || "").trim().toLowerCase()
  const password = String(formData.get("password") || "")
  const displayName = String(formData.get("displayName") || "").trim()
  const mode = String(formData.get("mode") || "signin") === "signup" ? "signup" : "signin"
  if (!email || !password) redirect("/login?error=Missing%20email%20or%20password")

  let betterAuthUser: BetterAuthUser | null = null
  try {
    await ensureBetterAuthSchema()
    const requestHeaders = await headers()
    const result = mode === "signup"
      ? await auth.api.signUpEmail({
        body: {
          email,
          password,
          name: displayName || email.split("@", 1)[0],
          rememberMe: true,
        },
        headers: requestHeaders,
        returnHeaders: true,
      })
      : await auth.api.signInEmail({
        body: {
          email,
          password,
          rememberMe: true,
        },
        headers: requestHeaders,
        returnHeaders: true,
      })
    betterAuthUser = betterAuthUserFromResult(result)
  } catch (error) {
    redirect(`/login?error=${encodeURIComponent(authErrorMessage(error))}`)
  }

  if (!betterAuthUser) {
    redirect("/login?error=Auth%20session%20missing%20user")
  }

  const bridgeSecret = process.env.AUTH_BRIDGE_SECRET || ""
  const bridgeResponse = await fetch(`${API_BASE}/api/v1/auth/better-auth/bridge`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Public-Key": PUBLIC_KEY,
      "X-Auth-Bridge-Secret": bridgeSecret,
    },
    body: JSON.stringify({
      userId: betterAuthUser.id,
      email: betterAuthUser.email,
      name: betterAuthUser.name,
    }),
  })
  if (!bridgeResponse.ok) {
    const error = await bridgeResponse.json().catch(() => ({}))
    const detail = typeof error.detail === "string" ? error.detail : `HTTP ${bridgeResponse.status}`
    redirect(`/login?error=${encodeURIComponent(detail)}`)
  }
  const data = (await bridgeResponse.json()) as AccountSession
  if (data.sessionToken) {
    await setSessionCookie(data.sessionToken)
  }
  if (data.server?.id) {
    await setActiveServerCookie(data.server.id)
  }
  redirect("/")
}

type BetterAuthUser = {
  id: string
  email: string
  name: string
}

function betterAuthUserFromResult(result: unknown): BetterAuthUser | null {
  const response = result && typeof result === "object" && "response" in result
    ? (result as { response?: unknown }).response
    : result
  if (!response || typeof response !== "object" || !("user" in response)) return null
  const user = (response as { user?: unknown }).user
  if (!user || typeof user !== "object") return null
  const record = user as Record<string, unknown>
  return typeof record.id === "string" && typeof record.email === "string" && typeof record.name === "string"
    ? { id: record.id, email: record.email, name: record.name }
    : null
}

function authErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; body?: unknown }
    if (typeof record.message === "string" && record.message) return record.message
    if (record.body && typeof record.body === "object") {
      const body = record.body as { message?: unknown; code?: unknown }
      if (typeof body.message === "string") return body.message
      if (typeof body.code === "string") return body.code
    }
  }
  return "Authentication failed"
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await currentAccount()
  if (session) redirect("/")
  const resolvedSearchParams = (await searchParams) ?? {}
  const error = Array.isArray(resolvedSearchParams.error) ? resolvedSearchParams.error[0] : resolvedSearchParams.error
  const t = await getTranslations("login")

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <LogIn className="size-5" />
            {t("brand")}
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={loginAction} className="space-y-3">
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("emailLabel")}
              </label>
              <Input id="login-email" name="email" type="email" required placeholder={t("emailPlaceholder")} autoFocus />
            </div>
            <div>
              <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("passwordLabel")}
              </label>
              <Input id="login-password" name="password" type="password" required minLength={8} placeholder={t("passwordPlaceholder")} />
            </div>
            <div>
              <label htmlFor="login-display-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("displayNameLabel")}
              </label>
              <Input id="login-display-name" name="displayName" placeholder={t("displayNamePlaceholder")} />
            </div>
            {error && (
              <p className="border-2 border-[var(--ink)] bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="submit" name="mode" value="signin" variant="default">
                {t("signIn")}
              </Button>
              <Button type="submit" name="mode" value="signup" variant="outline">
                {t("signUp")}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
