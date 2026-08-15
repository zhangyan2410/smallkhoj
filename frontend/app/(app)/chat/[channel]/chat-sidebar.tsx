"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Activity, Bot, Bookmark, Hash } from "lucide-react"

import { AvatarObject, SidebarEntityItem } from "@/components/inkframe-object-ui"
import { useRealtimeSubscription } from "@/components/realtime-provider"
import { CreateAgentDialog } from "./create-agent-dialog"
import { CreateChannelDialog } from "./create-channel-dialog"
import { useChatData, type DmInfo } from "../chat-data-context"
import { useActivityUnreadStore } from "@/hooks/use-activity-unread-store"
import { getStatusBucket, getStatusLabel } from "@/lib/agent-status"
import {
  CHAT_LATEST_SEQ_EVENT,
  chatEntityKeys,
  chatReadCursorRequestForEntity,
  deriveChatUnreadView,
  type ChatLatestSeqDetail,
  type ChatUnreadEntity,
} from "@/lib/chat-unread-state"
import { apiPost } from "@/lib/control-plane"
import { cn } from "@/lib/utils"

function channelPathSegment(name: string) {
  return encodeURIComponent(name.replace(/^#/, ""))
}

function dmAvatarMember(dm: DmInfo) {
  return (
    dm.peer ?? {
      id: dm.id,
      name: dm.name,
      displayName: dm.displayName.replace(/^DM @/, ""),
      kind: "human" as const,
      status: "offline" as const,
    }
  )
}

/** 事件里的频道标识是否对应该实体（id 精确匹配，或路由名匹配）。 */
function latestSeqEventMatchesEntity(entity: ChatUnreadEntity, detail: ChatLatestSeqDetail): boolean {
  if (detail.channelId && entity.id && detail.channelId === entity.id) return true
  if (detail.channelName && entity.name) {
    return entity.name.replace(/^#/, "") === detail.channelName
  }
  return false
}

export function ChatSidebar({
  canManageServer = false,
  serverContextLabel = "",
}: {
  canManageServer?: boolean
  serverContextLabel?: string
}) {
  const { channels, dms, allMembers, currentChannelName } = useChatData()
  const router = useRouter()
  const { store: unreadStore, clearKeys: clearUnreadKeys } = useActivityUnreadStore()
  const [clearedServerReadSeq, setClearedServerReadSeq] = useState<Record<string, number>>({})
  const tChat = useTranslations("chat")
  const tNav = useTranslations("nav")
  // 当前频道已由 SSE 推进到的最新消息序号（channel-client 在收到当前频道
  // message.created 时广播）。回写 read-cursor 用它代替 SSR 时静态的
  // entity.latestSeq —— 否则停留在频道里收到的消息不会被标记已读，
  // 下次 SSR 时服务端 unreadCount 又把已看过的消息算成未读（回闪）。
  const liveLatestSeqRef = useRef(0)
  // 防回写风暴：已发出（in-flight 或已完成）回写的最高序号。
  const lastCursorWriteSeqRef = useRef(0)
  const cursorWriteInFlightRef = useRef(false)
  // Realtime: keep sidebar (DM online status, Active agents) live without a
  // full-page reload. Reuses the single shared SSE connection via
  // useRealtimeSubscription (does NOT open a new stream). Debounced router.refresh()
  // re-runs the server-component chat layout fetches with full session context.
  const sidebarRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useRealtimeSubscription(({ event, decision }) => {
    if (decision.action === "drop") return
    if (
      event.type === "member.updated" ||
      event.type === "member.status.updated" ||
      event.type === "workspace.updated"
    ) {
      if (sidebarRefreshTimerRef.current) return
      sidebarRefreshTimerRef.current = setTimeout(() => {
        sidebarRefreshTimerRef.current = null
        router.refresh()
      }, 500)
    }
  })
  useEffect(() => () => {
    if (sidebarRefreshTimerRef.current) clearTimeout(sidebarRefreshTimerRef.current)
  }, [])
  const activeChannel = channels.find((ch) => ch.name.replace("#", "") === currentChannelName)
  const activeDm = dms.find((dm) => dm.name === currentChannelName)
  const activeEntity = activeChannel ?? activeDm
  const activeEntityKey = activeEntity ? `${activeEntity.type ?? "channel"}:${activeEntity.id ?? activeEntity.name}` : ""

  // 切换频道时重置 live 序号跟踪。
  useEffect(() => {
    liveLatestSeqRef.current = 0
    lastCursorWriteSeqRef.current = 0
    cursorWriteInFlightRef.current = false
  }, [activeEntityKey])

  // ref 持有最新 activeEntity，供异步回调使用（避免闭包过期）。
  const activeEntityRef = useRef<ChatUnreadEntity | undefined>(undefined)
  useEffect(() => {
    activeEntityRef.current = activeEntity
  }, [activeEntity])

  useEffect(() => {
    if (!activeEntity) return
    clearUnreadKeys(chatEntityKeys(activeEntity))
    const baseline = Math.max(0, activeEntity.latestSeq ?? 0)
    liveLatestSeqRef.current = Math.max(liveLatestSeqRef.current, baseline)
    const cursorRequest = chatReadCursorRequestForEntity(activeEntity)
    if (!cursorRequest) return
    lastCursorWriteSeqRef.current = Math.max(lastCursorWriteSeqRef.current, baseline)
    cursorWriteInFlightRef.current = true
    void apiPost("/api/v1/chat/read-cursors", cursorRequest)
      .then(() => {
        const keys = chatEntityKeys(activeEntity)
        setClearedServerReadSeq((previous) => {
          const next = { ...previous }
          for (const key of keys) next[key] = Math.max(next[key] ?? 0, baseline)
          return next
        })
      })
      .catch((error) => {
        console.warn("[chat] read cursor write failed", error)
      })
      .finally(() => {
        cursorWriteInFlightRef.current = false
      })
  }, [activeEntityKey, clearUnreadKeys]) // eslint-disable-line react-hooks/exhaustive-deps -- 以实体身份为粒度，channels/dms 引用变化不重复回写

  // 当前频道有新消息（SSE）→ 推进 live 序号并回写 read-cursor。
  useEffect(() => {
    const writeLiveCursor = (entity: ChatUnreadEntity, readSeq: number) => {
      if (!entity.id || readSeq <= 0) return
      if (readSeq <= lastCursorWriteSeqRef.current || cursorWriteInFlightRef.current) return
      const kind = entity.type === "dm" ? ("dm" as const) : ("channel" as const)
      cursorWriteInFlightRef.current = true
      lastCursorWriteSeqRef.current = readSeq
      void apiPost("/api/v1/chat/read-cursors", {
        scope: { kind, channelId: entity.id },
        lastReadSeq: readSeq,
      })
        .then(() => {
          const keys = chatEntityKeys(entity)
          setClearedServerReadSeq((previous) => {
            const next = { ...previous }
            for (const key of keys) next[key] = Math.max(next[key] ?? 0, readSeq)
            return next
          })
        })
        .catch((error) => {
          console.warn("[chat] read cursor write failed", error)
        })
        .finally(() => {
          cursorWriteInFlightRef.current = false
          // 回写期间序号又前进了：补一次最新回写（lastCursorWriteSeq 守卫防重复）。
          const current = activeEntityRef.current
          if (current && liveLatestSeqRef.current > lastCursorWriteSeqRef.current) {
            writeLiveCursor(current, liveLatestSeqRef.current)
          }
        })
    }
    const onLatestSeq = (event: Event) => {
      const detail = (event as CustomEvent<ChatLatestSeqDetail>).detail
      const entity = activeEntityRef.current
      if (!detail || !entity) return
      if (!latestSeqEventMatchesEntity(entity, detail)) return
      liveLatestSeqRef.current = Math.max(liveLatestSeqRef.current, detail.messageSeq)
      writeLiveCursor(entity, liveLatestSeqRef.current)
    }
    window.addEventListener(CHAT_LATEST_SEQ_EVENT, onLatestSeq)
    return () => window.removeEventListener(CHAT_LATEST_SEQ_EVENT, onLatestSeq)
  }, [])

  const entityWithLocalClear = (entity: ChatUnreadEntity): ChatUnreadEntity => {
    const latestSeq = Math.max(0, entity.latestSeq ?? 0)
    const cleared = chatEntityKeys(entity).some((key) => (clearedServerReadSeq[key] ?? -1) >= latestSeq)
    return cleared ? { ...entity, unreadCount: 0, hasUnread: false } : entity
  }

  const activeAgents = allMembers.filter((m) => {
    if (m.kind !== "agent") return false
    const bucket = getStatusBucket(m.status)
    return bucket === "ACTIVE" || bucket === "THINKING" || bucket === "STARTING"
  })

  return (
    <nav aria-label={tNav("chat")} className="flex h-full min-h-0 flex-col">
      {/* Brand row (small, matches tasks/members/computers list-panel style) */}
      <div className="border-b border-sand-border px-3 py-2.5">
        <Link
          href="/chat"
          className="block rounded-none px-2 py-1.5 text-sm font-semibold text-sand-ink hover:bg-sand"
        >
          {tChat("workbench")}
          <span className="mt-0.5 block text-xs font-normal text-sand-muted">
            {serverContextLabel || tChat("sidebarSubtitle") || "Channels & DMs"}
          </span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {/* Attention */}
        <Section title={tChat("attention")} tone="rose">
          <Item href="/daemon" icon={<Activity className="size-3.5" />}>
            {tChat("activity")}
          </Item>
          <Item href="/?focus=saved" icon={<Bookmark className="size-3.5" />}>
            {tChat("saved")}
          </Item>
        </Section>

        {/* Channels */}
        <Section
          title={tChat("channels")}
          tone="blue"
          action={canManageServer ? <CreateChannelDialog /> : undefined}
        >
          {[...channels]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((ch) => {
              const isActive = ch.name.replace("#", "") === currentChannelName
              const unread = deriveChatUnreadView(entityWithLocalClear(ch), unreadStore, currentChannelName)
              return (
                <SidebarEntityItem
                  key={ch.id}
                  href={`/chat/${channelPathSegment(ch.name)}`}
                  active={isActive}
                  tone="blue"
                  icon={<Hash className="size-3 shrink-0 text-sand-muted" />}
                  title={ch.name.replace("#", "")}
                  subtitle={ch.description || undefined}
                  unreadCount={unread.unreadCount}
                  hasUnread={unread.hasUnread}
                  unreadLabel={tChat("unread", { count: unread.unreadCount ?? 1 })}
                />
              )
            })}
          {channels.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-sand-muted">{tChat("noChannels")}</p>
          )}
        </Section>

        {/* DMs */}
        <Section title={tChat("dms")} tone="mint" action={canManageServer ? <CreateAgentDialog /> : undefined}>
          {dms.map((dm) => {
            const peer = dmAvatarMember(dm)
            const isActive = dm.name === currentChannelName
            const unread = deriveChatUnreadView(entityWithLocalClear(dm), unreadStore, currentChannelName)
            return (
              <SidebarEntityItem
                key={dm.id}
                href={`/chat/${channelPathSegment(dm.name)}`}
                active={isActive}
                tone="mint"
                avatar={<AvatarObject member={peer} size="sm" />}
                title={peer.displayName || peer.name}
                trailing={peer.kind === "agent" ? <Bot className="size-3 shrink-0 text-sand-muted" /> : null}
                unreadCount={unread.unreadCount}
                hasUnread={unread.hasUnread}
                unreadLabel={tChat("unread", { count: unread.unreadCount ?? 1 })}
              />
            )
          })}
          {dms.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-sand-muted">{tChat("noDms")}</p>
          )}
        </Section>

        {/* Active agents (auto-hides when none) */}
        {activeAgents.length > 0 && (
          <Section
            title={tChat("running")}
            tone="purple"
            count={activeAgents.length}
          >
            {activeAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-2 py-0.5 text-sm text-sand-ink"
              >
                <AvatarObject member={agent} size="xs" showStatus />
                <span className="truncate">{agent.displayName || agent.name}</span>
                <span className="ml-auto text-xs text-sand-muted">
                  {getStatusLabel(agent.status)}
                </span>
              </div>
            ))}
          </Section>
        )}
      </div>
    </nav>
  )
}

