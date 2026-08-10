"use client"

import { useTranslations } from "next-intl"

import { EmptyState } from "@/components/product-ui"
import { InkframeObjectSurface } from "@/components/inkframe-object-ui"
import { profileName } from "@/lib/member-profile"
import type { Member } from "@/lib/control-plane"

export function RemindersTab({ member }: { member: Member }) {
  const t = useTranslations("members")
  return (
    <div className="space-y-4">
      <EmptyState
        title={t("remindersFor", { name: profileName(member) ?? "" })}
        description={t("remindersDesc")}
      />
      <InkframeObjectSurface material="dry" className="p-3">
        <p className="text-xs text-muted-foreground">
          {t("remindersHint")}
        </p>
      </InkframeObjectSurface>
    </div>
  )
}
