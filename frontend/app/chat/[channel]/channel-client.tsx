"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import {
  Activity,
  Bell,
  Bookmark,
  Bot,
  CheckSquare,
  Clipboard,
  Files,
  HardDrive,
  Hash,
  ImageIcon,
  ListChecks,
  MessageCircle,
  MessageSquare,
  Paperclip,
  Plus,
  Search,
  Send,
  Settings,
  Smile,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react"

import { MemberAvatar } from "@/components/member-avatar"
import { MessageFrame } from "@/components/message-frame"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RuntimeChip } from "@/components/product-ui"
import { MarkdownMessage } from "@/components/markdown-message"
import { AgentActivityList } from "@/components/agent-activity-list"
import { TaskBoard } from "@/components/task-board"
import {
  apiGet,
  apiPost,
  apiDelete,
  apiHeaders,
  type Member,
  statusLabel,
  API_BASE,
} from "@/lib/control-plane"
import {
  applyHighWater,
  connectRealtimeEvents,
  mergeMessageById,
  shouldHandleRealtimeEvent,
  type HighWater,
  type PublicEventEnvelope,
} from "@/lib/realtime-events"
import { channelMemberAddPayload } from "@/lib/channel-members"
import { AGENT_DRAG_MIME, parseAgentDragPayload, serializeAgentDragPayload } from "@/lib/drag-data"
import { CreateChannelDialog } from "./create-channel-dialog"
import { CreateAgentDialog } from "./create-agent-dialog"
import { memberForMessageSender } from "@/lib/member-avatar"

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
type ReactionItem = {
  id: string
  reaction: string
  memberId: string
  member: string | null
  createdAt?: string | null
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
  reactions?: ReactionItem[]
  reactionCounts?: Record<string, number>
}
type ThreadData = {
  thread?: ChannelMessage
  replies?: ChannelMessage[]
  messages?: ChannelMessage[]
  replyCount?: number
  threadSummary?: ThreadSummary | null
}
type FileItem = {
  id: string
  attachmentId: string
  serverId: string
  channelId: string | null
  messageId: string | null
  uploadedBy: string
  fileName: string
  originalName: string
  mimeType: string
  size: number
  url: string
  previewUrl: string | null
  metadata: Record<string, unknown>
  createdAt: string | null
}
type SavedItem = {
  id: string
  itemType: string
  itemId: string
}

const conversationTabs = [
  { label: "Chat", icon: MessageCircle },
  { label: "Tasks", icon: ListChecks },
  { label: "Files", icon: Files },
  { label: "Activity", icon: Activity },
]
const CHAT_SIDEBAR_WIDTH_KEY = "smallkhoj.chat.sidebarWidth"
const CHAT_SIDEBAR_MIN_WIDTH = 220
const CHAT_SIDEBAR_MAX_WIDTH = 420
const CHAT_SIDEBAR_DEFAULT_WIDTH = 260
const THREAD_PANEL_WIDTH_KEY = "smallkhoj.chat.threadWidth"
const THREAD_PANEL_MIN_WIDTH = 320
const THREAD_PANEL_MAX_WIDTH = 560
const THREAD_PANEL_DEFAULT_WIDTH = 384

function channelPathSegment(value: string) {
  return encodeURIComponent(value)
}

function dmAvatarMember(dm: DmInfo): Member {
  return dm.peer ?? {
    id: dm.id,
    name: dm.name,
    displayName: dm.displayName.replace(/^DM @/, ""),
    kind: "human",
    status: "offline",
  }
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function createLatencyTraceId(prefix = "chat") {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 12)
      : Math.random().toString(36).slice(2, 14)
  return `${prefix}:${Date.now().toString(36)}:${random}`
}

function clampPanelWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(minWidth, width))
}

function readStoredPanelWidth(key: string, defaultWidth: number, minWidth: number, maxWidth: number) {
  if (typeof window === "undefined") return defaultWidth
  try {
    const stored = window.localStorage.getItem(key)
    const parsed = stored ? Number(stored) : defaultWidth
    if (!Number.isFinite(parsed)) return defaultWidth
    return clampPanelWidth(parsed, minWidth, maxWidth)
  } catch {
    return defaultWidth
  }
}

function subscribePanelWidthStore() {
  return () => {}
}

