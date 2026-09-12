"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { ScrollText, UserRound, Wrench } from "lucide-react"

import { MemberProfileCard } from "@/components/member-profile-card"
import { EmptyState, RuntimeChip } from "@/components/product-ui"
import { InkframeObjectSurface } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { SkillChipsSelect } from "@/components/skill-chips-select"
import { profileDescription } from "@/lib/member-profile"
import type { Computer, Member } from "@/lib/control-plane"
import {
  updateAgentDescriptionAction,
  updateAgentSystemPromptAction,
  updateHumanAvatarUrlAction,
  updateMemberSkillsAction,
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

      {member.kind === "agent" && <AgentRoleBlocks member={member} />}

      {member.kind === "agent" && canManageMembers ? (
        <div className="space-y-4">
          <form action={updateAgentSystemPromptAction} className="sk-object-surface space-y-2 p-3">
            <input type="hidden" name="memberId" value={member.id} />
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={`agent-system-prompt-${member.id}`} className="text-sm font-medium text-foreground">
                {t("agentSystemPrompt")}
              </label>
              <span className="text-xs text-muted-foreground">{t("agentSystemPromptLimit")}</span>
            </div>
            <Textarea
              id={`agent-system-prompt-${member.id}`}
              name="systemPrompt"
              rows={4}
              defaultValue={member.systemPrompt ?? ""}
              placeholder={t("agentSystemPromptPlaceholder")}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">{t("agentSystemPromptHint")}</p>
              <Button type="submit" size="sm" variant="outline">{t("save")}</Button>
            </div>
          </form>

          <AgentSkillsEditForm member={member} />

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
        </div>
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

/**
 * 职责与技能只读区块（参照 workspace-tab 的展示风格）：
 * 职责 = 注入运行时的 persona 文本；技能 = 装配记录卡片（名称/版本/触发描述）。
 */
export function AgentRoleBlocks({ member }: { member: Member }) {
  const t = useTranslations("members")
  const skills = member.skills ?? []

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <ScrollText className="size-3" />
          {t("agentSystemPrompt")}
        </div>
        <InkframeObjectSurface material="drying" className="p-3">
          {member.systemPrompt ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">{member.systemPrompt}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t("noSystemPrompt")}</p>
          )}
        </InkframeObjectSurface>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Wrench className="size-3" />
          {t("skills")}
          {skills.length > 0 && <RuntimeChip tone="neutral">{skills.length}</RuntimeChip>}
        </div>
        {skills.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {skills.map((skill) => (
              <div key={skill.id} className="sk-object-surface min-w-0 overflow-x-hidden p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{skill.name}</span>
                  <RuntimeChip tone="paper" className="shrink-0">v{skill.version}</RuntimeChip>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{skill.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={t("noSkills")} />
        )}
      </div>
    </div>
  )
}

/**
 * 技能装配编辑：多选 chips，保存时提交完整 skillIds 数组（全量替换语义）。
 */
function AgentSkillsEditForm({ member }: { member: Member }) {
  const t = useTranslations("members")
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => (member.skills ?? []).map((skill) => skill.id),
  )

  function toggleSkill(skillId: string) {
    setSelectedIds((current) =>
      current.includes(skillId) ? current.filter((id) => id !== skillId) : [...current, skillId],
    )
  }

  return (
    <form action={updateMemberSkillsAction} className="sk-object-surface space-y-2 p-3">
      <input type="hidden" name="memberId" value={member.id} />
      <input type="hidden" name="skillIds" value={JSON.stringify(selectedIds)} />
      <div className="text-sm font-medium text-foreground">{t("editSkills")}</div>
      <SkillChipsSelect
        selectedIds={selectedIds}
        onToggle={toggleSkill}
        idPrefix={`skill-edit-${member.id}`}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("editSkillsHint")}</p>
        <Button type="submit" size="sm" variant="outline">{t("saveSkills")}</Button>
      </div>
    </form>
  )
}
