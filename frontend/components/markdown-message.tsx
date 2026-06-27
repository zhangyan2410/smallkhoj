import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

export function MarkdownMessage({ content, compact = false }: { content: string; compact?: boolean }) {
  return (
    <div className={`markdown-body min-w-0 break-words [overflow-wrap:anywhere] ${compact ? "text-sm" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
