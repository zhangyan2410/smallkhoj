import { type ReactNode } from "react"

import { MemberAvatar } from "@/components/member-avatar"
import { getAgentColor } from "@/lib/agent-color"
import { memberAvatarName, type AvatarMember } from "@/lib/member-avatar"
import { cn } from "@/lib/utils"

type MessageFrameProps = {
  member: AvatarMember
  senderType?: string | null
  agentId?: string | null
  time?: string | null
  avatarSize?: "sm" | "lg"
  showStatus?: boolean
  actions?: ReactNode
  badges?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  timeVariant?: "default" | "compact"
  roleLabels?: {
    assistant: string
    member: string
  }
}

function roleLabel(senderType?: string | null) {
  return senderType === "agent" || senderType === "assistant" ? "assistant" : "member"
}

function compactTimeLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function MessageFrame({
  member,
  senderType,
  agentId,
  time,
  avatarSize = "lg",
  showStatus = false,
  actions,
  badges,
  children,
  className,
  bodyClassName,
  timeVariant = "default",
  roleLabels,
}: MessageFrameProps) {
  const role = roleLabel(senderType)
  const visibleRole = role === "assistant" ? (roleLabels?.assistant ?? role) : (roleLabels?.member ?? role)
  const visibleTime = time && timeVariant === "compact" ? compactTimeLabel(time) : time
  const isAgent = senderType === "agent" || senderType === "assistant" || member.kind === "agent"
  const stripeColor = isAgent ? getAgentColor(agentId || member.id) : undefined

  return (
    <div
      data-slot="message-frame"
      className={cn("flex min-w-0 items-start gap-3", stripeColor && "border-l-2 pl-2", className)}
      style={stripeColor ? { borderLeftColor: stripeColor } : undefined}
    >
      <MemberAvatar member={member} size={avatarSize} showStatus={showStatus} />
      <div className={cn("min-w-0 flex-1", bodyClassName)}>
        <div className="flex items-start justify-between gap-2">
          <div data-slot="message-author" className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="truncate font-semibold text-foreground">{memberAvatarName(member).replace(/^@/, "")}</span>
            <span
              className={cn(
                "rounded-none px-1.5 py-0.5 text-[0.65rem] font-medium",
                role === "assistant" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              {visibleRole}
            </span>
            {visibleTime ? (
              <span className="whitespace-nowrap text-xs text-muted-foreground" title={time ?? undefined}>
                {visibleTime}
              </span>
            ) : null}
            {badges}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        <div data-slot="message-body" className="sk-bubble mt-1 rounded-none px-3 py-2 text-paper-ink">
          {children}
        </div>
      </div>
    </div>
  )
}
