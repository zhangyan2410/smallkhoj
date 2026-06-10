import Link from "next/link"
import { KeyRound, Server, Shield, SlidersHorizontal } from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { RuntimeChip } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { requireCurrentAccount } from "@/lib/server-auth"

export default async function SettingsPage() {
  const session = await requireCurrentAccount()

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
            <CardDescription>Secret display, rotation, and revocation belong in the API key task.</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/settings">
              <Button disabled variant="outline" size="sm">
                Manage API Keys
              </Button>
            </Link>
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
            <RuntimeChip className="border-amber-200 bg-amber-50 text-amber-700">Feature flags planned</RuntimeChip>
            <RuntimeChip className="border-rose-200 bg-rose-50 text-rose-700">Destructive actions require confirm</RuntimeChip>
          </CardContent>
        </Card>
      </div>
    </ProductShell>
  )
}
