import Link from "next/link"

import { apiGet, type Member } from "@/lib/control-plane"

type Channel = {
  id: string
  name: string
  type: string
  description?: string
}

async function getChannels() {
  return apiGet<{ channels: Channel[] }>("/api/v1/channels", { channels: [] })
}

async function getMembers() {
  return apiGet<{ members: Member[] }>("/api/v1/members", { members: [] })
}

export default async function Home() {
  const [{ channels }, { members }] = await Promise.all([getChannels(), getMembers()])

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="max-w-2xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tight">Slock</h1>
          <p className="text-muted-foreground">Human-AI collaboration platform</p>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Channels</h2>
          <ul className="space-y-2">
            {channels.map((ch) => (
              <li key={ch.id} className="border rounded p-3 hover:bg-accent">
                <Link href={`/chat/${ch.name.replace("#", "")}`}>
                  <span className="font-mono font-semibold">{ch.name}</span>
                  <span className="text-muted-foreground ml-2">({ch.type})</span>
                  {ch.description && (
                    <span className="text-muted-foreground ml-2">— {ch.description}</span>
                  )}
                </Link>
              </li>
            ))}
            {channels.length === 0 && (
              <li className="text-muted-foreground">No channels — is the backend running?</li>
            )}
          </ul>
        </div>

        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Members</h2>
          <ul className="space-y-1">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${m.status === "online" || m.status === "active" ? "bg-green-500" : "bg-gray-400"}`} />
                <strong>{m.name}</strong>
                <span className="text-muted-foreground">[{m.kind}]</span>
                <span className="text-muted-foreground">{m.status}</span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <Link href="/tasks" className="text-xl font-semibold hover:underline">
            Tasks →
          </Link>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Link href="/daemon" className="rounded border p-3 font-semibold hover:bg-accent">
            Control Plane →
          </Link>
          <Link href="/members" className="rounded border p-3 font-semibold hover:bg-accent">
            Members →
          </Link>
          <Link href="/computers" className="rounded border p-3 font-semibold hover:bg-accent">
            Computers →
          </Link>
        </div>

        <div className="text-center text-sm text-muted-foreground">
          <a href="http://localhost:8000/docs" className="underline" target="_blank">
            API Docs (Swagger)
          </a>
        </div>
      </div>
    </main>
  )
}
