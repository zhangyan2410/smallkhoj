"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { apiPost, type Member } from "@/lib/control-plane"

export function DmStarter({ agents }: { agents: Member[] }) {
  const router = useRouter()
  const t = useTranslations("chat")
  const [selected, setSelected] = useState("")
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!selected) return
    setCreating(true)
    try {
      const data = await apiPost<{ channel?: { name: string } }>("/api/v1/dm", { peer: selected })
      const dmName = data?.channel?.name
      if (dmName) {
        router.push(`/chat/${encodeURIComponent(dmName.replace(/^#/, ""))}`)
      }
    } catch (e) {
      console.error("Create DM failed:", e)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={t("selectAgentToDm")}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        <option value="">{t("selectAgent")}</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.displayName}>
            {agent.displayName}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCreate}
        disabled={!selected || creating}
      >
        <Plus className="size-4" />
        {t("startDm")}
      </Button>
    </div>
  )
}
