"use client"

import { useCallback, useMemo, useState } from "react"

/**
 * 可调宽面板 hook —— 从 channel-client 的可调宽逻辑抽出来，供 ProductShell 三栏列表栏和 chat 复用。
 *
 * 用法：
 *   const { width, onPointerDown, onKeyDown } = useResizablePanel({
 *     storageKey: "smallkhoj.tasks.listWidth",
 *     defaultWidth: 280, min: 220, max: 420,
 *     direction: "right-edge",
 *   })
 *
 * direction:
 *   - "right-edge"（默认）：拖右边框往右拖变大（列表栏在左侧时用）
 *   - "left-edge"：拖左边框往左拖变大（thread 栏在右侧时用）
 *
 * 返回 onPointerDown/onKeyDown 可直接挂到拖拽手柄 div 上。
 */
export function useResizablePanel({
  storageKey,
  defaultWidth,
  min,
  max,
  direction = "right-edge",
}: {
  storageKey: string
  defaultWidth: number
  min: number
  max: number
  direction?: "left-edge" | "right-edge"
}) {
  const clamp = useCallback(
    (w: number) => Math.min(max, Math.max(min, w)),
    [min, max],
  )

  const [override, setOverride] = useState<number | null>(null)
  // 客户端读取 localStorage：用 lazy initializer 在首次渲染就读到，避免 effect 里 setState。
  // SSR 时 window 不存在，回退到 defaultWidth；客户端首次渲染用真实值（避免闪烁）。
  const stored = useMemo<number>(() => {
    if (typeof window === "undefined") return defaultWidth
    try {
      const raw = window.localStorage.getItem(storageKey)
      const parsed = raw ? Number(raw) : defaultWidth
      return Number.isFinite(parsed) ? clamp(parsed) : defaultWidth
    } catch {
      return defaultWidth
    }
  }, [storageKey, defaultWidth, clamp])

  const width = override ?? stored

  const persist = useCallback(
    (w: number) => {
      const next = clamp(w)
      setOverride(next)
      try {
        window.localStorage.setItem(storageKey, String(next))
      } catch {
        // ignore
      }
    },
    [clamp, storageKey],
  )

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"

      const handleMove = (moveEvent: PointerEvent) => {
        const delta =
          direction === "right-edge" ? moveEvent.clientX - startX : startX - moveEvent.clientX
        persist(width + delta)
      }
      const handleUp = () => {
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        window.removeEventListener("pointermove", handleMove)
        window.removeEventListener("pointerup", handleUp)
      }
      window.addEventListener("pointermove", handleMove)
      window.addEventListener("pointerup", handleUp, { once: true })
    },
    [direction, persist, width],
  )

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
      event.preventDefault()
      const grow = direction === "right-edge"
      const step = event.key === (grow ? "ArrowRight" : "ArrowLeft") ? 16 : -16
      persist(width + step)
    },
    [direction, persist, width],
  )

  return { width, onPointerDown, onKeyDown }
}
