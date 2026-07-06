import ReactMarkdown from "react-markdown"
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

export function MarkdownMessage({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div className={`markdown-body min-w-0 break-words [overflow-wrap:anywhere] ${compact ? "text-sm" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeMentions]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
