"use client"

import { memo, useEffect, useId, useMemo, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { CheckSquare, Paperclip, Send, Square } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ComposerSuggestionMenu,
  type ComposerSuggestionOption,
} from "@/components/composer-suggestion-menu"
import { Input } from "@/components/ui/input"
import { ChatComposerSurface, ChatTaskToggle } from "@/components/inkframe-object-ui"
import { useChatDraft } from "@/hooks/use-chat-draft"
import {
  activeComposerToken,
  replaceComposerToken,
  suggestionSearchKey,
} from "@/lib/composer-suggestions"

export type ComposerMemberSuggestion = {
  id: string
  handle: string
  reference: string
  kind: string
  displayName?: string | null
  description?: string | null
  originServerName?: string | null
}

export type ComposerChannelSuggestion = {
  id: string
  name: string
  description?: string | null
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function SuggestionInput({
  name,
  value,
  placeholder,
  className,
  members,
  channels,
  selectedMentionIds,
  onSelectedMentionIdsChange,
  onValueChange,
  onSubmit,
}: {
  name?: string
  value: string
  placeholder: string
  className?: string
  members: ComposerMemberSuggestion[]
  channels: ComposerChannelSuggestion[]
  selectedMentionIds: string[]
  onSelectedMentionIdsChange: (ids: string[]) => void
  onValueChange: (value: string) => void
  onSubmit: () => void
}) {
  const tChat = useTranslations("chat")
  const inputRef = useRef<HTMLInputElement>(null)
  const menuId = useId()
  const [caret, setCaret] = useState(value.length)
  const [activeSelection, setActiveSelection] = useState<{ tokenKey: string | null; index: number }>({
    tokenKey: null,
    index: 0,
  })
  const [isComposing, setIsComposing] = useState(false)
  const [dismissedTokenKey, setDismissedTokenKey] = useState<string | null>(null)
  const token = useMemo(() => activeComposerToken(value, caret), [caret, value])
  const tokenKey = token
    ? `${token.trigger}:${token.start}:${token.end}:${token.query}`
    : null

  const options = useMemo<ComposerSuggestionOption[]>(() => {
    if (!token) return []
    const query = suggestionSearchKey(token.query)
    if (token.trigger === "@") {
      return members
        .filter((member) => {
          const handle = suggestionSearchKey(member.handle)
          const reference = suggestionSearchKey(member.reference.replace(/^@/, ""))
          return handle.includes(query) || reference.includes(query)
        })
        .slice(0, 20)
        .map((member) => {
          const collision = member.reference !== `@${member.handle}`
          const humanDetails = member.kind === "human"
            ? [
                member.displayName && member.displayName !== member.handle ? member.displayName : null,
                collision ? member.originServerName : null,
              ].filter(Boolean).join(" · ")
            : null
          return {
            id: `member:${member.id}`,
            value: member.reference,
            primary: member.reference,
            secondary: member.kind === "agent" ? member.description : humanDetails,
            kind: "member" as const,
          }
        })
    }
    return channels
      .filter((channel) => suggestionSearchKey(channel.name.replace(/^#/, "")).includes(query))
      .slice(0, 20)
      .map((channel) => ({
        id: `channel:${channel.id}`,
        value: `#${channel.name.replace(/^#/, "")}`,
        primary: `#${channel.name.replace(/^#/, "")}`,
        secondary: channel.description,
        kind: "channel" as const,
      }))
  }, [channels, members, token])

  const menuOpen = Boolean(token && !isComposing && dismissedTokenKey !== tokenKey)
  const activeIndex = activeSelection.tokenKey === tokenKey
    ? Math.min(activeSelection.index, Math.max(0, options.length - 1))
    : 0

  useEffect(() => {
    const currentIds = new Set(members.map((member) => member.id))
    const nextIds = selectedMentionIds.filter((memberId) => {
      if (!currentIds.has(memberId)) return false
      const member = members.find((candidate) => candidate.id === memberId)
      return Boolean(member && value.includes(member.reference))
    })
    if (!sameIds(nextIds, selectedMentionIds)) onSelectedMentionIdsChange(nextIds)
  }, [members, onSelectedMentionIdsChange, selectedMentionIds, value])

  function updateCaret(target: HTMLInputElement) {
    setCaret(target.selectionStart ?? target.value.length)
    setDismissedTokenKey(null)
  }

  function selectOption(option: ComposerSuggestionOption) {
    if (!token) return
    const replacement = replaceComposerToken(value, token, option.value)
    onValueChange(replacement.value)
    if (option.kind === "member") {
      const memberId = option.id.slice("member:".length)
      if (!selectedMentionIds.includes(memberId)) {
        onSelectedMentionIdsChange([...selectedMentionIds, memberId])
      }
    }
    setCaret(replacement.caret)
    setDismissedTokenKey(null)
    window.requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(replacement.caret, replacement.caret)
    })
  }

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value
    const nextIds = selectedMentionIds.filter((memberId) => {
      const member = members.find((candidate) => candidate.id === memberId)
      return Boolean(member && nextValue.includes(member.reference))
    })
    if (!sameIds(nextIds, selectedMentionIds)) onSelectedMentionIdsChange(nextIds)
    onValueChange(nextValue)
    setCaret(event.target.selectionStart ?? nextValue.length)
    setDismissedTokenKey(null)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229 || isComposing
    if (menuOpen && !composing) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault()
        if (options.length > 0) {
          const direction = event.key === "ArrowDown" ? 1 : -1
          setActiveSelection({
            tokenKey,
            index: (activeIndex + direction + options.length) % options.length,
          })
        }
        return
      }
      if ((event.key === "Enter" || event.key === "Tab") && options[activeIndex]) {
        event.preventDefault()
        selectOption(options[activeIndex])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setDismissedTokenKey(tokenKey)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !composing) {
      event.preventDefault()
      onSubmit()
    }
  }

  return (
    <>
      <Input
        ref={inputRef}
        name={name}
        value={value}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={menuOpen}
        aria-controls={menuOpen ? menuId : undefined}
        aria-activedescendant={menuOpen && options[activeIndex] ? `${menuId}-option-${activeIndex}` : undefined}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(event) => updateCaret(event.currentTarget)}
        onKeyUp={(event) => {
          if (!event.nativeEvent.isComposing && event.key !== "Escape") updateCaret(event.currentTarget)
        }}
        onSelect={(event) => updateCaret(event.currentTarget)}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={(event) => {
          setIsComposing(false)
          updateCaret(event.currentTarget)
        }}
        placeholder={placeholder}
        className={className}
        style={{ backgroundColor: "var(--paper)" }}
      />
      <ComposerSuggestionMenu
        id={menuId}
        anchorRef={inputRef}
        open={menuOpen}
        options={options}
        activeIndex={activeIndex}
        emptyLabel={token?.trigger === "@" ? tChat("noMemberSuggestions") : tChat("noChannelSuggestions")}
        onActiveIndexChange={(index) => setActiveSelection({ tokenKey, index })}
        onSelect={selectOption}
      />
    </>
  )
}

