"use client"

import { Power, RotateCcw } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useTranslations } from "next-intl"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { apiPost, type AgentWorkspace } from "@/lib/control-plane"

const STOPPABLE_STATUSES = ["running", "active", "idle", "busy", "pending_start"]
const RESTARTABLE_STATUSES = ["running", "active", "idle", "busy"]

type BatchAction = "stop" | "restart"

/**
 * 「全部停止 / 全部重启」按钮 + 二级确认弹窗。
 *
 * 确认后在前端循环调用单个 workspace 的 lifecycle 接口（后端无批量接口），
 * 用 Promise.allSettled 并发；完成后 router.refresh() 反映最新状态。
 *
 * 这是 client component，不能接收 server 传来的含函数的 copy 对象，
 * 文案通过 useTranslations 直接取。
 */
export function BatchLifecycleButtons({
  workspaces,
  daemonOffline,
  offlineHelp,
  stopAllLabel,
  restartAllLabel,
  sessionToken,
  activeServerId,
}: {
  workspaces: AgentWorkspace[]
  daemonOffline: boolean
  offlineHelp: string
  stopAllLabel: string
  restartAllLabel: string
  sessionToken?: string | null
  activeServerId?: string | null
}) {
  const t = useTranslations("computers")
  const router = useRouter()
  const [openDialog, setOpenDialog] = useState<"none" | BatchAction>("none")

  const stopTargets = workspaces.filter((w) => STOPPABLE_STATUSES.includes(w.status))
  const restartTargets = workspaces.filter((w) => RESTARTABLE_STATUSES.includes(w.status))

  const runBatch = async (action: BatchAction, targets: AgentWorkspace[]) => {
    const results = await Promise.allSettled(
      targets.map((w) =>
        apiPost(
          `/api/v1/workspaces/${w.id}/lifecycle`,
          { action },
          sessionToken,
          activeServerId,
        ),
      ),
    )
    const failedNames: string[] = []
    let successCount = 0
    results.forEach((r, i) => {
      if (r.status === "fulfilled") successCount += 1
      else failedNames.push(targets[i].agentName ?? targets[i].id)
    })
    return { successCount, failedNames }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={daemonOffline || stopTargets.length === 0}
        title={daemonOffline ? offlineHelp : undefined}
        onClick={() => setOpenDialog("stop")}
      >
        <Power className="size-4" />
        {stopAllLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={daemonOffline || restartTargets.length === 0}
        title={daemonOffline ? offlineHelp : undefined}
        onClick={() => setOpenDialog("restart")}
      >
        <RotateCcw className="size-4" />
        {restartAllLabel}
      </Button>

      {openDialog !== "none" && (
        <BatchConfirmDialog
          action={openDialog}
          targets={openDialog === "stop" ? stopTargets : restartTargets}
          t={t}
          onRun={(targets) => runBatch(openDialog, targets)}
          onClose={() => {
            setOpenDialog("none")
            router.refresh()
          }}
        />
      )}
    </>
  )
}

type TranslationFn = ReturnType<typeof useTranslations>

function BatchConfirmDialog({
  action,
  targets,
  t,
  onRun,
  onClose,
}: {
  action: BatchAction
  targets: AgentWorkspace[]
  t: TranslationFn
  onRun: (targets: AgentWorkspace[]) => Promise<{ successCount: number; failedNames: string[] }>
  onClose: () => void
}) {
  const [phase, setPhase] = useState<"confirming" | "executing" | "done">("confirming")
  const [successCount, setSuccessCount] = useState(0)
  const [failedNames, setFailedNames] = useState<string[]>([])
  const isStop = action === "stop"
  const title = isStop ? t("batchStopTitle") : t("batchRestartTitle")
  const confirmText = isStop ? t("batchStopConfirm", { count: targets.length }) : t("batchRestartConfirm", { count: targets.length })

  const handleConfirm = async () => {
    setPhase("executing")
    const r = await onRun(targets)
    setSuccessCount(r.successCount)
    setFailedNames(r.failedNames)
    setPhase("done")
    // 全部成功后短暂展示后自动关闭刷新；有失败则留在弹窗里展示结果。
    if (r.failedNames.length === 0) {
      setTimeout(onClose, 600)
    }
  }

  const executing = phase === "executing"
  const done = phase === "done"
  const hasFailure = done && failedNames.length > 0

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !executing) onClose() }}>
      <DialogContent data-testid={`batch-${action}-dialog`} className="max-w-md" closeDisabled={executing}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{confirmText}</DialogDescription>
        </DialogHeader>

        <ul className="max-h-40 space-y-1 overflow-y-auto rounded-none border border-sand-border p-2 text-xs text-muted-foreground">
          {targets.map((w) => (
            <li key={w.id} className="truncate">
              {w.agentHandle ?? w.agentName ?? w.id}
              <span className="ml-1 text-sand-muted">· {w.status}</span>
            </li>
          ))}
        </ul>

        {done && hasFailure && (
          <div className="space-y-1 text-xs text-destructive">
            <p>{t("batchResultMixed", { success: successCount, failed: failedNames.length })}</p>
            <p className="truncate">{failedNames.join("、")}</p>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={executing} onClick={onClose}>
            {hasFailure ? t("batchClose") : t("batchCancel")}
          </Button>
          {!done && (
            <Button type="button" disabled={executing} onClick={handleConfirm}>
              {executing ? t("batchExecuting") : t("batchConfirm")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
