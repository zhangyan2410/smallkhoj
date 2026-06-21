import { type ReactNode } from "react"

import { MemberAvatar } from "@/components/member-avatar"
import { memberAvatarName, type AvatarMember } from "@/lib/member-avatar"
import { cn } from "@/lib/utils"

type MessageFrameProps = {
  member: AvatarMember
  senderType?: string | null
  time?: string | null
  avatarSize?: "sm" | "lg"
  showStatus?: boolean
  actions?: ReactNode
  badges?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

function roleLabel(senderType?: string | null) {
  return senderType === "agent" || senderType === "assistant" ? "assistant" : "member"
}

export function MessageFrame({
  member,
  senderType,
  time,
  avatarSize = "lg",
  showStatus = false,
  actions,
  badges,
  children,
  className,
  bodyClassName,
}: MessageFrameProps) {
  const role = roleLabel(senderType)

  return (
    <div data-slot="message-frame" className={cn("flex min-w-0 items-start gap-3", className)}>
      <MemberAvatar member={member} size={avatarSize} showStatus={showStatus} />
      <div className={cn("min-w-0 flex-1", bodyClassName)}>
        <div className="flex items-start justify-between gap-2">
          <div data-slot="message-author" className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="truncate font-semibold text-foreground">{memberAvatarName(member).replace(/^@/, "")}</span>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[0.65rem] font-medium",
                role === "assistant" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
              )}
            >
              {role}
            </span>
            {time ? <span className="text-xs text-muted-foreground">{time}</span> : null}
            {badges}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
        <div data-slot="message-body" className="mt-1">
          {children}
        </div>
      </div>
    </div>
  )
}
