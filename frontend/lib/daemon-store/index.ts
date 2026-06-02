/**
 * Daemon In-Memory Store (MVP v2)
 * Upgraded data structures based on slock-detail-spec.md
 * Replace with database when backend data structure is finalized
 */

// ---------------------------------------------------------------------------
// 1. Type Definitions
// ---------------------------------------------------------------------------

/** Top-level isolation unit */
export interface Server {
  id: string
  name: string
  ownerId: string
  createdAt: string
  updatedAt: string
  version: string
}

/** Physical machine running a Daemon */
export interface Computer {
  id: string
  serverId: string
  name: string
  os: string
  daemonVersion: string
  apiKey: string
  status: ComputerStatus
  detectedRuntimes: DetectedRuntime[]
  agentWorkspaces: AgentWorkspace[]
  createdAt: string
  updatedAt: string
  lastHeartbeatAt?: string
}

export type ComputerStatus = "online" | "offline" | "idle"

export interface DetectedRuntime {
  type: RuntimeType
  version?: string
  executablePath?: string
  status: "available" | "running" | "error"
}

export type RuntimeType = "claude_code" | "codex_cli" | "opencode" | "kimi_cli" | "custom"

export interface AgentWorkspace {
  id: string
  computerId: string
  agentId: string
  runtime: RuntimeType
  runtimeCommand?: string
  runtimeModel?: string
  status: AgentWorkspaceStatus
  sessionId?: string
  cwd?: string
  pid?: number
  startedAt?: string
  stoppedAt?: string
}

export type AgentWorkspaceStatus = "starting" | "running" | "idle" | "stopped" | "crashed" | "restarting"

// --- Member (Human | Agent) ---

export type Member = HumanMember | AgentMember

interface MemberBase {
  id: string
  serverId: string
  displayName: string
  description?: string
  avatarUrl?: string
  status: MemberStatus
  role: MemberRole
  createdAt: string
  updatedAt: string
}

export type MemberStatus = "online" | "idle" | "offline" | "suspended"
export type MemberRole = "owner" | "admin" | "member" | "guest"

export interface HumanMember extends MemberBase {
  kind: "human"
  email?: string
}

export interface AgentMember extends MemberBase {
  kind: "agent"
  computerId: string
  workspaceId?: string
  backend: string
  profile: AgentProfile
  permissions: AgentPermissions
  actions: AgentActions
}

export interface AgentProfile {
  skills: Skill[]
  systemInfo?: Record<string, string>
  workspaceConfig?: string
  apps: AppIntegration[]
}

export interface Skill {
  name: string
  description?: string
  enabled: boolean
  config?: Record<string, unknown>
}

export interface AppIntegration {
  service: string
  connected: boolean
  scopes?: string[]
  connectedAt?: string
}

export interface AgentActions {
  paused: boolean
  pausedAt?: string
  pausedBy?: string
  autoRestart: boolean
}

export interface AgentPermissions {
  fileRead: boolean
  fileWrite: boolean
  commandExecution: boolean
  networkAccess: boolean
  sendMessage: boolean
  createTask: boolean
  claimTask: boolean
  inviteMember: boolean
  manageChannel: boolean
  customPermissions?: Record<string, boolean>
}

// --- Channel ---

export interface Channel {
  id: string
  serverId: string
  name: string
  description?: string
  type: ChannelType
  creatorId: string
  members: ChannelMember[]
  createdAt: string
  updatedAt: string
  lastMessageAt?: string
  unreadCount?: number
}

export type ChannelType = "public" | "private" | "dm"

export interface ChannelMember {
  memberId: string
  joinedAt: string
  role: ChannelRole
  lastReadSeq?: number
  muted: boolean
}

export type ChannelRole = "admin" | "member" | "guest"

// --- Message ---

