"use client"

import { memo, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useTranslations } from "next-intl"
import {
  Bookmark,
  CheckSquare,
  Clipboard,
  Droplets,
  MessageCircle,
  Paintbrush,
  RotateCcw,
  Save,
  Smile,
} from "lucide-react"

import { MessageFrame } from "@/components/message-frame"
import { EmptyState } from "@/components/product-ui"
import { EventBadge, MessageToolStrip } from "@/components/inkframe-object-ui"
import { INKFRAME_DESK_PAPER_TINT, MaterialSurface, type MaterialPointerMode, type MaterialSurfaceMode } from "@/components/inkframe/material-surface"
import type { MaterialResource } from "@/components/inkframe/material-resource"
import { hasUnreadThreadActivity } from "@/lib/chat-unread-state"
import { memberForMessageSender, type AvatarMember } from "@/lib/member-avatar"

import type { ChannelMessage } from "./chat-types"

export function LazyWidgetLoading() {
  const t = useTranslations("common")
  return (
    <span role="status" aria-live="polite" className="text-sm text-muted-foreground">
      {t("loading")}
    </span>
  )
}

const MarkdownMessage = dynamic(
  () => import("@/components/markdown-message").then((module) => ({ default: module.MarkdownMessage })),
  { ssr: false, loading: () => <LazyWidgetLoading /> },
)

const CHAT_SCROLL_TICK_COUNT = 12

/**
 * 自包含的滚动进度导航条：自己挂 ONE 条 rAF 合并的 scroll + ResizeObserver
 * 监听，把进度直接写进 DOM（data-visible / 每个 tick 的 data-active / data-near），
 * 全程不进 React state —— 因此滚动时不会触发 ChannelClient 重渲、不会重渲消息列表。
 *
 * 进度协议与 globals.css 的 .sk-chat-scroll-rail[data-visible] /
 * .sk-chat-scroll-rail-tick[data-active|data-near] 完全对齐，CSS 无需改动。
 */
function ChatScrollRail({ scrollContainerRef }: { scrollContainerRef: RefObject<HTMLDivElement | null> }) {
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const scroller = scrollContainerRef.current
    const rail = railRef.current
    if (!scroller || !rail) return

    const ticks = Array.from(rail.querySelectorAll<HTMLSpanElement>("[data-slot='chat-scroll-rail-tick']"))
    let frame = 0

    const update = () => {
      const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const progress = maxScroll > 0 ? Math.max(0, Math.min(1, scroller.scrollTop / maxScroll)) : 0
      const visible = maxScroll > 8
      const activeIndex = Math.round(progress * (CHAT_SCROLL_TICK_COUNT - 1))

      rail.dataset.visible = visible ? "true" : "false"
      for (let index = 0; index < ticks.length; index += 1) {
        const tick = ticks[index]
        if (!tick) continue
        tick.dataset.active = index === activeIndex ? "true" : "false"
        tick.dataset.near = Math.abs(index - activeIndex) === 1 ? "true" : "false"
      }
    }

    const onScrollOrResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }

    update()
    scroller.addEventListener("scroll", onScrollOrResize, { passive: true })
    window.addEventListener("resize", onScrollOrResize)
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(onScrollOrResize)
    resizeObserver?.observe(scroller)
    if (scroller.firstElementChild) resizeObserver?.observe(scroller.firstElementChild)

    return () => {
      cancelAnimationFrame(frame)
      scroller.removeEventListener("scroll", onScrollOrResize)
      window.removeEventListener("resize", onScrollOrResize)
      resizeObserver?.disconnect()
    }
  }, [scrollContainerRef])

  return (
    <div
      ref={railRef}
      aria-hidden="true"
      data-slot="chat-scroll-rail"
      data-visible="false"
      className="sk-chat-scroll-rail"
    >
      {Array.from({ length: CHAT_SCROLL_TICK_COUNT }, (_, index) => (
        <span
          key={index}
          data-slot="chat-scroll-rail-tick"
          data-active="false"
          data-near="false"
          className="sk-chat-scroll-rail-tick"
        />
      ))}
    </div>
  )
}

function didReact(message: ChannelMessage, emoji: string, currentMemberId?: string | null) {
  return Boolean(message.reactions?.some((r) => r.reaction === emoji && r.memberId === currentMemberId))
}