export function ChannelClient({
  initialChannel,
  initialMessages = [],
  initialMembers = [],
  initialAllMembers = [],
  initialChannels = [],
  initialDms = [],
  initialChannelId = "",
  sessionToken,
  currentMemberId,
  initialThreadId,
  initialMessageId,
}: {
  initialChannel: string
  initialMessages?: ChannelMessage[]
  initialMembers?: Member[]
  initialAllMembers?: Member[]
  initialChannels?: ChannelInfo[]
  initialDms?: DmInfo[]
  initialChannelId?: string
  sessionToken?: string | null
  currentMemberId?: string | null
  initialThreadId?: string
  initialMessageId?: string
}) {
  const [channelName, setChannelName] = useState(initialChannel)
  const [messages, setMessages] = useState<ChannelMessage[]>(initialMessages)
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [allMembers, setAllMembers] = useState<Member[]>(initialAllMembers)
  const [channels, setChannels] = useState<ChannelInfo[]>(initialChannels)
  const [dms, setDms] = useState<DmInfo[]>(initialDms)
  const [input, setInput] = useState("")
  const [threadInput, setThreadInput] = useState("")
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null)
  const [threadData, setThreadData] = useState<ThreadData | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [showMembers, setShowMembers] = useState(true)
  const [channelId, setChannelId] = useState(initialChannelId)
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(() => new Set())
  const [taskMessageIds, setTaskMessageIds] = useState<Set<string>>(() => new Set())
  const [taskLinks, setTaskLinks] = useState<Record<string, string>>({})
  const [asTask, setAsTask] = useState(false)
  const [activeTab, setActiveTab] = useState<"chat" | "tasks" | "files" | "activity">("chat")
  const [files, setFiles] = useState<FileItem[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [agentDropChannelId, setAgentDropChannelId] = useState<string | null>(null)
  const [agentDropError, setAgentDropError] = useState<string | null>(null)
  const [sidebarWidthOverride, setSidebarWidthOverride] = useState<number | null>(null)
  const [threadWidthOverride, setThreadWidthOverride] = useState<number | null>(null)
  const dragDepthRef = useRef(0)
  const addMemberSelectRef = useRef<HTMLSelectElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const realtimeHighWaterRef = useRef(new Map<string, HighWater>())

  const storedSidebarWidth = useSyncExternalStore(
    subscribePanelWidthStore,
    () => readStoredPanelWidth(CHAT_SIDEBAR_WIDTH_KEY, CHAT_SIDEBAR_DEFAULT_WIDTH, CHAT_SIDEBAR_MIN_WIDTH, CHAT_SIDEBAR_MAX_WIDTH),
    () => CHAT_SIDEBAR_DEFAULT_WIDTH,
  )
  const storedThreadWidth = useSyncExternalStore(
    subscribePanelWidthStore,
    () => readStoredPanelWidth(THREAD_PANEL_WIDTH_KEY, THREAD_PANEL_DEFAULT_WIDTH, THREAD_PANEL_MIN_WIDTH, THREAD_PANEL_MAX_WIDTH),
    () => THREAD_PANEL_DEFAULT_WIDTH,
  )
  const sidebarWidth = sidebarWidthOverride ?? storedSidebarWidth
  const threadWidth = threadWidthOverride ?? storedThreadWidth

  const currentChannel = channels.find((c) => c.name.replace("#", "") === channelName)
  const currentDm = dms.find((dm) => dm.name === channelName)
  const currentTitle = currentDm?.displayName ?? (currentChannel?.name ?? `#${channelName}`)
  const currentIsDm = Boolean(currentDm)
  const dmAgent = currentDm?.peer?.kind === "agent" ? currentDm.peer : null
  const allKnownMembers = [...members, ...allMembers]
  const didReact = (message: ChannelMessage, emoji: string) =>
    Boolean(message.reactions?.some((r) => r.reaction === emoji && r.memberId === currentMemberId))

  function setPersistentPanelWidth(
    width: number,
    setWidth: (width: number) => void,
    key: string,
    minWidth: number,
    maxWidth: number,
  ) {
    const next = clampPanelWidth(width, minWidth, maxWidth)
    setWidth(next)
    window.localStorage.setItem(key, String(next))
  }

  function startPanelResize(
    event: React.PointerEvent<HTMLDivElement>,
    startWidth: number,
    applyWidth: (width: number) => void,
    direction: "left-edge" | "right-edge",
  ) {
    event.preventDefault()
    const startX = event.clientX
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = direction === "right-edge" ? moveEvent.clientX - startX : startX - moveEvent.clientX
      applyWidth(startWidth + delta)
    }
    const handlePointerUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
  }

  function handleSidebarResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    startPanelResize(
      event,
      sidebarWidth,
      (width) => setPersistentPanelWidth(width, setSidebarWidthOverride, CHAT_SIDEBAR_WIDTH_KEY, CHAT_SIDEBAR_MIN_WIDTH, CHAT_SIDEBAR_MAX_WIDTH),
      "right-edge",
    )
  }

  function handleThreadResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    startPanelResize(
      event,
      threadWidth,
      (width) => setPersistentPanelWidth(width, setThreadWidthOverride, THREAD_PANEL_WIDTH_KEY, THREAD_PANEL_MIN_WIDTH, THREAD_PANEL_MAX_WIDTH),
      "left-edge",
    )
  }

  function handleSidebarResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setPersistentPanelWidth(
      sidebarWidth + (event.key === "ArrowRight" ? 16 : -16),
      setSidebarWidthOverride,
      CHAT_SIDEBAR_WIDTH_KEY,
      CHAT_SIDEBAR_MIN_WIDTH,
      CHAT_SIDEBAR_MAX_WIDTH,
    )
  }

  function handleThreadResizeKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    setPersistentPanelWidth(
      threadWidth + (event.key === "ArrowLeft" ? 16 : -16),
      setThreadWidthOverride,
      THREAD_PANEL_WIDTH_KEY,
      THREAD_PANEL_MIN_WIDTH,
      THREAD_PANEL_MAX_WIDTH,
    )
  }

  useEffect(() => {
    let cancelled = false
    async function loadChannel() {
      const decodedChannel = initialChannel
      const encodedChannel = channelPathSegment(decodedChannel)
      setChannelName(decodedChannel)
      setActiveThreadId(initialThreadId ?? null)
      setThreadData(null)
      const h = apiHeaders(sessionToken)
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
      if (initialThreadId && !cancelled) {
        setThreadLoading(true)
        try {
          const data = await apiGet<ThreadData>(`/api/v1/threads/${encodeURIComponent(initialThreadId)}`, {}, sessionToken)
          if (!cancelled) setThreadData(data)
        } finally {
          if (!cancelled) setThreadLoading(false)
        }
      }
    }
    void loadChannel()
    return () => { cancelled = true }
  }, [initialChannel, initialThreadId, sessionToken])

  useEffect(() => {
    if (!initialMessageId) return
    const timer = window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(`[data-testid="message-${initialMessageId}"]`)
      target?.scrollIntoView({ block: "center" })
      target?.focus()
    }, 250)
    return () => window.clearTimeout(timer)
  }, [initialMessageId, messages])

  useEffect(() => {
    if (initialMessageId || activeTab !== "chat") return
    const frame = window.requestAnimationFrame(() => {
      messageEndRef.current?.scrollIntoView({ block: "end" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, channelName, initialMessageId, messages.length])

  const refreshFiles = useCallback(async () => {
    if (!channelId) return
    setFilesLoading(true)
    try {
      const data = await apiGet<{ files: FileItem[]; count: number }>(
        `/api/v1/files?channelId=${encodeURIComponent(channelId)}`,
        { files: [], count: 0 },
        sessionToken,
      )
      setFiles(data.files || [])
    } catch (e) {
      console.error("Refresh files failed:", e)
      setFiles([])
    } finally {
      setFilesLoading(false)
    }
  }, [channelId, sessionToken])

  const refreshSavedItems = useCallback(async () => {
    const data = await apiGet<{ saved: SavedItem[] }>(
      "/api/v1/saved?limit=50",
      { saved: [] },
      sessionToken,
    )
    setSavedMessageIds(new Set((data.saved || []).filter((item) => item.itemType === "message").map((item) => item.itemId)))
  }, [sessionToken])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshSavedItems()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [refreshSavedItems])

  async function handleFileUpload(file: File) {
    if (!channelId || !file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const h = apiHeaders(sessionToken)
      const url = `${API_BASE}/api/v1/files?channelId=${encodeURIComponent(channelId)}`
      const response = await fetch(url, {
        method: "POST",
        headers: h,
        body: formData,
      })
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error((error as { detail?: string }).detail || `HTTP ${response.status}`)
      }
      await refreshFiles()
      if (activeTab !== "files") {
        setActiveTab("files")
      }
    } catch (e) {
      console.error("Upload failed:", e)
      alert(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }

  // Native file drop handlers
  function handleDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current += 1
    if (dragDepthRef.current === 1) setIsDragOver(true)
  }

  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = channelId ? "copy" : "none"
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) setIsDragOver(false)
  }

  async function handleDrop(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes("Files")) return
    e.preventDefault()
    e.stopPropagation()
    dragDepthRef.current = 0
    setIsDragOver(false)
    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return
    if (!channelId) {
      alert("No channel selected. Cannot upload file.")
      return
    }
    // Upload the first file in MVP
    const file = droppedFiles[0]
    await handleFileUpload(file)
  }

  function openFilePicker(accept?: string) {
    if (!fileInputRef.current || uploading) return
    if (accept) {
      fileInputRef.current.accept = accept
    } else {
      fileInputRef.current.removeAttribute("accept")
    }
    fileInputRef.current.click()
  }

  const refreshMessages = useCallback(async () => {
    const encodedChannel = channelPathSegment(channelName)
    const data = await apiGet<{ messages: ChannelMessage[] }>(
      `/api/v1/channels/${encodedChannel}/messages?limit=50&threadMode=roots`,
      { messages: [] },
      sessionToken,
    )
    setMessages(data.messages || [])
  }, [channelName, sessionToken])

  const refreshThread = useCallback(async (threadId = activeThreadId) => {
    if (!threadId) return
    setThreadLoading(true)
    try {
      const data = await apiGet<ThreadData>(`/api/v1/threads/${encodeURIComponent(threadId)}`, {}, sessionToken)
      setThreadData(data)
    } finally {
      setThreadLoading(false)
    }
  }, [activeThreadId, sessionToken])

  const refreshChannelsAndDms = useCallback(async () => {
    const h = apiHeaders(sessionToken)
    const [chsRes, dmsRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/channels`, { headers: h }),
      fetch(`${API_BASE}/api/v1/dms`, { headers: h }),
    ])
    if (chsRes.ok) {
      const d = await chsRes.json()
      setChannels((d.channels || []) as ChannelInfo[])
    }
    if (dmsRes.ok) {
      const d = await dmsRes.json()
      setDms((d.dms || []) as DmInfo[])
    }
  }, [sessionToken])

  const refreshMembers = useCallback(async () => {
    if (!channelId) return
    try {
      const data = await apiGet<{ members: Member[] }>(`/api/v1/channels/${channelId}/members`, { members: [] }, sessionToken)
      setMembers(data.members || [])
    } catch {
      setMembers([])
    }
  }, [channelId, sessionToken])

  useEffect(() => {
    const controller = new AbortController()
    let catchUpTimer: number | null = null
    const scheduleCatchUp = () => {
      if (catchUpTimer) window.clearTimeout(catchUpTimer)
      catchUpTimer = window.setTimeout(() => {
        void refreshMessages()
        if (activeThreadId) void refreshThread(activeThreadId)
        catchUpTimer = null
      }, 120)
    }
    const stop = connectRealtimeEvents({
      headers: apiHeaders(sessionToken),
      signal: controller.signal,
      scope: channelId ? { kind: "channel", id: channelId } : undefined,
      onEvent: (event: PublicEventEnvelope) => {
        if (event.type === "member.status.updated" || event.type === "member.updated") {
          void refreshChannelsAndDms()
          void refreshMembers()
          return
        }
        if (!shouldHandleRealtimeEvent(event, { channelId, channelName })) {
          // Event belongs to another channel/DM or to a non-chat scope:
          // refresh sidebar lists so unread/new channels are visible.
          void refreshChannelsAndDms()
          return
        }
        const decision = applyHighWater(realtimeHighWaterRef.current, event)
        if (decision.action === "drop") {
          console.debug("[realtime] duplicate dropped", event.id)
          return
        }
        if (decision.action === "catch_up") {
          console.info("[realtime] catch-up triggered", decision.reason, event)
          scheduleCatchUp()
          return
        }
        if (event.type === "message.created") {
          const message = event.payload.message
          if (message && typeof message === "object" && "id" in message) {
            setMessages((previous) => mergeMessageById(previous, message as ChannelMessage))
          } else {
            scheduleCatchUp()
          }
          return
        }
        if (event.type === "reaction.updated" || event.type === "message.updated" || event.type === "message.deleted") {
          scheduleCatchUp()
        }
      },
      onStatus: (status) => {
        if (status.state === "error") console.warn("[realtime] chat stream error", status.error)
        if (status.state === "reconnecting") console.info("[realtime] chat reconnect", status.attempt, status.delayMs)
      },
    })
    return () => {
      stop()
      controller.abort()
      if (catchUpTimer) window.clearTimeout(catchUpTimer)
    }
  }, [activeThreadId, channelId, channelName, refreshChannelsAndDms, refreshMembers, refreshMessages, refreshThread, sessionToken])

  async function openThread(message: ChannelMessage) {
    const threadId = message.threadId || message.id
    setActiveThreadId(threadId)
    await refreshThread(threadId)
  }

  async function handleAddMember() {
    const memberId = addMemberSelectRef.current?.value
    if (!channelId || !memberId) return
    try {
      await apiPost(`/api/v1/channels/${channelId}/members`, channelMemberAddPayload(memberId), sessionToken)
      if (addMemberSelectRef.current) addMemberSelectRef.current.value = ""
      await refreshMembers()
    } catch (e) {
      console.error("Add member failed:", e)
    }
  }

  async function addMemberToChannel(targetChannelId: string, memberId: string) {
    await apiPost(`/api/v1/channels/${targetChannelId}/members`, channelMemberAddPayload(memberId), sessionToken)
    if (targetChannelId === channelId) {
      await refreshMembers()
    }
  }

  function handleChannelAgentDragOver(event: React.DragEvent, targetChannelId: string) {
    if (!event.dataTransfer.types.includes(AGENT_DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = "copy"
    setAgentDropError(null)
    setAgentDropChannelId(targetChannelId)
  }

  function handleChannelAgentDragLeave(event: React.DragEvent, targetChannelId: string) {
    if (!event.dataTransfer.types.includes(AGENT_DRAG_MIME)) return
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
    if (agentDropChannelId === targetChannelId) setAgentDropChannelId(null)
  }

  async function handleChannelAgentDrop(event: React.DragEvent, targetChannelId: string) {
    if (!event.dataTransfer.types.includes(AGENT_DRAG_MIME)) return
    event.preventDefault()
    event.stopPropagation()
    setAgentDropChannelId(null)
    const payload = parseAgentDragPayload(event.dataTransfer.getData(AGENT_DRAG_MIME))
    if (!payload || payload.kind !== "agent") return
    try {
      await addMemberToChannel(targetChannelId, payload.id)
    } catch (error) {
      console.error("Drop agent into channel failed:", error)
      setAgentDropError(error instanceof Error ? error.message : "Failed to add agent")
    }
  }

  async function handleSend() {
    if (!input.trim()) return
    try {
      const encodedChannel = channelPathSegment(channelName)
      const traceId = createLatencyTraceId("chat-send")
      const result = await apiPost<{ id: string }>(`/api/v1/channels/${encodedChannel}/messages`, { content: input.trim(), traceId }, sessionToken)
      setInput("")
      if (asTask) {
        setAsTask(false)
        await createTaskFromContent(input.trim(), result?.id)
        if (result?.id) {
          setTaskMessageIds((previous) => new Set(previous).add(result.id))
        }
      }
      await refreshMessages()
    } catch (e) {
      console.error("Send failed:", e)
    }
  }

  async function handleThreadSend() {
    if (!threadInput.trim() || !activeThreadId) return
    try {
      const encodedChannel = channelPathSegment(channelName)
      const traceId = createLatencyTraceId("thread-send")
      await apiPost(`/api/v1/channels/${encodedChannel}/messages`, {
        content: threadInput.trim(),
        threadId: activeThreadId,
        traceId,
      }, sessionToken)
      setThreadInput("")
      await Promise.all([refreshMessages(), refreshThread(activeThreadId)])
    } catch (e) {
      console.error("Thread reply failed:", e)
    }
  }

  async function createTaskFromContent(content: string, messageId?: string) {
    const mentionPattern = /@([A-Za-z0-9_\-]+)/g
    const mentions = Array.from(content.matchAll(mentionPattern)).map((m) => m[1])
    const agentPool = allMembers.length > 0 ? allMembers : members
    const mentionedAgent = mentions
      .map((handle) => {
        const clean = handle.startsWith("@") ? handle.slice(1) : handle
        return agentPool.find(
          (m) => m.kind === "agent" && (m.displayName === clean || m.handle === `@${clean}` || m.handle === clean)
        )
      })
      .find(Boolean)

    const dmAgent = currentDm?.peer?.kind === "agent" ? currentDm.peer : null
    const assignee = mentionedAgent?.handle
      ?? mentionedAgent?.displayName
      ?? dmAgent?.handle
      ?? dmAgent?.displayName
      ?? null

    const taskTitle = content.length > 72 ? `${content.slice(0, 69)}...` : content
    const sourceChannel = currentDm?.name ?? currentChannel?.name ?? `#${channelName}`
    const result = await apiPost<{ task?: { id?: string } }>("/api/v1/tasks", {
      channel: sourceChannel,
      title: taskTitle || "New task",
      description: `Created from ${currentTitle} message.`,
      assignee,
      status: "todo",
      messageId,
      data: {
        source: {
          type: "message",
          channel: sourceChannel,
          messageId,
        },
        evidence: {
          notes: ["Created from chat message."],
          links: [],
        },
      },
    }, sessionToken)
    return result.task?.id ?? null
  }

  async function handleCreateTaskFromMessage(message: ChannelMessage) {
    if (taskMessageIds.has(message.id)) return
    try {
      const taskId = await createTaskFromContent(message.content, message.id)
      setTaskMessageIds((previous) => new Set(previous).add(message.id))
      if (taskId) {
        setTaskLinks((previous) => ({ ...previous, [message.id]: taskId }))
      }
      setActiveTab("tasks")
    } catch (e) {
      console.error("Create task from message failed:", e)
    }
  }

  async function handleCopyMessage(message: ChannelMessage) {
    try {
      await navigator.clipboard.writeText(message.content)
    } catch (e) {
      console.error("Copy message failed:", e)
    }
  }

  async function toggleSaved(messageId: string) {
    const isSaved = savedMessageIds.has(messageId)
    setSavedMessageIds((previous) => {
      const next = new Set(previous)
      if (isSaved) next.delete(messageId)
      else next.add(messageId)
      return next
    })
    try {
      if (isSaved) {
        await apiDelete(`/api/v1/saved?itemType=message&itemId=${encodeURIComponent(messageId)}`, sessionToken)
      } else {
        await apiPost("/api/v1/saved", { itemType: "message", itemId: messageId }, sessionToken)
      }
    } catch (e) {
      console.error("Save message failed:", e)
      await refreshSavedItems()
    }
  }

  async function toggleReaction(message: ChannelMessage, emoji = "👍") {
    const hasReacted = didReact(message, emoji)
    try {
      const h = apiHeaders(sessionToken)
      const url = `${API_BASE}/api/v1/messages/${encodeURIComponent(message.id)}/reactions`
      if (hasReacted) {
        await fetch(url, {
          method: "DELETE",
          headers: { ...h, "Content-Type": "application/json" },
          body: JSON.stringify({ reaction: emoji }),
        })
      } else {
        await fetch(url, {
          method: "POST",
          headers: { ...h, "Content-Type": "application/json" },
          body: JSON.stringify({ reaction: emoji }),
        })
      }
      await refreshMessages()
      if (activeThreadId) await refreshThread(activeThreadId)
    } catch (e) {
      console.error("Reaction failed:", e)
    }
  }

  function renderMessageActions(message: ChannelMessage) {
    const hasReacted = didReact(message, "👍")
    const isSaved = savedMessageIds.has(message.id)
    const isTasked = taskMessageIds.has(message.id)
    return (
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => openThread(message)}
          aria-label="Reply in thread"
          title="Reply"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageCircle className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => toggleReaction(message, "👍")}
          aria-label="React to message"
          title="React"
          className={`inline-flex size-6 items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring ${
            hasReacted ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Smile className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void toggleSaved(message.id)}
          aria-label="Save message"
          title="Save"
          className={`inline-flex size-6 items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring ${
            isSaved ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Bookmark className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleCreateTaskFromMessage(message)}
          aria-label="Create task from message"
          title="As Task"
          className={`inline-flex size-6 items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-ring ${
            isTasked ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <CheckSquare className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleCopyMessage(message)}
          aria-label="Copy message"
          title="Copy"
          className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Clipboard className="size-3.5" />
        </button>
      </div>
    )
  }

  async function handleRemoveMember(memberId: string) {
    if (!channelId) return
    try {
      await apiDelete(`/api/v1/channels/${channelId}/members/${memberId}`, sessionToken)
      await refreshMembers()
    } catch (e) {
      console.error("Remove member failed:", e)
    }
  }

  async function handleDeleteChannel() {
    if (!currentChannel?.id || currentIsDm) return
    if (!window.confirm(`Delete ${currentChannel.name}?`)) return
    try {
      await apiDelete(`/api/v1/channels/${currentChannel.id}`, sessionToken)
      window.location.href = "/chat"
    } catch (e) {
      console.error("Delete channel failed:", e)
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
    <div className="flex h-screen bg-background">
      <nav
        aria-label="Primary"
        className="hidden w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar py-3 sm:flex"
      >
        <Link
          href="/"
          aria-label="Home"
          className="mb-1 flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.66_0.14_262)] text-primary-foreground"
        >
          <Sparkles className="size-4" />
        </Link>
        {[
          { href: "/?focus=search", label: "Search", icon: Search },
          { href: "/chat", label: "Chat", icon: MessageSquare, active: true },
          { href: "/tasks", label: "Tasks", icon: CheckSquare },
          { href: "/members", label: "Members", icon: Bot },
          { href: "/computers", label: "Computers", icon: HardDrive },
          { href: "/daemon", label: "Activity", icon: Bell },
        ].map(({ href, label, icon: Icon, active }) => (
          <Link
            key={label}
            href={href}
            aria-label={label}
            title={label}
            className={`flex size-9 items-center justify-center rounded-xl transition-colors ${
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            }`}
          >
            <Icon className="size-[18px]" />
          </Link>
        ))}
        <Link
          href="/settings"
          aria-label="Settings"
          title="Settings"
          className="mt-auto flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          <Settings className="size-[18px]" />
        </Link>
      </nav>

      <aside
        className="relative hidden shrink-0 border-r bg-sidebar sm:flex sm:flex-col"
        style={{ width: sidebarWidth }}
      >
        <div className="border-b p-3">
          <Link href="/" className="block rounded-md px-2 py-1.5 text-sm font-semibold hover:bg-sidebar-accent">
            SmallKhoj
            <span className="block text-xs font-normal text-muted-foreground">Chat workbench</span>
          </Link>
        </div>
        <div className="p-3">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Attention</h3>
          <div className="space-y-1">
            <Link href="/daemon" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent">
              <Activity className="size-3.5" />
              Activity
            </Link>
            <Link href="/?focus=saved" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-sidebar-accent">
              <Bookmark className="size-3.5" />
              Saved
            </Link>
          </div>
          <div className="mb-2 mt-5 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">Channels</h3>
            <CreateChannelDialog />
          </div>
          <div className="space-y-1">
            {[...channels].sort((a, b) => a.name.localeCompare(b.name)).map((ch) => (
              <Link
                key={ch.id}
                href={`/chat/${channelPathSegment(ch.name.replace("#", ""))}`}
                onDragOver={(event) => handleChannelAgentDragOver(event, ch.id)}
                onDragLeave={(event) => handleChannelAgentDragLeave(event, ch.id)}
                onDrop={(event) => void handleChannelAgentDrop(event, ch.id)}
                title="Drop an agent here to add it to this channel"
                className={`block truncate rounded-md border px-2 py-1.5 text-sm transition-colors ${
                  ch.name.replace("#", "") === channelName ? "border-primary/20 bg-primary/10 font-medium text-primary" : "border-transparent hover:bg-sidebar-accent"
                } ${
                  agentDropChannelId === ch.id ? "border-primary/50 bg-primary/10 ring-1 ring-primary/25" : ""
                }`}
              >
                <span className="inline-flex min-w-0 items-center gap-1">
                  <Hash className="size-3" />
                  <span className="truncate">{ch.name.replace("#", "")}</span>
                  <span className="ml-auto text-[0.7rem] text-muted-foreground">ch</span>
                </span>
              </Link>
            ))}
          </div>
          {agentDropError && <p className="mt-2 text-xs text-destructive">{agentDropError}</p>}
          <div className="mb-2 mt-5 flex items-center justify-between">
            <h3 className="text-xs font-medium uppercase text-muted-foreground">DMs</h3>
            <CreateAgentDialog />
          </div>
          <div className="space-y-1">
            {dms.map((dm) => {
              const avatarMember = dmAvatarMember(dm)
              const isAgentDm = avatarMember.kind === "agent"
              return (
                <Link
                  key={dm.id}
                  href={`/chat/${channelPathSegment(dm.name)}`}
                  draggable={isAgentDm}
                  onDragStart={isAgentDm ? (event) => {
                    event.dataTransfer.effectAllowed = "copy"
                    event.dataTransfer.setData(AGENT_DRAG_MIME, serializeAgentDragPayload(avatarMember))
                    event.dataTransfer.setData("text/plain", avatarMember.handle || avatarMember.displayName || avatarMember.name)
                  } : undefined}
                  title={isAgentDm ? "Drag agent to a channel or task" : undefined}
                  className={`block truncate rounded-md px-2 py-1.5 text-sm ${
                    dm.name === channelName ? "bg-primary/10 font-medium text-primary" : "hover:bg-sidebar-accent"
                  } ${isAgentDm ? "cursor-grab active:cursor-grabbing" : ""}`}
                >
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <MemberAvatar member={avatarMember} size="sm" />
                    <span className="truncate">{avatarMember.displayName || avatarMember.name}</span>
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
        <div className="mt-auto border-t p-3">
          <h3 className="mb-2 text-xs font-medium uppercase text-muted-foreground">Members Online</h3>
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-2 py-1 text-sm">
              <MemberAvatar member={m} size="xs" />
              <span className="truncate">{m.displayName}</span>
              <span className="ml-auto text-xs text-muted-foreground">{m.kind}</span>
            </div>
          ))}
        </div>
        <div
          role="separator"
          aria-label="Resize chat sidebar"
          aria-orientation="vertical"
          aria-valuemin={CHAT_SIDEBAR_MIN_WIDTH}
          aria-valuemax={CHAT_SIDEBAR_MAX_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          data-testid="chat-sidebar-resize-handle"
          onPointerDown={handleSidebarResizePointerDown}
          onKeyDown={handleSidebarResizeKeyDown}
          className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:w-0.5 hover:after:bg-primary/60 focus-visible:after:w-0.5 focus-visible:after:bg-primary"
        />
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {currentDm ? (
                <MemberAvatar member={dmAvatarMember(currentDm)} size="xl" />
              ) : (
                <Avatar size="xl" name={currentTitle} />
              )}
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold">{currentTitle}</h1>
                <div className="mt-1 flex items-center gap-2">
                  <RuntimeChip>{currentIsDm ? "Direct message" : "Channel"}</RuntimeChip>
                  <span className="text-xs text-muted-foreground">{messages.length} root messages</span>
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              aria-label={showMembers ? "Hide channel members" : "Show channel members"}
              onClick={() => setShowMembers(!showMembers)}
            >
              <Users className="size-4" />
              {members.length}
            </Button>
            {!currentIsDm && currentChannel?.id && (
              <Button
                variant="outline"
                size="sm"
                aria-label="Delete channel"
                onClick={handleDeleteChannel}
                className="border-rose-200 text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="size-4" />
              </Button>
            )}
          </div>
          <div className="mt-3 flex gap-1">
            {conversationTabs.map(({ label, icon: Icon }) => {
              const tabKey = label.toLowerCase() as "chat" | "tasks" | "files" | "activity"
              const isActive = activeTab === tabKey
              return (
                <button
                  key={String(label)}
                  type="button"
                  onClick={() => {
                    setActiveTab(tabKey)
                    if (tabKey === "files") {
                      void refreshFiles()
                    }
                  }}
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors ${
                    isActive
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              )
            })}
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <div
            className="flex flex-1 flex-col relative"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragOver && (
              <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-primary/10 backdrop-blur-sm border-2 border-dashed border-primary/40 m-2 rounded-lg">
                <div className="rounded-lg bg-background p-6 shadow-lg border text-center">
                  <Files className="mx-auto size-10 text-primary mb-3" />
                  <p className="text-sm font-medium">Drop file to upload</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {channelId ? "Release to upload to this channel" : "No channel available"}
                  </p>
                </div>
              </div>
            )}
            {activeTab === "activity" ? (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-3xl">
                  {dmAgent ? (
                    <AgentActivityList agentId={dmAgent.id} runtimeOnly limit={40} />
                  ) : (
                    <div className="rounded-lg border border-dashed py-10 text-center">
                      <Activity className="mx-auto size-7 text-muted-foreground/50" />
                      <p className="mt-2 text-sm text-muted-foreground">
                        Activity is only available for agent conversations.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === "tasks" ? (
              <div className="flex-1 overflow-y-auto p-4">
                  <TaskBoard
                    channelName={currentChannel?.name ?? currentDm?.name ?? channelName}
                    initialView="board"
                    showDetail
                    sessionToken={sessionToken}
                  />
              </div>
            ) : activeTab === "files" ? (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-3xl">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">Files</h2>
                    <span className="text-xs text-muted-foreground">{files.length} file{files.length === 1 ? "" : "s"}</span>
                  </div>
                  {filesLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading files...</p>}
                  {!filesLoading && files.length === 0 && (
                    <div className="rounded-lg border border-dashed py-12 text-center">
                      <Files className="mx-auto size-8 text-muted-foreground/50" />
                      <p className="mt-2 text-sm text-muted-foreground">No files in {currentTitle} yet.</p>
                    </div>
                  )}
                  <div className="space-y-2">
                    {files.map((file) => {
                      const uploader = allMembers.find((m) => m.id === file.uploadedBy) ?? members.find((m) => m.id === file.uploadedBy)
                      const isImage = file.mimeType.startsWith("image/")
                      return (
                        <div key={file.id} className="group/file flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm">
                          <div className={`flex size-10 shrink-0 items-center justify-center rounded-md border ${isImage ? "bg-primary/10 border-primary/20" : "bg-muted border-border"}`}>
                            {isImage ? <ImageIcon className="size-5 text-primary" /> : <Files className="size-5 text-muted-foreground" />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm font-medium">{file.originalName}</span>
                              <span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(file.size)}</span>
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              <span>{uploader?.displayName || "Unknown"}</span>
                              <span>·</span>
                              <span>{file.createdAt ? new Date(file.createdAt).toLocaleString() : ""}</span>
                            </div>
                            <div className="mt-1.5 flex items-center gap-2">
                              {file.messageId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setActiveTab("chat")
                                    const timer = window.setTimeout(() => {
                                      const target = document.querySelector<HTMLElement>(`[data-testid="message-${file.messageId}"]`)
                                      target?.scrollIntoView({ block: "center" })
                                      target?.focus()
                                    }, 150)
                                    window.setTimeout(() => window.clearTimeout(timer), 5000)
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/20"
                                >
                                  <MessageCircle className="size-3" />
                                  Open message
                                </button>
                              )}
                              {file.previewUrl && (
                                <a
                                  href={`${API_BASE}${file.previewUrl}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                                >
                                  <ImageIcon className="size-3" />
                                  Preview
                                </a>
                              )}
                              <a
                                href={`${API_BASE}${file.url}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                              >
                                Download
                              </a>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div ref={messageListRef} data-testid="chat-message-list" className="flex-1 overflow-y-auto p-4">
                <div className="mx-auto max-w-3xl space-y-3">
                {messages.map((msg) => {
                  const isSaved = savedMessageIds.has(msg.id)
                  const senderMember = memberForMessageSender(msg.sender, msg.senderType, allKnownMembers)
                  return (
                    <div
                      key={msg.id}
                      data-testid={`message-${msg.id}`}
                      className={`group/message relative rounded-lg p-2.5 transition-colors focus-within:bg-accent hover:bg-accent ${
                        isSaved ? "bg-primary/5" : ""
                      }`}
                      tabIndex={0}
                    >
                      <MessageFrame
                        member={senderMember}
                        senderType={msg.senderType}
                        time={msg.time}
                        avatarSize="lg"
                        showStatus={senderMember.kind === "agent"}
                        badges={
                          <>
                            {isSaved && (
                              <Bookmark className="size-3 text-primary" aria-label="Saved" />
                            )}
                            {taskLinks[msg.id] && (
                              <Link
                                href={`/tasks?task=${encodeURIComponent(taskLinks[msg.id])}`}
                                className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary hover:bg-primary/20"
                              >
                                <CheckSquare className="size-3" />
                                Task
                              </Link>
                            )}
                          </>
                        }
                        actions={
                          <div className="opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100">
                            {renderMessageActions(msg)}
                          </div>
                        }
                      >
                      <MarkdownMessage content={msg.content} />
                      {(msg.replyCount || msg.threadSummary) && (
                        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
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
                      {msg.reactionCounts && Object.keys(msg.reactionCounts).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(msg.reactionCounts).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(msg, emoji)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                                didReact(msg, emoji)
                                  ? "border-primary/30 bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted"
                              }`}
                              aria-label={`${count} ${emoji} reactions`}
                            >
                              <span>{emoji}</span>
                              <span className="text-[0.7rem] font-medium">{count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      </MessageFrame>
                    </div>
                  )
                })}
                {messages.length === 0 && (
                  <p className="py-20 text-center text-muted-foreground">No messages in {currentTitle} yet.</p>
                )}
                <div ref={messageEndRef} data-testid="chat-message-list-end" aria-hidden="true" />
              </div>
            </div>

            <div className="border-t p-4">
              <div className="mx-auto flex max-w-3xl items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  className="sr-only"
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleFileUpload(file)
                    e.target.value = ""
                  }}
                />
                <button
                  type="button"
                  aria-label="Attach file"
                  title="Attach file"
                  disabled={uploading || !channelId}
                  onClick={() => openFilePicker()}
                  className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg border px-2 ${
                    uploading || !channelId
                      ? "text-muted-foreground opacity-60"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Paperclip className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Attach image"
                  title="Attach image"
                  disabled={uploading || !channelId}
                  onClick={() => openFilePicker("image/*")}
                  className={`inline-flex h-8 shrink-0 items-center justify-center rounded-lg border px-2 ${
                    uploading || !channelId
                      ? "text-muted-foreground opacity-60"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <ImageIcon className="size-4" />
                </button>
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
                  onClick={() => setAsTask(!asTask)}
                  aria-pressed={asTask}
                  aria-label="Send as task"
                  className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground select-none hover:text-foreground"
                >
                  <span className={`inline-flex size-5 items-center justify-center rounded border ${asTask ? "border-primary" : "border-muted-foreground/30"}`}>
                    {asTask && <CheckSquare className="size-3.5 text-primary pointer-events-none" />}
                  </span>
                  As Task
                </button>
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
          </>
          )}
          </div>

          {activeThreadId && (
            <aside
              aria-label="Thread"
              className="relative shrink-0 border-l bg-background p-4"
              style={{ width: threadWidth }}
            >
              <div
                role="separator"
                aria-label="Resize thread panel"
                aria-orientation="vertical"
                aria-valuemin={THREAD_PANEL_MIN_WIDTH}
                aria-valuemax={THREAD_PANEL_MAX_WIDTH}
                aria-valuenow={threadWidth}
                tabIndex={0}
                data-testid="thread-panel-resize-handle"
                onPointerDown={handleThreadResizePointerDown}
                onKeyDown={handleThreadResizeKeyDown}
                className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:w-0.5 hover:after:bg-primary/60 focus-visible:after:w-0.5 focus-visible:after:bg-primary"
              />
              <div className="flex h-full flex-col">
                <div className="mb-3 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">Thread</h2>
                      {activeRoot && (
                        <p className="truncate text-xs text-muted-foreground">
                          {activeRoot.sender.replace(/^@/, "")} · {threadData?.replyCount ?? 0} {threadData?.replyCount === 1 ? "reply" : "replies"}
                        </p>
                      )}
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
                {threadData?.threadSummary?.summary && (
                  <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-foreground">
                    <span className="font-medium">Summary:</span> {threadData.threadSummary.summary}
                  </div>
                )}
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                  {activeRoot && (
                    <div className="group/message relative rounded-md border bg-card p-3 focus-within:ring-1 focus-within:ring-ring" tabIndex={0}>
                      <MessageFrame
                        member={memberForMessageSender(activeRoot.sender, activeRoot.senderType, allKnownMembers)}
                        senderType={activeRoot.senderType}
                        time={activeRoot.time}
                        timeVariant="compact"
                        avatarSize="sm"
                        showStatus={activeRoot.senderType === "agent"}
                        actions={
                          <div className="opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100">
                            {renderMessageActions(activeRoot)}
                          </div>
                        }
                      >
                      {taskLinks[activeRoot.id] && (
                        <Link
                          href={`/tasks?task=${encodeURIComponent(taskLinks[activeRoot.id])}`}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary hover:bg-primary/20"
                        >
                          <CheckSquare className="size-3" />
                          Open task
                        </Link>
                      )}
                      <MarkdownMessage content={activeRoot.content} compact />
                      {activeRoot.reactionCounts && Object.keys(activeRoot.reactionCounts).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(activeRoot.reactionCounts).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(activeRoot, emoji)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                                didReact(activeRoot, emoji)
                                  ? "border-primary/30 bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted"
                              }`}
                              aria-label={`${count} ${emoji} reactions`}
                            >
                              <span>{emoji}</span>
                              <span className="text-[0.7rem] font-medium">{count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {threadData?.threadSummary?.summary && (
                        <p className="mt-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
                          {threadData.threadSummary.summary}
                        </p>
                      )}
                      </MessageFrame>
                    </div>
                  )}

                  {threadLoading && <p className="py-8 text-center text-sm text-muted-foreground">Loading...</p>}
                  {activeReplies.map((msg) => (
                    <div key={msg.id} className="group/message relative rounded-md border bg-card p-3 focus-within:ring-1 focus-within:ring-ring" tabIndex={0}>
                      <MessageFrame
                        member={memberForMessageSender(msg.sender, msg.senderType, allKnownMembers)}
                        senderType={msg.senderType}
                        time={msg.time}
                        timeVariant="compact"
                        avatarSize="sm"
                        showStatus={msg.senderType === "agent"}
                        actions={
                          <div className="opacity-0 transition-opacity duration-150 group-hover/message:opacity-100 group-focus-within/message:opacity-100">
                            {renderMessageActions(msg)}
                          </div>
                        }
                      >
                      {taskLinks[msg.id] && (
                        <Link
                          href={`/tasks?task=${encodeURIComponent(taskLinks[msg.id])}`}
                          className="mt-2 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary hover:bg-primary/20"
                        >
                          <CheckSquare className="size-3" />
                          Open task
                        </Link>
                      )}
                      <MarkdownMessage content={msg.content} compact />
                      {msg.reactionCounts && Object.keys(msg.reactionCounts).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {Object.entries(msg.reactionCounts).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(msg, emoji)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                                didReact(msg, emoji)
                                  ? "border-primary/30 bg-primary/10 text-primary"
                                  : "border-border bg-background text-muted-foreground hover:bg-muted"
                              }`}
                              aria-label={`${count} ${emoji} reactions`}
                            >
                              <span>{emoji}</span>
                              <span className="text-[0.7rem] font-medium">{count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      </MessageFrame>
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
              className="w-64 shrink-0 border-l bg-background p-4 space-y-4 overflow-y-auto"
            >
              <h3 className="text-sm font-semibold">Members ({members.length})</h3>
              {members.map((m) => (
                <div
                  key={m.id}
                  data-testid={`channel-member-${m.displayName}`}
                  className="flex items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2 text-sm">
                    <MemberAvatar member={m} size="sm" />
                    <span className="truncate">{m.displayName}</span>
                    <span className="text-xs text-muted-foreground">{statusLabel(m.status)}</span>
                  </div>
                  {m.kind === "agent" && !currentIsDm && (
                    <button
                      aria-label={`Remove ${m.displayName}`}
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
                          {m.displayName} ({m.kind})
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