export interface Message {
  id: string
  shortId?: string
  serverId: string
  channelId: string
  target: string
  sender: string
  senderType: SenderType
  content: string
  contentType: ContentType
  attachments?: Attachment[]
  threadId?: string
  channelType?: ChannelDeliveryType
  channelName?: string
  reactions?: Reaction[]
  mentions?: string[]
  seq: number
  createdAt: string
  updatedAt?: string
  editedAt?: string
}

export type SenderType = "human" | "agent" | "system"
export type ContentType = "text" | "markdown" | "code" | "rich"
export type ChannelDeliveryType = "channel" | "dm" | "thread"

export interface Reaction {
  emoji: string
  memberId: string
  createdAt: string
}

export interface Attachment {
  id: string
  messageId: string
  fileName: string
  mimeType: string
  size: number
  url: string
  previewUrl?: string
  uploadedBy: string
  createdAt: string
}

// --- Thread ---

export interface Thread {
  id: string
  channelId: string
  rootMessageId: string
  replyCount: number
  lastReplyAt?: string
  participants: string[]
}

// --- Task ---

export interface Task {
  id: string
  number: number
  serverId: string
  channelId: string
  channelName: string
  title: string
  description?: string
  status: TaskStatus
  priority?: TaskPriority
  creatorId: string
  creatorType: SenderType
  assigneeId?: string
  messageId?: string
  threadId?: string
  tags?: string[]
  data?: Record<string, unknown>
  statusHistory: StatusTransition[]
  createdAt: string
  updatedAt: string
  completedAt?: string
  closedAt?: string
  closedBy?: string
}

export type TaskStatus = "todo" | "in_progress" | "in_review" | "done" | "closed"
export type TaskPriority = "low" | "medium" | "high" | "urgent"

export interface StatusTransition {
  from: TaskStatus
  to: TaskStatus
  changedBy: string
  changedAt: string
  reason?: string
}

// --- File ---

export interface FileEntry {
  id: string
  serverId: string
  channelId: string
  messageId?: string
  uploadedBy: string
  fileName: string
  originalName: string
  mimeType: string
  size: number
  storagePath: string
  url: string
  previewUrl?: string
  thumbnailUrl?: string
  metadata?: FileMetadata
  createdAt: string
}

export interface FileMetadata {
  width?: number
  height?: number
  duration?: number
  pages?: number
}

// --- ActivityLog ---

export interface ActivityLog {
  id: string
  serverId: string
  agentId: string
  type: ActivityType
  description: string
  details?: ActivityDetails
  channelId?: string
  taskId?: string
  timestamp: string
}

export type ActivityType =
  | "command_executed"
  | "file_read"
  | "file_modified"
  | "file_created"
  | "file_deleted"
  | "message_sent"
  | "message_received"
  | "task_claimed"
  | "task_completed"
  | "task_status_changed"
  | "channel_joined"
  | "channel_left"
  | "agent_started"
  | "agent_stopped"
  | "agent_error"
  | "permission_denied"
  | "integration_connected"
  | "custom"

export interface ActivityDetails {
  command?: string
  exitCode?: number
  filePath?: string
  fileSize?: number
  messageSnippet?: string
  error?: string
  metadata?: Record<string, unknown>
}

// --- ServerEvent (typed event union) ---

export type ServerEvent =
  | MessageEvent
  | TaskEvent
  | MemberEvent
  | ChannelEvent
  | FileEvent
  | ActivityEvent
  | ConnectionEvent
  | ErrorEvent

export interface MessageEvent {
  type: "message.created" | "message.updated" | "message.deleted" | "message.reaction"
  payload: {
    message: Message
    channelId: string
  }
  seq: number
  timestamp: string
}

export interface TaskEvent {
  type: "task.created" | "task.claimed" | "task.updated" | "task.completed" | "task.closed"
  payload: {
    taskId: string
    taskNumber?: number
    channel: string
    assigneeId?: string
    status?: TaskStatus
    previousStatus?: TaskStatus
    changedBy: string
  }
  seq: number
  timestamp: string
}

