"use client"

import { useTranslations } from "next-intl"
import { Cpu, HardDrive } from "lucide-react"

import { EmptyState, RuntimeChip, StatusPill } from "@/components/product-ui"
import { ComputerInkstone, InkframeObjectSurface, ObjectField } from "@/components/inkframe-object-ui"
import {
  findMemberWorkspace,
  formatTime,
  runtimeLabel,
  statusLabel,
  type Computer,
  type Member,
} from "@/lib/control-plane"

export function WorkspaceTab({
  member,
  computers,
}: {
  member: Member
  computers?: Computer[]
}) {
  const t = useTranslations("members")
  const computer = computers?.find((c) => c.id === member.computerId)

  if (!computer) {
    return (
      <EmptyState
        title={t("noComputerBinding")}
        description={member.kind === "human"
          ? t("noComputerBindingHuman")
          : t("noComputerBindingAgent")}
      />
    )
  }

  const workspace = computers ? findMemberWorkspace(member, computers) : undefined

  return (
    <div className="space-y-4">
      <div data-inkframe-mobile-role="member-workspace-binding" className="min-w-0 space-y-2 overflow-x-hidden">
        <div className="text-sm font-medium text-foreground">{t("boundComputer")}</div>
        <ComputerInkstone status={computer.status}>
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-accent-green" />
            <span className="text-sm font-medium">{computer.name}</span>
            <StatusPill status={computer.status} label={statusLabel(computer.status)} />
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <ObjectField label={t("fieldOs")} value={computer.os} />
            <ObjectField label={t("fieldDaemon")} value={computer.daemonVersion} />
            <ObjectField label={t("fieldHeartbeat")} value={formatTime(computer.lastHeartbeatAt)} />
          </div>
        </ComputerInkstone>
      </div>

      {workspace && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-foreground">{t("agentWorkspace")}</div>
          <InkframeObjectSurface raised data-inkframe-mobile-role="member-workspace-binding" className="min-w-0 overflow-x-hidden p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <ObjectField label={t("fieldStatus")} value={workspace.status} />
              <ObjectField label={t("fieldPid")} value={workspace.pid?.toString() ?? t("valueNone")} />
              <ObjectField label={t("fieldRuntime")} value={workspace.runtime ?? t("defaultValue")} />
              <ObjectField label={t("fieldProvider")} value={workspace.runtimeProvider ?? t("defaultValue")} />
              <ObjectField label={t("fieldModel")} value={workspace.runtimeModel ?? t("defaultValue")} />
              <ObjectField label={t("fieldStarted")} value={formatTime(workspace.startedAt)} />
              <ObjectField label={t("fieldStopped")} value={formatTime(workspace.stoppedAt)} />
            </div>
            {workspace.cwd && <div className="mt-2"><ObjectField label={t("fieldCwd")} value={workspace.cwd} /></div>}
          </InkframeObjectSurface>
        </div>
      )}

      {!workspace && member.kind === "agent" && (
        <InkframeObjectSurface material="drying" className="p-3">
          <p className="text-xs text-muted-foreground">
            {t("workspacePendingPrefix")} <code className="font-mono">{computer.name}</code> {t("workspacePendingSuffix")}
          </p>
        </InkframeObjectSurface>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Cpu className="size-3" />
          {t("detectedRuntimes")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(computer.detectedRuntimes.length ? computer.detectedRuntimes : ["none"]).map((runtime, i) => (
            <RuntimeChip key={typeof runtime === "string" ? `${runtime}-${i}` : runtimeLabel(runtime)}>
              {runtimeLabel(runtime)}
            </RuntimeChip>
          ))}
        </div>
      </div>
    </div>
  )
}
