"use client"

import { useTranslations } from "next-intl"
import { UserRound } from "lucide-react"

import { MemberProfileCard } from "@/components/member-profile-card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { profileDescription } from "@/lib/member-profile"
import type { Computer, Member } from "@/lib/control-plane"
import {
  updateAgentDescriptionAction,
  updateHumanAvatarUrlAction,
} from "@/app/(app)/members/actions"

export function ProfileTab({
  member,
  computers,
  canManageMembers,
}: {
  member: Member
  computers?: Computer[]
  canManageMembers?: boolean
}) {
  const t = useTranslations("members")
  const description = profileDescription(member)

  return (
    <div className="space-y-4">
      <MemberProfileCard member={member} computers={computers} />

      {member.kind === "agent" && canManageMembers ? (
        <form action={updateAgentDescriptionAction} className="sk-object-surface space-y-2 p-3">
          <input type="hidden" name="memberId" value={member.id} />
          <div className="flex items-center justify-between gap-3">
            <label htmlFor={`agent-description-${member.id}`} className="text-sm font-medium text-foreground">
              {t("agentDescription")}
            </label>
            <span className="text-xs text-muted-foreground">{t("agentDescriptionLimit")}</span>
          </div>
          <Textarea
            id={`agent-description-${member.id}`}
            name="description"
            rows={3}
            defaultValue={description ?? ""}
            placeholder={t("agentDescriptionPlaceholder")}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t("agentDescriptionHint")}</p>
            <Button type="submit" size="sm" variant="outline">{t("save")}</Button>
          </div>
        </form>
      ) : null}

      {member.kind === "human" && (
        <form action={updateHumanAvatarUrlAction} className="sk-object-surface p-3">
          <input type="hidden" name="memberId" value={member.id} />
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <UserRound className="size-3" />
            {t("humanAvatar")}
          </div>
          <div className="mt-2 flex gap-2">
            <Input
              name="avatarUrl"
              type="url"
              defaultValue={member.profile?.avatarUrl ?? member.avatarUrl ?? ""}
              placeholder="https://example.com/avatar.png"
              className="h-8"
            />
            <Button type="submit" size="sm" variant="outline">
              {t("save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
