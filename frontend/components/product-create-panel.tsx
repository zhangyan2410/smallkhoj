"use client"

import { FormEvent, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Bot, HardDrive, Hash, Plus } from "lucide-react"

import { AttachmentSheet, InkframeObjectSurface, ObjectToggleField } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { API_BASE, PUBLIC_KEY, PUBLIC_RUNTIME_ENV, runtimeLabel, type Channel, type Computer, type Member } from "@/lib/control-plane"
import { resolvePublicApiBase } from "@/lib/runtime-url"

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

function publicRuntimeValue(value: string) {
  const runtime = value.trim()
  if (runtime === "codex_acp" || runtime === "codex-acp" || runtime === "codex_cli") return "codex"
  return runtime
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
        serverUrl: fieldValue(form, "serverUrl") || resolvePublicApiBase(PUBLIC_RUNTIME_ENV),
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
          <Button disabled={pending} type="submit">
            <Plus className="size-4" />
            Create
          </Button>
        </form>
        {state.error && (
          <InkframeObjectSurface material="blocked" className="px-2 py-1.5 text-sm text-destructive">
            {state.error}
          </InkframeObjectSurface>
        )}
        {state.command && (
          <InkframeObjectSurface material="drying" className="space-y-2 p-3">
            <div className="text-xs font-medium uppercase text-muted-foreground">Run on the target computer</div>
            <AttachmentSheet kind="proof" className="p-2">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-xs">{state.command}</pre>
            </AttachmentSheet>
          </InkframeObjectSurface>
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
      .map((runtime) => publicRuntimeValue(typeof runtime === "string" ? runtime : runtime.type || runtime.command || runtimeLabel(runtime)))
      .filter(Boolean)
    return Array.from(new Set([...detected, "claude_code", "codex", "custom"]))
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
          <Select
            id="agent-computer"
            name="computerId"
            items={computers.map((computer) => `${computer.id}|${computer.name}`)}
            splitValue
            value={computerId}
            onChange={(event) => setComputerId(event.target.value)}
            required
          />
          <Select
            id="agent-runtime"
            name="runtime"
            items={runtimeOptions.map((runtime) => `${runtime}|${runtimeLabel(runtime)}`)}
            splitValue
            fallback="claude_code|Claude Code"
          />
          <Input name="backend" placeholder="backend label" defaultValue="Claude" />
          <Input name="runtimeModel" placeholder="model, optional" />
          <Input name="cwd" placeholder="workspace path, optional" />
          <Input name="description" placeholder="description" className="xl:col-span-2" />
          <Button disabled={pending || computers.length === 0} type="submit">
            <Plus className="size-4" />
            Create
          </Button>
        </form>
        {computers.length === 0 && (
          <InkframeObjectSurface material="dry" className="px-2 py-1.5 text-sm text-muted-foreground">
            Connect a computer before creating agents.
          </InkframeObjectSurface>
        )}
        {state.error && (
          <InkframeObjectSurface material="blocked" className="px-2 py-1.5 text-sm text-destructive">
            {state.error}
          </InkframeObjectSurface>
        )}
        {state.token && (
          <AttachmentSheet kind="proof" className="break-all p-2 text-xs text-muted-foreground">
            Agent token created: {state.token}
          </AttachmentSheet>
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
              <ObjectToggleField key={member.id} className="text-xs">
                <input name="memberIds" type="checkbox" value={member.id} />
                @{member.name}
                <span className="text-muted-foreground">[{member.kind}]</span>
              </ObjectToggleField>
            ))}
          </div>
        </form>
        {state.error && (
          <InkframeObjectSurface material="blocked" className="px-2 py-1.5 text-sm text-destructive">
            {state.error}
          </InkframeObjectSurface>
        )}
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
            <Select
              id="channel-member-channel"
              name="channel"
              items={channels.map((channel) => `${channel.rawName || channel.name.replace("#", "")}|${channel.name}`)}
              splitValue
              required
            />
            <Button disabled={pending || channels.length === 0} type="submit">
              Add
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map((member) => (
              <ObjectToggleField key={member.id} className="text-xs">
                <input name="memberIds" type="checkbox" value={member.id} />
                @{member.name}
                <span className="text-muted-foreground">[{member.kind}]</span>
              </ObjectToggleField>
            ))}
          </div>
        </form>
        {channels.length === 0 && (
          <InkframeObjectSurface material="dry" className="px-2 py-1.5 text-sm text-muted-foreground">
            Create a channel before adding members.
          </InkframeObjectSurface>
        )}
        {state.error && (
          <InkframeObjectSurface material="blocked" className="px-2 py-1.5 text-sm text-destructive">
            {state.error}
          </InkframeObjectSurface>
        )}
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
