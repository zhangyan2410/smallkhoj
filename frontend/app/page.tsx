import Link from "next/link"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { apiGet, type Member } from "@/lib/control-plane"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"
const PUBLIC_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "sk_public_local"

type Channel = {
  id: string
  name: string
  type: string
  description?: string
}

function channelPathSegment(name: string) {
  return encodeURIComponent(name.replace(/^#/, ""))
}

async function getChannels() {
  return apiGet<{ channels: Channel[] }>("/api/v1/channels", { channels: [] })
}

async function getMembers() {
  return apiGet<{ members: Member[] }>("/api/v1/members", { members: [] })
}

async function createChannelAction(formData: FormData) {
  "use server"
  const name = formData.get("channelName") as string
  if (!name) return
  await fetch(`${API_BASE}/api/v1/channels`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Public-Key": PUBLIC_KEY },
    body: JSON.stringify({ name, description: formData.get("channelDescription") || "" }),
  })
  revalidatePath("/")
}

async function createDmAction(formData: FormData) {
  "use server"
  const peer = formData.get("peer") as string
  if (!peer) return
  const response = await fetch(`${API_BASE}/api/v1/dm`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Public-Key": PUBLIC_KEY },
    body: JSON.stringify({ peer }),
  })
  revalidatePath("/")
  if (response.ok) {
    const data = await response.json()
    if (data.channel?.name) {
      redirect(`/chat/${channelPathSegment(data.channel.name)}`)
    }
  }
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
                <Link href={`/chat/${channelPathSegment(ch.name)}`}>
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
          <form action={createChannelAction} className="flex items-end gap-2">
            <div>
              <label htmlFor="channel-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                New Channel
              </label>
              <input
                id="channel-name"
                name="channelName"
                placeholder="channel-name"
                required
                className="h-9 rounded-md border bg-background px-3 text-sm"
              />
            </div>
            <div>
              <input name="channelDescription" placeholder="description" className="h-9 rounded-md border bg-background px-3 text-sm" />
            </div>
            <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Create</button>
          </form>
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
          <form action={createDmAction} className="flex items-end gap-2">
            <div>
              <label htmlFor="dm-peer" className="mb-1 block text-xs font-medium text-muted-foreground">
                Start DM with
              </label>
              <select id="dm-peer" name="peer" required className="h-9 rounded-md border bg-background px-3 text-sm">
                <option value="">Select member...</option>
                {members.filter((m) => m.kind === "agent").map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">DM</button>
          </form>
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
