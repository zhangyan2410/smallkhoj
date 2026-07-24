"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/form"
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
      <Select
        id="chat-dm-agent"
        name="chat-dm-agent"
        aria-label={t("selectAgentToDm")}
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        items={agents.map((agent) => agent.displayName || agent.name)}
        emptyLabel={t("selectAgent")}
        className="flex-1"
      />
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
