"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import { apiHeaders } from "@/lib/control-plane"
import { applyHighWater, connectRealtimeEvents, type HighWater } from "@/lib/realtime-events"

export function RealtimeRefresh({ eventTypes }: { eventTypes: string[] }) {
  const router = useRouter()
  const eventTypesRef = useRef(new Set(eventTypes))
  const highWaterRef = useRef(new Map<string, HighWater>())
  const refreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    eventTypesRef.current = new Set(eventTypes)
  }, [eventTypes])

  useEffect(() => {
    const controller = new AbortController()
    const stop = connectRealtimeEvents({
      headers: apiHeaders(),
      signal: controller.signal,
      onEvent: (event) => {
        if (!eventTypesRef.current.has(event.type)) return
        const decision = applyHighWater(highWaterRef.current, event)
        if (decision.action === "drop") return
        if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = window.setTimeout(() => {
          router.refresh()
          refreshTimerRef.current = null
        }, 150)
      },
      onStatus: (status) => {
        if (status.state === "error") console.warn("[realtime] refresh stream error", status.error)
      },
    })
    return () => {
      stop()
      controller.abort()
      if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    }
  }, [router])

  return null
}
