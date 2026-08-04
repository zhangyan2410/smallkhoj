"use client"

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import {
  Activity,
  Database,
  Droplets,
  Files,
  ImageIcon,
  ListChecks,
  MessageCircle,
  Paintbrush,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Users,
  X,
} from "lucide-react"

import { DestructiveActionDialog } from "@/components/destructive-action-dialog"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/form"
import { RuntimeChip } from "@/components/product-ui"
import { useRealtimeSubscription } from "@/components/realtime-provider"
import { AgentActivityList } from "@/components/agent-activity-list"
import { AttachmentSheet, AvatarObject, ChannelDivider, InkframeObjectSurface, MemberNameTag } from "@/components/inkframe-object-ui"
import { ChannelMemorySurface, MemoryProposalQueue } from "@/components/memory-entry-surface"
import type { MaterialPointerMode, MaterialSurfaceMode } from "@/components/inkframe/material-surface"
import type { MaterialResource } from "@/components/inkframe/material-resource"
import { resolveAppDeskMaterialAction, type AppDeskMaterialAction } from "@/components/inkframe/app-desk-background"
import {
  apiGet,
  apiGetCritical,
  apiPost,
  apiDelete,
  apiHeaders,
  isFileDeleteResult,
  type FileDeleteResult,
  type Member,
  type MemoryEntry,
  type MemoryProposal,
  statusLabel,
  API_BASE,
  BROWSER_API_BASE,
} from "@/lib/control-plane"
import {
  channelFilesReducer,
  createChannelFilesState,
  projectChannelFileEvent,
  type ChannelFileItem,
} from "@/lib/channel-files-state"
import {
  mergeMessageById,
  shouldHandleRealtimeEvent,
} from "@/lib/realtime-events"
import { chatLatestSeqDetailFromEvent, chatReadCursorRequestForThread, notifyChatLatestSeq } from "@/lib/chat-unread-state"
import { channelMemberAddPayload } from "@/lib/channel-members"

import type { ChannelMessage, ThreadData } from "./chat-types"
import { LazyWidgetLoading, MessageItem, MessageList } from "./message-list"
import { ChatComposer, ThreadComposer } from "./composer"

const TaskBoard = dynamic(
  () => import("@/components/task-board").then((module) => ({ default: module.TaskBoard })),
  { ssr: false, loading: () => <LazyWidgetLoading /> },
)

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

