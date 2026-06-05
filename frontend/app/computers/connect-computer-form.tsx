"use client"

import { useState, useTransition, type FormEvent } from "react"
import { Terminal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiPost } from "@/lib/control-plane"

type CredentialResponse = {
  created: boolean
  computerId: string
  apiKey: string
  command: string
}

export function ConnectComputerForm() {
  const [name, setName] = useState("")
  const [credential, setCredential] = useState<CredentialResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const result = await apiPost<CredentialResponse>("/api/v1/computers/credential", {
          name: name.trim() || "unregistered-computer",
        })
        setCredential(result)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate credential")
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="size-4" />
          Connect New Computer
        </CardTitle>
        <CardDescription>Generate a machine credential to connect a new computer via daemon.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="computer-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Computer Name
            </label>
            <Input
              id="computer-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-computer"
              className="max-w-xs"
            />
          </div>
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "Generating..." : "Generate Credential"}
          </Button>
        </form>

        {credential && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Connection Command</div>
            <code
              data-testid="connection-command"
              className="block whitespace-pre-wrap break-all rounded-md border bg-background p-2 text-xs"
            >
              {credential.command}
            </code>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">Computer ID</div>
                <div data-testid="generated-computer-id" className="truncate font-mono text-xs">
                  {credential.computerId}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-medium uppercase text-muted-foreground">Machine API Key</div>
                <div data-testid="generated-api-key" className="truncate font-mono text-xs">
                  {credential.apiKey}
                </div>
              </div>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  )
}
