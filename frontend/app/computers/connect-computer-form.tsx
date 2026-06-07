"use client"

import { Terminal } from "lucide-react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type CredentialResponse = {
  name: string
  command: string
  expiresAt: string
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
          Connect New Computer
        </CardTitle>
        <CardDescription>Generate a one-time connect command; the computer is created after the daemon connects.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form action={action} className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="computer-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Computer Name
            </label>
            <Input
              id="computer-name"
              name="name"
              placeholder="my-computer"
              className="max-w-xs"
            />
          </div>
          <Button type="submit" size="sm">
            Generate Connect Command
          </Button>
        </form>

        {credential && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-medium uppercase text-muted-foreground">Pending Connection</div>
              <div className="text-xs text-muted-foreground">Waiting for {credential.name}</div>
            </div>
            <div className="text-xs font-medium uppercase text-muted-foreground">Connection Command</div>
            <code
              data-testid="connection-command"
              className="block whitespace-pre-wrap break-all rounded-md border bg-background p-2 text-xs"
            >
              {credential.command}
            </code>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">Computer Name</div>
                <div data-testid="pending-computer-name" className="truncate font-mono text-xs">
                  {credential.name}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">Expires</div>
                <div className="truncate font-mono text-xs">
                  {credential.expiresAt}
                </div>
              </div>
            </div>
          </div>
        )}

        {connectedComputerName && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            {connectedComputerName} connected.
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
