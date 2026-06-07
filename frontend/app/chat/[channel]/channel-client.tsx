"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Plus, Send, Trash2, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  apiGet,
  apiPost,
  apiDelete,
  type Member,
  statusLabel,
  dotClass,
  PUBLIC_KEY,
  API_BASE,
} from "@/lib/control-plane"

type ChannelInfo = { id: string; name: string; type: string; description?: string }
type ChannelMessage = {
  id: string
  seq: number
  sender: string
  senderType: string
  content: string
  time: string
}

function channelPathSegment(value: string) {
  return encodeURIComponent(value)
}

export function ChannelClient({
  initialChannel,
  initialMessages = [],
  initialMembers = [],
  initialAllMembers = [],
  initialChannels = [],
  initialChannelId = "",
}: {
  initialChannel: string
  initialMessages?: ChannelMessage[]
  initialMembers?: Member[]
  initialAllMembers?: Member[]
  initialChannels?: ChannelInfo[]
  initialChannelId?: string
}) {
  const [channelName, setChannelName] = useState(initialChannel)
  const [messages, setMessages] = useState<ChannelMessage[]>(initialMessages)
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [allMembers, setAllMembers] = useState<Member[]>(initialAllMembers)
  const [channels, setChannels] = useState<ChannelInfo[]>(initialChannels)
  const [input, setInput] = useState("")
  const [showMembers, setShowMembers] = useState(true)
  const [channelId, setChannelId] = useState(initialChannelId)
  const addMemberSelectRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    let cancelled = false
    async function loadChannel() {
      const decodedChannel = initialChannel
      const encodedChannel = channelPathSegment(decodedChannel)
      setChannelName(decodedChannel)
      const h = { "X-Public-Key": PUBLIC_KEY }
      const msgsRes = await fetch(`${API_BASE}/api/v1/channels/${encodedChannel}/messages?limit=50`, { headers: h })
      if (msgsRes.ok) { const d = await msgsRes.json(); if (!cancelled) setMessages(d.messages || []) }
      const chsRes = await fetch(`${API_BASE}/api/v1/channels`, { headers: h })
      if (chsRes.ok) {
        const d = await chsRes.json()
        const chs = (d.channels || []) as ChannelInfo[]
        if (!cancelled) setChannels(chs)
        const match = chs.find((c) => c.name.replace("#", "") === decodedChannel)
        if (match && !cancelled) {
          setChannelId(match.id)
          const mRes = await fetch(`${API_BASE}/api/v1/channels/${match.id}/members`, { headers: h })
          if (mRes.ok) { const md = await mRes.json(); if (!cancelled) setMembers(md.members || []) }
        }
      }
      const membersRes = await fetch(`${API_BASE}/api/v1/members`, { headers: h })
      if (membersRes.ok) { const d = await membersRes.json(); if (!cancelled) setAllMembers(d.members || []) }
    }
    void loadChannel()
    return () => { cancelled = true }
  }, [initialChannel])

  async function refreshMessages() {
    const encodedChannel = channelPathSegment(channelName)
    const data = await apiGet<{ messages: ChannelMessage[] }>(
      `/api/v1/channels/${encodedChannel}/messages?limit=50`,
      { messages: [] },
    )
    setMessages(data.messages || [])
  }

  async function refreshMembers() {
    if (!channelId) return
    try {
      const data = await apiGet<{ members: Member[] }>(`/api/v1/channels/${channelId}/members`, { members: [] })
      setMembers(data.members || [])
    } catch {
      setMembers([])
    }
  }

  async function handleAddMember() {
    const memberId = addMemberSelectRef.current?.value
    if (!channelId || !memberId) return
    try {
      await apiPost(`/api/v1/channels/${channelId}/members`, { memberId })
      if (addMemberSelectRef.current) addMemberSelectRef.current.value = ""
      await refreshMembers()
    } catch (e) {
      console.error("Add member failed:", e)
    }
  }

  async function handleSend() {
    if (!input.trim()) return
    try {
      const encodedChannel = channelPathSegment(channelName)
      await apiPost(`/api/v1/channels/${encodedChannel}/messages`, { content: input.trim(), sender: "zy-ean" })
      setInput("")
      await refreshMessages()
    } catch (e) {
      console.error("Send failed:", e)
    }
  }

  async function handleRemoveMember(memberId: string) {
    if (!channelId) return
    try {
      await apiDelete(`/api/v1/channels/${channelId}/members/${memberId}`)
      await refreshMembers()
    } catch (e) {
      console.error("Remove member failed:", e)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-screen">
      <aside className="w-56 shrink-0 border-r bg-muted/30 flex flex-col">
        <div className="border-b p-3">
          <Link href="/" className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
            <ArrowLeft className="size-3" /> Back
          </Link>
        </div>
        <div className="p-3">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Channels</h3>
          <div className="space-y-1">
            {channels.map((ch) => (
              <Link
                key={ch.id}
                href={`/chat/${channelPathSegment(ch.name.replace("#", ""))}`}
                className={`block truncate rounded px-2 py-1 text-sm ${
                  ch.name.replace("#", "") === channelName ? "bg-accent font-medium" : "hover:bg-accent/50"
                }`}
              >
                {ch.name}
              </Link>
            ))}
          </div>
        </div>
        <div className="mt-auto border-t p-3">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Members Online</h3>
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-0.5 text-sm">
              <span className={`size-2 rounded-full ${dotClass(m.status)}`} />
              <span className="truncate">{m.name}</span>
              <span className="text-xs text-muted-foreground">{m.kind}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h1 className="text-lg font-semibold">#{channelName}</h1>
          <Button
            variant="outline"
            size="sm"
            aria-label={showMembers ? "Hide channel members" : "Show channel members"}
            onClick={() => setShowMembers(!showMembers)}
          >
            <Users className="size-4" />
            {members.length}
          </Button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col">
            <div className="flex-1 overflow-y-auto p-4">
              <div className="mx-auto max-w-3xl space-y-3">
                {messages.map((msg) => (
                  <div key={msg.id} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center gap-2 text-sm">
                      <span
                        className={`font-semibold ${
                          msg.senderType === "agent" ? "text-blue-600" : "text-green-600"
                        }`}
                      >
                        {msg.sender}
                      </span>
                      <span className="text-xs text-muted-foreground">{msg.time}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap">{msg.content}</p>
                  </div>
                ))}
                {messages.length === 0 && (
                  <p className="py-20 text-center text-muted-foreground">No messages in #{channelName} yet.</p>
                )}
              </div>
            </div>

            <div className="border-t p-4">
              <div className="mx-auto flex max-w-3xl gap-2">
                <Input
                  name="content"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a message..."
                  className="flex-1"
                />
                <button
                  type="button"
                  aria-label="Send message"
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all outline-none hover:bg-primary/90 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                >
                  <Send className="size-4" />
                </button>
              </div>
            </div>
          </div>

          {showMembers && (
            <aside
              aria-label="Channel members"
              className="w-64 shrink-0 border-l bg-muted/30 p-4 space-y-4 overflow-y-auto"
            >
              <h3 className="text-sm font-semibold">Members ({members.length})</h3>
              {members.map((m) => (
                <div
                  key={m.id}
                  data-testid={`channel-member-${m.name}`}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <span className={`size-2 rounded-full ${dotClass(m.status)}`} />
                    <span>{m.name}</span>
                    <span className="text-xs text-muted-foreground">{statusLabel(m.status)}</span>
                  </div>
                  {m.kind === "agent" && (
                    <button
                      aria-label={`Remove ${m.name}`}
                      onClick={() => handleRemoveMember(m.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              ))}

              <div className="border-t pt-3 space-y-2">
                <h4 className="text-xs font-medium uppercase text-muted-foreground">Add Member</h4>
                <div className="flex gap-2">
                  <select
                    aria-label="Add channel member"
                    data-testid="add-channel-member-select"
                    name="memberId"
                    ref={addMemberSelectRef}
                    className="flex-1 rounded-md border bg-background px-2 py-1 text-sm"
                  >
                    <option value="">Select...</option>
                    {allMembers
                      .filter((m) => !members.some((cm) => cm.id === m.id))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.kind})
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    aria-label="Add member to channel"
                    onClick={handleAddMember}
                    className="inline-flex h-7 shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 text-[0.8rem] font-medium text-primary-foreground transition-all outline-none hover:bg-primary/90 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
