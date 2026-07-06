import { type ReactNode } from "react"

import { AvatarObject, MessagePaper } from "@/components/inkframe-object-ui"
import { MaterialSurface, type MaterialPointerMode, type MaterialSurfaceMode } from "@/components/inkframe/material-surface"
import { shouldMaterialSurfaceCapturePointer } from "@/components/inkframe/material-surface-lifecycle"
import type { MaterialResource } from "@/components/inkframe/material-resource"
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
  contentLength?: number
  className?: string
  bodyClassName?: string
  timeVariant?: "default" | "compact"
  roleLabels?: {
    assistant: string
    member: string
  }
  materialSurface?: {
    ownerId: string
    mode?: MaterialSurfaceMode
    pointerMode?: MaterialPointerMode
    resource?: MaterialResource | null
    onResourceChange?: (resource: MaterialResource | null) => void
    onModeChange?: (mode: MaterialSurfaceMode) => void
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

function nodeTextLength(node: ReactNode): number | undefined {
  if (typeof node === "string" || typeof node === "number") return String(node).length
  if (Array.isArray(node)) {
    return node.reduce((total, child) => total + (nodeTextLength(child) ?? 0), 0)
  }
  return undefined
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
  contentLength,
  className,
  bodyClassName,
  timeVariant = "default",
  roleLabels,
  materialSurface,
}: MessageFrameProps) {
  const role = roleLabel(senderType)
  const visibleRole = role === "assistant" ? (roleLabels?.assistant ?? role) : (roleLabels?.member ?? role)
  const visibleTime = time && timeVariant === "compact" ? compactTimeLabel(time) : time
  const avatarMember = senderType === "agent" || senderType === "assistant"
    ? { ...member, kind: "agent" as const }
    : member
  const resolvedContentLength = contentLength ?? nodeTextLength(children)
  const capturesPointer = materialSurface
    ? shouldMaterialSurfaceCapturePointer(materialSurface.mode ?? "static", materialSurface.pointerMode ?? "none")
    : false

  return (
    <div
      data-slot="message-frame"
      className={cn("flex w-fit max-w-full min-w-0 items-start gap-3", className)}
    >
      <AvatarObject member={avatarMember} size={avatarSize} showStatus={showStatus} />
      <div className={cn("min-w-0 flex-1", bodyClassName)}>
        <div className="sk-message-meta relative z-20 mb-2 flex min-h-8 flex-wrap items-start gap-2 pt-1">
          <div data-slot="message-author" className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="truncate font-semibold text-paper-ink">
              {memberAvatarName(member).replace(/^@/, "")}
            </span>
            <span
              className={cn(
                "rounded-none border border-[var(--ink)] px-1.5 py-0.5 text-[0.65rem] font-medium",
                role === "assistant" ? "sk-accent-blue-soft" : "sk-cat-neutral"
              )}
            >
              {visibleRole}
            </span>
            {visibleTime ? (
              <span className="whitespace-nowrap text-xs text-sand-muted" title={time ?? undefined}>
                {visibleTime}
              </span>
            ) : null}
            {badges}
          </div>
          {actions ? (
            <div
              data-slot="message-actions"
              data-inkframe-object="message-actions"
              data-inkframe-state="toolbar-hidden"
              className="sk-message-actions relative z-30 shrink-0"
            >
              {actions}
            </div>
          ) : null}
        </div>
        <div data-slot="message-body" className="relative z-0 min-w-0 overflow-x-hidden">
          <MessagePaper
            length={resolvedContentLength}
            className={cn("text-paper-ink", materialSurface ? "px-0 py-0" : "px-3 py-2")}
          >
            {materialSurface ? (
              <div
                data-slot="message-material-layer"
                data-captures-pointer={capturesPointer ? "true" : "false"}
                data-inkframe-purpose="message-annotation"
                className="sk-message-annotation-layer"
              >
                <MaterialSurface
                  ownerKind="message"
                  ownerId={materialSurface.ownerId}
                  region="chat-main"
                  tint="paper"
                  mode={materialSurface.mode}
                  pointerMode={materialSurface.pointerMode}
                  waterStyle="wash"
                  washableFixedInk
                  resource={materialSurface.resource}
                  onResourceChange={materialSurface.onResourceChange}
                  onModeChange={materialSurface.onModeChange}
                  className="sk-message-annotation-surface"
                >
                  <div data-slot="message-paper-content" className="sk-message-paper-content min-w-0 overflow-x-hidden px-3 py-2">
                    {children}
                  </div>
                </MaterialSurface>
              </div>
            ) : (
              <div data-slot="message-paper-content" className="sk-message-paper-content min-w-0 overflow-x-hidden">
                {children}
              </div>
            )}
          </MessagePaper>
        </div>
      </div>
    </div>
  )
}
