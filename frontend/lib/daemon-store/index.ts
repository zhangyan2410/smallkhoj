/**
 * Daemon In-Memory Store (MVP)
 * Minimal objects: agents, channels, messages, events, tasks
 * Replace with database when backend data structure is finalized
 */

export interface Agent {
  id: string
  name: string
  displayName: string
  status: "online" | "idle" | "offline"
  role: string
  backend: string
}

export interface Channel {
  id: string
  name: string
  description: string
  type: "public" | "private"
  joined: string[] // agent IDs
}

export interface Message {
  id: string
  target: string
  sender: string
  content: string
  timestamp: string
  type: "human" | "agent" | "system"
}

export interface Event {
  id: string
  type: "message" | "task_claimed" | "task_updated" | "connected" | "disconnected"
  payload: Record<string, unknown>
  timestamp: string
  seq: number
}

export interface Task {
  id: number
  title: string
  status: "todo" | "in_progress" | "in_review" | "done"
  assignee?: string
  channel: string
  createdAt: string
}

// Event subscriber type
type EventSubscriber = (event: Event) => void

// Use globalThis to survive Next.js dev HMR module reloads
const GLOBAL_KEY = "__daemon_store_singleton__"
const CURSOR_KEY = "__daemon_cursor_singleton__"
const SUBS_KEY = "__daemon_subs_singleton__"

function getGlobalStore(): DaemonStore | undefined {
  return (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] as DaemonStore
}

function setGlobalStore(store: DaemonStore): void {
  (globalThis as unknown as Record<string, unknown>)[GLOBAL_KEY] = store
}

function getGlobalCursors(): Map<string, number> | undefined {
  return (globalThis as unknown as Record<string, unknown>)[CURSOR_KEY] as Map<string, number>
}

function setGlobalCursors(cursors: Map<string, number>): void {
  (globalThis as unknown as Record<string, unknown>)[CURSOR_KEY] = cursors
}

function getGlobalSubs(): Set<EventSubscriber> | undefined {
  return (globalThis as unknown as Record<string, unknown>)[SUBS_KEY] as Set<EventSubscriber>
}

function setGlobalSubs(subs: Set<EventSubscriber>): void {
  (globalThis as unknown as Record<string, unknown>)[SUBS_KEY] = subs
}

// In-memory store
class DaemonStore {
  agents: Map<string, Agent> = new Map()
  channels: Map<string, Channel> = new Map()
  messages: Message[] = []
  events: Event[] = []
  tasks: Map<number, Task> = new Map()
  private seqCounter = 0

  constructor() {
    // Seed data
    this.agents.set("aaa", {
      id: "aaa",
      name: "aaa",
      displayName: "aaa — test",
      status: "online",
      role: "test",
      backend: "Kimi",
    })
    this.agents.set("deepseek", {
      id: "deepseek",
      name: "deepseek",
      displayName: "deepseek",
      status: "online",
      role: "assistant",
      backend: "Claude",
    })
    this.agents.set("codex-mac", {
      id: "codex-mac",
      name: "codex-mac",
      displayName: "codex-mac",
      status: "offline",
      role: "coder",
      backend: "Codex",
    })

    this.channels.set("all", {
      id: "all",
      name: "#all",
      description: "General channel for all members",
      type: "public",
      joined: ["aaa", "deepseek"],
    })
    this.channels.set("window", {
      id: "window",
      name: "#window",
      description: "Development workspace",
      type: "public",
      joined: ["aaa", "deepseek"],
    })

    this.tasks.set(1, {
      id: 1,
      title: "整理本周 daemon 开发进度，输出一份简报",
      status: "done",
      assignee: "aaa",
      channel: "#window",
      createdAt: "2026-06-01T14:09:56Z",
    })
    this.tasks.set(2, {
      id: 2,
      title: "WebBridge twd.py token 认证",
      status: "in_review",
      assignee: "aaa",
      channel: "#window",
      createdAt: "2026-06-01T14:10:52Z",
    })
    this.tasks.set(4, {
      id: 4,
      title: "写 daemon MVP 网站",
      status: "in_progress",
      assignee: "aaa",
      channel: "#window",
      createdAt: "2026-06-01T20:40:13Z",
    })
  }

  subscribers: Set<EventSubscriber> = getGlobalSubs() || new Set()

