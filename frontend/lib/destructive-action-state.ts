export type DestructiveActionState = {
  phase: "idle" | "confirming" | "submitting" | "succeeded" | "failed"
  error: string | null
}

export type DestructiveActionEvent =
  | { type: "open" }
  | { type: "close" }
  | { type: "submit" }
  | { type: "succeed" }
  | { type: "fail"; error: string }

export const destructiveActionInitialState: DestructiveActionState = {
  phase: "idle",
  error: null,
}

export function destructiveActionReducer(
  state: DestructiveActionState,
  event: DestructiveActionEvent,
): DestructiveActionState {
  switch (event.type) {
    case "open":
      if (state.phase === "submitting") return state
      return { phase: "confirming", error: null }
    case "close":
      return state.phase === "submitting" ? state : destructiveActionInitialState
    case "submit":
      if (state.phase !== "confirming" && state.phase !== "failed") return state
      return { phase: "submitting", error: null }
    case "succeed":
      if (state.phase !== "submitting") return state
      return { phase: "succeeded", error: null }
    case "fail":
      if (state.phase !== "submitting") return state
      return { phase: "failed", error: event.error }
  }
}

export type DestructiveActionGate<T> = {
  isPending: () => boolean
  run: (operation: () => Promise<T>) => Promise<T>
}

export type CancelableOpenChangeDetails = {
  cancel: () => void
}

/**
 * A controlled Base UI dialog must cancel a rejected dismissal, not merely
 * retain its React `open` value. Cancellation prevents Base UI from running
 * close/focus-return bookkeeping while the destructive request is pending.
 */
export function guardDestructiveActionOpenChange(
  nextOpen: boolean,
  isPending: boolean,
  eventDetails: CancelableOpenChangeDetails,
): boolean {
  if (!nextOpen && isPending) {
    eventDetails.cancel()
    return false
  }
  return true
}

/**
 * Coalesces repeated confirmation attempts onto the exact same Promise. This
 * protects against two clicks landing before React has committed `disabled`.
 */
export function createDestructiveActionGate<T>(): DestructiveActionGate<T> {
  let pending: Promise<T> | null = null

  return {
    isPending: () => pending !== null,
    run(operation) {
      if (pending) return pending

      const current = Promise.resolve().then(operation)
      pending = current
      const clear = () => {
        if (pending === current) pending = null
      }
      void current.then(clear, clear)
      return current
    },
  }
}
