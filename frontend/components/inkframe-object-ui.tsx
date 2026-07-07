import type { AnchorHTMLAttributes, ButtonHTMLAttributes, HTMLAttributes, LabelHTMLAttributes, ReactNode } from "react"
import Link from "next/link"

import { MemberAvatar } from "@/components/member-avatar"
import { MaterialSurface, type MaterialSurfaceMode, type MaterialPointerMode } from "@/components/inkframe/material-surface"
import { shouldMaterialSurfaceCapturePointer } from "@/components/inkframe/material-surface-lifecycle"
import type { MaterialResource } from "@/components/inkframe/material-resource"
import type { AvatarMember } from "@/lib/member-avatar"
import { cn } from "@/lib/utils"

type MaterialState = "dry" | "wet" | "drying" | "fixed" | "blocked"

function materialForTaskStatus(status?: string | null): MaterialState {
  switch (status) {
    case "in_progress":
    case "running":
    case "active":
      return "wet"
    case "in_review":
    case "review":
      return "drying"
    case "done":
    case "closed":
      return "fixed"
    case "blocked":
    case "rejected":
      return "blocked"
    default:
      return "dry"
  }
}

export function InkframeObjectSurface({
  material = "dry",
  raised = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  material?: MaterialState
  raised?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-slot="inkframe-object-surface"
      data-object="surface"
      data-material={material}
      className={cn(
        "sk-object-surface",
        raised && "sk-object-raised",
        material === "wet" && "sk-object-wet",
        material === "drying" && "sk-object-drying",
        material === "fixed" && "sk-object-fixed",
        material === "blocked" && "sk-object-blocked",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}

export function ObjectField({
  label,
  value,
  mono = true,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  label: ReactNode
  value?: ReactNode
  mono?: boolean
}) {
  return (
    <div data-slot="object-field" data-object="field" className={cn("sk-object-field", className)} {...props}>
      <div data-slot="object-field-label" className="sk-object-field-label">
        {label}
      </div>
      <div data-slot="object-field-value" className={cn("sk-object-field-value", mono && "font-mono")}>
        {value || "none"}
      </div>
    </div>
  )
}

export function ObjectMetric({
  label,
  value,
  description,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  label: ReactNode
  value: ReactNode
  description?: ReactNode
}) {
  return (
    <div data-slot="object-metric" data-object="metric" className={cn("sk-object-metric", className)} {...props}>
      <div data-slot="object-metric-label" className="sk-object-metric-label">
        {label}
      </div>
      <div data-slot="object-metric-value" className="sk-object-metric-value">
        {value}
      </div>
      {description ? (
        <div data-slot="object-metric-description" className="sk-object-metric-description">
          {description}
        </div>
      ) : null}
    </div>
  )
}

export function ObjectToggleField({
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & {
  children: ReactNode
}) {
  return (
    <label data-slot="object-toggle-field" data-object="toggle-field" className={cn("sk-object-toggle-field", className)} {...props}>
      {children}
    </label>
  )
}

export function MessagePaper({
  length,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  length?: number
  children: ReactNode
}) {
  const density = length && length > 140 ? "long" : length && length > 64 ? "medium" : "short"
  return (
    <div
      {...props}
      data-slot="message-paper"
      data-object="chat-message"
      data-density={density}
      data-inkframe-object="message"
      data-inkframe-density={density}
      className={cn(
        "sk-message-paper",
        density === "short" && "sk-message-paper-tilt",
        className
      )}
    >
      {children}
    </div>
  )
}

export function MessageToolStrip({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}) {
  return (
    <div
      data-slot="message-tool-strip"
      data-object="message-actions"
      data-inkframe-object="message-actions"
      data-inkframe-state="toolbar-hidden"
      className={cn("sk-message-tool-strip", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function ChatComposerSurface({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}) {
  return (
    <div data-slot="chat-composer-surface" data-object="composer" className={cn("sk-chat-composer-surface", className)} {...props}>
      {children}
    </div>
  )
}

export function ChatTaskToggle({
  active = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      data-slot="chat-task-toggle"
      data-object="task-toggle"
      data-active={active ? "true" : "false"}
      className={cn("sk-chat-task-toggle", active && "sk-chat-task-toggle-active", className)}
      {...props}
    >
      {children}
    </button>
  )
}

export function AttachmentSheet({
  kind = "file",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  kind?: "file" | "image" | "video" | "proof"
  children: ReactNode
}) {
  return (
    <div
      data-slot="attachment-sheet"
      data-object="attachment"
      data-attachment-kind={kind}
      className={cn("sk-attachment-sheet", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function MemberNameTag({
  kind = "human",
  status,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  kind?: "agent" | "human" | "system" | string
  status?: string | null
  children: ReactNode
}) {
  return (
    <div
      data-slot="member-name-tag"
      data-object="member"
      data-member-kind={kind}
      data-status={status || "unknown"}
      className={cn("sk-member-name-tag", className)}
      {...props}
    >
      {children}
    </div>
  )
}

export function AgentSealMark({
  status,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  status?: string | null
  children: ReactNode
}) {
  return (
    <span
      data-slot="agent-seal-mark"
      data-object="agent-identity"
      data-status={status || "unknown"}
      className={cn("sk-agent-seal-mark", className)}
      {...props}
    >
      {children}
    </span>
  )
}

export function HumanSignatureCard({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode
}) {
  return (
    <span
      data-slot="human-signature-card"
      data-object="human-identity"
      className={cn("sk-human-signature-card", className)}
      {...props}
    >
      {children}
    </span>
  )
}

export function AvatarObject({
  member,
  size = "default",
  showStatus = true,
  className,
  avatarClassName,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  member: AvatarMember
  size?: "xs" | "sm" | "default" | "lg" | "xl"
  showStatus?: boolean
  avatarClassName?: string
}) {
  const avatar = <MemberAvatar member={member} size={size} showStatus={showStatus} className={avatarClassName} />

  return (
    <span
      data-slot="avatar-object"
      data-object="avatar"
      data-avatar-kind={member.kind || "member"}
      data-status={showStatus ? (member.status || "unknown") : undefined}
      className={cn("sk-avatar-object inline-flex shrink-0", className)}
      {...props}
    >
      {avatar}
    </span>
  )
}

export function ChannelDivider({
  kind = "channel",
  active = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  kind?: "channel" | "dm" | "thread"
  active?: boolean
  children: ReactNode
}) {
  return (
    <span
      data-slot="channel-divider"
      data-object="channel"
      data-kind={kind}
      data-active={active ? "true" : "false"}
      className={cn("sk-channel-divider", active && "sk-channel-divider-active", className)}
      {...props}
    >
      {children}
    </span>
  )
}

export function EventBadge({
  count,
  active = false,
  label,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  count?: number
  active?: boolean
  label?: string
}) {
  const hasCount = typeof count === "number" && count > 0
  return (
    <span
      aria-label={label}
      data-slot="event-badge"
      data-object="event-badge"
      data-inkframe-object="event-badge"
      data-inkframe-unread={active ? "true" : "false"}
      data-active={active ? "true" : "false"}
      className={cn("sk-event-badge", active && "sk-event-badge-active", className)}
      {...props}
    >
      {hasCount ? (count > 99 ? "99+" : count) : null}
    </span>
  )
}

export function SidebarEntityItem({
  href,
  active = false,
  tone = "ink",
  icon,
  avatar,
  title,
  subtitle,
  trailing,
  unreadCount,
  hasUnread,
  unreadLabel,
  className,
  ...props
}: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href" | "title"> & {
  href: string
  active?: boolean
  tone?: "ink" | "blue" | "mint" | "rose" | "purple" | "green" | "yellow"
  icon?: ReactNode
  avatar?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  unreadCount?: number
  hasUnread?: boolean
  unreadLabel?: string
}) {
  const showUnread = Boolean(hasUnread || (typeof unreadCount === "number" && unreadCount > 0))
  return (
    <Link
      href={href}
      data-slot="sidebar-entity-item"
      data-object="sidebar-entity"
      data-inkframe-object="sidebar-entity"
      data-tone={tone}
      data-active={active ? "true" : "false"}
      data-unread={showUnread ? "true" : "false"}
      data-inkframe-unread={showUnread ? "true" : "false"}
      className={cn("sk-sidebar-entity-item", active && "sk-sidebar-entity-item-active", className)}
      {...props}
    >
      {avatar ? <span className="sk-sidebar-entity-avatar">{avatar}</span> : null}
      {!avatar && icon ? <span className="sk-sidebar-entity-icon">{icon}</span> : null}
      <span className="sk-sidebar-entity-copy">
        <span className="sk-sidebar-entity-title">{title}</span>
        {subtitle ? <span className="sk-sidebar-entity-subtitle">{subtitle}</span> : null}
      </span>
      {showUnread ? (
        <EventBadge count={unreadCount} active label={unreadLabel} className="ml-auto" />
      ) : trailing ? (
        <span className="sk-sidebar-entity-trailing">{trailing}</span>
      ) : null}
    </Link>
  )
}

export function ComputerInkstone({
  status,
  compact = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  status?: string | null
  compact?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-slot="computer-inkstone"
      data-object="computer"
      data-status={status || "unknown"}
      data-compact={compact ? "true" : "false"}
      className={cn("sk-computer-inkstone", compact && "sk-computer-inkstone-compact", className)}
      {...props}
    >
      <div data-slot="computer-inkstone-well" className="sk-computer-inkstone-well" aria-hidden="true" />
      <div data-slot="computer-inkstone-content" className="sk-computer-inkstone-content">
        {children}
      </div>
    </div>
  )
}

export function TaskMaterialSurface({
  status,
  material,
  materialSurface,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  status?: string | null
  material?: MaterialState
  materialSurface?: {
    ownerId: string
    mode?: MaterialSurfaceMode
    pointerMode?: MaterialPointerMode
    resource?: MaterialResource | null
  }
  children: ReactNode
}) {
  const resolvedMaterial = material ?? materialForTaskStatus(status)
  const capturesPointer = materialSurface
    ? shouldMaterialSurfaceCapturePointer(materialSurface.mode ?? "static", materialSurface.pointerMode ?? "none")
    : false
  return (
    <div
      {...props}
      data-slot="task-material-surface"
      data-object="task"
      data-status={status || "unknown"}
      data-task-material={resolvedMaterial}
      data-inkframe-object="task-ticket"
      data-inkframe-state={status || "unknown"}
      className={cn("sk-task-material-surface", className)}
    >
      {materialSurface ? (
        <div
          aria-hidden="true"
          data-slot="task-material-layer"
          data-captures-pointer={capturesPointer ? "true" : "false"}
          className={cn("sk-task-material-layer", capturesPointer && "sk-material-layer-capturing")}
        >
          <MaterialSurface
            ownerKind="task"
            ownerId={materialSurface.ownerId}
            region="task-main"
            tint="task"
            mode={materialSurface.mode}
            pointerMode={materialSurface.pointerMode}
            resource={materialSurface.resource}
            className="sk-task-material-layer-surface"
          />
        </div>
      ) : null}
      <div data-slot="task-material-content" className="sk-task-material-content">
        {children}
      </div>
    </div>
  )
}

export function EvidenceSurface({
  kind,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  kind: string
  children: ReactNode
}) {
  return (
    <div
      {...props}
      data-slot="evidence-surface"
      data-object="evidence"
      data-inkframe-object="evidence"
      data-evidence-kind={kind}
      className={cn("sk-evidence-surface", className)}
    >
      {children}
    </div>
  )
}

export function ReviewStamp({
  tone = "review",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  tone?: "review" | "approved" | "rework" | "blocked"
  children: ReactNode
}) {
  return (
    <span
      {...props}
      data-slot="review-stamp"
      data-object="review"
      data-inkframe-object="review"
      data-tone={tone}
      className={cn("sk-review-stamp", className)}
    >
      {children}
    </span>
  )
}

export function TaskTicket({
  href,
  status,
  className,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string
  status?: string
  children: ReactNode
}) {
  return (
    <a
      {...props}
      data-slot="task-ticket"
      data-object="task-link"
      data-inkframe-object="task-ticket"
      data-status={status}
      href={href}
      className={cn("sk-task-ticket", className)}
    >
      {children}
    </a>
  )
}

export function MemoryFixedNote({
  fixed = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  fixed?: boolean
  children: ReactNode
}) {
  return (
    <div
      data-slot="memory-fixed-note"
      data-object="memory"
      data-fixed={fixed ? "true" : "false"}
      className={cn("sk-memory-fixed-note", fixed && "sk-memory-fixed-note-fixed", className)}
      {...props}
    >
      {children}
    </div>
  )
}
