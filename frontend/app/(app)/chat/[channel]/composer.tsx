"use client"

import { memo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { CheckSquare, Paperclip, Send } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ChatComposerSurface, ChatTaskToggle } from "@/components/inkframe-object-ui"

/**
 * 主输入框：input / asTask 是组件内部 state。打字只重渲 Composer 自身，
 * 不会触发 ChannelClient、更不会触发消息列表（memo 化的 MessageList）重渲。
 * 发送成功后清空草稿；失败保留草稿（与原行为一致）。
 */
export const ChatComposer = memo(function ChatComposer({
  placeholder,
  uploading,
  attachDisabled,
  onUpload,
  onSend,
}: {
  placeholder: string
  uploading: boolean
  attachDisabled: boolean
  onUpload: (file: File) => void | Promise<void>
  onSend: (content: string, asTask: boolean) => Promise<boolean>
}) {
  const tChat = useTranslations("chat")
  const [input, setInput] = useState("")
  const [asTask, setAsTask] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function openFilePicker() {
    if (!fileInputRef.current || uploading) return
    fileInputRef.current.removeAttribute("accept")
    fileInputRef.current.click()
  }

  async function submit() {
    const content = input.trim()
    if (!content) return
    const sent = await onSend(content, asTask)
    if (!sent) return
    setInput("")
    if (asTask) setAsTask(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // IME 组词期间的 Enter 用于确认候选词，不提交（isComposing / keyCode 229）。
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div data-region="composer" data-inkframe-mobile-role="chat-composer" className="sk-chat-composer min-w-0 shrink-0 overflow-x-hidden border-t-2 border-[var(--ink)] p-3">
      <ChatComposerSurface className="mr-auto flex w-full max-w-[1248px] min-w-0 flex-wrap items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void onUpload(file)
            e.target.value = ""
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={tChat("attachFile")}
          title={tChat("attachFile")}
          disabled={uploading || attachDisabled}
          onClick={() => openFilePicker()}
        >
          <Paperclip className="size-3.5" />
        </Button>
        <Input
          name="content"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1"
          style={{ backgroundColor: "var(--paper)" }}
        />
        <ChatTaskToggle
          active={asTask}
          onClick={() => setAsTask(!asTask)}
          aria-pressed={asTask}
          aria-label={tChat("sendAsTask")}
          title={tChat("asTask")}
        >
          <span data-slot="chat-task-toggle-mark" className="sk-chat-task-toggle-mark">
            {asTask && <CheckSquare className="size-3 pointer-events-none" />}
          </span>
          {tChat("asTask")}
        </ChatTaskToggle>
        <Button
          type="button"
          size="icon"
          aria-label={tChat("sendMessage")}
          onClick={() => void submit()}
          disabled={!input.trim()}
        >
          <Send className="size-3.5" />
        </Button>
      </ChatComposerSurface>
    </div>
  )
})

/**
 * Thread 回复输入框：与主输入框同理，threadInput 是内部 state，
 * 打字不再触发 ChannelClient / 消息列表重渲。
 */
export const ThreadComposer = memo(function ThreadComposer({
  placeholder,
  onSend,
}: {
  placeholder: string
  onSend: (content: string) => Promise<boolean>
}) {
  const tChat = useTranslations("chat")
  const [input, setInput] = useState("")

  async function submit() {
    const content = input.trim()
    if (!content) return
    const sent = await onSend(content)
    if (!sent) return
    setInput("")
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    // IME 组词期间的 Enter 用于确认候选词，不提交（isComposing / keyCode 229）。
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <div className="mt-3 flex shrink-0 gap-2 border-t pt-3 min-w-0 overflow-x-hidden">
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="min-w-0 flex-1"
        style={{ backgroundColor: "var(--paper)" }}
      />
      <Button
        type="button"
        size="icon"
        aria-label={tChat("sendThreadReply")}
        onClick={() => void submit()}
        disabled={!input.trim()}
      >
        <Send className="size-4" />
      </Button>
    </div>
  )
})
