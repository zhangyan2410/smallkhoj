"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Copy text to the clipboard with a secure-context fallback.
 *
 * Why this exists: `navigator.clipboard.writeText` is only available in secure
 * contexts (https or localhost). Plain-HTTP deployments (e.g. an internal cloud
 * box reached via http://<ip>) have `navigator.clipboard === undefined`, so the
 * async Clipboard API throws and a naive try/catch silently drops the copy with
 * no user feedback. This hook falls back to the legacy hidden-textarea +
 * `document.execCommand("copy")` path on non-secure contexts so the copy still
 * works over plain HTTP.
 *
 * Returns:
 * - `copied`: true for `resetMs` (default 2000ms) after a successful copy;
 *   callers use it to swap the icon / show a "copied" affordance.
 * - `copy(text)`: resolves `true` on success, `false` on failure. Safe to call
 *   without awaiting (fire-and-forget callers can ignore the result).
 */
export function useCopyToClipboard(resetMs = 2000): {
  copied: boolean
  copy: (text: string) => Promise<boolean>
} {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [])

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      const ok = await copyToClipboard(text)
      if (!ok) {
        setCopied(false)
        return false
      }
      setCopied(true)
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => setCopied(false), resetMs)
      return true
    },
    [resetMs],
  )

  return { copied, copy }
}

/**
 * Write `text` to the OS clipboard, preferring the async Clipboard API in
 * secure contexts and falling back to a hidden textarea + execCommand("copy")
 * otherwise. Returns false if every path failed. Exported for non-hook
 * callers (e.g. inside useCallback without state).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Secure context (https / localhost / file): use the modern async API.
  if (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof navigator !== "undefined" &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === "function"
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Permission denied / clipboard busy — fall through to the legacy path.
    }
  }

  // Legacy fallback for non-secure (plain-HTTP) contexts or when the async API
  // is unavailable/denied. execCommand is deprecated but still the only way to
  // copy synchronously from a user gesture on http:// origins.
  if (typeof document === "undefined") return false
  try {
    const textarea = document.createElement("textarea")
    textarea.value = text
    // Move off-screen so the element is never visible; avoid scrolling the page.
    textarea.setAttribute("readonly", "")
    textarea.style.position = "fixed"
    textarea.style.top = "0"
    textarea.style.left = "0"
    textarea.style.opacity = "0"
    document.body.appendChild(textarea)
    textarea.select()
    const succeeded = document.execCommand("copy")
    document.body.removeChild(textarea)
    return succeeded
  } catch {
    return false
  }
}
