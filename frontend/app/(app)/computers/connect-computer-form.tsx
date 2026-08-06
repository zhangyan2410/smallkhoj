"use client"

import { AlertTriangle, Check, Copy, Monitor, Plus, RefreshCw, Terminal } from "lucide-react"
import { useEffect, useState } from "react"
import { useFormStatus } from "react-dom"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"

import { AttachmentSheet, InkframeObjectSurface, ObjectField } from "@/components/inkframe-object-ui"
import { StatusPill } from "@/components/product-ui"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  detectInitialPlatform,
  isExpired,
  phaseCommand,
  renderPhaseCommand,
  type OnboardingPhase,
  type OnboardingPlatform,
  type OnboardingPreview,
  type PhaseCommand,
  type PlatformCommandMap,
} from "@/lib/computer-onboarding"

export type CredentialResponse = {
  name: string
  command: string
  expiresAt: string
  platforms?: PlatformCommandMap | null
  serverId?: string | null
  serverName?: string | null
  mode?: "create" | "reconnect"
  computerId?: string | null
}

type CopyFn = (key: string, values?: Record<string, string | number>) => string

type ConnectComputerFormProps = {
  action: (formData: FormData) => Promise<void>
  credential?: CredentialResponse | null
  preview?: OnboardingPreview | null
  connectedComputerName?: string | null
  error?: string | null
  /** 空状态（0 台电脑）时初始打开 steps dialog，代替原来的页面内嵌卡片。 */
  initialStepsOpen?: boolean
}

function fallbackPlatforms(credential?: CredentialResponse | null): PlatformCommandMap {
  return {
    windows: {
      platform: "windows",
      shell: "powershell",
      available: false,
      install: { command: null },
      setup: { command: null },
      // Legacy one-command cookies are Unix-only; never leak npx text into
      // the Windows tab when structured platform metadata is absent.
      connect: { command: null },
    },
    unix: {
      platform: "unix",
      shell: "bash",
      available: true,
      install: { command: null },
      setup: { command: null },
      connect: { command: credential?.command || null },
    },
  }
}

function shellLabel(platform: OnboardingPlatform, t: CopyFn) {
  return platform === "windows" ? t("onboarding.shellPowerShell") : t("onboarding.shellTerminal")
}

function phaseLabel(phase: OnboardingPhase, t: CopyFn) {
  return t(`onboarding.phase${phase[0].toUpperCase()}${phase.slice(1)}`)
}

