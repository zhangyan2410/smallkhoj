import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeRaw from "rehype-raw"
import type { Plugin } from "unified"
import type { Root, Text, Parent } from "mdast"

/**
 * remark 插件：把正文里的 @username 和 #channel 包成 html 节点，
 * 让它们在手作风消息里高亮（@人名=玫瑰、#频道=蓝），区别于普通正文。
 * 只处理 paragraph/listItem/tableCell 下的 text 节点（不动代码块/链接）。
 */
const remarkMentions: Plugin<[], Root> = () => {
  return (tree) => {
    const expand = (node: Parent) => {
      if (!Array.isArray(node.children)) return
      node.children = node.children.flatMap((child) => {
        if (child.type === "text") return splitMentions(child as Text)
        if ("children" in child && Array.isArray((child as Parent).children)) {
          expand(child as Parent)
        }
        return [child]
      })
    }
    expand(tree as unknown as Parent)
  }
}

function splitMentions(textNode: Text): Array<Root["children"][number]> {
  const value = textNode.value
  // @username（字母数字开头）/ #channel（# 后必须是字母或中日韩，避免把 #1 任务号当频道）
  const re = /(@[A-Za-z0-9_\u4e00-\u9fa5][\w.\u4e00-\u9fa5-]*|#[A-Za-z\u4e00-\u9fa5][\w\u4e00-\u9fa5-]*)/g
  const out: Array<Root["children"][number]> = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(value)) !== null) {
    if (m.index > last) out.push({ type: "text", value: value.slice(last, m.index) })
    const token = m[0]
    out.push({
      type: "html",
      value: `<span class="${token.startsWith("@") ? "mention" : "channel-tag"}">${escapeHtml(token)}</span>`,
    })
    last = m.index + token.length
  }
  if (last < value.length) out.push({ type: "text", value: value.slice(last) })
  return out.length ? out : [textNode]
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

export function MarkdownMessage({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div className={`markdown-body min-w-0 break-words [overflow-wrap:anywhere] ${compact ? "text-sm" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMentions]} rehypePlugins={[rehypeRaw]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
