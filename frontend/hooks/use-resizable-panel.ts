"use client"

import { useCallback, useEffect, useRef, useState } from "react"

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
 *
 * Hydration 安全：首次渲染（SSR + 客户端 hydrate）统一返回 defaultWidth，
 * 避免服务端/客户端因 localStorage 值不同导致 hydration mismatch。
 * 客户端 mount 后（useEffect）才读 localStorage，会触发一次从 default 到 stored 的更新。
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
  const [stored, setStored] = useState<number>(defaultWidth)
  const didRead = useRef(false)

  // 客户端 mount 后读 localStorage（首次渲染用 defaultWidth，保证 SSR/客户端一致）
  useEffect(() => {
    if (didRead.current) return
    didRead.current = true
    let timeout: number | undefined
    try {
      const raw = window.localStorage.getItem(storageKey)
      const parsed = raw ? Number(raw) : defaultWidth
      const next = Number.isFinite(parsed) ? clamp(parsed) : defaultWidth
      if (next !== defaultWidth) {
        timeout = window.setTimeout(() => setStored(next), 0)
      }
    } catch {
      // ignore
    }
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout)
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
