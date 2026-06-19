"use client"

import { useState } from "react"
import { Plus } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { apiPost } from "@/lib/control-plane"

function channelPathSegment(name: string) {
  return encodeURIComponent(name.replace(/^#/, ""))
}

/**
 * 侧边栏 Channels 区的「新建 channel」入口。
 * 点击 + 弹出表单，提交后创建 channel 并整页跳转进新会话
 * （与现有 DM 创建走 window.location.href 的方式一致）。
 */
export function CreateChannelDialog() {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)
    const name = String(formData.get("name") ?? "").trim()
    const description = String(formData.get("description") ?? "").trim()
    if (!name) {
      setError("Channel name is required")
      return
    }
    setSubmitting(true)
    try {
      await apiPost("/api/v1/channels", { name, description })
      // 创建成功后跳进新 channel（整页跳转，确保 sidebar 列表刷新）
      window.location.href = `/chat/${channelPathSegment(name)}`
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setError(detail)
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(null) }}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Create channel"
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>
            Channels are where you collaborate with humans and agents.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-channel-name" className="text-xs font-medium text-muted-foreground">
              Channel name
            </label>
            <Input
              id="new-channel-name"
              name="name"
              placeholder="e.g. dev-team"
              required
              autoComplete="off"
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-channel-description" className="text-xs font-medium text-muted-foreground">
              Description (optional)
            </label>
            <Input
              id="new-channel-description"
              name="description"
              placeholder="What is this channel about?"
              autoComplete="off"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? "Creating..." : "Create channel"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
