"use client"

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  Activity,
  Bookmark,
  CheckSquare,
  Clipboard,
  Database,
  Files,
  ImageIcon,
  ListChecks,
  MessageCircle,
  Paperclip,
  Paintbrush,
  Plus,
  RotateCcw,
  Save,
  Send,
  Smile,
  Droplets,
  Trash2,
  Users,
  X,
} from "lucide-react"

import { MessageFrame } from "@/components/message-frame"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { EmptyState, RuntimeChip } from "@/components/product-ui"
import { MarkdownMessage } from "@/components/markdown-message"
import { AgentActivityList } from "@/components/agent-activity-list"
import { AttachmentSheet, AvatarObject, ChannelDivider, ChatComposerSurface, ChatTaskToggle, EventBadge, MemberNameTag, MessageToolStrip } from "@/components/inkframe-object-ui"
import { TaskBoard } from "@/components/task-board"
import { ChannelMemorySurface, MemoryProposalQueue } from "@/components/memory-entry-surface"
import { INKFRAME_DESK_PAPER_TINT, MaterialSurface, type MaterialPointerMode, type MaterialSurfaceMode } from "@/components/inkframe/material-surface"
import type { MaterialResource } from "@/components/inkframe/material-resource"
import { resolveAppDeskMaterialAction, type AppDeskMaterialAction } from "@/components/inkframe/app-desk-background"
import {
  apiGet,
  apiPost,
  apiDelete,
  apiHeaders,
  type Member,
  type MemoryEntry,
  type MemoryProposal,
  statusLabel,
  API_BASE,
  BROWSER_API_BASE,
} from "@/lib/control-plane"
import {
  applyHighWater,
  connectRealtimeEvents,
  mergeMessageById,
  shouldHandleRealtimeEvent,
  type HighWater,
  type PublicEventEnvelope,
} from "@/lib/realtime-events"
import { chatReadCursorRequestForThread, hasUnreadThreadActivity, markChatUnreadScope } from "@/lib/chat-unread-state"
import { channelMemberAddPayload } from "@/lib/channel-members"
import { memberForMessageSender } from "@/lib/member-avatar"

type ChannelInfo = {
  id: string
  name: string
  type: string
  description?: string
  latestSeq?: number
  unreadCount?: number
  hasUnread?: boolean
}
type DmInfo = {
  id: string
  name: string
  type: "dm"
  displayName: string
  peer?: Member | null
  latestSeq?: number
  unreadCount?: number
  hasUnread?: boolean
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
  threadLatestSeq?: number
  threadUnreadCount?: number
  hasThreadUnread?: boolean
  reactions?: ReactionItem[]
  reactionCounts?: Record<string, number>
}

const CHAT_SCROLL_TICK_COUNT = 12

