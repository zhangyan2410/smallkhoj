"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeft, AtSign, Hash, MessageCircle, Plus, Send, Trash2, Users, X } from "lucide-react"

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
type DmInfo = {
  id: string
  name: string
  type: "dm"
  displayName: string
  peer?: Member | null
}
type ThreadSummary = {
  summary?: string | null
  status?: string | null
}
type ChannelMessage = {
  id: string
  shortId?: string
  seq: number
  sender: string
  senderType: string
  content: string
  time: string
  parentId?: string | null
  threadId?: string
  threadShortId?: string | null
  replyCount?: number
  threadSummary?: ThreadSummary | null
}
type ThreadData = {
  thread?: ChannelMessage
  replies?: ChannelMessage[]
  messages?: ChannelMessage[]
  replyCount?: number
  threadSummary?: ThreadSummary | null
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
  initialDms = [],
  initialChannelId = "",
}: {
  initialChannel: string
  initialMessages?: ChannelMessage[]
  initialMembers?: Member[]
  initialAllMembers?: Member[]
  initialChannels?: ChannelInfo[]
  initialDms?: DmInfo[]
  initialChannelId?: string
}) {
  const [channelName, setChannelName] = useState(initialChannel)
  const [messages, setMessages] = useState<ChannelMessage[]>(initialMessages)
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [allMembers, setAllMembers] = useState<Member[]>(initialAllMembers)
  const [channels, setChannels] = useState<ChannelInfo[]>(initialChannels)
  const [dms, setDms] = useState<DmInfo[]>(initialDms)
  const [input, setInput] = useState("")
  const [threadInput, setThreadInput] = useState("")
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [threadData, setThreadData] = useState<ThreadData | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [showMembers, setShowMembers] = useState(true)
  const [channelId, setChannelId] = useState(initialChannelId)
  const addMemberSelectRef = useRef<HTMLSelectElement>(null)

  const currentChannel = channels.find((c) => c.name.replace("#", "") === channelName)
  const currentDm = dms.find((dm) => dm.name === channelName)
  const currentTitle = currentDm?.displayName ?? (currentChannel?.name ?? `#${channelName}`)
  const currentIsDm = Boolean(currentDm)

  useEffect(() => {
    let cancelled = false
    async function loadChannel() {
      const decodedChannel = initialChannel
      const encodedChannel = channelPathSegment(decodedChannel)
      setChannelName(decodedChannel)
      setActiveThreadId(null)
      setThreadData(null)
      const h = { "X-Public-Key": PUBLIC_KEY }
      const msgsRes = await fetch(`${API_BASE}/api/v1/channels/${encodedChannel}/messages?limit=50&threadMode=roots`, { headers: h })
      if (msgsRes.ok) { const d = await msgsRes.json(); if (!cancelled) setMessages(d.messages || []) }
      const [chsRes, dmsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/channels`, { headers: h }),
        fetch(`${API_BASE}/api/v1/dms`, { headers: h }),
      ])
      let match: ChannelInfo | DmInfo | undefined
      if (chsRes.ok) {
        const d = await chsRes.json()
        const chs = (d.channels || []) as ChannelInfo[]
        if (!cancelled) setChannels(chs)
        match = chs.find((c) => c.name.replace("#", "") === decodedChannel)
      }
      if (dmsRes.ok) {
        const d = await dmsRes.json()
        const loadedDms = (d.dms || []) as DmInfo[]
        if (!cancelled) setDms(loadedDms)
        match = match ?? loadedDms.find((dm) => dm.name === decodedChannel)
      }
      if (match && !cancelled) {
        setChannelId(match.id)
        const mRes = await fetch(`${API_BASE}/api/v1/channels/${match.id}/members`, { headers: h })
        if (mRes.ok) { const md = await mRes.json(); if (!cancelled) setMembers(md.members || []) }
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
      `/api/v1/channels/${encodedChannel}/messages?limit=50&threadMode=roots`,
      { messages: [] },
    )
    setMessages(data.messages || [])
  }

  async function refreshThread(threadId = activeThreadId) {
    if (!threadId) return
    setThreadLoading(true)
    try {
      const data = await apiGet<ThreadData>(`/api/v1/threads/${encodeURIComponent(threadId)}`, {})
      setThreadData(data)
    } finally {
      setThreadLoading(false)
    }
  }

  async function openThread(message: ChannelMessage) {
    const threadId = message.threadId || message.id
    setActiveThreadId(threadId)
    await refreshThread(threadId)
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

  async function handleThreadSend() {
    if (!threadInput.trim() || !activeThreadId) return
    try {
      const encodedChannel = channelPathSegment(channelName)
      await apiPost(`/api/v1/channels/${encodedChannel}/messages`, {
        content: threadInput.trim(),
        sender: "zy-ean",
        threadId: activeThreadId,
      })
      setThreadInput("")
      await Promise.all([refreshMessages(), refreshThread(activeThreadId)])
    } catch (e) {
      console.error("Thread reply failed:", e)
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

  function handleThreadKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleThreadSend()
    }
  }

  const activeRoot = threadData?.thread
  const activeReplies = threadData?.replies ?? (threadData?.messages || []).filter((msg) => msg.parentId)

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
                <span className="inline-flex items-center gap-1">
                  <Hash className="size-3" />
                  {ch.name.replace("#", "")}
                </span>
              </Link>
            ))}
          </div>
          <h3 className="mb-2 mt-5 text-xs font-medium uppercase text-muted-foreground">DMs</h3>
          <div className="space-y-1">
            {dms.map((dm) => (
              <Link
                key={dm.id}
                href={`/chat/${channelPathSegment(dm.name)}`}
                className={`block truncate rounded px-2 py-1 text-sm ${
                  dm.name === channelName ? "bg-accent font-medium" : "hover:bg-accent/50"
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <AtSign className="size-3" />
                  {dm.peer?.displayName || dm.peer?.name || dm.displayName.replace(/^DM @/, "")}
                </span>
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
          <h1 className="truncate text-lg font-semibold">{currentTitle}</h1>
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
                    {(msg.replyCount || msg.threadSummary) && (
                      <div className="mt-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                        {msg.threadSummary?.summary && (
                          <p className="mb-2 text-muted-foreground">{msg.threadSummary.summary}</p>
                        )}
                        <button
                          type="button"
                          onClick={() => openThread(msg)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
                        >
                          <MessageCircle className="size-3" />
                          {msg.replyCount ? `${msg.replyCount} replies` : "Reply"}
                        </button>
                      </div>
                    )}
                    {!msg.replyCount && !msg.threadSummary && (
                      <button
                        type="button"
                        onClick={() => openThread(msg)}
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        <MessageCircle className="size-3" />
                        Reply
                      </button>
                    )}
                  </div>
                ))}
                {messages.length === 0 && (
                  <p className="py-20 text-center text-muted-foreground">No messages in {currentTitle} yet.</p>
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

          {activeThreadId && (
            <aside aria-label="Thread" className="w-96 shrink-0 border-l bg-background p-4">
              <div className="flex h-full flex-col">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">Thread</h2>
                    {activeRoot && <p className="truncate text-xs text-muted-foreground">{activeRoot.sender}</p>}
                  </div>
                  <button
                    type="button"
                    aria-label="Close thread"
                    onClick={() => {
                      setActiveThreadId(null)
                      setThreadData(null)
                    }}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border hover:bg-accent"
                  >
                    <X className="size-4" />
                  </button>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                  {activeRoot && (
                    <div className="rounded-md border bg-card p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`font-semibold ${activeRoot.senderType === "agent" ? "text-blue-600" : "text-green-600"}`}>
                          {activeRoot.sender}
                        </span>
                        <span className="text-xs text-muted-foreground">{activeRoot.time}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{activeRoot.content}</p>
                      {threadData?.threadSummary?.summary && (
                        <p className="mt-3 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                          {threadData.threadSummary.summary}
                        </p>
                      )}
                    </div>
                  )}

                  {threadLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>}
                  {activeReplies.map((msg) => (
                    <div key={msg.id} className="rounded-md border bg-card p-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`font-semibold ${msg.senderType === "agent" ? "text-blue-600" : "text-green-600"}`}>
                          {msg.sender}
                        </span>
                        <span className="text-xs text-muted-foreground">{msg.time}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-sm">{msg.content}</p>
                    </div>
                  ))}
                  {!threadLoading && activeReplies.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">No replies yet.</p>
                  )}
                </div>

                <div className="mt-3 flex gap-2 border-t pt-3">
                  <Input
                    value={threadInput}
                    onChange={(e) => setThreadInput(e.target.value)}
                    onKeyDown={handleThreadKeyDown}
                    placeholder="Reply in thread..."
                    className="flex-1"
                  />
                  <button
                    type="button"
                    aria-label="Send thread reply"
                    onClick={handleThreadSend}
                    disabled={!threadInput.trim()}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-primary px-2.5 text-sm font-medium text-primary-foreground transition-all outline-none hover:bg-primary/90 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                  >
                    <Send className="size-4" />
                  </button>
                </div>
              </div>
            </aside>
          )}

          {!activeThreadId && showMembers && (
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
                  {m.kind === "agent" && !currentIsDm && (
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

              {!currentIsDm && (
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
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