function CopyCommandButton({
  command,
  phase,
  platform,
  t,
}: {
  command: string
  phase: OnboardingPhase
  platform: OnboardingPlatform
  t: CopyFn
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  return (
    <Button
      type="button"
      size="icon-xs"
      variant="outline"
      data-testid={`copy-command-${phase}`}
      aria-label={`${t("onboarding.copy")} ${phaseLabel(phase, t)} (${shellLabel(platform, t)})`}
      title={`${t("onboarding.copy")} ${phaseLabel(phase, t)}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(command)
          setCopied(true)
        } catch {
          // Clipboard permissions can be denied in an embedded browser. Keep
          // the command visible so the user can select it manually.
          setCopied(false)
        }
      }}
    >
      {copied ? <Check className="size-3" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
      {copied ? (
        <span data-testid="copy-feedback" aria-live="polite" className="text-[10px] font-medium text-success">
          {t("onboarding.copied")}
        </span>
      ) : null}
      <span className="sr-only">{copied ? t("onboarding.copied") : t("onboarding.copy")}</span>
    </Button>
  )
}

function TicketActionButton({
  expired,
  onGenerate,
  t,
}: {
  expired: boolean
  onGenerate?: () => void
  t: CopyFn
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      size="sm"
      data-testid={expired ? "regenerate-ticket-button" : "generate-ticket-button"}
      aria-busy={pending}
      onClick={onGenerate}
      disabled={pending || !onGenerate}
    >
      {expired ? <RefreshCw className="size-3.5" aria-hidden="true" /> : <Terminal className="size-3.5" aria-hidden="true" />}
      {pending ? t("onboarding.generating") : expired ? t("onboarding.regenerate") : t("onboarding.connectCta")}
    </Button>
  )
}

function PhaseCard({
  phase,
  number,
  platform,
  command,
  available,
  ticket,
  expired,
  onGenerate,
  t,
}: {
  phase: OnboardingPhase
  number: string
  platform: OnboardingPlatform
  command: PhaseCommand | null
  available: boolean
  ticket: boolean
  expired: boolean
  onGenerate?: () => void
  t: CopyFn
}) {
  const renderedCommand = command?.command || null
  const isConnect = phase === "connect"
  const canShowCommand = Boolean(renderedCommand) && available && (!isConnect || !expired)
  const title = phaseLabel(phase, t)

  return (
    <InkframeObjectSurface
      material="drying"
      data-testid={`phase-card-${phase}`}
      data-region={`phase-${phase}`}
      className="space-y-2 p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={isConnect && !ticket ? "border-2 border-[var(--cinnabar)] px-1.5 py-0.5 text-xs text-[var(--cinnabar)]" : "border-2 border-[var(--ink)] px-1.5 py-0.5 text-xs"}
          >
            {number}
          </span>
          <span className="text-sm font-medium text-foreground">{title}</span>
        </div>
        <span className="border border-[var(--ink)] px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
          {shellLabel(platform, t)}
        </span>
      </div>

      {platform === "windows" && !available && phase === "install" ? (
        <Panel variant="flat" className="flex items-start gap-2 p-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span>{t("onboarding.windowsUnavailable")}</span>
        </Panel>
      ) : null}

      {canShowCommand ? (
        <AttachmentSheet
          kind="proof"
          className="flex items-start gap-2 p-2"
          data-testid={isConnect ? "daemon-connect-command" : undefined}
        >
          <code
            data-testid={`phase-command-${phase}`}
            className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs"
          >
            {renderedCommand}
          </code>
          <CopyCommandButton command={renderedCommand!} phase={phase} platform={platform} t={t} />
        </AttachmentSheet>
      ) : null}

      {isConnect && !ticket ? (
        <TicketActionButton expired={false} onGenerate={onGenerate} t={t} />
      ) : null}

      {isConnect && ticket && expired ? (
        <>
          <Panel variant="flat" className="p-2 text-xs text-warning">
            {t("onboarding.expiredNotice")}
          </Panel>
          <TicketActionButton expired onGenerate={onGenerate} t={t} />
        </>
      ) : null}

      <p className="text-xs text-muted-foreground">
        {phase === "install"
          ? platform === "windows"
            ? t("onboarding.installGuideWindows")
            : t("onboarding.installGuideUnix")
          : phase === "setup"
            ? t("onboarding.setupGuide")
            : t("onboarding.connectGuide")}
      </p>
      <p className="text-xs text-muted-foreground">
        {phase === "install"
          ? t("onboarding.installExpect")
          : phase === "setup"
            ? t("onboarding.setupExpect")
            : t("onboarding.connectExpect")}
      </p>
    </InkframeObjectSurface>
  )
}

function OnboardingPhases({
  platform,
  platforms,
  name,
  credential,
  onGenerate,
  t,
}: {
  platform: OnboardingPlatform
  platforms: PlatformCommandMap
  name: string
  credential?: CredentialResponse | null
  onGenerate?: () => void
  t: CopyFn
}) {
  const selected = platforms[platform]
  const expired = isExpired(credential?.expiresAt)
  const ticket = Boolean(credential)
  const setup = phaseCommand(platforms, platform, "setup")
  const renderedSetup = setup
    ? { ...setup, command: renderPhaseCommand(setup, name, platform) }
    : null
  const connect = phaseCommand(platforms, platform, "connect")
  const renderedConnect = connect
    ? {
        ...connect,
        command: connect.command || renderPhaseCommand(connect, name, platform),
      }
    : null

  return (
    <div className="space-y-3">
      <PhaseCard
        phase="install"
        number="❶"
        platform={platform}
        command={phaseCommand(platforms, platform, "install")}
        available={selected.available !== false}
        ticket={ticket}
        expired={false}
        t={t}
      />
      <PhaseCard
        phase="setup"
        number="❷"
        platform={platform}
        command={renderedSetup}
        available={selected.available !== false}
        ticket={ticket}
        expired={false}
        t={t}
      />
      <PhaseCard
        phase="connect"
        number="❸"
        platform={platform}
        command={renderedConnect}
        available={selected.available !== false}
        ticket={ticket}
        expired={expired}
        onGenerate={onGenerate}
        t={t}
      />
    </div>
  )
}

function PlatformOnboarding({
  action,
  credential,
  preview,
  connectedComputerName,
  error,
  reconnectOnly = false,
}: Omit<ConnectComputerFormProps, "initialStepsOpen"> & { reconnectOnly?: boolean }) {
  const router = useRouter()
  const t = useTranslations("computers") as unknown as CopyFn
  const [platform, setPlatform] = useState<OnboardingPlatform>(() => detectInitialPlatform())
  const [name, setName] = useState(credential?.name || preview?.name || "my-computer")
  const [now, setNow] = useState(() => Date.now())
  const platforms = credential?.platforms || preview?.platforms || fallbackPlatforms(credential)

  useEffect(() => {
    // Browser detection is an initial preference only; users can switch tabs.
    const timer = window.setTimeout(() => setPlatform(detectInitialPlatform()), 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!credential) return
    const refreshTimer = window.setInterval(() => router.refresh(), 3000)
    const expiryTimer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(refreshTimer)
      window.clearInterval(expiryTimer)
    }
  }, [credential, router])

  const expired = Boolean(credential && isExpired(credential.expiresAt, now))

  return (
    <div data-region="computer-onboarding" className="space-y-3">
      {!reconnectOnly ? (
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label htmlFor="computer-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
              {t("computerName")}
            </label>
            <Input
              id="computer-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="my-computer"
              autoFocus={!credential}
              className="max-w-xs"
            />
          </div>
        </div>
      ) : null}

      <Tabs
        value={platform}
        onValueChange={(value) => setPlatform(value as OnboardingPlatform)}
        data-testid="platform-tabs"
      >
        <TabsList>
          <TabsTrigger value="windows" data-testid="platform-tab-windows">
            {t("onboarding.platformWindows")}
          </TabsTrigger>
          <TabsTrigger value="unix" data-testid="platform-tab-unix">
            {t("onboarding.platformUnix")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value={platform} data-testid={`platform-panel-${platform}`}>
          <form action={action} className="space-y-3">
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="platform" value={platform} />
            <OnboardingPhases
              platform={platform}
              platforms={platforms}
              name={name}
              credential={credential}
              onGenerate={() => undefined}
              t={t}
            />
          </form>
        </TabsContent>
      </Tabs>

      <div
        data-testid="connect-status-region"
        aria-live="polite"
        className="min-h-10"
      >
        {connectedComputerName ? (
          <Panel variant="flat" className="sk-cat-success p-3 text-sm">
            {t("connected", { name: connectedComputerName })}
          </Panel>
        ) : error ? (
          <Panel variant="flat" className="sk-cat-danger p-3 text-sm">{error}</Panel>
        ) : credential && !expired ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <StatusPill status="pending" label={t("pendingConnection")} />
            <span>{t("onboarding.pendingHint", { name: credential.name })}</span>
          </div>
        ) : credential && expired ? (
          <Panel variant="flat" className="sk-cat-warning p-3 text-sm">
            {t("onboarding.timeoutHint")}
          </Panel>
        ) : (
          <p className="text-xs text-muted-foreground">{t("onboarding.statusIdle")}</p>
        )}
      </div>

      {credential ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <ObjectField label={t("computerName")} value={<span data-testid="pending-computer-name">{credential.name}</span>} />
          <ObjectField label={t("server")} value={<span data-testid="pending-server-name">{credential.serverName || credential.serverId || "-"}</span>} />
          <ObjectField label={t("expires")} value={<span data-testid="ticket-expires-at">{credential.expiresAt}</span>} />
        </div>
      ) : null}
    </div>
  )
}

function ConnectStepsBody(props: Omit<ConnectComputerFormProps, "initialStepsOpen">) {
  return <PlatformOnboarding {...props} />
}

/** @deprecated Empty state now uses ConnectComputerDialog; retained for old imports. */
export function ConnectComputerForm(props: Omit<ConnectComputerFormProps, "initialStepsOpen">) {
  const t = useTranslations("computers")

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Terminal className="size-4" />
          {t("connectNew")}
        </CardTitle>
        <CardDescription>{t("onboarding.dialogDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <ConnectStepsBody {...props} />
      </CardContent>
    </Card>
  )
}

/**
 * Sidebar «添加电脑» entry + onboarding dialog. Install/Setup are previews;
 * only the Connect form submit reaches the ticket-generating server action.
 */
export function ConnectComputerDialog({
  action,
  credential,
  preview,
  connectedComputerName,
  error,
  initialStepsOpen = false,
}: ConnectComputerFormProps) {
  const t = useTranslations("computers")
  const [openDialog, setOpenDialog] = useState<"none" | "steps" | "already">(
    initialStepsOpen ? "steps" : "none",
  )
  const [dismissedConnectedName, setDismissedConnectedName] = useState<string | null>(null)
  const showAlreadyConnected = Boolean(connectedComputerName) && connectedComputerName !== dismissedConnectedName
  const activeDialog: "none" | "steps" | "already" = showAlreadyConnected ? "already" : openDialog

  const dismissAlreadyDialog = () => {
    setOpenDialog("none")
    if (connectedComputerName) setDismissedConnectedName(connectedComputerName)
  }

  const openStepsDialog = () => {
    if (connectedComputerName) setDismissedConnectedName(connectedComputerName)
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
        onClick={openStepsDialog}
      >
        <Plus className="size-4" />
        <span className="sr-only sm:not-sr-only">{t("addComputer")}</span>
      </Button>

      {activeDialog === "steps" ? (
        <Dialog open onOpenChange={(open) => !open && setOpenDialog("none")}>
          <DialogContent data-testid="connect-computer-dialog" className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Terminal className="size-4" />
                {t("connectNew")}
              </DialogTitle>
              <DialogDescription>{t("onboarding.dialogDesc")}</DialogDescription>
            </DialogHeader>
            <ConnectStepsBody
              action={action}
              credential={credential}
              preview={preview}
              connectedComputerName={null}
              error={error}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {activeDialog === "already" ? (
        <Dialog open onOpenChange={(open) => !open && dismissAlreadyDialog()}>
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
              <Button type="button" variant="outline" onClick={dismissAlreadyDialog}>
                {t("keepCurrentConnection")}
              </Button>
              <Button type="button" onClick={openStepsDialog}>
                {t("connectAnotherComputer")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

/** Reconnect output intentionally exposes only the Connect phase. */
export function ReconnectCommandCard({
  credential,
  computerName,
}: {
  credential: CredentialResponse
  computerName: string
}) {
  const t = useTranslations("computers")
  const [platform, setPlatform] = useState<OnboardingPlatform>(() => detectInitialPlatform())
  const platforms = credential.platforms || fallbackPlatforms(credential)
  const selected = platforms[platform]
  const connect = phaseCommand(platforms, platform, "connect")
  const rendered = connect ? { ...connect, command: connect.command } : null

  return (
    <InkframeObjectSurface material="drying" data-inkframe-mobile-role="computer-reconnect-command" data-region="computer-reconnect" className="min-w-0 space-y-3 overflow-x-hidden p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{t("reconnectCommand")}</div>
        <div className="text-xs text-muted-foreground">{t("useOn", { name: computerName })}</div>
      </div>
      <Tabs value={platform} onValueChange={(value) => setPlatform(value as OnboardingPlatform)} data-testid="reconnect-platform-tabs">
        <TabsList>
          <TabsTrigger value="windows" data-testid="platform-tab-windows">{t("onboarding.platformWindows")}</TabsTrigger>
          <TabsTrigger value="unix" data-testid="platform-tab-unix">{t("onboarding.platformUnix")}</TabsTrigger>
        </TabsList>
        <TabsContent value={platform}>
          {selected.available === false && platform === "windows" ? (
            <Panel variant="flat" className="p-2 text-xs text-warning">{t("onboarding.windowsUnavailable")}</Panel>
          ) : rendered?.command ? (
            <AttachmentSheet kind="proof" className="flex items-start gap-2 p-2">
              <code data-testid="reconnect-command" className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs">{rendered.command}</code>
              <CopyCommandButton command={rendered.command} phase="connect" platform={platform} t={t} />
            </AttachmentSheet>
          ) : null}
        </TabsContent>
      </Tabs>
      <div className="grid gap-2 sm:grid-cols-3">
        <ObjectField label={t("computerName")} value={credential.name} />
        <ObjectField label={t("server")} value={credential.serverName || credential.serverId || "-"} />
        <ObjectField label={t("expires")} value={<span data-testid="ticket-expires-at">{credential.expiresAt}</span>} />
      </div>
    </InkframeObjectSurface>
  )
}