  subscribe(fn: EventSubscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private emit(event: Event): void {
    for (const fn of this.subscribers) {
      try { fn(event) } catch { /* ignore subscriber errors */ }
    }
  }

  nextSeq(): number {
    return ++this.seqCounter
  }

  addMessage(msg: Omit<Message, "id" | "timestamp">): Message {
    const message: Message = {
      ...msg,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    }
    this.messages.push(message)

    // Also create an event
    const event: Event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "message",
      payload: { message },
      timestamp: message.timestamp,
      seq: this.nextSeq(),
    }
    this.events.push(event)
    this.emit(event)

    return message
  }

  getEvents(since?: number): { events: Event[]; nextCursor: number } {
    const sinceSeq = since ?? 0
    const filtered = this.events.filter((e) => e.seq > sinceSeq)
    const nextCursor = filtered.length > 0 ? filtered[filtered.length - 1].seq : sinceSeq
    return { events: filtered, nextCursor }
  }

  getHistory(channel: string, limit = 50): Message[] {
    return this.messages
      .filter((m) => m.target === channel || m.target.startsWith(`${channel}:`))
      .slice(-limit)
  }

  claimTask(taskId: number, agentId: string): Task | null {
    const task = this.tasks.get(taskId)
    if (!task) return null
    if (task.assignee) return null  // Already claimed by anyone
    task.status = "in_progress"
    task.assignee = agentId

    this.events.push({
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "task_claimed",
      payload: { taskId, assignee: agentId },
      timestamp: new Date().toISOString(),
      seq: this.nextSeq(),
    })

    return task
  }

  claimTaskByNumber(taskNumber: number, channel: string, agentId: string): Task | null {
    // Find task by number (id) and optional channel filter
    const task = this.tasks.get(taskNumber)
    if (!task) return null
    if (channel && task.channel !== channel) return null
    if (task.assignee) return null
    task.status = "in_progress"
    task.assignee = agentId

    const event: Event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "task_claimed",
      payload: { taskId: taskNumber, assignee: agentId, channel },
      timestamp: new Date().toISOString(),
      seq: this.nextSeq(),
    }
    this.events.push(event)
    this.emit(event)

    return task
  }

  updateTaskStatus(taskId: number, status: Task["status"], agentId: string): Task | null {
    const task = this.tasks.get(taskId)
    if (!task) return null
    if (task.assignee !== agentId) return null
    task.status = status

    const event: Event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "task_updated",
      payload: { taskId, status, assignee: agentId },
      timestamp: new Date().toISOString(),
      seq: this.nextSeq(),
    }
    this.events.push(event)
    this.emit(event)

    return task
  }

  getServerInfo() {
    return {
      serverId: "local-mvp",
      version: "0.1.0",
      channels: Array.from(this.channels.values()),
      agents: Array.from(this.agents.values()),
      humans: [{ id: "zy-ean", name: "zy-ean" }],
    }
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case "online": return "bg-green-500"
    case "idle": return "bg-yellow-500"
    case "offline": return "bg-gray-400"
    case "todo": return "bg-slate-400"
    case "in_progress": return "bg-blue-500"
    case "in_review": return "bg-amber-500"
    case "done": return "bg-green-500"
    default: return "bg-gray-400"
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case "todo": return "待办"
    case "in_progress": return "进行中"
    case "in_review": return "审核中"
    case "done": return "已完成"
    default: return status
  }
}

// Per-agent consumed cursor tracking
function getCursors(): Map<string, number> {
  let cursors = getGlobalCursors()
  if (!cursors) {
    cursors = new Map<string, number>()
    setGlobalCursors(cursors)
  }
  return cursors
}

export function getAgentCursor(agentId: string): number | undefined {
  return getCursors().get(agentId)
}

export function setAgentCursor(agentId: string, cursor: number): void {
  getCursors().set(agentId, cursor)
}

export function hasAgentCursor(agentId: string): boolean {
  return getCursors().has(agentId)
}

// Singleton instance — survives HMR via globalThis
let storeInstance = getGlobalStore()
if (!storeInstance) {
  storeInstance = new DaemonStore()
  setGlobalStore(storeInstance)
}
export const store = storeInstance

// Ensure subscribers survive HMR
let globalSubs = getGlobalSubs()
if (!globalSubs) {
  globalSubs = new Set<EventSubscriber>()
  setGlobalSubs(globalSubs)
}
storeInstance.subscribers = globalSubs
