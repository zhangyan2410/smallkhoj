"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Bot } from "lucide-react"

import { CreateAgentForm } from "@/components/create-agent-form"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { apiPost, type Computer, type Member } from "@/lib/control-plane"
import type { ProviderOption } from "@/lib/runtime-options"
import { unavailableProviderOptions } from "@/lib/runtime-options"

/**
 * members 页的 Create Agent 卡片。
 * 包一层共享 CreateAgentForm。创建成功后会：
 *   1. 为新 agent 建一个 DM（POST /api/v1/dm），使其出现在 chat 的 DMS 列表——
 *      后端创建 agent 不会自动建 DM，必须显式补这一步，否则 agent 不会在 DMS 里。
 *   2. 刷新当前页面以重拉 member 列表（等价于原 server action 的 revalidate）。
 * members 页不跳转到 chat（管理视角留在本页）；建 DM 失败不阻断 agent 创建。
 */
export function CreateAgentCard({
  computers,
  providerOptions,
  error,
}: {
  computers: Computer[]
  providerOptions: ProviderOption[]
  error?: string | null
}) {
  const router = useRouter()
  const [warning, setWarning] = useState<string | null>(null)
  const unavailableProviders = unavailableProviderOptions(providerOptions)

  async function handleCreated(member: Member) {
    setWarning(null)
    try {
      await apiPost("/api/v1/dm", { peer: member.displayName })
    } catch (e) {
      // agent 已创建成功；建 DM 失败时只给提示，不阻断。
      const detail = e instanceof Error ? e.message : String(e)
      setWarning(`Agent created, but failed to open DM (${detail}). It's available in the member list.`)
    }
    router.refresh()
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4" />
          Create Agent
        </CardTitle>
        <CardDescription>Create a new agent and bind it to a computer runtime.</CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {warning && <p className="mb-3 text-sm text-amber-700">{warning}</p>}
        <CreateAgentForm
          computers={computers}
          providerOptions={providerOptions}
          unavailableProviders={unavailableProviders}
          onSuccess={handleCreated}
        />
      </CardContent>
    </Card>
  )
}
