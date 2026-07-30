"use client"

import { useState } from "react"
import { Bot } from "lucide-react"

import { ProviderSelect } from "@/components/provider-select"
import { InkframeObjectSurface } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
  apiPost,
  type Computer,
  type Member,
} from "@/lib/control-plane"
import {
  detectedProviderOptions,
  unavailableProviderOptions,
  runtimeOptionsFromDetected,
  type ProviderOption,
  type RuntimeOption,
} from "@/lib/runtime-options"

type CreatedMember = Member

export interface CreateAgentFormProps {
  computers: Computer[]
  providerOptions: ProviderOption[]
  unavailableProviders?: ProviderOption[]
  /**
   * 创建成功后的回调，接收后端返回的新 member。
   * members 页可省略（由父组件控制后续 revalidate/redirect）；
   * chat 弹窗用它来接着创建 DM。
   */
  onSuccess?: (member: CreatedMember) => void | Promise<void>
  /** 触发提交按钮的文案。 */
  submitLabel?: string
}

/**
 * 创建 agent 的表单。从 members 页抽取为共享组件，同时供 chat 弹窗复用。
 *
 * 与 members 页原 server action 版本的差异：改用客户端 apiPost 提交，
 * 这样能在创建成功后通过 onSuccess 回调执行后续动作（如建 DM），
 * 而不必依赖 server action 的固定 redirect。
 */
export function CreateAgentForm({
  computers,
  providerOptions,
  unavailableProviders = [],
  onSuccess,
  submitLabel = "Create Agent",
}: CreateAgentFormProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [computerId, setComputerId] = useState("")
  const [runtime, setRuntime] = useState("claude_code")
  const runtimeOptions = computerId
    ? runtimeOptionsFromDetected(computers, { computerId })
    : runtimeOptionsFromDetected(computers)
  // 默认选第一个可用的；若当前 runtime 不可选，回退到第一个可用项
  const effectiveRuntime =
    runtimeOptions.some((opt) => opt.value === runtime && opt.available)
      ? runtime
      : runtimeOptions.find((opt) => opt.available)?.value ?? "pi"
  const scopedProviderOptions = computerId
    ? detectedProviderOptions(computers, { computerId, runtime: effectiveRuntime })
    : providerOptions
  const scopedUnavailableProviders = computerId
    ? unavailableProviderOptions(scopedProviderOptions, { runtime: effectiveRuntime })
    : unavailableProviders

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    // 在任何 await 之前缓存 form 引用：React 合成事件在处理结束后会清空
    // event.currentTarget，await 之后再用它会得到 null（曾导致 "Cannot
    // read properties of null (reading 'reset')" 报错，吞掉创建成功的结果）。
    const form = event.currentTarget
    const formData = new FormData(form)
    const name = String(formData.get("name") ?? "").trim()
    const computerId = String(formData.get("computerId") ?? "")
    const runtime = String(formData.get("runtime") ?? "") || "claude_code"
    const runtimeProvider = String(formData.get("runtimeProvider") ?? "")
    const provider = String(formData.get("provider") ?? "")
    if (!name || !computerId) {
      setError("Missing name or computer")
      return
    }
    setSubmitting(true)
    try {
      const data = await apiPost<{ member?: CreatedMember; detail?: string }>(
        "/api/v1/members/agents",
        { name, computerId, runtime, runtimeProvider, provider }
      )
      if (!data.member) {
        throw new Error(data.detail || "Failed to create agent")
      }
      form.reset()
      await onSuccess?.(data.member)
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e)
      setError(detail)
    } finally {
      setSubmitting(false)
    }
  }

  function runtimeOptionLabel(opt: RuntimeOption): string {
    if (opt.bundled) return `${opt.label} (自带，无需配 key)`
    return opt.available ? opt.label : `${opt.label} (本机未检测到)`
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {error && (
        <InkframeObjectSurface material="blocked" className="px-2 py-1.5 text-sm text-destructive" role="alert">
          {error}
        </InkframeObjectSurface>
      )}
      <p className="text-xs text-muted-foreground">
        以下是这台电脑能用的 runtime，选一个就能建 agent。本机没装别的也没关系，有自带的 Built-in Pi（无需配 key）。
      </p>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Bot className="size-4" />
        Create a new agent
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agent-name" className="text-xs font-medium text-muted-foreground">
            Agent Name
          </label>
          <Input id="agent-name" name="name" placeholder="my-agent" required autoComplete="off" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agent-computer" className="text-xs font-medium text-muted-foreground">
            Computer
          </label>
          <Select
            id="agent-computer"
            name="computerId"
            required
            value={computerId}
            items={computers.map((computer) => `${computer.id}|${computer.name}`)}
            splitValue
            emptyLabel="Select..."
            onChange={(event) => setComputerId(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agent-runtime" className="text-xs font-medium text-muted-foreground">
            Runtime
          </label>
          <Select
            id="agent-runtime"
            name="runtime"
            value={effectiveRuntime}
            onChange={(event) => setRuntime(event.target.value)}
            items={runtimeOptions.map((opt) => ({
              value: opt.value,
              label: runtimeOptionLabel(opt),
              disabled: !opt.available,
            }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="agent-provider" className="text-xs font-medium text-muted-foreground">
            Provider
          </label>
          <ProviderSelect options={scopedProviderOptions} unavailableOptions={scopedUnavailableProviders} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? "Creating..." : submitLabel}
        </Button>
      </div>
    </form>
  )
}