type MessageItemCallbacks = {
  onOpenThread: (message: ChannelMessage) => void
  onAvatarClick?: (memberId: string) => void
  onToggleReaction: (message: ChannelMessage, emoji: string) => void
  onToggleSaved: (messageId: string) => void
  onCreateTask: (message: ChannelMessage) => void
  onCopyMessage: (message: ChannelMessage) => void
  onMaterialResourceChange: (messageId: string, resource: MaterialResource | null) => void
  onMaterialModeChange: (messageId: string, mode: MaterialSurfaceMode) => void
  onActivateMaterial: (messageId: string, pointerMode: MaterialPointerMode) => void
  onRequestMaterialAction: (messageId: string, mode: Extract<MaterialSurfaceMode, "keeping" | "discarding">) => void
}

type MessageItemProps = MessageItemCallbacks & {
  message: ChannelMessage
  variant?: "channel" | "thread"
  allKnownMembers: AvatarMember[]
  currentMemberId?: string | null
  isSaved?: boolean
  isTasked?: boolean
  taskLink?: string
  hasThreadUnread?: boolean
  materialMode: MaterialSurfaceMode
  materialPointerMode: MaterialPointerMode
  materialResource: MaterialResource | null
  isMaterialActive: boolean
  deskCapturing?: boolean
}

/**
 * 单条消息行（频道主列表 + thread 面板共用）。memo 化：父组件因输入框等
 * 局部 state 重渲时，只要该消息的派生 props 没变就整行跳过重渲，
 * react-markdown 不会为未变化的消息重新解析。
 */