function Section({
  title,
  count,
  action,
  tone = "ink",
  children,
}: {
  title: string
  count?: number
  action?: React.ReactNode
  tone?: "ink" | "blue" | "mint" | "rose" | "purple" | "green" | "yellow"
  children: React.ReactNode
}) {
  const toneClass: Record<string, string> = {
    ink: "text-sand-ink",
    blue: "text-accent-blue",
    mint: "text-accent-mint",
    rose: "text-accent-rose",
    purple: "text-accent-purple",
    green: "text-accent-green",
    yellow: "text-accent-yellow",
  }
  const countTone: Record<string, string> = {
    ink: "border-[var(--ink)] bg-sand-deep text-sand-ink",
    blue: "border-[var(--ink)] sk-accent-blue-soft",
    mint: "border-[var(--ink)] sk-accent-mint-soft",
    rose: "border-[var(--ink)] sk-accent-rose-soft",
    purple: "border-[var(--ink)] sk-accent-purple-soft",
    green: "border-[var(--ink)] sk-accent-green-soft",
    yellow: "border-[var(--ink)] sk-accent-yellow-soft",
  }
  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 flex items-center justify-between px-2">
        <h3 className={cn("text-sm font-medium", toneClass[tone])}>{title}</h3>
        <div className="flex items-center gap-2">
          {typeof count === "number" && (
            <span className={cn("rounded-none border px-1.5 py-0.5 text-[10px] font-semibold", countTone[tone])}>
              {count}
            </span>
          )}
          {action}
        </div>
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

function Item({
  href,
  icon,
  children,
}: {
  href: string
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-none px-2 py-1.5 text-sm text-sand-ink hover:bg-sand"
    >
      {icon}
      <span className="truncate">{children}</span>
    </Link>
  )
}