function ChannelFileDeleteAction({
  file,
  sessionToken,
  activeServerId,
  onDeleted,
}: {
  file: ChannelFileItem
  sessionToken?: string | null
  activeServerId: string
  onDeleted: (result: FileDeleteResult) => void
}) {
  const tChat = useTranslations("chat")
  const tCommon = useTranslations("common")

  return (
    <DestructiveActionDialog
      key={file.id}
      triggerLabel={tChat("deleteFile")}
      title={tChat("deleteFile")}
      targetName={file.originalName}
      consequence={tChat("deleteFileConsequence")}
      confirmLabel={tCommon("delete")}
      cancelLabel={tCommon("cancel")}
      submittingLabel={tChat("deletingFile")}
      retryLabel={tCommon("tryAgain")}
      failureLabel={tChat("fileDeleteFailed")}
      closeLabel={tCommon("close")}
      onConfirm={async () => {
        const result = await apiDelete<unknown>(
          `/api/v1/files/${encodeURIComponent(file.id)}`,
          sessionToken,
          activeServerId,
          { timeoutMs: 15_000 },
        )
        if (!isFileDeleteResult(result, file.id)) {
          throw new Error(tChat("fileDeleteInvalidResponse"))
        }
        return result
      }}
      onSuccess={onDeleted}
    />
  )
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

type SavedItem = {
  id: string
  itemType: string
  itemId: string
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
  activeServerId,
  canManageServer = false,
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
  activeServerId: string
  canManageServer?: boolean
  currentMemberId?: string | null
  initialThreadId?: string
  initialMessageId?: string
}) {
  const [channelName, setChannelName] = useState(initialChannel)
  const [messages, setMessages] = useState<ChannelMessage[]>(initialMessages)
  const tChat = useTranslations("chat")
  const tCommon = useTranslations("common")
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
  const [activeTab, setActiveTab] = useState<"chat" | "tasks" | "memory" | "files" | "activity">("chat")
  const filesChannelName = channelName === initialChannel ? channelName : null
  const filesChannelId = filesChannelName ? channelId : ""
  const filesScopeKey = `${activeServerId}:${filesChannelId}`
  const [filesState, dispatchFiles] = useReducer(
    channelFilesReducer,
    filesScopeKey,
    createChannelFilesState,
  )
  const filesStateIsCurrent = filesState.scopeKey === filesScopeKey
  const files = filesStateIsCurrent ? filesState.files : []
  const filesLoading = filesStateIsCurrent && filesState.phase === "loading"
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntry[]>([])
  const [memoryProposals, setMemoryProposals] = useState<MemoryProposal[]>([])
  const [memoryLoading, setMemoryLoading] = useState(false)
  const [memoryProposalLoading, setMemoryProposalLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [threadWidthOverride, setThreadWidthOverride] = useState<number | null>(null)
  const dragDepthRef = useRef(0)
  const addMemberSelectRef = useRef<HTMLSelectElement>(null)
  const realtimeCatchUpTimerRef = useRef<number | null>(null)
  const fileRequestGenerationRef = useRef(0)
  const fileRequestAbortRef = useRef<AbortController | null>(null)
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
  // useMemo：消息行 memo 的前提 —— 父组件重渲时该数组引用必须保持稳定，
  // 否则所有 MessageItem 的 allKnownMembers prop 都会变、memo 失效。
  const allKnownMembers = useMemo(() => [...members, ...allMembers], [members, allMembers])
  const memberKindLabel = (kind: string) => kind === "agent" ? tChat("agentKind") : kind === "human" ? tChat("humanKind") : kind

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
      setChannelId("")
      setActiveThreadId(initialThreadId ?? null)
      setThreadData(null)
      const h = apiHeaders(sessionToken, false, activeServerId)
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
  }, [activeServerId, initialChannel, initialThreadId, markVisibleThreadRead, sessionToken])

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
    fileRequestAbortRef.current?.abort()
    fileRequestAbortRef.current = null
    const generation = ++fileRequestGenerationRef.current
    dispatchFiles({ type: "scopeChanged", scopeKey: filesScopeKey, generation })
  }, [filesScopeKey])

  useEffect(() => () => fileRequestAbortRef.current?.abort(), [])

  const refreshFiles = useCallback(async () => {
    if (!filesChannelId) return
    fileRequestAbortRef.current?.abort()
    const controller = new AbortController()
    fileRequestAbortRef.current = controller
    const generation = ++fileRequestGenerationRef.current
    dispatchFiles({ type: "loadStarted", scopeKey: filesScopeKey, generation })
    try {
      const data = await apiGetCritical<{ files: ChannelFileItem[]; count: number }>(
        `/api/v1/files?channelId=${encodeURIComponent(filesChannelId)}`,
        sessionToken,
        activeServerId,
        { signal: controller.signal, timeoutMs: 15_000 },
      )
      dispatchFiles({
        type: "loadSucceeded",
        scopeKey: filesScopeKey,
        generation,
        files: data.files || [],
      })
    } catch (e) {
      if (controller.signal.aborted) return
      console.error("Refresh files failed:", e)
      dispatchFiles({
        type: "loadFailed",
        scopeKey: filesScopeKey,
        generation,
        error: e instanceof Error ? e.message : tChat("filesLoadFailed"),
      })
    } finally {
      if (fileRequestAbortRef.current === controller) {
        fileRequestAbortRef.current = null
      }
    }
  }, [activeServerId, filesChannelId, filesScopeKey, sessionToken, tChat])

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

  const handleFileUpload = useCallback(async (file: File) => {
    if (!filesChannelId || !file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      const h = apiHeaders(sessionToken, false, activeServerId)
      const url = `${API_BASE}/api/v1/files?channelId=${encodeURIComponent(filesChannelId)}`
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
      setActiveTab("files")
    } catch (e) {
      console.error("Upload failed:", e)
      alert(`Upload failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setUploading(false)
    }
  }, [activeServerId, filesChannelId, refreshFiles, sessionToken])

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
    e.dataTransfer.dropEffect = filesChannelId ? "copy" : "none"
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
    if (!filesChannelId) {
      alert("No channel selected. Cannot upload file.")
      return
    }
    // Upload the first file in MVP
    const file = droppedFiles[0]
    await handleFileUpload(file)
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

  useRealtimeSubscription(({ event, decision }) => {
    const scheduleCatchUp = () => {
      if (realtimeCatchUpTimerRef.current) window.clearTimeout(realtimeCatchUpTimerRef.current)
      realtimeCatchUpTimerRef.current = window.setTimeout(() => {
        void refreshMessages()
        if (activeThreadId) void refreshThread(activeThreadId)
        realtimeCatchUpTimerRef.current = null
      }, 120)
    }

    if (decision.action === "drop") {
      console.debug("[realtime] duplicate dropped", event.id)
      return
    }

    if (event.type === "member.status.updated" || event.type === "member.updated") {
      void refreshChannelsAndDms()
      void refreshMembers()
      void refreshAllMembers()
      return
    }

    const fileProjection = projectChannelFileEvent(event, {
      channelId: filesChannelId,
      channelName: filesChannelName,
    })
    if (fileProjection) {
      if (fileProjection.kind === "ignore") return
      if (decision.action === "catch_up" || fileProjection.kind === "refresh") {
        void refreshFiles()
        return
      }
      const removedFile = files.find((file) => file.id === fileProjection.fileId)
      dispatchFiles({
        type: "fileRemoved",
        scopeKey: filesScopeKey,
        fileId: fileProjection.fileId,
        fileName: removedFile?.originalName ?? fileProjection.fileId,
      })
      return
    }

    if (!shouldHandleRealtimeEvent(event, { channelId, channelName })) {
      // Event belongs to another channel/DM or to a non-chat scope:
      // refresh sidebar lists so unread/new channels are visible.
      // 未读标记由全局 ActivityUnreadTracker 统一处理（07-30-realtime-activity-indicators）。
      void refreshChannelsAndDms()
      return
    }
    if (decision.action === "catch_up") {
      console.info("[realtime] catch-up triggered", decision.reason, event)
      // 追补后最新消息序号未知，用载荷里的序号下限推进 read-cursor；
      // refreshMessages 拉全量后若序号更高，下一条新消息事件会继续推进。
      const catchUpDetail = event.type === "message.created" ? chatLatestSeqDetailFromEvent(event) : null
      if (catchUpDetail) notifyChatLatestSeq(window, catchUpDetail)
      scheduleCatchUp()
      return
    }
    if (event.type === "message.created") {
      // 推进侧栏 read-cursor 的 live 序号（该处理器已经 shouldHandleRealtimeEvent
      // 过滤，事件必属于当前频道）：停留期间收到的消息要标记已读，
      // 否则下次 SSR 时服务端 unreadCount 会把已看过的消息算回未读（回闪）。
      const latestSeqDetail = chatLatestSeqDetailFromEvent(event)
      if (latestSeqDetail) notifyChatLatestSeq(window, latestSeqDetail)
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
  })

  useEffect(() => () => {
    if (realtimeCatchUpTimerRef.current) window.clearTimeout(realtimeCatchUpTimerRef.current)
  }, [])

  const openThread = useCallback(async (message: ChannelMessage) => {
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
  }, [refreshThread])

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

  const createTaskFromContent = useCallback(async (content: string, messageId?: string) => {
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
  }, [allMembers, channelName, currentChannel, currentDm, currentTitle, members, sessionToken])

  // Composer 回调：内容由 ChatComposer 的内部 state 提交上来。
  // 返回是否发送成功，Composer 据此决定要不要清空草稿。
  const handleSend = useCallback(async (content: string, asTask: boolean): Promise<boolean> => {
    try {
      const encodedChannel = channelPathSegment(channelName)
      const traceId = createLatencyTraceId("chat-send")
      const result = await apiPost<{ id: string }>(`/api/v1/channels/${encodedChannel}/messages`, { content, traceId }, sessionToken)
      if (asTask) {
        await createTaskFromContent(content, result?.id)
        if (result?.id) {
          setTaskMessageIds((previous) => new Set(previous).add(result.id))
        }
      }
      await refreshMessages()
      return true
    } catch (e) {
      console.error("Send failed:", e)
      return false
    }
  }, [channelName, createTaskFromContent, refreshMessages, sessionToken])

  const handleThreadSend = useCallback(async (content: string): Promise<boolean> => {
    if (!activeThreadId) return false
    try {
      const encodedChannel = channelPathSegment(channelName)
      const traceId = createLatencyTraceId("thread-send")
      await apiPost(`/api/v1/channels/${encodedChannel}/messages`, {
        content,
        threadId: activeThreadId,
        traceId,
      }, sessionToken)
      await Promise.all([refreshMessages(), refreshThread(activeThreadId)])
      return true
    } catch (e) {
      console.error("Thread reply failed:", e)
      return false
    }
  }, [activeThreadId, channelName, refreshMessages, refreshThread, sessionToken])

  const handleCreateTaskFromMessage = useCallback(async (message: ChannelMessage) => {
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
  }, [createTaskFromContent, taskMessageIds])

  const handleCopyMessage = useCallback(async (message: ChannelMessage) => {
    try {
      await navigator.clipboard.writeText(message.content)
    } catch (e) {
      console.error("Copy message failed:", e)
    }
  }, [])

  const toggleSaved = useCallback(async (messageId: string) => {
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
  }, [refreshSavedItems, savedMessageIds, sessionToken])

  const toggleReaction = useCallback(async (message: ChannelMessage, emoji = "👍") => {
    const hasReacted = Boolean(message.reactions?.some((r) => r.reaction === emoji && r.memberId === currentMemberId))
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
  }, [activeThreadId, currentMemberId, refreshMessages, refreshThread, sessionToken])

  const setMessageMaterialResource = useCallback((messageId: string, resource: MaterialResource | null) => {
    setMessageMaterialResources((previous) => {
      const next = { ...previous }
      if (resource) next[messageId] = resource
      else delete next[messageId]
      return next
    })
  }, [])

  const setMessageMaterialMode = useCallback((messageId: string, mode: MaterialSurfaceMode) => {
    setMessageMaterialModes((previous) => {
      const next = { ...previous, [messageId]: mode }
      if (mode === "static") delete next[messageId]
      return next
    })
    if (mode === "static" || mode === "fallback") {
      setActiveMaterialMessageId((current) => (current === messageId ? null : current))
    }
  }, [])

  const activateMessageMaterial = useCallback((messageId: string, pointerMode: MaterialPointerMode) => {
    setActiveMaterialMessageId(messageId)
    setActiveMaterialPointerMode(pointerMode)
    setMessageMaterialModes((previous) => ({ ...previous, [messageId]: "active" }))
  }, [])

  const requestMessageMaterialAction = useCallback((messageId: string, mode: Extract<MaterialSurfaceMode, "keeping" | "discarding">) => {
    setActiveMaterialMessageId(messageId)
    setActiveMaterialPointerMode("none")
    setMessageMaterialModes((previous) => ({ ...previous, [messageId]: mode }))
  }, [])

  function requestChatDeskMaterialAction(action: AppDeskMaterialAction) {
    const next = resolveAppDeskMaterialAction(action)
    setChatDeskPointerMode(next.pointerMode)
    setChatDeskMaterialMode(next.mode)
  }

  function messageMaterialMode(messageId: string): MaterialSurfaceMode {
    return messageMaterialModes[messageId] ?? (activeMaterialMessageId === messageId ? "active" : "static")
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

  const activeRoot = threadData?.thread
  const activeReplies = threadData?.replies ?? (threadData?.messages || []).filter((msg) => msg.parentId)
  const headerDmMember = currentDm ? dmAvatarMember(currentDm) : null
  const composerPlaceholder = currentDm
    ? tChat("dmComposePlaceholder", { peer: currentTitle.replace(/^DM @/, "") })
    : tChat("composePlaceholder", { channel: currentTitle.replace(/^#/, "") })

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
                    aria-label={tChat("drawChatDesk")}
                    title={tChat("drawChatDesk")}
                  >
                    <Paintbrush className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant={chatDeskMaterialMode === "active" && chatDeskPointerMode === "water" ? "default" : "outline"}
                    onClick={() => requestChatDeskMaterialAction("water")}
                    aria-label={tChat("washChatDesk")}
                    title={tChat("washChatDesk")}
                  >
                    <Droplets className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={chatDeskMaterialMode !== "active"}
                    onClick={() => requestChatDeskMaterialAction("keep")}
                    aria-label={tChat("keepChatDesk")}
                    title={tChat("keepChatDesk")}
                  >
                    <Save className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    disabled={chatDeskMaterialMode !== "active" && !chatDeskMaterialResource}
                    onClick={() => requestChatDeskMaterialAction("discard")}
                    aria-label={tChat("clearChatDesk")}
                    title={tChat("clearChatDesk")}
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
                  {filesStateIsCurrent && filesState.cleanupWarnings.map((warning) => (
                    <InkframeObjectSurface
                      key={warning.fileId}
                      material="drying"
                      role="alert"
                      data-slot="file-cleanup-warning"
                      className="mb-3 space-y-1 p-3"
                    >
                      <p className="text-sm font-medium">{tChat("fileQuarantineWarningTitle")}</p>
                      <p className="text-xs text-muted-foreground">
                        {tChat("fileQuarantineWarningDesc", { name: warning.fileName })}
                      </p>
                    </InkframeObjectSurface>
                  ))}
                  {filesLoading ? (
                    <p role="status" aria-live="polite" className="mb-3 text-sm text-muted-foreground">
                      {tChat("filesLoading")}
                    </p>
                  ) : null}
                  {filesStateIsCurrent && filesState.phase === "error" ? (
                    <InkframeObjectSurface
                      material="blocked"
                      role="alert"
                      data-slot="files-load-error"
                      className="mb-3 flex items-start justify-between gap-3 p-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium text-destructive">{tChat("filesLoadFailed")}</p>
                        <p className="text-xs text-muted-foreground">{tChat("filesLoadFailedDesc")}</p>
                        {filesState.error ? <p className="break-words text-xs text-destructive">{filesState.error}</p> : null}
                      </div>
                      <Button type="button" size="sm" variant="outline" onClick={() => void refreshFiles()}>
                        {tCommon("tryAgain")}
                      </Button>
                    </InkframeObjectSurface>
                  ) : null}
                  {filesStateIsCurrent && filesState.phase === "ready" && files.length === 0 && (
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
                              {canManageServer ? (
                                <ChannelFileDeleteAction
                                  file={file}
                                  sessionToken={sessionToken}
                                  activeServerId={activeServerId}
                                  onDeleted={(result) => {
                                    dispatchFiles({
                                      type: "fileRemoved",
                                      scopeKey: filesScopeKey,
                                      fileId: file.id,
                                      fileName: file.originalName,
                                      storageCleanup: result.storageCleanup,
                                    })
                                  }}
                                />
                              ) : null}
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
                <MessageList
                  messages={messages}
                  allKnownMembers={allKnownMembers}
                  currentMemberId={currentMemberId}
                  savedMessageIds={savedMessageIds}
                  taskMessageIds={taskMessageIds}
                  taskLinks={taskLinks}
                  threadUnreadRootIds={threadUnreadRootIds}
                  activeMaterialMessageId={activeMaterialMessageId}
                  activeMaterialPointerMode={activeMaterialPointerMode}
                  messageMaterialModes={messageMaterialModes}
                  messageMaterialResources={messageMaterialResources}
                  channelName={channelName}
                  deskMode={chatDeskMaterialMode}
                  deskPointerMode={chatDeskPointerMode}
                  deskResource={chatDeskMaterialResource}
                  onDeskResourceChange={setChatDeskMaterialResource}
                  onDeskModeChange={setChatDeskMaterialMode}
                  activeTab={activeTab}
                  initialMessageId={initialMessageId}
                  emptyTitle={tChat("noMessages", { channel: currentTitle })}
                  emptyDescription={composerPlaceholder}
                  onOpenThread={openThread}
                  onToggleReaction={toggleReaction}
                  onToggleSaved={toggleSaved}
                  onCreateTask={handleCreateTaskFromMessage}
                  onCopyMessage={handleCopyMessage}
                  onMaterialResourceChange={setMessageMaterialResource}
                  onMaterialModeChange={setMessageMaterialMode}
                  onActivateMaterial={activateMessageMaterial}
                  onRequestMaterialAction={requestMessageMaterialAction}
                />

                <ChatComposer
                  placeholder={composerPlaceholder}
                  uploading={uploading}
                  attachDisabled={!filesChannelId}
                  onUpload={handleFileUpload}
                  onSend={handleSend}
                />
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
                    <MessageItem
                      variant="thread"
                      message={activeRoot}
                      allKnownMembers={allKnownMembers}
                      currentMemberId={currentMemberId}
                      taskLink={taskLinks[activeRoot.id]}
                      materialMode={messageMaterialMode(activeRoot.id)}
                      materialPointerMode={activeMaterialMessageId === activeRoot.id ? activeMaterialPointerMode : "none"}
                      materialResource={messageMaterialResources[activeRoot.id] ?? null}
                      isMaterialActive={activeMaterialMessageId === activeRoot.id}
                      onOpenThread={openThread}
                      onToggleReaction={toggleReaction}
                      onToggleSaved={toggleSaved}
                      onCreateTask={handleCreateTaskFromMessage}
                      onCopyMessage={handleCopyMessage}
                      onMaterialResourceChange={setMessageMaterialResource}
                      onMaterialModeChange={setMessageMaterialMode}
                      onActivateMaterial={activateMessageMaterial}
                      onRequestMaterialAction={requestMessageMaterialAction}
                    />
                  )}

                  {threadLoading && <p className="py-8 text-center text-sm text-muted-foreground">{tChat("threadLoading")}</p>}
                  {activeReplies.map((msg) => (
                    <MessageItem
                      key={msg.id}
                      variant="thread"
                      message={msg}
                      allKnownMembers={allKnownMembers}
                      currentMemberId={currentMemberId}
                      taskLink={taskLinks[msg.id]}
                      materialMode={messageMaterialMode(msg.id)}
                      materialPointerMode={activeMaterialMessageId === msg.id ? activeMaterialPointerMode : "none"}
                      materialResource={messageMaterialResources[msg.id] ?? null}
                      isMaterialActive={activeMaterialMessageId === msg.id}
                      onOpenThread={openThread}
                      onToggleReaction={toggleReaction}
                      onToggleSaved={toggleSaved}
                      onCreateTask={handleCreateTaskFromMessage}
                      onCopyMessage={handleCopyMessage}
                      onMaterialResourceChange={setMessageMaterialResource}
                      onMaterialModeChange={setMessageMaterialMode}
                      onActivateMaterial={activateMessageMaterial}
                      onRequestMaterialAction={requestMessageMaterialAction}
                    />
                  ))}
                  {!threadLoading && activeReplies.length === 0 && (
                    <p className="py-8 text-center text-sm text-muted-foreground">{tChat("noReplies")}</p>
                  )}
                </div>

                <ThreadComposer
                  placeholder={tChat("replyPlaceholder")}
                  onSend={handleThreadSend}
                />
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
