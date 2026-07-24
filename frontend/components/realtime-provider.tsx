"use client"

import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react"

import { apiHeaders } from "@/lib/control-plane"
import {
  RealtimeTransportOwner,
  TASK_DATA_INVALIDATED_EVENT,
  type RealtimeDelivery,
} from "@/lib/realtime-owner"
import { connectRealtimeEvents } from "@/lib/realtime-events"

const RealtimeOwnerContext = createContext<RealtimeTransportOwner | null>(null)

export function RealtimeProvider({
  serverId,
  children,
}: {
  serverId?: string | null
  children: ReactNode
}) {
  const [owner] = useState(() => new RealtimeTransportOwner(({ headers, signal, onEvent }) => (
    connectRealtimeEvents({
      headers,
      signal,
      onEvent,
      onStatus: (status) => {
        if (status.state === "error") console.warn("[realtime] shared stream error", status.error)
        if (status.state === "reconnecting") {
          console.info("[realtime] shared stream reconnect", status.attempt, status.delayMs)
        }
      },
    })
  )))

  useEffect(() => {
    const headers = apiHeaders(undefined, false, serverId)
    const accountToken = headers["X-Account-Token"]
    owner.setScope(serverId && accountToken
      ? { key: `${accountToken}:${serverId}`, headers }
      : null)
    return () => owner.setScope(null)
  }, [owner, serverId])

  useEffect(() => () => owner.dispose(), [owner])

  useEffect(() => owner.subscribe(({ event }) => {
    if (!event.type.startsWith("task.")) return
    window.dispatchEvent(new CustomEvent(TASK_DATA_INVALIDATED_EVENT, { detail: event }))
  }), [owner])

  return (
    <RealtimeOwnerContext.Provider value={owner}>
      {children}
    </RealtimeOwnerContext.Provider>
  )
}

export function useRealtimeSubscription(
  callback: (delivery: RealtimeDelivery) => void,
) {
  const owner = useContext(RealtimeOwnerContext)
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!owner) return
    return owner.subscribe((delivery) => callbackRef.current(delivery))
  }, [owner])
}
