import { redirect } from "next/navigation"
import { LogIn } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { API_BASE, PUBLIC_KEY, type AccountSession } from "@/lib/control-plane"
import { currentAccount, setSessionCookie } from "@/lib/server-auth"

async function loginAction(formData: FormData) {
  "use server"

  const name = String(formData.get("name") || "").trim()
  if (!name) return

  const response = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Public-Key": PUBLIC_KEY },
    body: JSON.stringify({ name }),
  })
  if (!response.ok) {
    redirect(`/login?error=${encodeURIComponent(`HTTP ${response.status}`)}`)
  }
  const data = (await response.json()) as AccountSession
  if (data.sessionToken) {
    await setSessionCookie(data.sessionToken)
  }
  redirect("/")
}

export default async function LoginPage() {
  const session = await currentAccount()
  if (session) redirect("/")
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
              <label htmlFor="login-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
                {t("nameLabel")}
              </label>
              <Input id="login-name" name="name" required placeholder={t("namePlaceholder")} autoFocus />
            </div>
            <Button type="submit" className="w-full">
              {t("continue")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
