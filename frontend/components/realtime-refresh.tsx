"use client"

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import { useRealtimeSubscription } from "@/components/realtime-provider"
import { projectRealtimeEvent } from "@/lib/realtime-owner"

export function RealtimeRefresh({ eventTypes }: { eventTypes: string[] }) {
  const router = useRouter()
  const eventTypesRef = useRef(new Set(eventTypes))
  const refreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    eventTypesRef.current = new Set(eventTypes)
  }, [eventTypes])

  useRealtimeSubscription(({ event }) => {
    const projection = projectRealtimeEvent(event, eventTypesRef.current)
    if (projection === "ignore" || projection === "tasks") return
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
    refreshTimerRef.current = window.setTimeout(() => {
      router.refresh()
      refreshTimerRef.current = null
    }, 150)
  })

  useEffect(() => () => {
    if (refreshTimerRef.current) window.clearTimeout(refreshTimerRef.current)
  }, [])

  return null
}
