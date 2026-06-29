"use client"

import { Terminal } from "lucide-react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Panel } from "@/components/ui/panel"
import { deriveDaemonInstallCommand } from "@/lib/daemon-install"

type CredentialResponse = {
  name: string
  command: string
  expiresAt: string
  daemonInstall?: {
    installCommand: string
  } | null
}

export function ConnectComputerForm({
  action,
  credential,
  connectedComputerName,
  error,
}: {
  action: (formData: FormData) => Promise<void>
  credential?: CredentialResponse | null
  connectedComputerName?: string | null
  error?: string | null
}) {
  const router = useRouter()
  const t = useTranslations("computers")
  const installCommand = credential?.daemonInstall?.installCommand ?? deriveDaemonInstallCommand(credential?.command)

  useEffect(() => {
    if (!credential) return
    const timer = window.setInterval(() => router.refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [credential, router])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="size-4" />
          {t("connectNew")}
        </CardTitle>
        <CardDescription>{t("connectDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={action} className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="computer-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("computerName")}
            </label>
            <Input
              id="computer-name"
              name="name"
              placeholder="my-computer"
              className="max-w-xs"
            />
          </div>
          <Button type="submit" size="sm">
            {t("generateConnect")}
          </Button>
        </form>

        {credential && (
          <div className="space-y-2 rounded-none border-2 border-[var(--ink)] bg-muted/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">{t("pendingConnection")}</div>
              <div className="text-xs text-muted-foreground">{t("waitingFor", { name: credential.name })}</div>
            </div>
            {installCommand && (
              <>
                <div className="text-xs font-medium uppercase text-muted-foreground">{t("installCommand")}</div>
                <code
                  data-testid="daemon-install-command"
                  className="block whitespace-pre-wrap break-all rounded-none border-2 border-[var(--ink)] bg-sand-card p-2 text-xs"
                >
                  {installCommand}
                </code>
              </>
            )}
            <div className="text-xs font-medium uppercase text-muted-foreground">{t("connectionCommand")}</div>
            <code
              data-testid="connection-command"
              className="block whitespace-pre-wrap break-all rounded-none border-2 border-[var(--ink)] bg-sand-card p-2 text-xs"
            >
              {credential.command}
            </code>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">{t("computerName")}</div>
                <div data-testid="pending-computer-name" className="truncate font-mono text-xs">
                  {credential.name}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">{t("expires")}</div>
                <div className="truncate font-mono text-xs">
                  {credential.expiresAt}
                </div>
              </div>
            </div>
          </div>
        )}

        {connectedComputerName && (
          <Panel variant="flat" className="sk-cat-success p-3 text-sm">
            {t("connected", { name: connectedComputerName })}
          </Panel>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