/**
 * 主输入框：input 草稿落到 localStorage（按 scopeKey 持久化），切换页面/
 * 刷新后能恢复；asTask 仍是组件内部 state。打字只重渲 Composer 自身，不会
 * 触发 ChannelClient、更不会触发消息列表（memo 化的 MessageList）重渲。
 * 发送成功后清空草稿；失败保留草稿（与原行为一致）。
 */
export const ChatComposer = memo(function ChatComposer({
  placeholder,
  scopeKey,
  uploading,
  attachDisabled,
  members,
  channels,
  onUpload,
  onSend,
  onCancelTurn,
  cancelTurnDisabled,
}: {
  placeholder: string
  scopeKey: string
  uploading: boolean
  attachDisabled: boolean
  members: ComposerMemberSuggestion[]
  channels: ComposerChannelSuggestion[]
  onUpload: (file: File) => void | Promise<void>
  onSend: (content: string, asTask: boolean, mentionMemberIds: string[]) => Promise<boolean>
  /** Present when the conversation has a busy agent: stops its current turn. */
  onCancelTurn?: () => void | Promise<void>
  cancelTurnDisabled?: boolean
}) {
  const tChat = useTranslations("chat")
  const { draft: input, setDraft: setInput, clearDraft: clearInput } = useChatDraft(scopeKey)
  const [asTask, setAsTask] = useState(false)
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  function openFilePicker() {
    if (!fileInputRef.current || uploading) return
    fileInputRef.current.removeAttribute("accept")
    fileInputRef.current.click()
  }

  async function submit() {
    const content = input.trim()
    if (!content) return
    const sent = await onSend(content, asTask, selectedMentionIds)
    if (!sent) return
    clearInput()
    setSelectedMentionIds([])
    if (asTask) setAsTask(false)
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
        <SuggestionInput
          name="content"
          value={input}
          placeholder={placeholder}
          className="min-w-0 flex-1"
          members={members}
          channels={channels}
          selectedMentionIds={selectedMentionIds}
          onSelectedMentionIdsChange={setSelectedMentionIds}
          onValueChange={setInput}
          onSubmit={() => void submit()}
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
        {onCancelTurn ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={tChat("cancelTurn")}
            title={tChat("cancelTurn")}
            disabled={cancelTurnDisabled}
            onClick={() => void onCancelTurn()}
          >
            <Square className="size-3.5" />
          </Button>
        ) : null}
      </ChatComposerSurface>
    </div>
  )
})

/**
 * Thread 回复输入框：与主输入框同理，草稿按 scopeKey 持久化，打字不再触发
 * ChannelClient / 消息列表重渲，切走再回来草稿不丢。
 */
export const ThreadComposer = memo(function ThreadComposer({
  placeholder,
  scopeKey,
  members,
  channels,
  onSend,
}: {
  placeholder: string
  scopeKey: string
  members: ComposerMemberSuggestion[]
  channels: ComposerChannelSuggestion[]
  onSend: (content: string, mentionMemberIds: string[]) => Promise<boolean>
}) {
  const tChat = useTranslations("chat")
  const { draft: input, setDraft: setInput, clearDraft: clearInput } = useChatDraft(scopeKey)
  const [selectedMentionIds, setSelectedMentionIds] = useState<string[]>([])

  async function submit() {
    const content = input.trim()
    if (!content) return
    const sent = await onSend(content, selectedMentionIds)
    if (!sent) return
    clearInput()
    setSelectedMentionIds([])
  }

  return (
    <div className="mt-3 flex shrink-0 gap-2 border-t pt-3 min-w-0 overflow-x-hidden">
      <SuggestionInput
        value={input}
        placeholder={placeholder}
        className="min-w-0 flex-1"
        members={members}
        channels={channels}
        selectedMentionIds={selectedMentionIds}
        onSelectedMentionIdsChange={setSelectedMentionIds}
        onValueChange={setInput}
        onSubmit={() => void submit()}
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
