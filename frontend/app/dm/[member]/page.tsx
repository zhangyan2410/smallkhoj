import Link from "next/link"

import { MessageComposer } from "@/components/message-composer"
import { API_BASE, PUBLIC_KEY, type ChannelMessage, type Member } from "@/lib/control-plane"

async function getDmMessages(member: string) {
  try {
    const response = await fetch(`${API_BASE}/api/v1/dms/${member}/messages?limit=50`, {
      cache: "no-store",
      headers: { "X-Public-Key": PUBLIC_KEY },
    })
    if (!response.ok) return { messages: [] as ChannelMessage[], peer: null as Member | null }
    return response.json() as Promise<{ messages: ChannelMessage[]; peer: Member }>
  } catch {
    return { messages: [] as ChannelMessage[], peer: null as Member | null }
  }
}

export default async function DmPage({ params }: { params: Promise<{ member: string }> }) {
  const { member } = await params
  const { messages, peer } = await getDmMessages(member)

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-4xl flex-col">
        <header className="mb-4 flex items-center justify-between gap-3 border-b pb-4">
          <div>
            <Link href="/" className="text-sm text-muted-foreground hover:underline">
              Back
            </Link>
            <h1 className="mt-1 text-2xl font-semibold">DM {peer?.handle || member}</h1>
            {peer?.backend && <p className="text-sm text-muted-foreground">{peer.backend}</p>}
          </div>
          <Link href="/members" className="text-sm text-primary hover:underline">
            Members
          </Link>
        </header>

        <section className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-none border-2 border-[var(--ink)] bg-card p-3">
          {messages.map((message) => (
            <article key={message.id} className="rounded-none border-2 border-[var(--ink)] bg-sand-card p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`font-semibold ${message.senderType === "agent" ? "text-blue-600" : "text-green-600"}`}>
                  {message.sender}
                </span>
                <span className="text-xs text-muted-foreground">{message.time || message.createdAt}</span>
                {message.seq !== undefined && <span className="text-xs text-muted-foreground">seq={message.seq}</span>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{message.content}</p>
            </article>
          ))}
          {messages.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No DM messages yet.</p>}
        </section>

        <footer className="mt-3 rounded-none border-2 border-[var(--ink)] bg-card p-3">
          <MessageComposer path={`/api/v1/dms/${encodeURIComponent(member)}/messages`} placeholder={`Message ${peer?.handle || member}`} />
        </footer>
      </div>
    </main>
  )
}
