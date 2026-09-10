"use client"

import { useEffect, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useTranslations } from "next-intl"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiHeaders, BROWSER_API_BASE } from "@/lib/control-plane"
import type { ChannelFileItem } from "@/lib/channel-files-state"

/**
 * Files 标签页的任务成果预览。
 * 视频/音频用原生标签直连附件端点（后端已支持会话 cookie 鉴权），
 * Markdown/文本走带鉴权的 fetch 后用 react-markdown 渲染。
 */

const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i
const AUDIO_EXT = /\.(mp3|wav|m4a|ogg)$/i
const MARKDOWN_EXT = /\.(md|markdown)$/i
const TEXT_EXT = /\.(txt|log|json|csv|ya?ml|toml|xml|html?)$/i
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024

export type ChannelFilePreviewKind = "video" | "audio" | "markdown" | "text" | null

export function channelFilePreviewKind(mimeType: string, fileName: string): ChannelFilePreviewKind {
  const mime = (mimeType || "").toLowerCase()
  // 老 daemon 上传的文件 MIME 常是 application/octet-stream，按扩展名兜底。
  const generic = mime === "" || mime === "application/octet-stream"
  if (mime.startsWith("video/") || (generic && VIDEO_EXT.test(fileName))) return "video"
  if (mime.startsWith("audio/") || (generic && AUDIO_EXT.test(fileName))) return "audio"
  const texty = generic || mime.startsWith("text/") || mime === "application/json"
  if (texty && (mime === "text/markdown" || MARKDOWN_EXT.test(fileName))) return "markdown"
  if (texty && (mime.startsWith("text/") || TEXT_EXT.test(fileName))) return "text"
  return null
}

function formatSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ""
  const units = ["B", "KB", "MB", "GB"]
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

type TextPreviewState = { phase: "loading" } | { phase: "error" } | { phase: "done"; text: string }

function FileTextContent({
  file,
  asMarkdown,
  sessionToken,
  activeServerId,
}: {
  file: ChannelFileItem
  asMarkdown: boolean
  sessionToken?: string | null
  activeServerId?: string | null
}) {
  const t = useTranslations("chat")
  const [state, setState] = useState<TextPreviewState>({ phase: "loading" })

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${BROWSER_API_BASE}/api/v1/attachments/${file.id}`, {
      headers: apiHeaders(sessionToken, false, activeServerId),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => setState({ phase: "done", text }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "error" })
      })
    return () => controller.abort()
  }, [file.id, sessionToken, activeServerId])

  if (state.phase === "error") {
    return <p className="py-8 text-center text-sm text-destructive">{t("filePreviewLoadFailed")}</p>
  }
  if (state.phase === "loading") {
    return <p className="py-8 text-center text-sm text-muted-foreground">{t("filesLoading")}</p>
  }
  if (asMarkdown) {
    return (
      <div className="prose prose-sm max-w-none break-words pb-2 text-sm">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{state.text}</ReactMarkdown>
      </div>
    )
  }
  return (
    <pre className="overflow-x-auto rounded-none bg-muted p-3 text-xs whitespace-pre-wrap break-words">
      {state.text}
    </pre>
  )
}

export function ChannelFilePreviewDialog({
  file,
  open,
  onOpenChange,
  sessionToken,
  activeServerId,
}: {
  file: ChannelFileItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionToken?: string | null
  activeServerId?: string | null
}) {
  const t = useTranslations("chat")
  if (!file) return null
  const kind = channelFilePreviewKind(file.mimeType, file.originalName)
  const src = `${BROWSER_API_BASE}/api/v1/attachments/${file.id}`
  const tooLarge = file.size > MAX_TEXT_PREVIEW_BYTES

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1rem)] max-w-3xl max-h-[calc(100svh-2rem)] gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="truncate pr-8">{file.originalName}</DialogTitle>
          <DialogDescription>
            {file.mimeType}
            {file.size > 0 ? ` · ${formatSize(file.size)}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {tooLarge && (kind === "markdown" || kind === "text") ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("filePreviewTooLarge")}</p>
          ) : kind === "video" ? (
            <video controls preload="metadata" src={src} className="max-h-[65svh] w-full bg-black" />
          ) : kind === "audio" ? (
            <audio controls preload="metadata" src={src} className="w-full" />
          ) : kind === "markdown" || kind === "text" ? (
            <FileTextContent
              key={file.id}
              file={file}
              asMarkdown={kind === "markdown"}
              sessionToken={sessionToken}
              activeServerId={activeServerId}
            />
          ) : null}
        </div>

        <div>
          <a
            href={`${BROWSER_API_BASE}${file.url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {t("download")}
          </a>
        </div>
      </DialogContent>
    </Dialog>
  )
}
