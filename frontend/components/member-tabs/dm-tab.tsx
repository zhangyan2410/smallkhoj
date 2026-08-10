"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { MessageSquare } from "lucide-react"

import { EmptyState } from "@/components/product-ui"
import { InkframeObjectSurface } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { profileName } from "@/lib/member-profile"
import type { Member } from "@/lib/control-plane"

export function DmTab({ member }: { member: Member }) {
  const t = useTranslations("members")
  return (
    <div className="space-y-4">
      <EmptyState
        title={t("dmWith", { name: profileName(member) ?? "" })}
        description={t("dmDesc")}
      />
      <InkframeObjectSurface material="dry" className="p-3">
        <p className="text-xs text-muted-foreground">
          {t("dmHintPrefix")} <code className="font-mono">dm:&lt;your-id&gt;-&lt;member-id&gt;</code>.{" "}
          {t("dmHintSuffix")}
        </p>
        <div className="mt-2">
          <Link href="/chat">
            <Button variant="outline" size="sm">
              <MessageSquare className="size-4" />
              {t("openChat")}
            </Button>
          </Link>
        </div>
      </InkframeObjectSurface>
    </div>
  )
}
