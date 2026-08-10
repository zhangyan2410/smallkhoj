"use client"

import { useTranslations } from "next-intl"
import { Activity, Shield } from "lucide-react"

import { EmptyState, RuntimeChip } from "@/components/product-ui"
import { InkframeObjectSurface, ObjectField } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/form"
import type { Member } from "@/lib/control-plane"
import {
  addPermissionEntryAction,
  removePermissionEntryAction,
  togglePermissionEntryAction,
  updatePermissionsAction,
} from "@/app/(app)/members/actions"

export function PermissionsTab({ member }: { member: Member }) {
  const t = useTranslations("members")
  const permissions = member.permissions ?? member.config?.permissions ?? {}
  const actions = member.actions ?? member.config?.actions ?? {}
  const isAgent = member.kind === "agent"

  return (
    <div className="space-y-5">
      <form action={updatePermissionsAction} className="space-y-5">
        <input type="hidden" name="memberId" value={member.id} />
        <input type="hidden" name="permissions" value={JSON.stringify(permissions)} />
        <input type="hidden" name="actions" value={JSON.stringify(actions)} />

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Shield className="size-3" />
              {t("tabPermissions")}
            </div>
            {isAgent && Object.keys(permissions).length > 0 && (
              <Button type="submit" size="sm" variant="outline">{t("savePermissions")}</Button>
            )}
          </div>
          {Object.keys(permissions).length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(permissions).map(([key, enabled]) => (
                <ObjectField
                  key={key}
                  label={key}
                  mono={false}
                  value={<RuntimeChip tone={enabled ? "success" : "neutral"}>{enabled ? t("enabled") : t("disabled")}</RuntimeChip>}
                />
              ))}
            </div>
          ) : (
            <EmptyState title={t("noCustomPermissions")} description={isAgent ? t("noCustomPermissionsAgentDesc") : t("noCustomPermissionsHumanDesc")} />
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Activity className="size-3" />
              {t("actionsLabel")}
            </div>
            {isAgent && Object.keys(actions).length > 0 && (
              <Button type="submit" size="sm" variant="outline">{t("saveActions")}</Button>
            )}
          </div>
          {Object.keys(actions).length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(actions).map(([key, enabled]) => (
                <ObjectField
                  key={key}
                  label={key}
                  mono={false}
                  value={<RuntimeChip tone={enabled ? "success" : "neutral"}>{enabled ? t("on") : t("off")}</RuntimeChip>}
                />
              ))}
            </div>
          ) : (
            <EmptyState title={t("noCustomActions")} description={isAgent ? t("noCustomActionsAgentDesc") : t("noCustomActionsHumanDesc")} />
          )}
        </div>
      </form>

      {isAgent && <AddPermissionForm memberId={member.id} permissions={permissions} actions={actions} />}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Shield className="size-3" />
          {t("enforcementStatus")}
        </div>
        <InkframeObjectSurface material="drying" className="space-y-2 p-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-warning" />
            <span className="text-sm">{t("enforcementPending")}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("enforcementDesc")}
          </p>
        </InkframeObjectSurface>
      </div>
    </div>
  )
}

function AddPermissionForm({
  memberId,
  permissions,
  actions,
}: {
  memberId: string
  permissions: Record<string, boolean>
  actions: Record<string, boolean>
}) {
  const t = useTranslations("members")
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Shield className="size-3" />
          {t("permissionEntries")}
        </div>
        {Object.keys(permissions).length > 0 && (
          <div className="space-y-1">
            {Object.entries(permissions).map(([key, enabled]) => (
              <form key={key} action={togglePermissionEntryAction} data-inkframe-mobile-role="member-permission-entry" className="sk-object-surface flex min-w-0 items-center justify-between gap-3 overflow-x-hidden px-3 py-2">
                <input type="hidden" name="memberId" value={memberId} />
                <input type="hidden" name="type" value="permissions" />
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="currentValue" value={String(enabled)} />
                <input type="hidden" name="existing" value={JSON.stringify(permissions)} />
                <span className="min-w-0 truncate text-sm font-mono">{key}</span>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" variant={enabled ? "default" : "outline"}>
                    {enabled ? t("enabled") : t("disabled")}
                  </Button>
                  <Button type="submit" formAction={removePermissionEntryAction} size="xs" variant="destructive" title={t("remove")}>
                    {t("remove")}
                  </Button>
                </div>
              </form>
            ))}
          </div>
        )}
        <form action={addPermissionEntryAction} className="flex min-w-0 flex-wrap items-end gap-2 overflow-x-hidden">
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="type" value="permissions" />
          <input type="hidden" name="existing" value={JSON.stringify(permissions)} />
          <Input name="key" placeholder={t("permissionKeyPlaceholder")} className="min-w-0 max-w-[200px] flex-1" />
          <Select id="permission-entry-value" name="value" items={[`true|${t("enabled")}`, `false|${t("disabled")}`]} splitValue className="h-9 w-auto min-w-28 shrink-0" />
          <Button type="submit" size="sm" variant="outline">{t("add")}</Button>
        </form>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Activity className="size-3" />
          {t("actionEntries")}
        </div>
        {Object.keys(actions).length > 0 && (
          <div className="space-y-1">
            {Object.entries(actions).map(([key, enabled]) => (
              <form key={key} action={togglePermissionEntryAction} data-inkframe-mobile-role="member-permission-entry" className="sk-object-surface flex min-w-0 items-center justify-between gap-3 overflow-x-hidden px-3 py-2">
                <input type="hidden" name="memberId" value={memberId} />
                <input type="hidden" name="type" value="actions" />
                <input type="hidden" name="key" value={key} />
                <input type="hidden" name="currentValue" value={String(enabled)} />
                <input type="hidden" name="existing" value={JSON.stringify(actions)} />
                <span className="min-w-0 truncate text-sm font-mono">{key}</span>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm" variant={enabled ? "default" : "outline"}>
                    {enabled ? t("on") : t("off")}
                  </Button>
                  <Button type="submit" formAction={removePermissionEntryAction} size="xs" variant="destructive" title={t("remove")}>
                    {t("remove")}
                  </Button>
                </div>
              </form>
            ))}
          </div>
        )}
        <form action={addPermissionEntryAction} className="flex min-w-0 flex-wrap items-end gap-2 overflow-x-hidden">
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="type" value="actions" />
          <input type="hidden" name="existing" value={JSON.stringify(actions)} />
          <Input name="key" placeholder={t("actionKeyPlaceholder")} className="min-w-0 max-w-[200px] flex-1" />
          <Select id="action-entry-value" name="value" items={[`true|${t("on")}`, `false|${t("off")}`]} splitValue className="h-9 w-auto min-w-28 shrink-0" />
          <Button type="submit" size="sm" variant="outline">{t("add")}</Button>
        </form>
      </div>
    </div>
  )
}
