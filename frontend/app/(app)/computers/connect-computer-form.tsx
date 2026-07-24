"use client"

import { Terminal } from "lucide-react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import { AttachmentSheet, InkframeObjectSurface, ObjectField } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Panel } from "@/components/ui/panel"

type CredentialResponse = {
  name: string
  command: string
  expiresAt: string
  serverId?: string | null
  serverName?: string | null
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
          <InkframeObjectSurface material="drying" className="space-y-2 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">{t("pendingConnection")}</div>
              <div className="text-xs text-muted-foreground">{t("waitingFor", { name: credential.name })}</div>
            </div>
            <div className="text-xs font-medium uppercase text-muted-foreground">{t("connectionCommand")}</div>
            <AttachmentSheet kind="proof" className="p-2">
              <code
                data-testid="daemon-connect-command"
                className="block whitespace-pre-wrap break-all text-xs"
              >
                {credential.command}
              </code>
            </AttachmentSheet>
            <div className="grid gap-2 sm:grid-cols-3">
              <ObjectField label={t("computerName")} value={<span data-testid="pending-computer-name">{credential.name}</span>} />
              <ObjectField label={t("server")} value={<span data-testid="pending-server-name">{credential.serverName || credential.serverId || "-"}</span>} />
              <ObjectField label={t("expires")} value={credential.expiresAt} />
            </div>
          </InkframeObjectSurface>
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
