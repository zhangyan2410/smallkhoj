import { isValidElement, memo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import { Check, Copy } from "lucide-react"
import { useTranslations } from "next-intl"
import remarkGfm from "remark-gfm"
import type { Plugin } from "unified"
import type { Element, ElementContent, Parents, Root, RootContent, Text } from "hast"

/**
 * rehype 插件：把正文里的 @username 和 #channel 包成 span 节点，
 * 让它们在手作风消息里高亮（@人名=玫瑰、#频道=蓝），区别于普通正文。
 * 不启用 raw HTML：用户消息里的 <marker> 这类内容必须作为文本渲染，不能变成 DOM tag。
 */
const rehypeMentions: Plugin<[], Root> = () => {
  return (tree) => {
    const expand = (node: Parents, blocked = false) => {
      if (!Array.isArray(node.children)) return
      const nextBlocked = blocked || isBlockedElement(node)
      node.children = node.children.flatMap((child) => {
        if (!nextBlocked && child.type === "text") return splitMentions(child)
        if ("children" in child && Array.isArray((child as Parents).children)) {
          expand(child as Parents, nextBlocked)
        }
        return [child]
      }) as typeof node.children
    }
    expand(tree)
  }
}

function splitMentions(textNode: Text): Array<RootContent | ElementContent> {
  const value = textNode.value
  // @username（字母数字开头）/ #channel（# 后必须是字母或中日韩，避免把 #1 任务号当频道）
  const re = /(@[A-Za-z0-9_\u4e00-\u9fa5][\w.\u4e00-\u9fa5-]*|#[A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g
  const out: Array<RootContent | ElementContent> = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) })
    const token = m[0]
    out.push({
      type: "element",
      tagName: "span",
      properties: { className: token.startsWith("@") ? ["mention"] : ["channel-tag"] },
      children: [{ type: "text", value: token }],
    })
    last = m.index + token.length
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) })
  return out.length ? out : [textNode]
}

function isBlockedElement(node: Parents): node is Element {
  return node.type === "element" && ["a", "code", "pre"].includes(node.tagName)
}

/** react-markdown 把 fenced code 渲染成 pre > code，语言在 code 的 className（language-xxx）。 */
function extractCodeLanguage(children: ReactNode): string | null {
  if (!isValidElement(children)) return null
  const className = (children.props as { className?: string }).className ?? ""
  const match = /language-([\w-]+)/.exec(className)
  return match?.[1] ?? null
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // 剪贴板 API 被拒（权限/非安全上下文）时退回 execCommand。
    try {
      const textarea = document.createElement("textarea")
      textarea.value = text
      textarea.style.position = "fixed"
      textarea.style.opacity = "0"
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand("copy")
      textarea.remove()
      return ok
    } catch {
      return false
    }
  }
}

/**
 * 代码块：墨边纸条 + 头部条（语言标签 + 复制按钮）。
 * 薄荷底只作柔和 tint（globals.css .sk-codeblock），区别于正文但不喧宾夺主。
 */
const CodeBlock = memo(function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useTranslations("common")
  const [copied, setCopied] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const language = extractCodeLanguage(children)

  async function onCopy() {
    const text = bodyRef.current?.textContent ?? ""
    if (!text) return
    if (await copyText(text)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="sk-codeblock">
      <div className="sk-codeblock-header">
        <span className="sk-codeblock-lang">{language ?? "code"}</span>
        <button
          type="button"
          onClick={onCopy}
          className="sk-codeblock-copy"
          aria-label={t("copy")}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? t("copied") : t("copy")}
        </button>
      </div>
      <div ref={bodyRef} className="sk-codeblock-body">
        <pre>{children}</pre>
      </div>
    </div>
  )
})

// memo：消息列表里每条消息都挂一个 MarkdownMessage。父级（消息行/MessageList）
// 因无关 state 重渲时，content 没变的消息直接跳过重渲，不为未变化的消息
// 重新跑 react-markdown 解析。
export const MarkdownMessage = memo(function MarkdownMessage({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div className={`markdown-body min-w-0 break-words [overflow-wrap:anywhere] ${compact ? "text-sm" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeMentions]}
        components={{ pre: CodeBlock }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
