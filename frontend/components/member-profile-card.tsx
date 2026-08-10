"use client"

import { Cpu } from "lucide-react"
import { useTranslations } from "next-intl"

import {
  AvatarObject,
  ComputerInkstone,
  MemberNameTag,
  ObjectField,
} from "@/components/inkframe-object-ui"
import { RuntimeChip, StatusPill } from "@/components/product-ui"
import {
  findMemberWorkspace,
  runtimeLabel,
  shortId,
  statusLabel,
  type Computer,
  type Member,
  type RuntimeInfo,
} from "@/lib/control-plane"
import { profileDescription, profileName } from "@/lib/member-profile"

/**
 * Read-only member profile card.
 *
 * Shows avatar + name + handle + status + kind/provider + description + skills,
 * plus (when `computers` is provided) the runtime/workspace/computer binding
 * details and the ID grid. Used on the members page and in the chat
 * member-detail side panel. Does NOT include edit forms (those stay on the
 * members page via server actions).
 */
export function MemberProfileCard({
  member,
  computers,
}: {
  member: Member
  computers?: Computer[]
}) {
  const t = useTranslations("members")
  const description = profileDescription(member)
  const provider = member.config?.provider || member.runtimeProvider || member.backend
  const computer = computers?.find((c) => c.id === member.computerId)
  const workspace = computers ? findMemberWorkspace(member, computers) : undefined

  return (
    <div className="space-y-4">
      {/* Profile header card */}
      <MemberNameTag
        kind={member.kind}
        status={member.status}
        data-inkframe-mobile-role="member-profile"
        className="flex min-w-0 items-start gap-4 overflow-x-hidden border-b-2 border-[var(--ink)] pb-4"
      >
        <AvatarObject member={member} size="xl" />
        <div className="min-w-0">
          <div className="text-lg font-semibold">{profileName(member)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">
              @{(member.handle || member.name).replace(/^@/, "")}
            </span>
            <StatusPill status={member.status} label={statusLabel(member.status)} />
            <RuntimeChip tone="neutral">{member.kind}</RuntimeChip>
            {provider && (
              <RuntimeChip tone="neutral" className="min-h-5 px-2 py-0 text-xs">
                {provider}
              </RuntimeChip>
            )}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            {description || t("noProfileDescription")}
          </p>
        </div>
      </MemberNameTag>

      {/* ID grid */}
      <div className="grid gap-2 sm:grid-cols-3">
        <ObjectField label={t("fieldMemberId")} value={shortId(member.id)} />
        <ObjectField label={t("fieldComputerId")} value={shortId(member.computerId)} />
        <ObjectField label={t("fieldWorkspaceId")} value={shortId(member.workspaceId)} />
      </div>

      {/* Runtime / workspace binding (agents only, requires computers data) */}
      {member.kind === "agent" && computer && workspace && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Cpu className="size-3" />
            {t("runtimeBinding")}
          </div>
          <ComputerInkstone
            status={computer.status}
            data-inkframe-mobile-role="member-workspace-binding"
            className="min-w-0 overflow-x-hidden"
          >
            <div className="grid gap-2 sm:grid-cols-2">
              <ObjectField label={t("fieldComputer")} value={computer.name} />
              <ObjectField label={t("fieldComputerStatus")} value={computer.status} />
              <ObjectField
                label={t("fieldRuntime")}
                value={workspace.runtime ? runtimeLabel(workspace.runtime as unknown as RuntimeInfo) : t("unbound")}
              />
              <ObjectField
                label={t("fieldProvider")}
                value={workspace.runtimeProvider ?? member.config?.provider ?? member.runtimeProvider ?? t("defaultValue")}
              />
              <ObjectField label={t("fieldPid")} value={workspace.pid?.toString() ?? t("valueNone")} />
              <ObjectField label={t("fieldSession")} value={shortId(workspace.sessionId)} />
            </div>
          </ComputerInkstone>
          {workspace.cwd && (
            <ObjectField label={t("fieldCwd")} value={workspace.cwd} />
          )}
        </div>
      )}

      {/* Skills */}
      {member.skills && member.skills.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            {t("skills")}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {member.skills.map((skill) => (
              <RuntimeChip key={skill}>{skill}</RuntimeChip>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
