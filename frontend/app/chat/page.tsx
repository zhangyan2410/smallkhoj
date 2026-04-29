"use client"

import { useState } from "react"
import { useChatWebSocket } from "@/hooks/use-websocket"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export default function ChatPage() {
  const [input, setInput] = useState("")
  const { messages, isThinking, sendMessage } = useChatWebSocket()

  const handleSend = () => {
    if (!input.trim()) return
    sendMessage(input.trim())
    setInput("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="border-b px-4 py-3">
        <h1 className="text-lg font-semibold">SmallKhoj Chat</h1>
        <p className="text-xs text-muted-foreground">WebSocket 实时通信</p>
      </header>

      <ScrollArea className="flex-1 p-4">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.length === 0 && !isThinking && (
            <div className="text-center text-muted-foreground py-20">
              <p className="text-lg">发送一条消息开始对话</p>
              <p className="text-sm mt-1">基于 FastAPI WebSocket + OpenAI 流式 API</p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className="space-y-1">
              <div className="text-xs text-muted-foreground">Assistant</div>
              <div className="prose prose-sm dark:prose-invert max-w-none bg-muted/50 rounded-lg p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {msg || (i === messages.length - 1 && isThinking ? "..." : "")}
                </ReactMarkdown>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      <footer className="border-t p-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，按 Enter 发送..."
            disabled={isThinking}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={isThinking || !input.trim()}>
            发送
          </Button>
        </div>
      </footer>
    </div>
  )
}