export interface MemberEvent {
  type: "member.joined" | "member.left" | "member.status_changed" | "member.profile_updated" | "member.permissions_changed"
  payload: {
    memberId: string
    status?: MemberStatus
    changes?: Record<string, unknown>
  }
  seq: number
  timestamp: string
}

export interface ChannelEvent {
  type: "channel.created" | "channel.member_joined" | "channel.member_left"
  payload: {
    channelId: string
    channelName: string
    memberId?: string
  }
  seq: number
  timestamp: string
}

export interface FileEvent {
  type: "file.uploaded" | "file.deleted"
  payload: {
    fileId: string
    channelId: string
    uploadedBy: string
  }
  seq: number
  timestamp: string
}

export interface ActivityEvent {
  type: "activity.log"
  payload: ActivityLog
  seq: number
  timestamp: string
}

export interface ConnectionEvent {
  type: "connected" | "disconnected"
  payload: {
    agentId?: string
    computerId?: string
    reason?: string
  }
  seq: number
  timestamp: string
}

export interface ErrorEvent {
  type: "error"
  payload: {
    error: string
    code: string
    details?: Record<string, unknown>
  }
  seq: number
  timestamp: string
}

// --- Backward-compatible legacy Event shape for existing consumers ---
export interface Event {
  id: string
  type: string
  payload: Record<string, unknown>
  timestamp: string
  seq: number
}

// Event subscriber type
type EventSubscriber = (event: ServerEvent) => void

// --- Legacy Agent interface for backward compatibility ---
export interface Agent {
  id: string
  name: string
  displayName: string
  status: "online" | "idle" | "offline"
  role: string
  backend: string
}

// ---------------------------------------------------------------------------
// 2. globalThis helpers (HMR survival)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 3. ID generation
// ---------------------------------------------------------------------------

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// 4. Default agent permissions (spec: all enabled by default)
// ---------------------------------------------------------------------------

const DEFAULT_AGENT_PERMISSIONS: AgentPermissions = {
  fileRead: true,
  fileWrite: true,
  commandExecution: true,
  networkAccess: true,
  sendMessage: true,
  createTask: true,
  claimTask: true,
  inviteMember: false,
  manageChannel: false,
}

// ---------------------------------------------------------------------------
// 5. DaemonStore class
// ---------------------------------------------------------------------------

const SERVER_ID = "local-mvp"
const NOW = new Date().toISOString()

class DaemonStore {
  // Core data
  server: Server
  computers: Map<string, Computer> = new Map()
  members: Map<string, Member> = new Map()
  channels: Map<string, Channel> = new Map()
  messages: Map<string, Message> = new Map()
  threads: Map<string, Thread> = new Map()
  tasks: Map<string, Task> = new Map()
  files: Map<string, FileEntry> = new Map()
  activityLogs: ActivityLog[] = []
  events: ServerEvent[] = []
  private seqCounter = 0
  private taskNumberCounter = 0

  subscribers: Set<EventSubscriber> = getGlobalSubs() || new Set()

