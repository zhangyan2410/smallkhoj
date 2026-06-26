"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Activity, Bot, Bookmark, Hash, MessageSquare, Plus } from "lucide-react"

import { MemberAvatar } from "@/components/member-avatar"
import { CreateAgentDialog } from "@/app/chat/[channel]/create-agent-dialog"
import { CreateChannelDialog } from "@/app/chat/[channel]/create-channel-dialog"
import { useChatData, type DmInfo } from "@/app/chat/chat-data-context"
import { statusLabel } from "@/lib/control-plane"
import { getStatusBucket, getStatusLabel } from "@/lib/agent-status"
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
  const tChat = useTranslations("chat")
  const tNav = useTranslations("nav")
  const [, startTransition] = useTransition()

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
        <Section title={tChat("attention")}>
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
          action={<CreateChannelDialog />}
        >
          {[...channels]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((ch) => {
              const isActive = ch.name.replace("#", "") === currentChannelName
              return (
                <Link
                  key={ch.id}
                  href={`/chat/${channelPathSegment(ch.name)}`}
                  className={cn(
                    "flex items-center gap-2 truncate rounded-none px-2 py-1.5 text-sm transition-colors",
                    isActive
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-sand-ink hover:bg-sand"
                  )}
                >
                  <Hash className="size-3 shrink-0 text-sand-muted" />
                  <span className="truncate">{ch.name.replace("#", "")}</span>
                </Link>
              )
            })}
          {channels.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-sand-muted">{tChat("noChannels")}</p>
          )}
        </Section>

        {/* DMs */}
        <Section title={tChat("dms")} action={<CreateAgentDialog />}>
          {dms.map((dm) => {
            const peer = dmAvatarMember(dm)
            const isActive = dm.name === currentChannelName
            return (
              <Link
                key={dm.id}
                href={`/chat/${channelPathSegment(dm.name)}`}
                className={cn(
                  "flex items-center gap-2 truncate rounded-none px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-sand-ink hover:bg-sand"
                )}
              >
                <MemberAvatar member={peer} size="sm" />
                <span className="truncate">{peer.displayName || peer.name}</span>
                {peer.kind === "agent" && (
                  <Bot className="ml-auto size-3 shrink-0 text-sand-muted" />
                )}
              </Link>
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
            count={activeAgents.length}
          >
            {activeAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center gap-2 py-0.5 text-sm text-sand-ink"
              >
                <MemberAvatar member={agent} size="xs" showStatus />
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
  children,
}: {
  title: string
  count?: number
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mt-2 first:mt-0">
      <div className="mb-1 flex items-center justify-between px-2">
        <h3 className="text-sm font-medium text-sand-ink">{title}</h3>
        <div className="flex items-center gap-2">
          {typeof count === "number" && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
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
