"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Activity, Bot, Bookmark, Hash } from "lucide-react"

import { AvatarObject, SidebarEntityItem } from "@/components/inkframe-object-ui"
import { CreateAgentDialog } from "./create-agent-dialog"
import { CreateChannelDialog } from "./create-channel-dialog"
import { useChatData, type DmInfo } from "../chat-data-context"
import { useChatUnreadStore } from "@/hooks/use-chat-unread-store"
import { getStatusBucket, getStatusLabel } from "@/lib/agent-status"
import { chatEntityKeys, chatReadCursorRequestForEntity, deriveChatUnreadView, type ChatUnreadEntity } from "@/lib/chat-unread-state"
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

export function ChatSidebar() {
  const { channels, dms, allMembers, currentChannelName } = useChatData()
  const { store: unreadStore, clearEntity } = useChatUnreadStore()
  const [clearedServerReadSeq, setClearedServerReadSeq] = useState<Record<string, number>>({})
  const tChat = useTranslations("chat")
  const tNav = useTranslations("nav")

  useEffect(() => {
    const activeChannel = channels.find((ch) => ch.name.replace("#", "") === currentChannelName)
    const activeDm = dms.find((dm) => dm.name === currentChannelName)
    const activeEntity = activeChannel ?? activeDm
    if (!activeEntity) return
    clearEntity(activeEntity)
    const cursorRequest = chatReadCursorRequestForEntity(activeEntity)
    if (!cursorRequest) return
    void apiPost("/api/v1/chat/read-cursors", cursorRequest)
      .then(() => {
        const keys = chatEntityKeys(activeEntity)
        const readSeq = Math.max(0, activeEntity.latestSeq ?? 0)
        setClearedServerReadSeq((previous) => {
          const next = { ...previous }
          for (const key of keys) next[key] = Math.max(next[key] ?? 0, readSeq)
          return next
        })
      })
      .catch((error) => {
        console.warn("[chat] read cursor write failed", error)
      })
  }, [channels, dms, currentChannelName, clearEntity])

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
            {tChat("sidebarSubtitle") ?? "Channels & DMs"}
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
          action={<CreateChannelDialog />}
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
        <Section title={tChat("dms")} tone="mint" action={<CreateAgentDialog />}>
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
