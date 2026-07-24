"use client"

import { useEffect, useState } from "react"
import { Plus } from "lucide-react"

import { CreateAgentForm } from "@/components/create-agent-form"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  apiPost,
  apiGet,
  type Computer,
  type Member,
} from "@/lib/control-plane"
import {
  detectedProviderOptions,
  unavailableProviderOptions,
  type ProviderOption,
} from "@/lib/runtime-options"

function channelPathSegment(name: string) {
  return encodeURIComponent(name.replace(/^#/, ""))
}

/**
 * 侧边栏 DMS 区的「新建 agent」入口。
 * 点击 + 弹出完整 create-agent 表单；创建成功后自动调用 POST /api/v1/dm
 * 让新 agent 出现在 DMS 列表，并跳进该 DM 会话。
 *
 * 注意：后端创建 agent 不会自动建 DM（见 backend POST /api/v1/members/agents），
 * 所以这里显式补一次 /api/v1/dm。
 */
export function CreateAgentDialog() {
  const [open, setOpen] = useState(false)
  const [computers, setComputers] = useState<Computer[]>([])
  const [providerOptions, setProviderOptions] = useState<ProviderOption[]>([])
  const [error, setError] = useState<string | null>(null)

  // 弹窗打开时再拉 computer 列表（用于 computer 下拉 + provider 选项派生）。
  useEffect(() => {
    if (!open) return
    let cancelled = false
    apiGet<{ computers: Computer[] }>("/api/v1/computers", { computers: [] })
      .then(({ computers: list }) => {
        if (cancelled) return
        setComputers(list)
        setProviderOptions(detectedProviderOptions(list))
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load computers")
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleCreated(member: Member) {
    // 创建 agent 成功后，为它建一个 DM，使其出现在 DMS 列表。
    const dm = await apiPost<{ channel?: { name: string }; detail?: string }>(
      "/api/v1/dm",
      { peer: member.displayName }
    )
    const dmName = dm?.channel?.name
    if (dmName) {
      window.location.href = `/chat/${channelPathSegment(dmName)}`
    } else {
      // DM 创建失败时至少关掉弹窗、给出提示，agent 本身已创建成功。
      setError("Agent created, but failed to open DM. Find it in the members page.")
      setOpen(false)
    }
  }

  const unavailableProviders = unavailableProviderOptions(providerOptions)

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(null) }}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Create agent"
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a new agent</DialogTitle>
          <DialogDescription>
            Create an agent and start a direct message with it.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <CreateAgentForm
          computers={computers}
          providerOptions={providerOptions}
          unavailableProviders={unavailableProviders}
          onSuccess={handleCreated}
          submitLabel="Create agent & start DM"
        />
      </DialogContent>
    </Dialog>
  )
}
