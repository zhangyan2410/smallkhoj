"use client"

import { useTranslations } from "next-intl"

import { EmptyState } from "@/components/product-ui"
import { InkframeObjectSurface } from "@/components/inkframe-object-ui"
import { profileName } from "@/lib/member-profile"
import type { Member } from "@/lib/control-plane"

export function AppsTab({ member }: { member: Member }) {
  const t = useTranslations("members")
  return (
    <div className="space-y-4">
      <EmptyState
        title={t("appsFor", { name: profileName(member) ?? "" })}
        description={t("appsDesc")}
      />
      <InkframeObjectSurface material="dry" className="p-3">
        <p className="text-xs text-muted-foreground">
          {t("appsHint")}
        </p>
      </InkframeObjectSurface>
    </div>
  )
}
