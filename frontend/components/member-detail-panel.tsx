"use client"

import { useSyncExternalStore, useCallback, useEffect, useState, type KeyboardEvent } from "react"
import { useTranslations } from "next-intl"
import { X } from "lucide-react"

import { MemberDetailContent, ClientTabBar, type TabKey } from "@/components/member-detail-content"
import { apiGet, type Computer, type Member } from "@/lib/control-plane"
import {
  CHAT_PANEL_MIN_WIDTH,
  CHAT_PANEL_MAX_WIDTH,
  readStoredPanelWidth,
  setPersistentPanelWidth,
  startPanelResize,
  subscribePanelWidthStore,
} from "@/lib/panel-width"

const MEMBER_DETAIL_WIDTH_KEY = "smallkhoj.chat.memberDetailWidth"
const MEMBER_DETAIL_DEFAULT_WIDTH = 380

/**
 * Member detail side panel — mirrors the thread panel's resize/close behavior.
 * Width state + localStorage persistence are self-contained: the parent only
 * provides `member` and `onClose`.
 */
export function MemberDetailPanel({
  member,
  onClose,
}: {
  member: Member
  onClose: () => void
}) {
  const tChat = useTranslations("chat")
  const [activeTab, setActiveTab] = useState<TabKey>("profile")
  // Fetch computers so tab content can show runtime/workspace bindings.
  const [computers, setComputers] = useState<Computer[]>([])
  useEffect(() => {
    let cancelled = false
    apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] })
      .then((data) => { if (!cancelled) setComputers(data.computers || []) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [member.id])
  const storedWidth = useSyncExternalStore(
    subscribePanelWidthStore,
    () => readStoredPanelWidth(MEMBER_DETAIL_WIDTH_KEY, MEMBER_DETAIL_DEFAULT_WIDTH),
    () => MEMBER_DETAIL_DEFAULT_WIDTH,
  )
  const [widthOverride, setWidthOverride] = useState<number | null>(null)
  const width = widthOverride ?? storedWidth

  const applyWidth = useCallback((next: number) => {
    setPersistentPanelWidth(
      next,
      setWidthOverride,
      MEMBER_DETAIL_WIDTH_KEY,
      CHAT_PANEL_MIN_WIDTH,
      CHAT_PANEL_MAX_WIDTH,
    )
  }, [])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      startPanelResize(event, width, applyWidth, "left-edge")
    },
    [width, applyWidth],
  )

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      event.preventDefault()
      applyWidth(width + (event.key === "ArrowLeft" ? 16 : -16))
    },
    [width, applyWidth],
  )

  const handleRootKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
      }
    },
    [onClose],
  )

  return (
    <aside
      aria-label={tChat("memberDetail")}
      data-region="member-detail-panel"
      data-testid="member-detail-panel"
      data-inkframe-mobile-role="chat-member-detail-panel"
      onKeyDown={handleRootKeyDown}
      className="sk-chat-member-detail-panel relative flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l-2 border-[var(--ink)] p-4"
      style={{ width }}
    >
      <div
        role="separator"
        aria-label={tChat("memberDetail")}
        aria-orientation="vertical"
        aria-valuemin={CHAT_PANEL_MIN_WIDTH}
        aria-valuemax={CHAT_PANEL_MAX_WIDTH}
        aria-valuenow={width}
        tabIndex={0}
        data-testid="member-detail-panel-resize-handle"
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        className="absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:w-0.5 hover:after:bg-[var(--ink)] focus-visible:after:w-0.5 focus-visible:after:bg-[var(--ink)]"
      />
      <div className="flex h-full flex-col">
        <div className="mb-2 flex items-center justify-between gap-3 border-b pb-2">
          <h2 className="truncate text-sm font-semibold">{tChat("memberDetail")}</h2>
          <button
            type="button"
            aria-label={tChat("closeMemberDetail")}
            onClick={onClose}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <ClientTabBar activeTab={activeTab} onChange={setActiveTab} />
        <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto pr-1 pt-3">
          <MemberDetailContent
            member={member}
            computers={computers}
            activeTab={activeTab}
          />
        </div>
      </div>
    </aside>
  )
}