export const MessageItem = memo(function MessageItem({
  message,
  variant = "channel",
  allKnownMembers,
  currentMemberId,
  isSaved = false,
  isTasked = false,
  taskLink,
  hasThreadUnread = false,
  materialMode,
  materialPointerMode,
  materialResource,
  isMaterialActive,
  deskCapturing = false,
  onOpenThread,
  onAvatarClick,
  onToggleReaction,
  onToggleSaved,
  onCreateTask,
  onCopyMessage,
  onMaterialResourceChange,
  onMaterialModeChange,
  onActivateMaterial,
  onRequestMaterialAction,
}: MessageItemProps) {
  const tChat = useTranslations("chat")
  const senderMember = memberForMessageSender(message.sender, message.senderType, allKnownMembers)
  // Fake-id guard: memberForMessageSender returns synthetic ids (message:agent:xxx)
  // when the real member can't be resolved. Don't wire avatar click in that case —
  // clicking would silently do nothing (no matching member to show).
  const senderHasRealId = Boolean(senderMember.id) && !senderMember.id!.startsWith("message:")
  const avatarClickHandler = onAvatarClick && senderHasRealId
    ? () => onAvatarClick(senderMember.id!)
    : undefined
  const messageRoleLabels = { assistant: tChat("agentKind"), member: tChat("members") }
  const hasReacted = didReact(message, "👍", currentMemberId)
  const hasMaterialResource = Boolean(materialResource)
  const isDrawing = isMaterialActive && materialMode === "active" && materialPointerMode === "draw"
  const isWatering = isMaterialActive && materialMode === "active" && materialPointerMode === "water"

  const actions = (
    <MessageToolStrip>
      <button
        type="button"
        data-slot="message-material-pen"
        data-active={isDrawing ? "true" : "false"}
        onClick={() => {
          if (isDrawing) onMaterialModeChange(message.id, "static")
          else onActivateMaterial(message.id, "draw")
        }}
        aria-label={tChat("annotateMessage")}
        title={tChat("annotateMessage")}
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
        onClick={() => onActivateMaterial(message.id, "water")}
        aria-label={tChat("waterAnnotation")}
        title={tChat("waterAnnotation")}
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
        onClick={() => onRequestMaterialAction(message.id, "keeping")}
        aria-label={tChat("keepAnnotation")}
        title={tChat("keepAnnotation")}
        className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
      >
        <Save className="size-3.5" />
      </button>
      <button
        type="button"
        data-slot="message-material-discard"
        disabled={!isMaterialActive && !hasMaterialResource}
        onClick={() => onRequestMaterialAction(message.id, "discarding")}
        aria-label={tChat("clearAnnotation")}
        title={tChat("clearAnnotation")}
        className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35"
      >
        <RotateCcw className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onOpenThread(message)}
        aria-label={tChat("replyInThread")}
        title={tChat("reply")}
        className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MessageCircle className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={() => onToggleReaction(message, "👍")}
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
        onClick={() => onToggleSaved(message.id)}
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
        onClick={() => onCreateTask(message)}
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
        onClick={() => onCopyMessage(message)}
        aria-label={tChat("copyMessage")}
        title={tChat("copyMessage")}
        className="inline-flex size-6 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Clipboard className="size-3.5" />
      </button>
    </MessageToolStrip>
  )

  const reactions = message.reactionCounts && Object.keys(message.reactionCounts).length > 0 && (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {Object.entries(message.reactionCounts).map(([emoji, count]) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onToggleReaction(message, emoji)}
          className={`inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] px-2 py-0.5 text-xs transition-colors ${
            didReact(message, emoji, currentMemberId)
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
  )

  if (variant === "thread") {
    return (
      <div className="group/message relative -mx-1 px-1 py-1.5 rounded-none" tabIndex={0}>
        <MessageFrame
          member={senderMember}
          senderType={message.senderType}
          agentId={senderMember.kind === "agent" ? senderMember.id : undefined}
          time={message.time}
          contentLength={message.content.length}
          timeVariant="compact"
          avatarSize="sm"
          showStatus={message.senderType === "agent"}
          onAvatarClick={avatarClickHandler}
          roleLabels={messageRoleLabels}
          materialSurface={{
            ownerId: message.id,
            mode: materialMode,
            pointerMode: materialPointerMode,
            resource: materialResource,
            onResourceChange: (resource) => onMaterialResourceChange(message.id, resource),
            onModeChange: (mode) => onMaterialModeChange(message.id, mode),
          }}
          actions={actions}
        >
        {taskLink && (
          <Link
            href={`/tasks?task=${encodeURIComponent(taskLink)}`}
            className="mt-1.5 inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] sk-accent-rose-soft px-1.5 py-0.5 text-[0.7rem] font-medium hover:opacity-85"
          >
            <CheckSquare className="size-3" />
            {tChat("openTask")}
          </Link>
        )}
        <MarkdownMessage content={message.content} compact />
        {reactions}
        </MessageFrame>
      </div>
    )
  }

  return (
    <div
      data-testid={`message-${message.id}`}
      className={`group/message relative -mx-2 min-w-0 px-2 py-1.5 pointer-events-none transition-colors ${
        isSaved ? "sk-accent-rose-soft/40" : ""
      }`}
      tabIndex={0}
    >
      <div className={deskCapturing ? "pointer-events-none" : "pointer-events-auto"}>
      <MessageFrame
        member={senderMember}
        senderType={message.senderType}
        agentId={senderMember.kind === "agent" ? senderMember.id : undefined}
        time={message.time}
        contentLength={message.content.length}
        avatarSize="lg"
        showStatus={senderMember.kind === "agent"}
        onAvatarClick={avatarClickHandler}
        roleLabels={messageRoleLabels}
        materialSurface={{
          ownerId: message.id,
          mode: materialMode,
          pointerMode: materialPointerMode,
          resource: materialResource,
          onResourceChange: (resource) => onMaterialResourceChange(message.id, resource),
          onModeChange: (mode) => onMaterialModeChange(message.id, mode),
        }}
        badges={
          <>
            {isSaved && (
              <Bookmark className="size-3 text-accent-rose" aria-label={tChat("savedBadge")} />
            )}
            {taskLink && (
              <Link
                href={`/tasks?task=${encodeURIComponent(taskLink)}`}
                className="inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] sk-accent-rose-soft px-1.5 py-0.5 text-[0.7rem] font-medium hover:opacity-85"
              >
                <CheckSquare className="size-3" />
                {tChat("taskBadge")}
              </Link>
            )}
          </>
        }
        actions={actions}
      >
      <MarkdownMessage content={message.content} />
      {(message.replyCount || message.threadSummary) && (
        <div className="mt-1.5 pl-10">
          {message.threadSummary?.summary && (
            <p className="mb-1 text-xs text-sand-muted">{message.threadSummary.summary}</p>
          )}
          <button
            type="button"
            onClick={() => onOpenThread(message)}
            className="inline-flex items-center gap-1 rounded-none border-2 border-[var(--ink)] bg-paper px-1.5 py-0.5 text-xs font-medium text-accent-blue hover:sk-accent-blue-soft"
          >
            <MessageCircle className="size-3" />
            {message.replyCount ? tChat("replyCount", { count: message.replyCount }) : tChat("reply")}
            {hasThreadUnread ? (
              <EventBadge active label={tChat("unread", { count: 1 })} />
            ) : null}
          </button>
        </div>
      )}
      {reactions}
      </MessageFrame>
      </div>
    </div>
  )
})

type MessageListProps = MessageItemCallbacks & {
  messages: ChannelMessage[]
  allKnownMembers: AvatarMember[]
  currentMemberId?: string | null
  savedMessageIds: ReadonlySet<string>
  taskMessageIds: ReadonlySet<string>
  taskLinks: Record<string, string>
  threadUnreadRootIds: ReadonlySet<string>
  activeMaterialMessageId: string | null
  activeMaterialPointerMode: MaterialPointerMode
  messageMaterialModes: Record<string, MaterialSurfaceMode>
  messageMaterialResources: Record<string, MaterialResource | null>
  channelName: string
  deskMode: MaterialSurfaceMode
  deskPointerMode: MaterialPointerMode
  deskResource: MaterialResource | null
  onDeskResourceChange: (resource: MaterialResource | null) => void
  onDeskModeChange: (mode: MaterialSurfaceMode) => void
  activeTab: string
  initialMessageId?: string
  emptyTitle: string
  emptyDescription: string
}

/**
 * 消息列表区块：滚动容器、chat-desk 水墨层、滚动导航条、消息堆叠。
 * memo 化 —— 父组件（ChannelClient）因 composer 之外的局部 state 重渲时，
 * 只要下列 props 引用不变，整个列表（含所有消息的 markdown）跳过重渲。
 */
export const MessageList = memo(function MessageList({
  messages,
  allKnownMembers,
  currentMemberId,
  savedMessageIds,
  taskMessageIds,
  taskLinks,
  threadUnreadRootIds,
  activeMaterialMessageId,
  activeMaterialPointerMode,
  messageMaterialModes,
  messageMaterialResources,
  channelName,
  deskMode,
  deskPointerMode,
  deskResource,
  onDeskResourceChange,
  onDeskModeChange,
  activeTab,
  initialMessageId,
  emptyTitle,
  emptyDescription,
  ...callbacks
}: MessageListProps) {
  const messageListRef = useRef<HTMLDivElement>(null)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const messageEndRef = useRef<HTMLDivElement>(null)
  const chatDeskMaterialLayerRef = useRef<HTMLDivElement>(null)
  const chatDeskPointerForwardingRef = useRef(false)

  const deskCapturing = deskMode === "active" && deskPointerMode !== "none"

  useEffect(() => {
    if (initialMessageId || activeTab !== "chat") return
    const frame = window.requestAnimationFrame(() => {
      messageEndRef.current?.scrollIntoView({ block: "end" })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTab, channelName, initialMessageId, messages.length])

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
    if (!deskCapturing) return
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

  return (
    <div ref={messageListRef} data-testid="chat-message-list" data-region="message-list" data-inkframe-mobile-role="chat-message-list" className="sk-chat-message-list relative isolate min-h-0 min-w-0 flex-1 overflow-hidden">
    <ChatScrollRail scrollContainerRef={messageScrollRef} />
    <div
      ref={chatDeskMaterialLayerRef}
      data-slot="chat-desk-material-layer"
      data-inkframe-purpose="chat-desk-canvas"
      data-captures-pointer={deskCapturing ? "true" : "false"}
      className="sk-chat-desk-material-layer pointer-events-none absolute inset-0 z-0 data-[captures-pointer=true]:pointer-events-auto data-[captures-pointer=true]:cursor-crosshair"
    >
      <MaterialSurface
        ownerKind="app-background"
        ownerId={`chat-desk:${channelName}`}
        region="chat-main"
        tint="desk"
        mode={deskMode}
        pointerMode={deskPointerMode}
        waterStyle="wash"
        washableFixedInk
        paperTint={INKFRAME_DESK_PAPER_TINT}
        vignette={0}
        cleanPaper
        resource={deskResource}
        onResourceChange={onDeskResourceChange}
        onModeChange={onDeskModeChange}
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
      className={`sk-chat-message-scroll pointer-events-auto relative z-10 h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-4`}
    >
    <div className="sk-chat-message-stack pointer-events-none relative mr-auto w-full max-w-[1248px] min-w-0 space-y-3">
      {messages.map((msg) => (
        <MessageItem
          key={msg.id}
          message={msg}
          allKnownMembers={allKnownMembers}
          currentMemberId={currentMemberId}
          isSaved={savedMessageIds.has(msg.id)}
          isTasked={taskMessageIds.has(msg.id)}
          taskLink={taskLinks[msg.id]}
          hasThreadUnread={hasUnreadThreadActivity(msg, threadUnreadRootIds)}
          materialMode={messageMaterialMode(msg.id)}
          materialPointerMode={activeMaterialMessageId === msg.id ? activeMaterialPointerMode : "none"}
          materialResource={messageMaterialResources[msg.id] ?? null}
          isMaterialActive={activeMaterialMessageId === msg.id}
          deskCapturing={deskCapturing}
          {...callbacks}
        />
      ))}
      {messages.length === 0 && (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          className="sk-chat-empty-note"
        />
      )}
      <div ref={messageEndRef} data-testid="chat-message-list-end" aria-hidden="true" />
    </div>
    </div>
    </div>
  )
})