  constructor() {
    this.server = {
      id: SERVER_ID,
      name: "Local MVP",
      ownerId: "member_zy_ean",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: NOW,
      version: "0.2.0",
    }

    // --- Seed: Computer ---
    this.computers.set("comp_mac", {
      id: "comp_mac",
      serverId: SERVER_ID,
      name: "zhangyan-ean",
      os: "darwin 24.5.0",
      daemonVersion: "0.3.0",
      apiKey: "sk_machine_mvp_local",
      status: "online",
      detectedRuntimes: [
        { type: "claude_code", version: "1.0.0", status: "running" },
        { type: "codex_cli", version: "0.1.0", status: "available" },
      ],
      agentWorkspaces: [
        {
          id: "ws_aaa",
          computerId: "comp_mac",
          agentId: "agent_aaa",
          runtime: "claude_code",
          status: "running",
          cwd: "/Users/code/project/smallkhoj",
          startedAt: "2026-06-01T08:00:00Z",
        },
        {
          id: "ws_codex",
          computerId: "comp_mac",
          agentId: "agent_codex_mac",
          runtime: "codex_cli",
          status: "idle",
          cwd: "/Users/code/project/smallkhoj",
          startedAt: "2026-06-01T09:00:00Z",
        },
      ],
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: NOW,
      lastHeartbeatAt: NOW,
    })

    // --- Seed: Members ---
    // Human
    this.members.set("member_zy_ean", {
      kind: "human",
      id: "member_zy_ean",
      serverId: SERVER_ID,
      displayName: "zy-ean",
      status: "online",
      role: "owner",
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: NOW,
    })

    // Agent: aaa
    this.members.set("agent_aaa", {
      kind: "agent",
      id: "agent_aaa",
      serverId: SERVER_ID,
      displayName: "aaa — test",
      description: "Test Agent",
      status: "online",
      role: "member",
      computerId: "comp_mac",
      workspaceId: "ws_aaa",
      backend: "Claude",
      profile: {
        skills: [{ name: "code-review", description: "Code review and suggestions", enabled: true }],
        apps: [],
      },
      permissions: { ...DEFAULT_AGENT_PERMISSIONS },
      actions: { paused: false, autoRestart: true },
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: NOW,
    })

    // Agent: deepseek
    this.members.set("agent_deepseek", {
      kind: "agent",
      id: "agent_deepseek",
      serverId: SERVER_ID,
      displayName: "deepseek",
      description: "DeepSeek Assistant",
      status: "online",
      role: "member",
      computerId: "comp_mac",
      backend: "Claude",
      profile: {
        skills: [{ name: "assistant", description: "General assistant", enabled: true }],
        apps: [],
      },
      permissions: { ...DEFAULT_AGENT_PERMISSIONS },
      actions: { paused: false, autoRestart: true },
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: NOW,
    })

    // Agent: codex-mac
    this.members.set("agent_codex_mac", {
      kind: "agent",
      id: "agent_codex_mac",
      serverId: SERVER_ID,
      displayName: "codex-mac",
      description: "Codex Coder Agent",
      status: "offline",
      role: "member",
      computerId: "comp_mac",
      workspaceId: "ws_codex",
      backend: "Codex",
      profile: {
        skills: [{ name: "coding", description: "Autonomous coding", enabled: true }],
        apps: [],
      },
      permissions: { ...DEFAULT_AGENT_PERMISSIONS },
      actions: { paused: false, autoRestart: true },
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: NOW,
    })

    // --- Seed: Channels ---
    this.channels.set("ch_all", {
      id: "ch_all",
      serverId: SERVER_ID,
      name: "#all",
      description: "General channel for all members",
      type: "public",
      creatorId: "member_zy_ean",
      members: [
        { memberId: "member_zy_ean", joinedAt: "2026-06-01T00:00:00Z", role: "admin", muted: false },
        { memberId: "agent_aaa", joinedAt: "2026-06-01T00:00:00Z", role: "member", muted: false },
        { memberId: "agent_deepseek", joinedAt: "2026-06-01T00:00:00Z", role: "member", muted: false },
        { memberId: "agent_codex_mac", joinedAt: "2026-06-01T00:00:00Z", role: "member", muted: false },
      ],
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: NOW,
    })

    this.channels.set("ch_window", {
      id: "ch_window",
      serverId: SERVER_ID,
      name: "#window",
      description: "Development workspace",
      type: "public",
      creatorId: "member_zy_ean",
      members: [
        { memberId: "member_zy_ean", joinedAt: "2026-06-01T00:00:00Z", role: "admin", muted: false },
        { memberId: "agent_aaa", joinedAt: "2026-06-01T00:00:00Z", role: "member", muted: false },
        { memberId: "agent_deepseek", joinedAt: "2026-06-01T00:00:00Z", role: "member", muted: false },
      ],
      createdAt: "2026-06-01T00:00:00Z",
      updatedAt: NOW,
    })

    // --- Seed: Tasks ---
    this.tasks.set("task_1", {
      id: "task_1",
      number: 1,
      serverId: SERVER_ID,
      channelId: "ch_window",
      channelName: "#window",
      title: "整理本周 daemon 开发进度，输出一份简报",
      status: "done",
      creatorId: "member_zy_ean",
      creatorType: "human",
      assigneeId: "agent_aaa",
      statusHistory: [
        { from: "todo", to: "todo", changedBy: "member_zy_ean", changedAt: "2026-06-01T14:09:56Z" },
        { from: "todo", to: "in_progress", changedBy: "agent_aaa", changedAt: "2026-06-01T14:10:00Z" },
        { from: "in_progress", to: "done", changedBy: "agent_aaa", changedAt: "2026-06-01T14:30:00Z" },
      ],
      createdAt: "2026-06-01T14:09:56Z",
      updatedAt: "2026-06-01T14:30:00Z",
      completedAt: "2026-06-01T14:30:00Z",
    })
    this.taskNumberCounter = 1

    this.tasks.set("task_2", {
      id: "task_2",
      number: 2,
      serverId: SERVER_ID,
      channelId: "ch_window",
      channelName: "#window",
      title: "WebBridge twd.py token 认证",
      status: "in_review",
      creatorId: "member_zy_ean",
      creatorType: "human",
      assigneeId: "agent_aaa",
      statusHistory: [
        { from: "todo", to: "todo", changedBy: "member_zy_ean", changedAt: "2026-06-01T14:10:52Z" },
        { from: "todo", to: "in_progress", changedBy: "agent_aaa", changedAt: "2026-06-01T14:11:00Z" },
        { from: "in_progress", to: "in_review", changedBy: "agent_aaa", changedAt: "2026-06-01T15:00:00Z" },
      ],
      createdAt: "2026-06-01T14:10:52Z",
      updatedAt: "2026-06-01T15:00:00Z",
    })
    this.taskNumberCounter = 2

    this.tasks.set("task_4", {
      id: "task_4",
      number: 4,
      serverId: SERVER_ID,
      channelId: "ch_window",
      channelName: "#window",
      title: "写 daemon MVP 网站",
      status: "in_progress",
      creatorId: "member_zy_ean",
      creatorType: "human",
      assigneeId: "agent_aaa",
      statusHistory: [
        { from: "todo", to: "todo", changedBy: "member_zy_ean", changedAt: "2026-06-01T20:40:13Z" },
        { from: "todo", to: "in_progress", changedBy: "agent_aaa", changedAt: "2026-06-01T20:41:00Z" },
      ],
      createdAt: "2026-06-01T20:40:13Z",
      updatedAt: "2026-06-01T20:41:00Z",
    })
    this.taskNumberCounter = 4
  }

