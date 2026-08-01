"use client"

import { FormEvent, useState } from "react"
import { useRouter } from "next/navigation"
import { Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { API_BASE, PUBLIC_KEY } from "@/lib/control-plane"

type MessageComposerProps = {
  path: string
  placeholder?: string
  allowTask?: boolean
}

export function MessageComposer({ path, placeholder = "Type a message", allowTask = false }: MessageComposerProps) {
  const router = useRouter()
  const [content, setContent] = useState("")
  const [asTask, setAsTask] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  // IME（中文/日文等输入法）组词期间的 Enter 用于确认候选词，不应提交消息。
  // keyCode 229 是 IME 仍在组合的兼容信号；isComposing 是标准属性。
  // 拦截组合期间的 Enter，避免把拼音/半截中文发出去。
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      event.preventDefault()
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!content.trim()) return
    setPending(true)
    setError("")
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Public-Key": PUBLIC_KEY },
        body: JSON.stringify({
          content: content.trim(),
          sender: "zy-ean",
          asTask,
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.detail || data.message || `Request failed: ${response.status}`)
      }
      setContent("")
      setAsTask(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message")
    } finally {
      setPending(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={pending}
          className="flex-1"
        />
        <Button type="submit" disabled={pending || !content.trim()}>
          <Send className="size-4" />
          Send
        </Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        {allowTask ? (
          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={asTask} onChange={(event) => setAsTask(event.target.checked)} />
            AS TASK
          </label>
        ) : (
          <span />
        )}
        {error && <span className="text-xs text-destructive">{error}</span>}
      </div>
    </form>
  )
}
