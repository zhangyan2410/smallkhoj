"use client"

import { useReducer, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  type DialogOpenChangeEventDetails,
} from "@/components/ui/dialog"
import { Panel } from "@/components/ui/panel"
import {
  createDestructiveActionGate,
  destructiveActionInitialState,
  destructiveActionReducer,
  guardDestructiveActionOpenChange,
} from "@/lib/destructive-action-state"

export type DestructiveActionDialogProps<Result> = {
  triggerLabel: string
  title: string
  targetName: string
  consequence: string
  confirmLabel: string
  cancelLabel: string
  submittingLabel: string
  retryLabel: string
  failureLabel: string
  closeLabel: string
  successLabel?: string
  disabled?: boolean
  onConfirm: () => Promise<Result>
  onSuccess?: (result: Result) => void
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}

export function DestructiveActionDialog<Result>({
  triggerLabel,
  title,
  targetName,
  consequence,
  confirmLabel,
  cancelLabel,
  submittingLabel,
  retryLabel,
  failureLabel,
  closeLabel,
  successLabel,
  disabled = false,
  onConfirm,
  onSuccess,
}: DestructiveActionDialogProps<Result>) {
  const [open, setOpen] = useState(false)
  const [state, dispatch] = useReducer(
    destructiveActionReducer,
    destructiveActionInitialState,
  )
  const [gate] = useState(() => createDestructiveActionGate<Result>())
  const isSubmitting = state.phase === "submitting"
  const isSucceeded = state.phase === "succeeded"

  const handleOpenChange = (
    nextOpen: boolean,
    eventDetails: DialogOpenChangeEventDetails,
  ) => {
    if (!guardDestructiveActionOpenChange(nextOpen, gate.isPending(), eventDetails)) return
    setOpen(nextOpen)
    dispatch({ type: nextOpen ? "open" : "close" })
  }

  const handleConfirm = async () => {
    if (gate.isPending() || isSucceeded) return
    dispatch({ type: "submit" })

    let result: Result
    try {
      result = await gate.run(onConfirm)
    } catch (error) {
      dispatch({ type: "fail", error: errorMessage(error, failureLabel) })
      return
    }

    dispatch({ type: "succeed" })
    onSuccess?.(result)
  }

  const visibleError = state.error && state.error !== failureLabel
    ? `${failureLabel}: ${state.error}`
    : failureLabel

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={(
          <Button type="button" variant="destructive" disabled={disabled}>
            {triggerLabel}
          </Button>
        )}
      />
      <DialogContent
        aria-busy={isSubmitting}
        closeLabel={closeLabel}
        closeDisabled={isSubmitting}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{consequence}</DialogDescription>
        </DialogHeader>

        <Panel variant="flat" className="p-3">
          <p data-slot="destructive-action-target" className="break-words font-medium text-foreground">
            {targetName}
          </p>
        </Panel>

        <div aria-live="polite" aria-atomic="true">
          {isSubmitting ? (
            <p data-slot="destructive-action-status" role="status" className="text-sm text-muted-foreground">
              {submittingLabel}
            </p>
          ) : null}
          {isSucceeded && successLabel ? (
            <p data-slot="destructive-action-status" role="status" className="text-sm text-foreground">
              {successLabel}
            </p>
          ) : null}
          {state.phase === "failed" ? (
            <p data-slot="destructive-action-error" role="alert" className="text-sm text-destructive">
              {visibleError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose
            render={(
              <Button type="button" variant="outline" disabled={isSubmitting}>
                {isSucceeded ? closeLabel : cancelLabel}
              </Button>
            )}
          />
          {!isSucceeded ? (
            <Button
              type="button"
              variant="destructive"
              disabled={isSubmitting || disabled}
              onClick={handleConfirm}
            >
              {isSubmitting
                ? submittingLabel
                : state.phase === "failed"
                  ? retryLabel
                  : confirmLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
