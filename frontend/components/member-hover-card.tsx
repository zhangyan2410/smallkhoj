"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { AvatarObject } from "@/components/inkframe-object-ui"
import type { ActivityItem } from "@/components/agent-activity-list"
import {
  apiGet,
  formatTime,
  findMemberWorkspace,
  runtimeLabel,
  statusLabel,
  type Computer,
  type Member,
  type RuntimeInfo,
} from "@/lib/control-plane"
import { profileDescription, profileName } from "@/lib/member-profile"
import { statusDotClass } from "@/lib/agent-status"
import { cn } from "@/lib/utils"

/**
 * Compact hover info card for avatars.
 *
 * Wraps any trigger (typically an <AvatarObject>) and shows a small floating
 * card on hover/focus with: name, status, @handle, computer, runtime, model,
 * provider, description, and skills. Uses a portal to document.body so it is
 * never clipped by ancestor overflow:hidden containers (e.g. chat headers).
 */
export function MemberHoverCard({
  member,
  children,
  align = "start",
}: {
  member: Member
  children: ReactNode
  align?: "start" | "center"
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipW = 320
  const [computers, setComputers] = useState<Computer[]>([])
  const [activity, setActivity] = useState<ActivityItem[]>([])

  useEffect(() => {
    let cancelled = false
    apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] })
      .then((data) => { if (!cancelled) setComputers(data.computers || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Fetch recent activity when the card opens (lazy — avoid fetching on every mount).
  useEffect(() => {
    if (!open || !member.id) return
    let cancelled = false
    apiGet<{ activity: ActivityItem[] }>(
      `/api/v1/activity?agentId=${encodeURIComponent(member.id)}&limit=3`,
      { activity: [] },
    )
      .then((data) => { if (!cancelled) setActivity(data.activity || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, member.id])

  // Position the tooltip below the trigger; if there isn't enough room below
  // (e.g. messages near the bottom of the viewport), flip it above the trigger.
  useEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const tooltipW = 320
    const tooltipEstH = 240
    const spaceBelow = window.innerHeight - rect.bottom
    const above = spaceBelow < tooltipEstH + 16 && rect.top > tooltipEstH + 16
    let left = align === "center" ? rect.left + rect.width / 2 - tooltipW / 2 : rect.left
    left = Math.max(8, Math.min(left, window.innerWidth - tooltipW - 8))
    const top = above ? rect.top - tooltipEstH - 8 : rect.bottom + 8
    setPos({ top, left, above })
  }, [open, align])

  const description = profileDescription(member)
  const computer = computers.find((c) => c.id === member.computerId)
  const workspace = computers.length > 0 ? findMemberWorkspace(member, computers) : undefined
  const provider = workspace?.runtimeProvider ?? member.runtimeProvider ?? member.backend
  const runtimeText = workspace?.runtime ? runtimeLabel(workspace.runtime as unknown as RuntimeInfo) : null
  const model = workspace?.runtimeModel || null

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={(e) => { if (e.key === "Escape") setOpen(false) }}
    >
      {children}
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          style={{ position: "fixed", top: pos.top, left: pos.left, width: tooltipW }}
          className={cn(
            "z-[9999] border-2 border-[var(--ink)] bg-[var(--paper)] shadow-[3px_3px_0_var(--ink)]",
          )}
        >
          {/* Header: avatar + name + status */}
          <div className="flex items-center gap-3 border-b border-[var(--ink)]/30 p-3">
            <AvatarObject member={member} size="default" showStatus={false} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-paper-ink">
                  {profileName(member)}
                </span>
                <span className={cn("size-2 shrink-0 rounded-full", statusDotClass(member.status))} />
                <span className="text-xs text-sand-muted">{statusLabel(member.status)}</span>
              </div>
              <div className="truncate text-xs text-sand-muted">
                @{(member.handle || member.name).replace(/^@/, "")}
              </div>
            </div>
          </div>

          {/* Runtime info grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 p-3 text-xs">
            {computer && (
              <InfoField label="电脑" value={computer.name} />
            )}
            {runtimeText && (
              <InfoField label="运行时" value={runtimeText} />
            )}
            {model && (
              <InfoField label="模型" value={model} />
            )}
            {!computer && !runtimeText && (
              <InfoField label="类型" value={member.kind === "agent" ? "智能体" : "成员"} />
            )}
            {provider && (
              <InfoField label="提供方" value={provider} />
            )}
          </div>

          {/* Description */}
          {description && (
            <p className="border-t border-[var(--ink)]/30 px-3 py-2 text-xs text-muted-foreground line-clamp-2">
              {description}
            </p>
          )}

          {/* Skills */}
          {member.skills && member.skills.length > 0 && (
            <div className="flex flex-wrap gap-1 border-t border-[var(--ink)]/30 px-3 py-2">
              {member.skills.slice(0, 6).map((skill) => (
                <span key={skill} className="border border-[var(--ink)] px-1.5 py-0.5 text-[0.65rem] text-sand-muted">
                  {skill}
                </span>
              ))}
              {member.skills.length > 6 && (
                <span className="text-[0.65rem] text-sand-muted">+{member.skills.length - 6}</span>
              )}
            </div>
          )}

          {/* Recent activity */}
          {activity.length > 0 && (
            <div className="border-t border-[var(--ink)]/30 px-3 py-2">
              <div className="mb-1 text-[0.65rem] uppercase text-sand-muted">最近活动</div>
              <ul className="space-y-1.5">
                {activity.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-xs">
                    <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", activityDotColor(item.type))} />
                    <span className="min-w-0 flex-1">
                      <span className="truncate text-sand-muted">{item.description}</span>
                      {item.timestamp && (
                        <span className="ml-1 text-[0.6rem] text-sand-muted/70">{formatTime(item.timestamp)}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>,
        document.body,
      )}
    </span>
  )
}

/** Activity event type → dot color. Matches the agent status semantics:
 * running/active → green, idle/starting/busy → yellow, failed/error → red. */
function activityDotColor(type: string): string {
  const t = type.toLowerCase()
  if (["failed", "error", "crashed", "cancelled"].some((k) => t.includes(k))) return "bg-danger"
  if (["idle", "pending", "starting", "busy", "stopping", "restarting", "in_review", "pending_start"].some((k) => t.includes(k))) return "bg-warning"
  if (["running", "active", "done", "fired", "online", "message_sent", "message", "workspace_updated", "workspace_registered", "task"].some((k) => t.includes(k))) return "bg-success"
  return "bg-muted-foreground"
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.65rem] uppercase text-sand-muted">{label}</div>
      <div className="truncate font-medium text-paper-ink">{value}</div>
    </div>
  )
}
