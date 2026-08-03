"use client"

import { Monitor, Plus, Terminal } from "lucide-react"
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import { AttachmentSheet, InkframeObjectSurface, ObjectField } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Panel } from "@/components/ui/panel"

type CredentialResponse = {
  name: string
  command: string
  expiresAt: string
  serverId?: string | null
  serverName?: string | null
}

type ConnectComputerFormProps = {
  action: (formData: FormData) => Promise<void>
  credential?: CredentialResponse | null
  connectedComputerName?: string | null
  error?: string | null
  /** 空状态（0 台电脑）时初始打开 steps dialog，代替原来的页面内嵌卡片。 */
  initialStepsOpen?: boolean
}

function ConnectStepsBody({
  action,
  credential,
  connectedComputerName,
  error,
}: Omit<ConnectComputerFormProps, "initialStepsOpen">) {
  const router = useRouter()
  const t = useTranslations("computers")

  useEffect(() => {
    if (!credential) return
    const timer = window.setInterval(() => router.refresh(), 3000)
    return () => window.clearInterval(timer)
  }, [credential, router])

  return (
    <div className="space-y-3">
      <form action={action} className="flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="computer-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {t("computerName")}
          </label>
          <Input
            id="computer-name"
            name="name"
            placeholder="my-computer"
            className="max-w-xs"
          />
        </div>
        <Button type="submit" size="sm">
          {t("generateConnect")}
        </Button>
      </form>

      {credential && (
        <InkframeObjectSurface material="drying" className="space-y-2 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-medium uppercase text-muted-foreground">{t("pendingConnection")}</div>
            <div className="text-xs text-muted-foreground">{t("waitingFor", { name: credential.name })}</div>
          </div>
          <div className="text-xs font-medium uppercase text-muted-foreground">{t("connectionCommand")}</div>
          <AttachmentSheet kind="proof" className="p-2">
            <code
              data-testid="daemon-connect-command"
              className="block whitespace-pre-wrap break-all text-xs"
            >
              {credential.command}
            </code>
          </AttachmentSheet>
          <div className="grid gap-2 sm:grid-cols-3">
            <ObjectField label={t("computerName")} value={<span data-testid="pending-computer-name">{credential.name}</span>} />
            <ObjectField label={t("server")} value={<span data-testid="pending-server-name">{credential.serverName || credential.serverId || "-"}</span>} />
            <ObjectField label={t("expires")} value={credential.expiresAt} />
          </div>
        </InkframeObjectSurface>
      )}

      {connectedComputerName && (
        <Panel variant="flat" className="sk-cat-success p-3 text-sm">
          {t("connected", { name: connectedComputerName })}
        </Panel>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  )
}

/** @deprecated 空状态现在直接用 ConnectComputerDialog 的 initialStepsOpen，
 *  这个内嵌卡片仅保留以兼容旧引用，不再被 computers 页面使用。 */
export function ConnectComputerForm(props: Omit<ConnectComputerFormProps, "initialStepsOpen">) {
  const t = useTranslations("computers")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="size-4" />
          {t("connectNew")}
        </CardTitle>
        <CardDescription>{t("connectDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ConnectStepsBody {...props} />
      </CardContent>
    </Card>
  )
}

/**
 * 侧边栏「添加电脑」入口 + 两个对话框：
 * 1. steps dialog：连接步骤（名称输入 + 一次性命令 + 过期信息）。
 * 2. already-connected dialog：pending credential 对应的电脑已经在线时提示，
 *    可选择保持当前连接，或继续为另一台电脑生成命令。
 *
 * 已有电脑在线时入口依然可用 —— 后端支持一个 server 挂多台电脑
 * （按 machineId 区分），其它电脑执行同一个新命令即可加入。
 */
export function ConnectComputerDialog({
  action,
  credential,
  connectedComputerName,
  error,
  initialStepsOpen = false,
}: ConnectComputerFormProps) {
  const t = useTranslations("computers")
  // 单一 state 机：任一时刻最多渲染一个 dialog（两个 Dialog 同时 open 时，
  // Base UI 的 backdrop 计数会让先打开的那个即使 open=false 也残留在 DOM 里，
  // 必须保证不同时为 true）。
  // - none: 都没有
  // - steps: 连接步骤 dialog（Add 按钮打开；空状态时初始打开）
  // - already: 已连接提示 dialog（pending credential 的电脑上线后自动出现）
  const [openDialog, setOpenDialog] = useState<"none" | "steps" | "already">(
    initialStepsOpen ? "steps" : "none",
  )
  const [dismissedConnectedName, setDismissedConnectedName] = useState<string | null>(null)

  // 「已连接」信号：pending credential 的电脑刚刚上线。
  // 它优先于 steps（等待中的 steps dialog 让位），但任何用户选择
  // （保持 / 换一台 / 主动点 Add）都记录 dismissed 名字，之后不再被这个
  // 派生信号强制拉起。
  const showAlreadyConnected =
    Boolean(connectedComputerName) && connectedComputerName !== dismissedConnectedName
  const activeDialog: "none" | "steps" | "already" =
    showAlreadyConnected ? "already" : openDialog

  const dismissAlreadyDialog = () => {
    setOpenDialog("none")
    if (connectedComputerName) {
      setDismissedConnectedName(connectedComputerName)
    }
  }

  const openStepsDialog = () => {
    if (connectedComputerName) {
      setDismissedConnectedName(connectedComputerName)
    }
    setOpenDialog("steps")
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="add-computer-button"
        aria-label={t("connectNew")}
        onClick={() => {
          // Add 按钮直接打开 steps dialog；如果正处于「已连接」信号期，
          // 也一并 dismiss 掉 —— 用户既然主动点 Add，就是明确要连新电脑。
          if (connectedComputerName) {
            setDismissedConnectedName(connectedComputerName)
          }
          setOpenDialog("steps")
        }}
      >
        <Plus className="size-4" />
        <span className="sr-only sm:not-sr-only">{t("addComputer")}</span>
      </Button>

      {/* 两个 dialog 不同时渲染：Base UI 的 Popup 关闭动画会让旧节点带
          data-closed 残留在 DOM（本项目的 ui/dialog 没有针对 data-closed 的
          隐藏样式，会挡住新 dialog），条件渲染保证任一时刻只有一个。 */}
      {activeDialog === "steps" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setOpenDialog("none")
          }}
        >
          <DialogContent data-testid="connect-computer-dialog" className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Terminal className="size-4" />
                {t("connectNew")}
              </DialogTitle>
              <DialogDescription>{t("connectDesc")}</DialogDescription>
            </DialogHeader>
            <ConnectStepsBody
              action={action}
              credential={credential}
              connectedComputerName={null}
              error={error}
            />
          </DialogContent>
        </Dialog>
      )}

      {activeDialog === "already" && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) dismissAlreadyDialog()
          }}
        >
          <DialogContent data-testid="computer-already-connected-dialog">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Monitor className="size-4" />
                {t("alreadyConnectedTitle")}
              </DialogTitle>
              <DialogDescription>
                {t("alreadyConnectedDesc", { name: connectedComputerName ?? "" })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={dismissAlreadyDialog}
              >
                {t("keepCurrentConnection")}
              </Button>
              <Button
                type="button"
                onClick={openStepsDialog}
              >
                {t("connectAnotherComputer")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
