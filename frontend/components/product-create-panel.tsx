"use client"

import { FormEvent, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Bot, HardDrive, Hash, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { API_BASE, PUBLIC_KEY, runtimeLabel, type Channel, type Computer, type Member } from "@/lib/control-plane"

type SubmitState = {
  error?: string
  command?: string
  token?: string
}

async function postJson(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Public-Key": PUBLIC_KEY },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Request failed: ${response.status}`)
  }
  return data
}

function fieldValue(form: FormData, key: string) {
  const value = form.get(key)
  return typeof value === "string" ? value.trim() : ""
}

export function ComputerConnectForm({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const [state, setState] = useState<SubmitState>({})
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setState({})
    const form = new FormData(event.currentTarget)
    try {
      const data = await postJson("/api/v1/computers/connect-command", {
        name: fieldValue(form, "name") || "New computer",
        os: fieldValue(form, "os") || "unknown",
        serverUrl: fieldValue(form, "serverUrl") || API_BASE,
      })
      setState({ command: data.command, token: data.machineToken })
      router.refresh()
      event.currentTarget.reset()
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Failed to create connect command" })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card size={compact ? "sm" : "default"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="size-4" />
          Connect computer
        </CardTitle>
        <CardDescription>Create a machine credential and daemon command.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onSubmit} className="grid gap-2 sm:grid-cols-[1fr_0.7fr_auto]">
          <Input name="name" placeholder="computer name" />
          <Input name="os" placeholder="macOS / Windows" />
          <input type="hidden" name="serverUrl" value={API_BASE} />
          <Button disabled={pending} type="submit">
            <Plus className="size-4" />
            Create
          </Button>
        </form>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.command && (
          <div className="space-y-2 rounded-md border bg-muted/40 p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Run on the target computer</div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-xs">{state.command}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AgentCreateForm({ computers, compact = false }: { computers: Computer[]; compact?: boolean }) {
  const router = useRouter()
  const [computerId, setComputerId] = useState(computers[0]?.id ?? "")
  const [state, setState] = useState<SubmitState>({})
  const [pending, setPending] = useState(false)

  const runtimeOptions = useMemo(() => {
    const selected = computers.find((computer) => computer.id === computerId)
    const detected = (selected?.detectedRuntimes ?? [])
      .map((runtime) => (typeof runtime === "string" ? runtime : runtime.type || runtime.command || runtimeLabel(runtime)))
      .filter(Boolean)
    return Array.from(new Set([...detected, "claude_code", "codex_cli", "custom"]))
  }, [computerId, computers])

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setState({})
    const form = new FormData(event.currentTarget)
    try {
      const data = await postJson("/api/v1/agents", {
        displayName: fieldValue(form, "displayName"),
        description: fieldValue(form, "description"),
        computerId: fieldValue(form, "computerId"),
        runtime: fieldValue(form, "runtime") || "claude_code",
        backend: fieldValue(form, "backend") || "Claude",
        runtimeModel: fieldValue(form, "runtimeModel"),
        cwd: fieldValue(form, "cwd"),
      })
      setState({ token: data.agentToken })
      router.refresh()
      event.currentTarget.reset()
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Failed to create agent" })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card size={compact ? "sm" : "default"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4" />
          Create agent
        </CardTitle>
        <CardDescription>Bind a new agent profile to a computer/runtime.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onSubmit} className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          <Input name="displayName" placeholder="agent handle, e.g. aaa" required />
          <select
            name="computerId"
            value={computerId}
            onChange={(event) => setComputerId(event.target.value)}
            className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm"
            required
          >
            {computers.map((computer) => (
              <option key={computer.id} value={computer.id}>
                {computer.name}
              </option>
            ))}
          </select>
          <select name="runtime" className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm">
            {runtimeOptions.map((runtime) => (
              <option key={runtime} value={runtime}>
                {runtime}
              </option>
            ))}
          </select>
          <Input name="backend" placeholder="backend label" defaultValue="Claude" />
          <Input name="runtimeModel" placeholder="model, optional" />
          <Input name="cwd" placeholder="workspace path, optional" />
          <Input name="description" placeholder="description" className="xl:col-span-2" />
          <Button disabled={pending || computers.length === 0} type="submit">
            <Plus className="size-4" />
            Create
          </Button>
        </form>
        {computers.length === 0 && <p className="text-sm text-muted-foreground">Connect a computer before creating agents.</p>}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        {state.token && (
          <p className="break-all rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
            Agent token created: {state.token}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

export function ChannelCreateForm({ members, compact = false }: { members: Member[]; compact?: boolean }) {
  const router = useRouter()
  const [state, setState] = useState<SubmitState>({})
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setState({})
    const form = new FormData(event.currentTarget)
    try {
      await postJson("/api/v1/channels", {
        name: fieldValue(form, "name"),
        description: fieldValue(form, "description"),
        memberIds: form.getAll("memberIds").map(String),
      })
      router.refresh()
      event.currentTarget.reset()
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Failed to create channel" })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card size={compact ? "sm" : "default"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Hash className="size-4" />
          Create channel
        </CardTitle>
        <CardDescription>Create a chat space and add people or agents.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
            <Input name="name" placeholder="channel-name" required />
            <Input name="description" placeholder="description" />
            <Button disabled={pending} type="submit">
              <Plus className="size-4" />
              Create
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <label key={member.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                <input name="memberIds" type="checkbox" value={member.id} />
                @{member.name}
                <span className="text-muted-foreground">[{member.kind}]</span>
              </label>
            ))}
          </div>
        </form>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  )
}

export function ChannelMemberAddForm({
  channels,
  members,
  compact = false,
}: {
  channels: Channel[]
  members: Member[]
  compact?: boolean
}) {
  const router = useRouter()
  const [state, setState] = useState<SubmitState>({})
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setState({})
    const form = new FormData(event.currentTarget)
    try {
      const channelRef = fieldValue(form, "channel")
      await postJson(`/api/v1/channels/${encodeURIComponent(channelRef)}/members`, {
        memberIds: form.getAll("memberIds").map(String),
      })
      router.refresh()
      event.currentTarget.reset()
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Failed to add members" })
    } finally {
      setPending(false)
    }
  }

  return (
    <Card size={compact ? "sm" : "default"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Plus className="size-4" />
          Add to channel
        </CardTitle>
        <CardDescription>Add created agents or humans to an existing channel.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <select name="channel" className="h-8 rounded-lg border border-input bg-background px-2.5 text-sm" required>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.rawName || channel.name.replace("#", "")}>
                  {channel.name}
                </option>
              ))}
            </select>
            <Button disabled={pending || channels.length === 0} type="submit">
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <label key={member.id} className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs">
                <input name="memberIds" type="checkbox" value={member.id} />
                @{member.name}
                <span className="text-muted-foreground">[{member.kind}]</span>
              </label>
            ))}
          </div>
        </form>
        {channels.length === 0 && <p className="text-sm text-muted-foreground">Create a channel before adding members.</p>}
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      </CardContent>
    </Card>
  )
}

export function ProductCreatePanel({
  computers,
  members,
  channels = [],
}: {
  computers: Computer[]
  members: Member[]
  channels?: Channel[]
}) {
  return (
    <div className="grid gap-3">
      <ComputerConnectForm compact />
      <AgentCreateForm computers={computers} compact />
      <ChannelCreateForm members={members} compact />
      <ChannelMemberAddForm channels={channels} members={members} compact />
    </div>
  )
}