  // --- Sequence ---

  nextSeq(): number {
    return ++this.seqCounter
  }

  // --- Subscribe / Emit ---

  subscribe(fn: EventSubscriber): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  private emit(event: ServerEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event)
      } catch {
        /* ignore subscriber errors */
      }
    }
  }

  // --- Events (cursor-based pagination) ---

  getEvents(since?: number): { events: ServerEvent[]; nextCursor: number } {
    const sinceSeq = since ?? 0
    const filtered = this.events.filter((e) => e.seq > sinceSeq)
    const nextCursor = filtered.length > 0 ? filtered[filtered.length - 1].seq : sinceSeq
    return { events: filtered, nextCursor }
  }

  // --- Messages ---

  addMessage(msg: Omit<Message, "id" | "serverId" | "seq" | "createdAt">): Message {
    const seq = this.nextSeq()
    const now = new Date().toISOString()
    const message: Message = {
      ...msg,
      id: genId("msg"),
      serverId: SERVER_ID,
      seq,
      createdAt: now,
    }
    this.messages.set(message.id, message)

    // Update channel lastMessageAt
    const channel = this.channels.get(message.channelId)
    if (channel) {
      channel.lastMessageAt = now
    }

    const event: MessageEvent = {
      type: "message.created",
      payload: { message, channelId: message.channelId },
      seq,
      timestamp: now,
    }
    this.events.push(event)
    this.emit(event)

    return message
  }

  getHistory(channel: string, limit = 50): Message[] {
    // Support both channelId and channel name (e.g. "#all")
    const msgs = Array.from(this.messages.values())
      .filter((m) => {
        // Match by target (channel name like "#all", "#window") or channelId
        return (
          m.target === channel ||
          m.target.startsWith(`${channel}:`) ||
          m.channelId === channel ||
          m.channelName === channel
        )
      })
      .sort((a, b) => a.seq - b.seq)
      .slice(-limit)
    return msgs
  }

  // --- Threads ---

  createThread(rootMessageId: string, reply: Omit<Message, "id" | "serverId" | "seq" | "createdAt" | "threadId">): { thread: Thread; reply: Message } {
    const rootMsg = this.messages.get(rootMessageId)
    if (!rootMsg) {
      throw new Error(`Root message ${rootMessageId} not found`)
    }

    const now = new Date().toISOString()
    const seq = this.nextSeq()
    const replyMsg: Message = {
      ...reply,
      id: genId("msg"),
      serverId: SERVER_ID,
      threadId: rootMessageId,
      seq,
      createdAt: now,
    }
    this.messages.set(replyMsg.id, replyMsg)

    const existingThread = this.threads.get(rootMessageId)
    let thread: Thread
    if (existingThread) {
      existingThread.replyCount++
      existingThread.lastReplyAt = now
      if (!existingThread.participants.includes(reply.sender)) {
        existingThread.participants.push(reply.sender)
      }
      thread = existingThread
    } else {
      thread = {
        id: rootMessageId,
        channelId: rootMsg.channelId,
        rootMessageId,
        replyCount: 1,
        lastReplyAt: now,
        participants: [reply.sender],
      }
      this.threads.set(thread.id, thread)
    }

    const event: MessageEvent = {
      type: "message.created",
      payload: { message: replyMsg, channelId: replyMsg.channelId },
      seq,
      timestamp: now,
    }
    this.events.push(event)
    this.emit(event)

    return { thread, reply: replyMsg }
  }

  addReply(threadId: string, reply: Omit<Message, "id" | "serverId" | "seq" | "createdAt" | "threadId">): { thread: Thread; reply: Message } {
    return this.createThread(threadId, reply)
  }

  // --- Tasks ---

  createTask(params: {
    title: string
    channel: string
    creatorId: string
    creatorType?: SenderType
    assigneeId?: string
    messageId?: string
    priority?: TaskPriority
    tags?: string[]
    data?: Record<string, unknown>
  }): Task {
    const now = new Date().toISOString()
    const number = ++this.taskNumberCounter
    const channelId = this.findChannelId(params.channel)
    const initialStatus: TaskStatus = params.assigneeId ? "in_progress" : "todo"
    const task: Task = {
      id: genId("task"),
      number,
      serverId: SERVER_ID,
      channelId,
      channelName: params.channel,
      title: params.title,
      status: initialStatus,
      priority: params.priority,
      creatorId: params.creatorId,
      creatorType: params.creatorType ?? "human",
      assigneeId: params.assigneeId,
      messageId: params.messageId,
      tags: params.tags,
      data: params.data,
      statusHistory: [
        { from: "todo", to: initialStatus, changedBy: params.creatorId, changedAt: now },
      ],
      createdAt: now,
      updatedAt: now,
    }
    this.tasks.set(task.id, task)

    const eventType = initialStatus === "in_progress" ? "task.claimed" : "task.created"
    const event: TaskEvent = {
      type: eventType,
      payload: {
        taskId: task.id,
        taskNumber: task.number,
        channel: params.channel,
        assigneeId: params.assigneeId,
        status: initialStatus,
        changedBy: params.creatorId,
      },
      seq: this.nextSeq(),
      timestamp: now,
    }
    this.events.push(event)
    this.emit(event)

    return task
  }

  claimTask(taskId: string | number, assigneeId: string): Task | null {
    const resolved = this.resolveTaskId(taskId)
    if (!resolved) return null
    const task = this.tasks.get(resolved)
    if (!task) return null
    if (task.assigneeId) return null

    const now = new Date().toISOString()
    const previousStatus = task.status
    task.status = "in_progress"
    task.assigneeId = assigneeId
    task.updatedAt = now
    task.statusHistory.push({
      from: previousStatus,
      to: "in_progress",
      changedBy: assigneeId,
      changedAt: now,
    })

    const event: TaskEvent = {
      type: "task.claimed",
      payload: {
        taskId: task.id,
        taskNumber: task.number,
        channel: task.channelName,
        assigneeId,
        status: "in_progress",
        previousStatus,
        changedBy: assigneeId,
      },
      seq: this.nextSeq(),
      timestamp: now,
    }
    this.events.push(event)
    this.emit(event)

    return task
  }

  claimTaskByNumber(taskNumber: number, channel: string, agentId: string): Task | null {
    const task = Array.from(this.tasks.values()).find(
      (t) => t.number === taskNumber && t.channelName === channel
    )
    if (!task) return null
    if (task.assigneeId) return null
    return this.claimTask(task.id, agentId)
  }

  updateTaskStatus(taskId: string | number, status: TaskStatus, changedBy: string, reason?: string): Task | null {
    const resolved = this.resolveTaskId(taskId)
    if (!resolved) return null
    const task = this.tasks.get(resolved)
    if (!task) return null

    const now = new Date().toISOString()
    const previousStatus = task.status
    task.status = status
    task.updatedAt = now
    if (status === "done") {
      task.completedAt = now
    }
    task.statusHistory.push({
      from: previousStatus,
      to: status,
      changedBy,
      changedAt: now,
      reason,
    })

    const eventType: TaskEvent["type"] =
      status === "done" ? "task.completed" :
      status === "closed" ? "task.closed" :
      "task.updated"

    const event: TaskEvent = {
      type: eventType,
      payload: {
        taskId: task.id,
        taskNumber: task.number,
        channel: task.channelName,
        assigneeId: task.assigneeId,
        status,
        previousStatus,
        changedBy,
      },
      seq: this.nextSeq(),
      timestamp: now,
    }
    this.events.push(event)
    this.emit(event)

    return task
  }

  // --- Files ---

  uploadFile(params: {
    channelId: string
    uploadedBy: string
    fileName: string
    originalName: string
    mimeType: string
    size: number
    storagePath?: string
  }): FileEntry {
    const now = new Date().toISOString()
    const id = genId("file")
    const file: FileEntry = {
      id,
      serverId: SERVER_ID,
      channelId: params.channelId,
      uploadedBy: params.uploadedBy,
      fileName: params.fileName,
      originalName: params.originalName,
      mimeType: params.mimeType,
      size: params.size,
      storagePath: params.storagePath ?? `/uploads/${id}/${params.fileName}`,
      url: `/api/files/${id}/download`,
      createdAt: now,
    }
    this.files.set(file.id, file)

    const event: FileEvent = {
      type: "file.uploaded",
      payload: { fileId: file.id, channelId: params.channelId, uploadedBy: params.uploadedBy },
      seq: this.nextSeq(),
      timestamp: now,
    }
    this.events.push(event)
    this.emit(event)

    return file
  }

  // --- Activity Logs ---

  logActivity(params: {
    agentId: string
    type: ActivityType
    description: string
    details?: ActivityDetails
    channelId?: string
    taskId?: string
  }): ActivityLog {
    const now = new Date().toISOString()
    const log: ActivityLog = {
      id: genId("act"),
      serverId: SERVER_ID,
      agentId: params.agentId,
      type: params.type,
      description: params.description,
      details: params.details,
      channelId: params.channelId,
      taskId: params.taskId,
      timestamp: now,
    }
    this.activityLogs.push(log)

    const event: ActivityEvent = {
      type: "activity.log",
      payload: log,
      seq: this.nextSeq(),
      timestamp: now,
    }
    this.events.push(event)
    this.emit(event)

    return log
  }

  // --- Backward Compatibility ---

  /**
   * Legacy agents map -- derived from members with kind === 'agent'.
   * Provides the same Agent interface that existing consumers expect.
   */
  get agents(): Map<string, Agent> {
    const map = new Map<string, Agent>()
    for (const [id, member] of this.members) {
      if (member.kind === "agent") {
        map.set(id, {
          id: member.id,
          name: member.displayName,
          displayName: member.displayName,
          status: member.status as "online" | "idle" | "offline",
          role: member.role,
          backend: member.backend,
        })
      }
    }
    return map
  }

  /**
   * Backward-compatible getServerInfo.
   * Returns same shape as before plus new fields, so existing API routes work.
   */
  getServerInfo() {
    return {
      serverId: this.server.id,
      version: this.server.version,
      channels: Array.from(this.channels.values()),
      agents: Array.from(this.agents.values()),
      humans: Array.from(this.members.values())
        .filter((m) => m.kind === "human")
        .map((m) => ({ id: m.id, name: m.displayName })),
    }
  }

  // --- Helper ---

  private findChannelId(channelNameOrId: string): string {
    // If it looks like a channel ID, return it directly
    if (channelNameOrId.startsWith("ch_")) return channelNameOrId
    // Otherwise find by name (e.g. "#all")
    for (const [id, ch] of this.channels) {
      if (ch.name === channelNameOrId) return id
    }
    return channelNameOrId
  }

  /**
   * Resolve a task ID that may be a legacy numeric id or a new-style string id.
   * Legacy numeric ids (1, 2, 4) map to "task_1", "task_2", "task_4".
   * New-style ids ("task_xxx") pass through.
   */
  private resolveTaskId(taskId: string | number): string | undefined {
    const str = String(taskId)
    // New-style: already has prefix
    if (str.startsWith("task_")) return str
    // Legacy numeric: try "task_{n}"
    const legacyKey = `task_${str}`
    if (this.tasks.has(legacyKey)) return legacyKey
    // Also try by task number
    const byNumber = Array.from(this.tasks.values()).find((t) => t.number === Number(taskId))
    if (byNumber) return byNumber.id
    // Last resort: try the raw string
    if (this.tasks.has(str)) return str
    return undefined
  }
}

// ---------------------------------------------------------------------------
// 6. Utility exports
// ---------------------------------------------------------------------------

export function getStatusColor(status: string): string {
  switch (status) {
    case "online":
      return "bg-green-500"
    case "idle":
      return "bg-yellow-500"
    case "offline":
      return "bg-gray-400"
    case "todo":
      return "bg-slate-400"
    case "in_progress":
      return "bg-blue-500"
    case "in_review":
      return "bg-amber-500"
    case "done":
      return "bg-green-500"
    case "closed":
      return "bg-gray-500"
    default:
      return "bg-gray-400"
  }
}

export function getStatusLabel(status: string): string {
  switch (status) {
    case "todo":
      return "待办"
    case "in_progress":
      return "进行中"
    case "in_review":
      return "审核中"
    case "done":
      return "已完成"
    case "closed":
      return "已关闭"
    default:
      return status
  }
}

// ---------------------------------------------------------------------------
// 7. Per-agent cursor tracking
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 8. Singleton (survives HMR via globalThis)
// ---------------------------------------------------------------------------

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
