import { redirect } from "next/navigation"
import { headers } from "next/headers"
import Link from "next/link"
import { LogIn } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { InkframeObjectSurface } from "@/components/inkframe-object-ui"
import { MemberNameField } from "@/components/member-name-field"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { API_BASE, PUBLIC_KEY, type AccountSession } from "@/lib/control-plane"
import { auth, ensureBetterAuthSchema } from "@/lib/auth"
import { currentAccount, setActiveServerCookie, setSessionCookie } from "@/lib/server-auth"

type LoginMode = "signin" | "signup" | "setup"

function safeReturnTo(value: FormDataEntryValue | string | string[] | undefined | null) {
  const raw = Array.isArray(value) ? value[0] : String(value || "").trim()
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/"
  return raw
}

function loginPathWithError(returnTo: string, message: string, mode: LoginMode = "signin") {
  const params = new URLSearchParams()
  if (returnTo !== "/") params.set("returnTo", returnTo)
  if (mode !== "signin") params.set("mode", mode)
  params.set("error", message)
  return `/login?${params.toString()}`
}

async function canonicalSignupName(name: string): Promise<string> {
  const response = await fetch(
    `${API_BASE}/api/v1/auth/name-preview?name=${encodeURIComponent(name)}`,
    {
      cache: "no-store",
      headers: { "X-Public-Key": PUBLIC_KEY },
    },
  )
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const preview = await response.json() as {
    valid?: boolean
    canonicalName?: string | null
    reasonCode?: string | null
  }
  if (!preview.valid || !preview.canonicalName) {
    throw new Error(preview.reasonCode || "NAME_REQUIRED")
  }
  return preview.canonicalName
}

