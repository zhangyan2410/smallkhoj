import Link from "next/link"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { Activity, CheckSquare, Hash, HardDrive, MessageSquare, Plus, Search } from "lucide-react"

import { ProductShell } from "@/components/product-shell"
import { EmptyState, RuntimeChip, Toolbar } from "@/components/product-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { apiGet, dotClass, statusLabel, type Computer, type Member } from "@/lib/control-plane"
import { requireCurrentAccount, serverApiHeaders } from "@/lib/server-auth"

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"

type Channel = {
  id: string
  name: string
  type: string
  description?: string
}

type Task = {
  id: string
  number: number
  title: string
  status: string
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

async function getTasks() {
  return apiGet<{ tasks: Task[] }>("/api/v1/tasks", { tasks: [] })
}

async function getComputers() {
  return apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] })
}

async function createChannelAction(formData: FormData) {
  "use server"
  const name = formData.get("channelName") as string
  if (!name) return
  await fetch(`${API_BASE}/api/v1/channels`, {
    method: "POST",
    headers: await serverApiHeaders(true),
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
    headers: await serverApiHeaders(true),
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
  const session = await requireCurrentAccount()
  const [{ channels }, { members }, { tasks }, { computers }] = await Promise.all([
    getChannels(),
    getMembers(),
    getTasks(),
    getComputers(),
  ])
  const agents = members.filter((member) => member.kind === "agent")
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "closed")
  const onlineComputers = computers.filter((computer) => computer.status === "online" || computer.status === "active")

  return (
    <ProductShell
      active="search"
      title="SmallKhoj Workbench"
      description="Search, chat, tasks, agents, and connected computers in one operational product surface."
      session={session}
      sidebarTitle="Quick Start"
      sidebarDescription="Create a channel or start a DM without leaving the workbench."
      sidebar={
        <div className="space-y-4">
          <form action={createChannelAction} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="channel-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                New Channel
              </label>
              <Input
                id="channel-name"
                name="channelName"
                placeholder="channel-name"
                required
              />
            </div>
            <Button type="submit" size="icon" aria-label="Create channel">
              <Plus className="size-4" />
            </Button>
          </form>
          <form action={createDmAction} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="dm-peer" className="mb-1 block text-xs font-medium text-muted-foreground">
                Start DM with
              </label>
              <select id="dm-peer" name="peer" required className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm">
                <option value="">Select member...</option>
                {agents.map((m) => (
                  <option key={m.id} value={m.name}>{m.name}</option>
                ))}
              </select>
            </div>
            <Button type="submit" size="icon" aria-label="Start DM">
              <MessageSquare className="size-4" />
            </Button>
          </form>
        </div>
      }
      actions={
        <>
          <Link href="/chat">
            <Button size="sm">
              <MessageSquare className="size-4" />
              Chat
            </Button>
          </Link>
          <Link href="/tasks">
            <Button variant="outline" size="sm">
              <CheckSquare className="size-4" />
              Tasks
            </Button>
          </Link>
        </>
      }
    >
      <div className="space-y-5">
        <Toolbar>
          <Search className="size-4 text-muted-foreground" />
          <Input aria-label="Global search" placeholder="Search channels, DMs, tasks, members, files..." disabled className="border-0 bg-transparent shadow-none focus-visible:ring-0" />
          <RuntimeChip>Search surface planned</RuntimeChip>
        </Toolbar>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Card size="sm">
            <CardHeader>
              <CardDescription>Channels</CardDescription>
              <CardTitle className="text-2xl">{channels.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Open Tasks</CardDescription>
              <CardTitle className="text-2xl">{openTasks.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Agents</CardDescription>
              <CardTitle className="text-2xl">{agents.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardDescription>Computers Online</CardDescription>
              <CardTitle className="text-2xl">{onlineComputers.length}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Hash className="size-4 text-primary" />
                Chat Spaces
              </CardTitle>
              <CardDescription>Channels and DMs are the fastest path into collaboration.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {channels.slice(0, 6).map((ch) => (
                <Link
                  key={ch.id}
                  href={`/chat/${channelPathSegment(ch.name)}`}
                  className="flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm transition-colors hover:bg-accent"
                >
                  <Hash className="size-4 text-cyan-700" />
                  <span className="min-w-0 flex-1 truncate font-medium">{ch.name}</span>
                  <span className="text-xs text-muted-foreground">{ch.type}</span>
                </Link>
              ))}
              {channels.length === 0 && (
                <EmptyState title="No channels yet" description="Create one from the quick start panel." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="size-4 text-primary" />
                Operational Attention
              </CardTitle>
              <CardDescription>Recent work and connected runtime capacity.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {openTasks.slice(0, 5).map((task) => (
                <Link key={task.id} href="/tasks" className="block rounded-md border bg-background px-3 py-2 hover:bg-accent">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">#{task.number}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                    <RuntimeChip className="border-sky-200 bg-sky-50 text-sky-700">{task.status}</RuntimeChip>
                  </div>
                </Link>
              ))}
              {openTasks.length === 0 && <EmptyState title="No open tasks" description="Create work from Tasks or Chat." />}
              <div className="grid gap-2 border-t pt-3">
                {computers.slice(0, 3).map((computer) => (
                  <Link key={computer.id} href="/computers" className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                    <span className={`size-2 rounded-full ${dotClass(computer.status)}`} />
                    <HardDrive className="size-4 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-sm">{computer.name}</span>
                    <span className="text-xs text-muted-foreground">{statusLabel(computer.status)}</span>
                  </Link>
                ))}
                {computers.length === 0 && <div className="text-sm text-muted-foreground">No computers registered.</div>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ProductShell>
  )
}
