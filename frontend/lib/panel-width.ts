/**
 * Shared panel width / resize helpers.
 *
 * Extracted from channel-client.tsx so the member-detail panel can reuse the
 * same resize + localStorage-persistence pattern the thread panel uses, without
 * duplicating the logic. These are pure functions — no React state — so they
 * can be called from any component.
 */

/** Shared min/max for chat side panels (thread + member detail). */
export const CHAT_PANEL_MIN_WIDTH = 320
export const CHAT_PANEL_MAX_WIDTH = 760

export function clampPanelWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(minWidth, width))
}

export function readStoredPanelWidth(
  key: string,
  defaultWidth: number,
  minWidth: number = CHAT_PANEL_MIN_WIDTH,
  maxWidth: number = CHAT_PANEL_MAX_WIDTH,
) {
  if (typeof window === "undefined") return defaultWidth
  try {
    const stored = window.localStorage.getItem(key)
    const parsed = stored ? Number(stored) : defaultWidth
    if (!Number.isFinite(parsed)) return defaultWidth
    return clampPanelWidth(parsed, minWidth, maxWidth)
  } catch {
    return defaultWidth
  }
}

/** No-op subscribe for useSyncExternalStore (width is read imperatively). */
export function subscribePanelWidthStore() {
  return () => {}
}

export function setPersistentPanelWidth(
  width: number,
  setWidth: (width: number) => void,
  key: string,
  minWidth: number = CHAT_PANEL_MIN_WIDTH,
  maxWidth: number = CHAT_PANEL_MAX_WIDTH,
) {
  const next = clampPanelWidth(width, minWidth, maxWidth)
  setWidth(next)
  if (typeof window !== "undefined") {
    window.localStorage.setItem(key, String(next))
  }
}

/**
 * Start a pointer-driven panel resize. `direction` is which edge the handle is
 * on: "left-edge" = panel grows when dragging left (panel is on the right side,
 * like thread/member-detail), "right-edge" = panel grows when dragging right.
 */
export function startPanelResize(
  event: React.PointerEvent<HTMLDivElement>,
  startWidth: number,
  applyWidth: (width: number) => void,
  direction: "left-edge" | "right-edge",
) {
  event.preventDefault()
  const startX = event.clientX
  document.body.style.cursor = "col-resize"
  document.body.style.userSelect = "none"

  const handlePointerMove = (moveEvent: PointerEvent) => {
    const delta = direction === "right-edge" ? moveEvent.clientX - startX : startX - moveEvent.clientX
    applyWidth(startWidth + delta)
  }
  const handlePointerUp = () => {
    document.body.style.cursor = ""
    document.body.style.userSelect = ""
    window.removeEventListener("pointermove", handlePointerMove)
    window.removeEventListener("pointerup", handlePointerUp)
  }

  window.addEventListener("pointermove", handlePointerMove)
  window.addEventListener("pointerup", handlePointerUp, { once: true })
}

/** Keyboard resize: ArrowLeft/ArrowRight by a fixed step. */
export function handlePanelResizeKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  currentWidth: number,
  applyWidth: (width: number) => void,
  minWidth: number = CHAT_PANEL_MIN_WIDTH,
  maxWidth: number = CHAT_PANEL_MAX_WIDTH,
) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
  event.preventDefault()
  applyWidth(currentWidth + (event.key === "ArrowLeft" ? 16 : -16))
  // clamp via setPersistentPanelWidth if the caller wraps it; here we just pass through
  // — callers typically pass a clamping setter.
  void minWidth
  void maxWidth
}