async function loginAction(formData: FormData) {
  "use server"

  const email = String(formData.get("email") || "").trim().toLowerCase()
  const password = String(formData.get("password") || "")
  const submittedName = String(formData.get("name") || "").trim()
  const rawMode = String(formData.get("mode") || "signin")
  const mode: LoginMode = rawMode === "signup" ? "signup" : rawMode === "setup" ? "setup" : "signin"
  const returnTo = safeReturnTo(formData.get("returnTo"))
  if (mode !== "setup" && (!email || !password)) {
    redirect(loginPathWithError(returnTo, "Missing email or password", mode))
  }
  if (mode !== "signin" && !submittedName) {
    redirect(loginPathWithError(returnTo, "NAME_REQUIRED", mode))
  }

  let betterAuthUser: BetterAuthUser | null = null
  let canonicalName = ""
  try {
    await ensureBetterAuthSchema()
    const requestHeaders = await headers()
    if (mode !== "signin") canonicalName = await canonicalSignupName(submittedName)
    if (mode === "setup") {
      betterAuthUser = betterAuthUserFromSession(await auth.api.getSession({ headers: requestHeaders }))
    } else {
      const result = mode === "signup"
        ? await auth.api.signUpEmail({
        body: {
          email,
          password,
          name: canonicalName,
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
    }
  } catch (error) {
    redirect(loginPathWithError(returnTo, authErrorMessage(error), mode))
  }

  if (!betterAuthUser) {
    redirect(loginPathWithError(returnTo, "Auth session missing user", mode))
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
      name: mode === "signin" ? betterAuthUser.name : canonicalName,
    }),
  })
  if (!bridgeResponse.ok) {
    const error = await bridgeResponse.json().catch(() => ({}))
    const detail = typeof error.detail === "string"
      ? error.detail
      : error.detail && typeof error.detail === "object" && typeof error.detail.message === "string"
        ? error.detail.message
        : `HTTP ${bridgeResponse.status}`
    redirect(loginPathWithError(returnTo, detail, "setup"))
  }
  const data = (await bridgeResponse.json()) as AccountSession
  if (data.sessionToken) {
    await setSessionCookie(data.sessionToken)
  }
  if (data.server?.id) {
    await setActiveServerCookie(data.server.id)
  }
  redirect(returnTo)
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

function betterAuthUserFromSession(result: unknown): BetterAuthUser | null {
  if (!result || typeof result !== "object" || !("user" in result)) return null
  const user = (result as { user?: unknown }).user
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
  const resolvedSearchParams = (await searchParams) ?? {}
  const error = Array.isArray(resolvedSearchParams.error) ? resolvedSearchParams.error[0] : resolvedSearchParams.error
  const returnTo = safeReturnTo(resolvedSearchParams.returnTo)
  if (session) redirect(returnTo)
  const t = await getTranslations("login")
  const tIdentity = await getTranslations("identity")
  const requestedMode = resolvedSearchParams.mode === "signup" ? "signup" : "signin"
  let setupUser: BetterAuthUser | null = null
  try {
    await ensureBetterAuthSchema()
    setupUser = betterAuthUserFromSession(await auth.api.getSession({ headers: await headers() }))
  } catch {
    setupUser = null
  }
  const mode: LoginMode = setupUser ? "setup" : requestedMode
  const localizedError = error && error.startsWith("NAME_")
    ? ({
        NAME_REQUIRED: tIdentity("nameRequired"),
        NAME_TOO_LONG: tIdentity("nameTooLong"),
        NAME_INVALID_HYPHEN: tIdentity("nameInvalidHyphen"),
        NAME_INVALID_CHARACTER: tIdentity("nameInvalidCharacter"),
        NAME_RESERVED_SERVER_SUFFIX: tIdentity("nameReservedSuffix"),
      } as Record<string, string>)[error] ?? error
    : error

  return (
    <main data-slot="workbench-desk" className="sk-workbench-desk flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <LogIn className="size-5" />
            {t("brand")}
          </CardTitle>
          <CardDescription>
            {mode === "signup" ? t("signUpDescription") : mode === "setup" ? t("setupDescription") : t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={loginAction} className="space-y-3">
            <input type="hidden" name="returnTo" value={returnTo} />
            <input type="hidden" name="mode" value={mode} />
            {mode !== "signin" ? (
              <MemberNameField
                id="login-name"
                label={t("nameLabel")}
                placeholder={t("namePlaceholder")}
                availabilityPath="/api/v1/auth/name-preview"
                defaultValue={setupUser?.name ?? ""}
                autoFocus={mode === "setup"}
              />
            ) : null}
            {mode !== "setup" ? (
              <>
                <div>
                  <label htmlFor="login-email" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    {t("emailLabel")}
                  </label>
                  <Input id="login-email" name="email" type="email" required placeholder={t("emailPlaceholder")} autoFocus={mode === "signin"} />
                </div>
                <div>
                  <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                    {t("passwordLabel")}
                  </label>
                  <Input id="login-password" name="password" type="password" required minLength={8} placeholder={t("passwordPlaceholder")} />
                </div>
              </>
            ) : null}
            {localizedError && (
              <InkframeObjectSurface material="blocked" className="px-2 py-1.5 text-xs text-destructive">
                {localizedError}
              </InkframeObjectSurface>
            )}
            {returnTo !== "/" && (
              <InkframeObjectSurface material="dry" className="px-2 py-1.5 text-xs text-muted-foreground">
                {t("returnToHint")}
              </InkframeObjectSurface>
            )}
            <Button type="submit" className="w-full">
              {mode === "signup" ? t("signUp") : mode === "setup" ? t("finishSetup") : t("signIn")}
            </Button>
            {mode !== "setup" ? (
              <p className="text-center text-xs text-muted-foreground">
                {mode === "signin" ? t("needAccount") : t("haveAccount")}{" "}
                <Link
                  href={`/login?${new URLSearchParams({
                    ...(returnTo !== "/" ? { returnTo } : {}),
                    mode: mode === "signin" ? "signup" : "signin",
                  }).toString()}`}
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  {mode === "signin" ? t("signUp") : t("signIn")}
                </Link>
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