function ChatScrollRail({ progress, visible }: { progress: number; visible: boolean }) {
  const activeIndex = Math.round(Math.max(0, Math.min(1, progress)) * (CHAT_SCROLL_TICK_COUNT - 1))

  return (
    <div
      aria-hidden="true"
      data-slot="chat-scroll-rail"
      data-visible={visible ? "true" : "false"}
      className="sk-chat-scroll-rail"
    >
      {Array.from({ length: CHAT_SCROLL_TICK_COUNT }, (_, index) => (
        <span
          key={index}
          data-active={index === activeIndex ? "true" : "false"}
          data-near={Math.abs(index - activeIndex) === 1 ? "true" : "false"}
          className="sk-chat-scroll-rail-tick"
        />
      ))}
    </div>
  )
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
  { key: "chat", labelKey: "tabChat", icon: MessageCircle, tone: "blue" },
  { key: "tasks", labelKey: "tabTasks", icon: ListChecks, tone: "rose" },
  { key: "memory", labelKey: "tabMemory", icon: Database, tone: "mint" },
  { key: "files", labelKey: "tabFiles", icon: Files, tone: "green" },
  { key: "activity", labelKey: "tabActivity", icon: Activity, tone: "purple" },
] as const
const THREAD_PANEL_WIDTH_KEY = "smallkhoj.chat.threadWidth"
const THREAD_PANEL_MIN_WIDTH = 320
const THREAD_PANEL_MAX_WIDTH = 760
const THREAD_PANEL_DEFAULT_WIDTH = 420

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
  const tChat = useTranslations("chat")
  const channelMemoryCopy = {
    title: tChat("tabMemory"),
    entryCount: (count: number) => tChat("memoryEntryCount", { count }),
    loading: tChat("memoryLoading"),
    empty: tChat("memoryEmpty"),
    channelKnowledge: tChat("memoryChannelKnowledge"),
    taskOutputs: tChat("memoryTaskOutputs"),
    artifactsAndProofs: tChat("memoryArtifacts"),
    promotions: tChat("memoryPromotions"),
    otherMemory: tChat("memoryOther"),
  }
  const memoryProposalCopy = {
    reviewQueue: tChat("memoryReviewQueue"),
    loading: tChat("memoryProposalLoading"),
    openProposals: tChat("memoryOpenProposals"),
    accept: tChat("memoryAccept"),
    reject: tChat("memoryReject"),
    acceptAria: (path: string) => tChat("memoryAcceptAria", { path }),
    rejectAria: (path: string) => tChat("memoryRejectAria", { path }),
    base: tChat("memoryBase"),
  }
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [allMembers, setAllMembers] = useState<Member[]>(initialAllMembers)
  const [channels, setChannels] = useState<ChannelInfo[]>(initialChannels)
  const [dms, setDms] = useState<DmInfo[]>(initialDms)
  const [input, setInput] = useState("")
  const [threadInput, setThreadInput] = useState("")
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId ?? null)
  const [threadUnreadRootIds, setThreadUnreadRootIds] = useState<Set<string>>(() => new Set())
  const [activeMaterialMessageId, setActiveMaterialMessageId] = useState<string | null>(null)
  const [activeMaterialPointerMode, setActiveMaterialPointerMode] = useState<MaterialPointerMode>("draw")
  const [messageMaterialModes, setMessageMaterialModes] = useState<Record<string, MaterialSurfaceMode>>({})
  const [messageMaterialResources, setMessageMaterialResources] = useState<Record<string, MaterialResource | null>>({})
  const [chatDeskMaterialMode, setChatDeskMaterialMode] = useState<MaterialSurfaceMode>("static")
  const [chatDeskPointerMode, setChatDeskPointerMode] = useState<MaterialPointerMode>("none")
  const [chatDeskMaterialResource, setChatDeskMaterialResource] = useState<MaterialResource | null>(null)
  const [threadData, setThreadData] = useState<ThreadData | null>(null)
  const [threadLoading, setThreadLoading] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [channelId, setChannelId] = useState(initialChannelId)
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(() => new Set())
  const [taskMessageIds, setTaskMessageIds] = useState<Set<string>>(() => new Set())
  const [taskLinks, setTaskLinks] = useState<Record<string, string>>({})
  const [asTask, setAsTask] = useState(false)
  const [activeTab, setActiveTab] = useState<"chat" | "tasks" | "memory" | "files" | "activity">("chat")
  const [files, setFiles] = useState<FileItem[]>([])
  const [filesLoading, setFilesLoading] = useState(false)
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([])
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryProposalLoading, setMemoryProposalLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [threadWidthOverride, setThreadWidthOverride] = useState<number | null>(null)
  const dragDepthRef = useRef(0)
  const addMemberSelectRef = useRef<HTMLSelectElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const chatDeskMaterialLayerRef = useRef<HTMLDivElement>(null)
  const chatDeskPointerForwardingRef = useRef(false)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const realtimeHighWaterRef = useRef(new Map<string, HighWater>())
  const [messageScrollState, setMessageScrollState] = useState({ progress: 0, visible: false })

  const storedThreadWidth = useSyncExternalStore(
    subscribePanelWidthStore,
    () => readStoredPanelWidth(THREAD_PANEL_WIDTH_KEY, THREAD_PANEL_DEFAULT_WIDTH, THREAD_PANEL_MIN_WIDTH, THREAD_PANEL_MAX_WIDTH),
    () => THREAD_PANEL_DEFAULT_WIDTH,
  )
  const threadWidth = threadWidthOverride ?? storedThreadWidth

  const currentChannel = channels.find((c) => c.name.replace("#", "") === channelName)
  const currentDm = dms.find((dm) => dm.name === channelName)
  const currentTitle = (() => {
    // DM 标题优先用 peer 的干净名字，绝不直接显示后端原始的 "DM @<uuid>"
    // （否则 hydration 后会闪一下长 id 才切到正确名字）。
    if (currentDm) {
      const peerName = currentDm.peer?.profile?.displayName || currentDm.peer?.displayName || currentDm.peer?.name
      return peerName || tChat("directMessage")
    }
    return currentChannel?.name ?? `#${channelName}`
  })()
  const currentIsDm = Boolean(currentDm)
  const dmAgent = currentDm?.peer?.kind === "agent" ? currentDm.peer : null
  const allKnownMembers = [...members, ...allMembers]
  const updateMessageScrollRail = useCallback(() => {
    const element = messageScrollRef.current
    if (!element) {
      setMessageScrollState({ progress: 0, visible: false })
      return
    }

    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
    const nextState = {
      progress: maxScroll > 0 ? element.scrollTop / maxScroll : 0,
      visible: maxScroll > 8,
    }
    setMessageScrollState((current) => {
      if (
        current.visible === nextState.visible &&
        Math.abs(current.progress - nextState.progress) < 0.005
      ) {
        return current
      }
      return nextState
    })
  }, [])

  const didReact = (message: ChannelMessage, emoji: string) =>
    Boolean(message.reactions?.some((r) => r.reaction === emoji && r.memberId === currentMemberId))
  const memberKindLabel = (kind: string) => kind === "agent" ? tChat("agentKind") : kind === "human" ? tChat("humanKind") : kind
  const messageRoleLabels = { assistant: tChat("agentKind"), member: tChat("members") }

  useEffect(() => {
    updateMessageScrollRail()
    const element = messageScrollRef.current
    if (!element) return

    let frame = 0
    const delayedFrame = requestAnimationFrame(updateMessageScrollRail)
    const delayedTimer = window.setTimeout(updateMessageScrollRail, 180)
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          cancelAnimationFrame(frame)
          frame = requestAnimationFrame(updateMessageScrollRail)
        })
    const onScrollOrResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(updateMessageScrollRail)
    }

    element.addEventListener("scroll", onScrollOrResize, { passive: true })
    window.addEventListener("resize", onScrollOrResize)
    resizeObserver?.observe(element)
    if (element.firstElementChild) resizeObserver?.observe(element.firstElementChild)

    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(delayedFrame)
      window.clearTimeout(delayedTimer)
      resizeObserver?.disconnect()
      element.removeEventListener("scroll", onScrollOrResize)
      window.removeEventListener("resize", onScrollOrResize)
    }
  }, [activeTab, messages.length, updateMessageScrollRail])

  const markVisibleThreadRead = useCallback(async (threadId: string, data: ThreadData) => {
    const replies = data.replies ?? (data.messages || []).filter((msg) => msg.parentId)
    const visibleMessages = data.thread ? [data.thread, ...replies] : replies
    const cursorRequest = chatReadCursorRequestForThread({ rootMessageId: threadId, messages: visibleMessages })
    if (!cursorRequest) return
    try {
      await apiPost("/api/v1/chat/read-cursors", cursorRequest, sessionToken)
      setMessages((previous) =>
        previous.map((message) => {
          const rootId = message.threadId || message.id
          if (rootId !== threadId && message.id !== threadId) return message
          return {
            ...message,
            threadUnreadCount: 0,
            hasThreadUnread: false,
          }
        }),
      )
      setThreadUnreadRootIds((previous) => {
        if (!previous.has(threadId)) return previous
        const next = new Set(previous)
        next.delete(threadId)
        return next
      })
    } catch (error) {
      console.warn("[chat] thread read cursor write failed", error)
    }
  }, [sessionToken])

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

  // Thread resize = ONE drag line between message area and thread. The message
  // area is flex-1 so it automatically shrinks as thread grows; only threadWidth
  // needs to change. The line is the shared boundary the user described.
  function handleThreadResizePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    startPanelResize(
      event,
      threadWidth,
      (width) => setPersistentPanelWidth(width, setThreadWidthOverride, THREAD_PANEL_WIDTH_KEY, THREAD_PANEL_MIN_WIDTH, THREAD_PANEL_MAX_WIDTH),
      "left-edge",
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
          if (!cancelled) {
            setThreadData(data)
            void markVisibleThreadRead(initialThreadId, data)
          }
        } finally {
          if (!cancelled) setThreadLoading(false)
        }
      }
    }
    void loadChannel()
    return () => { cancelled = true }
  }, [initialChannel, initialThreadId, markVisibleThreadRead, sessionToken])

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

  const refreshMemory = useCallback(async () => {
    if (!channelId) {
      setMemoryEntries([])
      setMemoryProposals([])
      return
    }
    setMemoryLoading(true)
    setMemoryProposalLoading(true)
    try {
      const [data, proposalData] = await Promise.all([
        apiGet<{ entries: MemoryEntry[] }>(
          `/api/v1/memory/scopes/channel/${encodeURIComponent(channelId)}`,
          { entries: [] },
          sessionToken,
        ),
        apiGet<{ proposals: MemoryProposal[] }>(
          `/api/v1/memory/scopes/channel/${encodeURIComponent(channelId)}/proposals?status=open`,
          { proposals: [] },
          sessionToken,
        ),
      ])
      setMemoryEntries(data.entries || [])
      setMemoryProposals(proposalData.proposals || [])
    } catch (e) {
      console.error("Refresh memory failed:", e)
      setMemoryEntries([])
      setMemoryProposals([])
    } finally {
      setMemoryLoading(false)
      setMemoryProposalLoading(false)
    }
  }, [channelId, sessionToken])

  const handleMemoryProposalDecision = useCallback(async (proposal: MemoryProposal, decision: "accept" | "reject") => {
    try {
      await apiPost(
        `/api/v1/memory/proposals/${encodeURIComponent(proposal.id)}/${decision}`,
        { reviewNote: decision === "accept" ? "Accepted from channel memory review queue." : "Rejected from channel memory review queue." },
        sessionToken,
      )
      await refreshMemory()
    } catch (e) {
      console.error("Memory proposal decision failed:", e)
      alert(`Memory proposal update failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [refreshMemory, sessionToken])

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
      void markVisibleThreadRead(threadId, data)
    } finally {
      setThreadLoading(false)
    }
  }, [activeThreadId, markVisibleThreadRead, sessionToken])

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

  // Refresh the workspace-wide member list (all agents + humans). The active
  // agents panel reads from this state, so it must be re-fetched on
  // member.status.updated / member.updated events for the panel to stay live.
  const refreshAllMembers = useCallback(async () => {
    try {
      const data = await apiGet<{ members: Member[] }>(`/api/v1/members`, { members: [] }, sessionToken)
      setAllMembers(data.members || [])
    } catch {
      // leave existing list in place on error
    }
  }, [sessionToken])

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
          void refreshAllMembers()
          return
        }
        if (!shouldHandleRealtimeEvent(event, { channelId, channelName })) {
          // Event belongs to another channel/DM or to a non-chat scope:
          // refresh sidebar lists so unread/new channels are visible.
          if (event.type === "message.created" && (event.scope.kind === "channel" || event.scope.kind === "dm")) {
            markChatUnreadScope(
              typeof window === "undefined" ? undefined : window.localStorage,
              typeof window === "undefined" ? undefined : window,
              event.scope,
              event.seq,
            )
          }
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
            const channelMessage = message as ChannelMessage
            if (channelMessage.parentId) {
              const rootId = channelMessage.threadId || channelMessage.parentId
              if (rootId && rootId !== activeThreadId) {
                setThreadUnreadRootIds((previous) => {
                  const next = new Set(previous)
                  next.add(rootId)
                  return next
                })
              }
            }
            setMessages((previous) => mergeMessageById(previous, channelMessage))
          } else {
            scheduleCatchUp()
          }
          return
        }
        if (event.type.startsWith("memory.")) {
          void refreshMemory()
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
  }, [activeThreadId, channelId, channelName, refreshChannelsAndDms, refreshMembers, refreshAllMembers, refreshMemory, refreshMessages, refreshThread, sessionToken])

  async function openThread(message: ChannelMessage) {
    const threadId = message.threadId || message.id
    setActiveThreadId(threadId)
    setThreadUnreadRootIds((previous) => {
      if (!previous.has(threadId) && !previous.has(message.id)) return previous
      const next = new Set(previous)
      next.delete(threadId)
      next.delete(message.id)
      return next
    })
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

  function setMessageMaterialResource(messageId: string, resource: MaterialResource | null) {
    setMessageMaterialResources((previous) => {
      const next = { ...previous }
      if (resource) next[messageId] = resource
      else delete next[messageId]
      return next
    })
  }

  function setMessageMaterialMode(messageId: string, mode: MaterialSurfaceMode) {
    setMessageMaterialModes((previous) => {
      const next = { ...previous, [messageId]: mode }
      if (mode === "static") delete next[messageId]
      return next
    })
    if (mode === "static" || mode === "fallback") {
      setActiveMaterialMessageId((current) => (current === messageId ? null : current))
    }
  }

  function activateMessageMaterial(messageId: string, pointerMode: MaterialPointerMode) {
    setActiveMaterialMessageId(messageId)
    setActiveMaterialPointerMode(pointerMode)
    setMessageMaterialModes((previous) => ({ ...previous, [messageId]: "active" }))
  }

  function requestMessageMaterialAction(messageId: string, mode: Extract<MaterialSurfaceMode, "keeping" | "discarding">) {
    setActiveMaterialMessageId(messageId)
    setActiveMaterialPointerMode("none")
    setMessageMaterialModes((previous) => ({ ...previous, [messageId]: mode }))
  }

  function requestChatDeskMaterialAction(action: AppDeskMaterialAction) {
    const next = resolveAppDeskMaterialAction(action)
    setChatDeskPointerMode(next.pointerMode)
    setChatDeskMaterialMode(next.mode)
  }

  function isChatDeskMaterialCapturing() {
    return chatDeskMaterialMode === "active" && chatDeskPointerMode !== "none"
  }

  function forwardChatDeskPointerEvent(event: ReactPointerEvent<HTMLElement>) {
    const materialSurface = chatDeskMaterialLayerRef.current?.querySelector<HTMLElement>('[data-slot="material-surface"]')
    if (!materialSurface || typeof window === "undefined") return
    const PointerCtor = window.PointerEvent ?? window.MouseEvent
    materialSurface.dispatchEvent(new PointerCtor(event.type, {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      button: event.button,
      buttons: event.buttons,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      pressure: event.pressure,
      movementX: event.movementX,
      movementY: event.movementY,
    } as PointerEventInit))
  }

  function handleChatDeskPointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isChatDeskMaterialCapturing()) return
    event.preventDefault()
    event.stopPropagation()
    chatDeskPointerForwardingRef.current = true
    forwardChatDeskPointerEvent(event)
  }

  function handleChatDeskPointerMoveCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!chatDeskPointerForwardingRef.current) return
    event.preventDefault()
    event.stopPropagation()
    forwardChatDeskPointerEvent(event)
  }

  function handleChatDeskPointerUpCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (!chatDeskPointerForwardingRef.current) return
    event.preventDefault()
    event.stopPropagation()
    forwardChatDeskPointerEvent(event)
    chatDeskPointerForwardingRef.current = false
  }

  function messageMaterialMode(messageId: string): MaterialSurfaceMode {
    return messageMaterialModes[messageId] ?? (activeMaterialMessageId === messageId ? "active" : "static")
  }

  function renderMessageActions(message: ChannelMessage) {
    const hasReacted = didReact(message, "👍")
    const isSaved = savedMessageIds.has(message.id)
    const isTasked = taskMessageIds.has(message.id)
    const isMaterialActive = activeMaterialMessageId === message.id
    const materialMode = messageMaterialMode(message.id)
    const isDrawing = isMaterialActive && materialMode === "active" && activeMaterialPointerMode === "draw"
    const isWatering = isMaterialActive && materialMode === "active" && activeMaterialPointerMode === "water"
    const hasMaterialResource = Boolean(messageMaterialResources[message.id])
    return (
      <MessageToolStrip>
        <button
          type="button"
          data-slot="message-material-pen"
          data-active={isDrawing ? "true" : "false"}
          onClick={() => {
            if (isDrawing) setMessageMaterialMode(message.id, "static")
            else activateMessageMaterial(message.id, "draw")
          }}
          aria-label="Annotate message"
          title="Annotate message"
          className={`inline-flex size-6 items-center justify-center rounded-none focus-visible:ring-2 focus-visible:ring-ring ${
            isDrawing ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Paintbrush className="size-3.5" />
        </button>
        <button
          type="button"
          data-slot="message-material-water"
          data-active={isWatering ? "true" : "false"}
          onClick={() => activateMessageMaterial(message.id, "water")}
          aria-label="Water annotation"
          title="Water annotation"
          className={`inline-flex size-6 items-center justify-center rounded-none focus-visible:ring-2 focus-visible:ring-ring ${
            isWatering ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Droplets className="size-3.5" />
        </button>
        <button
          type="button"
          data-slot="message-material-keep"
          disabled={!isMaterialActive}
          onClick={() => requestMessageMaterialAction(message.id, "keeping")}
          aria-label="Keep annotation"
          title="Keep annotation"
          className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
        >
          <Save className="size-3.5" />
        </button>
        <button
          type="button"
          data-slot="message-material-discard"
          disabled={!isMaterialActive && !hasMaterialResource}
          onClick={() => requestMessageMaterialAction(message.id, "discarding")}
          aria-label="Clear annotation"
          title="Clear annotation"
          className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
        >
          <RotateCcw className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => openThread(message)}
          aria-label={tChat("replyInThread")}
          title={tChat("reply")}
          className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MessageCircle className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => toggleReaction(message, "👍")}
          aria-label={tChat("react")}
          title={tChat("react")}
          className={`inline-flex size-6 items-center justify-center rounded-none focus-visible:ring-2 focus-visible:ring-ring ${
            hasReacted ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Smile className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => void toggleSaved(message.id)}
          aria-label={tChat("saveMessage")}
          title={tChat("saveMessage")}
          className={`inline-flex size-6 items-center justify-center rounded-none focus-visible:ring-2 focus-visible:ring-ring ${
            isSaved ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <Bookmark className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleCreateTaskFromMessage(message)}
          aria-label={tChat("createTaskFromMessage")}
          title={tChat("asTask")}
          className={`inline-flex size-6 items-center justify-center rounded-none focus-visible:ring-2 focus-visible:ring-ring ${
            isTasked ? "text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <CheckSquare className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => handleCopyMessage(message)}
          aria-label={tChat("copyMessage")}
          title={tChat("copyMessage")}
          className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Clipboard className="size-3.5" />
        </button>
      </MessageToolStrip>
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
    if (!window.confirm(tChat("deleteChannelConfirm", { channel: currentChannel.name }))) return
    try {
      await apiDelete(`/api/v1/channels/${currentChannel.id}`, sessionToken)
      window.location.assign("/chat")
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
  const headerDmMember = currentDm ? dmAvatarMember(currentDm) : null

  return (
    <div className="sk-chat-main flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-chat-root data-region="chat-main" data-inkframe-mobile-role="chat-workspace">
        <header className="sk-chat-channel-header shrink-0 border-b px-4 py-2">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {headerDmMember ? (
                <AvatarObject member={headerDmMember} size="sm" />
              ) : (
                <ChannelDivider kind="channel" active>
                  <Avatar size="sm" name={currentTitle} />
                </ChannelDivider>
              )}
              <div className="min-w-0">
                <h1 className="truncate text-sm font-semibold leading-tight">
                  <ChannelDivider kind={currentIsDm ? "dm" : "channel"} active className="min-h-0 py-1 text-sm">
                    {currentTitle}
                  </ChannelDivider>
                </h1>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-sand-muted">
                  <RuntimeChip>{currentIsDm ? tChat("directMessageChip") : tChat("channel")}</RuntimeChip>
                </div>
              </div>
            </div>
            {/* Tab strip — each tab carries its functional accent color
                (blue/rose/mint/green/purple). Active = solid accent + white text,
                inactive = soft accent + dark text. All combos are contrast-safe. */}
            <div
              data-inkframe-mobile-role="chat-tab-strip"
              className="ml-4 flex min-w-0 flex-1 gap-1 overflow-x-auto border-l pl-4"
            >
              {conversationTabs.map(({ key, labelKey, icon: Icon, tone }) => {
                const tabKey = key as "chat" | "tasks" | "memory" | "files" | "activity"
                const label = tChat(labelKey)
                const isActive = activeTab === tabKey
                // full static class strings (so they survive CSS purging/merge);
                // active = solid accent + white text, inactive = soft accent + dark text
                const tabClass: Record<string, { on: string; off: string }> = {
                  blue: { on: "sk-accent-blue", off: "sk-accent-blue-soft" },
                  rose: { on: "sk-accent-rose", off: "sk-accent-rose-soft" },
                  mint: { on: "sk-accent-mint", off: "sk-accent-mint-soft" },
                  green: { on: "sk-accent-green", off: "sk-accent-green-soft" },
                  purple: { on: "sk-accent-purple", off: "sk-accent-purple-soft" },
                }
                return (
                  <Button
                    key={key}
                    type="button"
                    size="sm"
                    variant="outline"
                    className={`${isActive ? tabClass[tone].on : tabClass[tone].off} border-[var(--ink)]`}
                    onClick={() => {
                      setActiveTab(tabKey)
                      if (tabKey === "files") void refreshFiles()
                      if (tabKey === "memory") void refreshMemory()
                    }}
                  >
                    <Icon className="size-3.5" />
                    {label}
                  </Button>
                )
              })}
            </div>
            <div className="ml-auto flex items-center gap-1">
              {activeTab === "chat" && (
                <div className="flex items-center gap-0.5" data-slot="chat-desk-material-controls">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant={chatDeskMaterialMode === "active" && chatDeskPointerMode === "draw" ? "default" : "outline"}
                    onClick={() => requestChatDeskMaterialAction("draw")}
                    aria-label="Draw on chat desk"
                    title="Draw on chat desk"
                  >
                    <Paintbrush className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant={chatDeskMaterialMode === "active" && chatDeskPointerMode === "water" ? "default" : "outline"}
                    onClick={() => requestChatDeskMaterialAction("water")}
                    aria-label="Wash chat desk"
                    title="Wash chat desk"
                  >
                    <Droplets className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={chatDeskMaterialMode !== "active"}
                    onClick={() => requestChatDeskMaterialAction("keep")}
                    aria-label="Keep chat desk"
                    title="Keep chat desk"
                  >
                    <Save className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={chatDeskMaterialMode !== "active" && !chatDeskMaterialResource}
                    onClick={() => requestChatDeskMaterialAction("discard")}
                    aria-label="Clear chat desk"
                    title="Clear chat desk"
                  >
                    <RotateCcw className="size-3.5" />
                  </Button>
                </div>
              )}
              {!currentIsDm && (
                <Button
                  type="button"
                  size="sm"
                  variant={showMembers ? "default" : "outline"}
                  onClick={() => setShowMembers((v) => !v)}
                  aria-pressed={showMembers}
                >
                  <Users className="size-3.5" />
                  {tChat("membersCount", { count: members.length })}
                </Button>
              )}
              {!currentIsDm && currentChannel?.id && (
                <button
                  type="button"
                  aria-label={tChat("deleteChannel")}
                  title={tChat("deleteChannel")}
                  onClick={handleDeleteChannel}
                  className="inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </header>

        <div className="sk-chat-content flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isDragOver && (
              <div className="pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center rounded-none border-2 border-dashed border-[var(--ink)] bg-[var(--accent-blue-soft)]">
                <Files className="size-7 text-accent-blue" />
                <p className="mt-2 text-sm font-medium">{tChat("dropFileTitle")}</p>
                <p className="text-xs text-sand-muted">
                  {channelId ? tChat("dropFileReady") : tChat("dropFileNoChannel")}
                </p>
              </div>
            )}
            {activeTab === "activity" ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
                <div className="mr-auto w-full max-w-[1248px]">
                  {dmAgent ? (
                    <AgentActivityList agentId={dmAgent.id} runtimeOnly limit={40} />
                  ) : (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      {tChat("activityAgentOnly")}
                    </p>
                  )}
                </div>
              </div>
            ) : activeTab === "tasks" ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
                  <TaskBoard
                    channelName={currentChannel?.name ?? currentDm?.name ?? channelName}
                    initialView="board"
                    showDetail
                    sessionToken={sessionToken}
                  />
              </div>
            ) : activeTab === "memory" ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
                <div className="mr-auto w-full max-w-[1248px]">
                  <MemoryProposalQueue
                    proposals={memoryProposals}
                    loading={memoryProposalLoading}
                    onAccept={(proposal) => void handleMemoryProposalDecision(proposal, "accept")}
                    onReject={(proposal) => void handleMemoryProposalDecision(proposal, "reject")}
                    copy={memoryProposalCopy}
                  />
                </div>
                <ChannelMemorySurface entries={memoryEntries} loading={memoryLoading} channelTitle={currentTitle} copy={channelMemoryCopy} />
              </div>
            ) : activeTab === "files" ? (
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
                <div className="mr-auto w-full max-w-[1248px]">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{tChat("filesTitle")}</h2>
                    <span className="text-xs text-sand-muted">{tChat("fileCount", { count: files.length })}</span>
                  </div>
                  {filesLoading && <p className="py-12 text-center text-sm text-muted-foreground">{tChat("filesLoading")}</p>}
                  {!filesLoading && files.length === 0 && (
                    <p className="py-12 text-center text-sm text-muted-foreground">{tChat("noFiles", { channel: currentTitle })}</p>
                  )}
                  <ul className="space-y-2">
                    {files.map((file) => {
                      const uploader = allMembers.find((m) => m.id === file.uploadedBy) ?? members.find((m) => m.id === file.uploadedBy)
                      const isImage = file.mimeType.startsWith("image/")
                      return (
                        <li key={file.id} className="group/file">
                          <AttachmentSheet kind={isImage ? "image" : "file"} className="flex items-center gap-3 px-3 py-2.5">
                            <div className={`sk-attachment-sheet-icon flex size-8 shrink-0 items-center justify-center rounded-none ${isImage ? "text-accent-green" : "text-sand-muted"}`}>
                              {isImage ? <ImageIcon className="size-4" /> : <Files className="size-4" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-sm font-medium">{file.originalName}</span>
                                <span className="shrink-0 text-xs text-sand-muted">{formatFileSize(file.size)}</span>
                              </div>
                              <div className="mt-0.5 flex items-center gap-2 text-xs text-sand-muted">
                                <span>{uploader?.displayName || tChat("unknown")}</span>
                                {file.createdAt && (
                                  <>
                                    <span>·</span>
                                    <span>{new Date(file.createdAt).toLocaleString()}</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-1">
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
                                  title={tChat("openMessage")}
                                  className="inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                  <MessageCircle className="size-3.5" />
                                </button>
                              )}
                              {file.previewUrl && (
                                <a
                                  href={`${BROWSER_API_BASE}${file.previewUrl}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={tChat("preview")}
                                  className="inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
                                >
                                  <ImageIcon className="size-3.5" />
                                </a>
                              )}
                              <a
                                href={`${BROWSER_API_BASE}${file.url}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={tChat("download")}
                                className="inline-flex size-7 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <Files className="size-3.5" />
                              </a>
                            </div>
                          </AttachmentSheet>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            ) : (
              <>
                <div ref={messageListRef} data-testid="chat-message-list" data-region="message-list" data-inkframe-mobile-role="chat-message-list" className="sk-chat-message-list relative isolate min-h-0 min-w-0 flex-1 overflow-hidden">
                <ChatScrollRail progress={messageScrollState.progress} visible={messageScrollState.visible} />
                <div
                  ref={chatDeskMaterialLayerRef}
                  data-slot="chat-desk-material-layer"
                  data-inkframe-purpose="chat-desk-canvas"
                  data-captures-pointer={chatDeskMaterialMode === "active" && chatDeskPointerMode !== "none" ? "true" : "false"}
                  className="sk-chat-desk-material-layer pointer-events-none absolute inset-0 z-0 data-[captures-pointer=true]:pointer-events-auto data-[captures-pointer=true]:cursor-crosshair"
                >
                  <MaterialSurface
                    ownerKind="app-background"
                    ownerId={`chat-desk:${channelName}`}
                    region="chat-main"
                    tint="desk"
                    mode={chatDeskMaterialMode}
                    pointerMode={chatDeskPointerMode}
                    waterStyle="wash"
                    washableFixedInk
                    paperTint={INKFRAME_DESK_PAPER_TINT}
                    vignette={0}
                    cleanPaper
                    resource={chatDeskMaterialResource}
                    onResourceChange={setChatDeskMaterialResource}
                    onModeChange={setChatDeskMaterialMode}
                    className="sk-chat-desk-material-surface absolute inset-0 min-h-full !border-0 !bg-transparent"
                  >
                    <div data-slot="chat-desk-static" className="sk-chat-desk-static absolute inset-0" />
                  </MaterialSurface>
                </div>
                <div
                  ref={messageScrollRef}
                  data-slot="chat-message-scroll"
                  onPointerDownCapture={handleChatDeskPointerDownCapture}
                  onPointerMoveCapture={handleChatDeskPointerMoveCapture}
                  onPointerUpCapture={handleChatDeskPointerUpCapture}
                  onPointerCancelCapture={handleChatDeskPointerUpCapture}
                  onScroll={updateMessageScrollRail}
                  className={`sk-chat-message-scroll pointer-events-auto relative z-10 h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4`}
                >
                <div className="sk-chat-message-stack pointer-events-none relative mr-auto w-full max-w-[1248px] min-w-0 space-y-3">
                {messages.map((msg) => {
                  const isSaved = savedMessageIds.has(msg.id)
                  const senderMember = memberForMessageSender(msg.sender, msg.senderType, allKnownMembers)
                  const hasThreadUnread = hasUnreadThreadActivity(msg, threadUnreadRootIds)
                  return (
                    <div
                      key={msg.id}
                      data-testid={`message-${msg.id}`}
                      className={`group/message relative -mx-2 min-w-0 px-2 py-1.5 pointer-events-none transition-colors ${
                        isSaved ? "sk-accent-rose-soft/40" : ""
                      }`}
                      tabIndex={0}
                    >
                      <div className={isChatDeskMaterialCapturing() ? "pointer-events-none" : "pointer-events-auto"}>
                      <MessageFrame
                        member={senderMember}
                        senderType={msg.senderType}
                        agentId={senderMember.kind === "agent" ? senderMember.id : undefined}
                        time={msg.time}
                        contentLength={msg.content.length}
                        avatarSize="lg"
                        showStatus={senderMember.kind === "agent"}
                        roleLabels={messageRoleLabels}
                        materialSurface={{
                          ownerId: msg.id,
                          mode: messageMaterialMode(msg.id),
                          pointerMode: activeMaterialMessageId === msg.id ? activeMaterialPointerMode : "none",
                          resource: messageMaterialResources[msg.id] ?? null,
                          onResourceChange: (resource) => setMessageMaterialResource(msg.id, resource),
                          onModeChange: (mode) => setMessageMaterialMode(msg.id, mode),
                        }}
                        badges={
                          <>
                            {isSaved && (
                              <Bookmark className="size-3 text-accent-rose" aria-label={tChat("savedBadge")} />
                            )}
                            {taskLinks[msg.id] && (
                              <Link
                                href={`/tasks?task=${encodeURIComponent(taskLinks[msg.id])}`}
                                className="inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] sk-accent-rose-soft px-1.5 py-0.5 text-[0.7rem] font-medium hover:opacity-85"
                              >
                                <CheckSquare className="size-3" />
                                {tChat("taskBadge")}
                              </Link>
                            )}
                          </>
                        }
                        actions={renderMessageActions(msg)}
                      >
                      <MarkdownMessage content={msg.content} />
                      {(msg.replyCount || msg.threadSummary) && (
                        <div className="mt-1.5 pl-10">
                          {msg.threadSummary?.summary && (
                            <p className="mb-1 text-xs text-sand-muted">{msg.threadSummary.summary}</p>
                          )}
                          <button
                            type="button"
                            onClick={() => openThread(msg)}
                            className="inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] bg-paper px-1.5 py-0.5 text-xs font-medium text-accent-blue hover:sk-accent-blue-soft"
                          >
                            <MessageCircle className="size-3" />
                            {msg.replyCount ? tChat("replyCount", { count: msg.replyCount }) : tChat("reply")}
                            {hasThreadUnread ? (
                              <EventBadge active label={tChat("unread", { count: 1 })} />
                            ) : null}
                          </button>
                        </div>
                      )}
                      {msg.reactionCounts && Object.keys(msg.reactionCounts).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {Object.entries(msg.reactionCounts).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(msg, emoji)}
                              className={`inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] px-2 py-0.5 text-xs transition-colors ${
                                didReact(msg, emoji)
                                  ? "sk-accent-rose-soft"
                                  : "bg-paper text-sand-ink hover:bg-muted/60"
                              }`}
                              aria-label={tChat("reactionCount", { count, reaction: emoji })}
                            >
                              <span>{emoji}</span>
                              <span className="text-[0.7rem] font-medium">{count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      </MessageFrame>
                      </div>
                    </div>
                  )
                })}
                {messages.length === 0 && (
                  <EmptyState
                    title={tChat("noMessages", { channel: currentTitle })}
                    description={currentDm ? tChat("dmComposePlaceholder", { peer: currentTitle.replace(/^DM @/, "") }) : tChat("composePlaceholder", { channel: currentTitle.replace(/^#/, "") })}
                    className="sk-chat-empty-note"
                  />
                )}
                <div ref={messageEndRef} data-testid="chat-message-list-end" aria-hidden="true" />
              </div>
              </div>
            </div>

            <div data-region="composer" data-inkframe-mobile-role="chat-composer" className="sk-chat-composer min-w-0 shrink-0 overflow-x-hidden border-t-2 border-[var(--ink)] p-3">
              <ChatComposerSurface className="mr-auto flex w-full max-w-[1248px] min-w-0 flex-wrap items-end gap-2">
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
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={tChat("attachFile")}
                  title={tChat("attachFile")}
                  disabled={uploading || !channelId}
                  onClick={() => openFilePicker()}
                >
                  <Paperclip className="size-3.5" />
                </Button>
                <Input
                  name="content"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={currentDm ? tChat("dmComposePlaceholder", { peer: currentTitle.replace(/^DM @/, "") }) : tChat("composePlaceholder", { channel: currentTitle.replace(/^#/, "") })}
                  className="min-w-0 flex-1"
                  style={{ backgroundColor: "var(--paper)" }}
                />
                <ChatTaskToggle
                  active={asTask}
                  onClick={() => setAsTask(!asTask)}
                  aria-pressed={asTask}
                  aria-label={tChat("sendAsTask")}
                  title={tChat("asTask")}
                >
                  <span data-slot="chat-task-toggle-mark" className="sk-chat-task-toggle-mark">
                    {asTask && <CheckSquare className="size-3 pointer-events-none" />}
                  </span>
                  {tChat("asTask")}
                </ChatTaskToggle>
                <Button
                  type="button"
                  size="icon"
                  aria-label={tChat("sendMessage")}
                  onClick={handleSend}
                  disabled={!input.trim()}
                >
                  <Send className="size-3.5" />
                </Button>
              </ChatComposerSurface>
            </div>
          </>
          )}
          </div>

          {activeThreadId && (
            <aside
              aria-label={tChat("thread")}
              data-region="thread-panel"
              data-inkframe-mobile-role="chat-thread-panel"
              className="sk-chat-thread-panel relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l-2 border-[var(--ink)] p-4"
              style={{ width: threadWidth }}
            >
              <div
                role="separator"
                aria-label={tChat("thread")}
                aria-orientation="vertical"
                aria-valuemin={THREAD_PANEL_MIN_WIDTH}
                aria-valuemax={THREAD_PANEL_MAX_WIDTH}
                aria-valuenow={threadWidth}
                tabIndex={0}
                data-testid="thread-panel-resize-handle"
                onPointerDown={handleThreadResizePointerDown}
                onKeyDown={handleThreadResizeKeyDown}
                className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:w-0.5 hover:after:bg-[var(--ink)] focus-visible:after:w-0.5 focus-visible:after:bg-[var(--ink)]"
              />
              <div className="flex h-full flex-col">
                <div className="mb-2 flex items-center justify-between gap-3 border-b pb-2">
                    <div className="min-w-0">
                      <h2 className="truncate text-sm font-semibold">{tChat("thread")}</h2>
                      {activeRoot && (
                        <p className="truncate text-xs text-sand-muted">
                          {activeRoot.sender.replace(/^@/, "")} · {tChat("replyCount", { count: threadData?.replyCount ?? 0 })}
                        </p>
                      )}
                    </div>
                    <button
                    type="button"
                    aria-label={tChat("closeThread")}
                    onClick={() => {
                      setActiveThreadId(null)
                      setThreadData(null)
                    }}
                    className="inline-flex size-7 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                {threadData?.threadSummary?.summary && (
                  <p className="mb-2 text-xs text-sand-muted">
                    <span className="font-medium text-foreground">{tChat("summary")}</span> {threadData.threadSummary.summary}
                  </p>
                )}

                <div className="min-h-0 min-w-0 flex-1 space-y-1 overflow-x-hidden overflow-y-auto pr-1">
                  {activeRoot && (
                    <div className="group/message relative -mx-1 px-1 py-1.5 rounded-none" tabIndex={0}>
                      <MessageFrame
                        member={memberForMessageSender(activeRoot.sender, activeRoot.senderType, allKnownMembers)}
                        senderType={activeRoot.senderType}
                        agentId={activeRoot.senderType === "agent" ? memberForMessageSender(activeRoot.sender, activeRoot.senderType, allKnownMembers).id : undefined}
                        time={activeRoot.time}
                        contentLength={activeRoot.content.length}
                        timeVariant="compact"
                        avatarSize="sm"
                        showStatus={activeRoot.senderType === "agent"}
                        roleLabels={messageRoleLabels}
                        materialSurface={{
                          ownerId: activeRoot.id,
                          mode: messageMaterialMode(activeRoot.id),
                          pointerMode: activeMaterialMessageId === activeRoot.id ? activeMaterialPointerMode : "none",
                          resource: messageMaterialResources[activeRoot.id] ?? null,
                          onResourceChange: (resource) => setMessageMaterialResource(activeRoot.id, resource),
                          onModeChange: (mode) => setMessageMaterialMode(activeRoot.id, mode),
                        }}
                        actions={renderMessageActions(activeRoot)}
                      >
                      {taskLinks[activeRoot.id] && (
                        <Link
                          href={`/tasks?task=${encodeURIComponent(taskLinks[activeRoot.id])}`}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] sk-accent-rose-soft px-1.5 py-0.5 text-[0.7rem] font-medium hover:opacity-85"
                        >
                          <CheckSquare className="size-3" />
                          {tChat("openTask")}
                        </Link>
                      )}
                      <MarkdownMessage content={activeRoot.content} compact />
                      {activeRoot.reactionCounts && Object.keys(activeRoot.reactionCounts).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {Object.entries(activeRoot.reactionCounts).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(activeRoot, emoji)}
                              className={`inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] px-2 py-0.5 text-xs transition-colors ${
                                didReact(activeRoot, emoji)
                                  ? "sk-accent-rose-soft"
                                  : "bg-paper text-sand-ink hover:bg-muted/60"
                              }`}
                              aria-label={tChat("reactionCount", { count, reaction: emoji })}
                            >
                              <span>{emoji}</span>
                              <span className="text-[0.7rem] font-medium">{count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      </MessageFrame>
                    </div>
                  )}

                  {threadLoading && <p className="py-8 text-center text-sm text-muted-foreground">{tChat("threadLoading")}</p>}
                  {activeReplies.map((msg) => (
                    <div key={msg.id} className="group/message relative -mx-1 px-1 py-1.5 rounded-none" tabIndex={0}>
                      <MessageFrame
                        member={memberForMessageSender(msg.sender, msg.senderType, allKnownMembers)}
                        senderType={msg.senderType}
                        agentId={msg.senderType === "agent" ? memberForMessageSender(msg.sender, msg.senderType, allKnownMembers).id : undefined}
                        time={msg.time}
                        contentLength={msg.content.length}
                        timeVariant="compact"
                        avatarSize="sm"
                        showStatus={msg.senderType === "agent"}
                        roleLabels={messageRoleLabels}
                        materialSurface={{
                          ownerId: msg.id,
                          mode: messageMaterialMode(msg.id),
                          pointerMode: activeMaterialMessageId === msg.id ? activeMaterialPointerMode : "none",
                          resource: messageMaterialResources[msg.id] ?? null,
                          onResourceChange: (resource) => setMessageMaterialResource(msg.id, resource),
                          onModeChange: (mode) => setMessageMaterialMode(msg.id, mode),
                        }}
                        actions={renderMessageActions(msg)}
                      >
                      {taskLinks[msg.id] && (
                        <Link
                          href={`/tasks?task=${encodeURIComponent(taskLinks[msg.id])}`}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] sk-accent-rose-soft px-1.5 py-0.5 text-[0.7rem] font-medium hover:opacity-85"
                        >
                          <CheckSquare className="size-3" />
                          {tChat("openTask")}
                        </Link>
                      )}
                      <MarkdownMessage content={msg.content} compact />
                      {msg.reactionCounts && Object.keys(msg.reactionCounts).length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {Object.entries(msg.reactionCounts).map(([emoji, count]) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => toggleReaction(msg, emoji)}
                              className={`inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] px-2 py-0.5 text-xs transition-colors ${
                                didReact(msg, emoji)
                                  ? "sk-accent-rose-soft"
                                  : "bg-paper text-sand-ink hover:bg-muted/60"
                              }`}
                              aria-label={tChat("reactionCount", { count, reaction: emoji })}
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
                    <p className="py-8 text-center text-sm text-muted-foreground">{tChat("noReplies")}</p>
                  )}
                </div>

                <div className="mt-3 flex shrink-0 gap-2 border-t pt-3 min-w-0 overflow-x-hidden">
                  <Input
                    value={threadInput}
                    onChange={(e) => setThreadInput(e.target.value)}
                    onKeyDown={handleThreadKeyDown}
                    placeholder={tChat("replyPlaceholder")}
                    className="min-w-0 flex-1"
                    style={{ backgroundColor: "var(--paper)" }}
                  />
                  <Button
                    type="button"
                    size="icon"
                    aria-label={tChat("sendThreadReply")}
                    onClick={handleThreadSend}
                    disabled={!threadInput.trim()}
                  >
                    <Send className="size-4" />
                  </Button>
                </div>
              </div>
            </aside>
          )}

          {!activeThreadId && showMembers && (
            <aside
              aria-label={tChat("channelMembers")}
              data-region="members-panel"
              data-inkframe-mobile-role="chat-members-panel"
              className="sk-chat-members-panel flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden border-l-2 border-[var(--ink)]"
            >
              {/* drawer header: title + close */}
              <div className="flex shrink-0 items-center justify-between border-b-2 border-[var(--ink)] px-3 py-2">
                <h3 className="text-xs font-semibold text-sand-ink">
                  {tChat("membersCount", { count: members.length })}
                </h3>
                <button
                  type="button"
                  aria-label={tChat("channelMembers")}
                  onClick={() => setShowMembers(false)}
                  className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* add member on TOP (was buried at the bottom) */}
              {!currentIsDm && (
                <div className="shrink-0 space-y-1.5 border-b-2 border-[var(--ink)] p-3">
                  <h4 className="text-xs font-semibold text-sand-muted">{tChat("addMember")}</h4>
                  <div className="flex gap-1">
                    <Select
                      id="add-channel-member-select"
                      aria-label={tChat("addChannelMember")}
                      data-testid="add-channel-member-select"
                      name="memberId"
                      ref={addMemberSelectRef}
                      items={allMembers
                        .filter((m) => !members.some((cm) => cm.id === m.id))
                        .map((m) => ({ value: m.id, label: `${m.displayName} (${memberKindLabel(m.kind)})` }))}
                      emptyLabel={tChat("selectMember")}
                      className="h-7 min-w-0 flex-1 px-1.5 py-1 text-xs"
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      aria-label={tChat("addMemberToChannel")}
                      onClick={handleAddMember}
                    >
                      <Plus className="size-3" />
                    </Button>
                  </div>
                </div>
              )}

              {/* member list */}
              <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
                <ul className="space-y-0.5">
                  {members.map((m) => (
                    <li
                      key={m.id}
                      data-testid={`channel-member-${m.displayName}`}
                      className="group/member"
                    >
                      <MemberNameTag kind={m.kind} status={m.status} className="flex min-w-0 items-center gap-2 px-1.5 py-1 text-sm">
                        <AvatarObject member={m} size="xs" />
                        <span className="min-w-0 flex-1 truncate">{m.displayName}</span>
                        <span className="shrink-0 text-xs text-sand-muted">{statusLabel(m.status)}</span>
                        {m.kind === "agent" && !currentIsDm && (
                          <button
                            aria-label={tChat("removeMember", { member: m.displayName || m.name })}
                            onClick={() => handleRemoveMember(m.id)}
                            className="size-5 shrink-0 items-center justify-center text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover/member:flex"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        )}
                      </MemberNameTag>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          )}
        </div>
      </div>
  )
}
