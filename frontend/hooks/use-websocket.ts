"use client"

import { useCallback, useState } from "react"
import useWebSocket from "react-use-websocket"

import { PUBLIC_KEY } from "@/lib/control-plane"
import { resolveChatWebSocketProtocols, resolveChatWebSocketUrl } from "@/lib/runtime-url"

export interface WSMessage {
  type: "status" | "message" | "error"
  status?: string
  content?: string
  message?: string
}

export function useChatWebSocket() {
  const [messages, setMessages] = useState<string[]>([])
  const [isThinking, setIsThinking] = useState(false)

  const { sendJsonMessage, readyState } = useWebSocket(() => resolveChatWebSocketUrl(), {
    protocols: resolveChatWebSocketProtocols(PUBLIC_KEY),
    onMessage: (event) => {
      const data: WSMessage = JSON.parse(event.data)
      if (data.type === "status" && data.status === "thinking") {
        setIsThinking(true)
        setMessages((prev) => [...prev, ""])
      } else if (data.type === "message" && data.content) {
        setMessages((prev) => {
          const copy = [...prev]
          copy[copy.length - 1] = (copy[copy.length - 1] || "") + data.content
          return copy
        })
      } else if (data.type === "status" && data.status === "done") {
        setIsThinking(false)
      }
    },
    shouldReconnect: () => true,
  })

  const sendMessage = useCallback(
    (text: string) => {
      sendJsonMessage({ q: text })
    },
    [sendJsonMessage]
  )

  return { messages, isThinking, sendMessage, readyState }
}
