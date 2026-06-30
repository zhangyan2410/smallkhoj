"use client"

import { useState } from "react"
import { Check, Copy, LinkIcon, UserPlus } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Panel, PanelTitle } from "@/components/ui/panel"
import { apiPost, type ServerInviteResponse } from "@/lib/control-plane"

export type InviteMemberDialogCopy = {
  inviteMember: string
  inviteMemberDesc: string
  serverLabel: string
  invitedNameLabel: string
  invitedNamePlaceholder: string
  manualCopyHint: string
  generateInviteLink: string
  generatingInviteLink: string
  copyInviteLink: string
  copiedInviteLink: string
  inviteLinkLabel: string
  close: string
}

function absoluteJoinUrl(value: string) {
  if (!value || typeof window === "undefined") return value
  if (value.startsWith("http://") || value.startsWith("https://")) return value
  return `${window.location.origin}${value.startsWith("/") ? "" : "/"}${value}`
}

export function InviteMemberDialog({
  serverName,
  copy,
}: {
  serverName: string
  copy: InviteMemberDialogCopy
}) {
  const [open, setOpen] = useState(false)
  const [joinUrl, setJoinUrl] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generateInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setCopied(false)
    setError(null)
    const formData = new FormData(event.currentTarget)
    const invitedName = String(formData.get("invitedName") || "").trim()
    try {
      const data = await apiPost<ServerInviteResponse>("/api/v1/server-invites", {
        role: "member",
        invitedName,
        expiresInDays: 14,
      })
      setJoinUrl(absoluteJoinUrl(data.invite.joinUrl || ""))
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : String(inviteError))
    } finally {
      setSubmitting(false)
    }
  }

  async function copyInviteLink() {
    if (!joinUrl) return
    await navigator.clipboard.writeText(joinUrl)
    setCopied(true)
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setError(null)
      setCopied(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button variant="default" size="sm" className="w-full">
            <UserPlus className="size-3.5" />
            {copy.inviteMember}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.inviteMember}</DialogTitle>
          <DialogDescription>{copy.inviteMemberDesc}</DialogDescription>
        </DialogHeader>

        <Panel className="p-3">
          <PanelTitle className="flex items-center gap-2">
            <LinkIcon className="size-3.5" />
            {copy.serverLabel}
          </PanelTitle>
          <p className="mt-1 text-sm text-muted-foreground">{serverName}</p>
          <p className="mt-2 text-xs text-muted-foreground">{copy.manualCopyHint}</p>
        </Panel>

        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        <form onSubmit={generateInvite} className="grid gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="invite-member-name" className="text-xs font-medium text-muted-foreground">
              {copy.invitedNameLabel}
            </label>
            <Input
              id="invite-member-name"
              name="invitedName"
              placeholder={copy.invitedNamePlaceholder}
              autoComplete="off"
            />
          </div>

          {joinUrl && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-member-link" className="text-xs font-medium text-muted-foreground">
                {copy.inviteLinkLabel}
              </label>
              <div className="flex gap-2">
                <Input id="invite-member-link" value={joinUrl} readOnly />
                <Button type="button" variant="outline" size="sm" onClick={copyInviteLink}>
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? copy.copiedInviteLink : copy.copyInviteLink}
                </Button>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              {copy.close}
            </Button>
            <Button type="submit" size="sm" disabled={submitting}>
              {submitting ? copy.generatingInviteLink : copy.generateInviteLink}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
