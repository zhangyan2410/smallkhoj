"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"

import { Input } from "@/components/ui/input"
import { apiGetCritical } from "@/lib/control-plane"
import {
  validateMemberName,
  type MemberNameReasonCode,
  type MemberNameValidation,
} from "@/lib/member-name"

type MemberNameFieldProps = {
  id: string
  label: string
  placeholder: string
  availabilityPath: string
  defaultValue?: string
  autoFocus?: boolean
  disabled?: boolean
}

function feedbackKey(reasonCode: MemberNameReasonCode | "NAME_UNAVAILABLE" | null) {
  switch (reasonCode) {
    case "NAME_REQUIRED": return "nameRequired"
    case "NAME_TOO_LONG": return "nameTooLong"
    case "NAME_INVALID_HYPHEN": return "nameInvalidHyphen"
    case "NAME_INVALID_CHARACTER": return "nameInvalidCharacter"
    case "NAME_RESERVED_SERVER_SUFFIX": return "nameReservedSuffix"
    case "NAME_UNAVAILABLE": return "nameUnavailable"
    default: return null
  }
}

export function MemberNameField({
  id,
  label,
  placeholder,
  availabilityPath,
  defaultValue = "",
  autoFocus = false,
  disabled = false,
}: MemberNameFieldProps) {
  const t = useTranslations("identity")
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(defaultValue)
  const local = validateMemberName(value)
  const [remoteState, setRemoteState] = useState<{
    value: string
    phase: "checking" | "ready" | "failed"
    result?: MemberNameValidation
  } | null>(null)

  useEffect(() => {
    const form = inputRef.current?.form
    if (!form) return
    const handleReset = () => setValue(defaultValue)
    form.addEventListener("reset", handleReset)
    return () => form.removeEventListener("reset", handleReset)
  }, [defaultValue])

  useEffect(() => {
    if (!local.valid) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setRemoteState({ value, phase: "checking" })
      apiGetCritical<MemberNameValidation>(
        `${availabilityPath}?name=${encodeURIComponent(value)}`,
        undefined,
        undefined,
        { signal: controller.signal, timeoutMs: 5_000 },
      )
        .then((result) => {
          if (!controller.signal.aborted) setRemoteState({ value, phase: "ready", result })
        })
        .catch(() => {
          if (!controller.signal.aborted) setRemoteState({ value, phase: "failed" })
        })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [availabilityPath, local.canonicalName, local.valid, value])

  const currentRemote = remoteState?.value === value ? remoteState : null
  const remote = currentRemote?.phase === "ready" ? currentRemote.result ?? null : null
  const checking = currentRemote?.phase === "checking"
  const checkFailed = currentRemote?.phase === "failed"
  const validation = remote ?? local
  const reasonKey = feedbackKey(validation.reasonCode)
  const visibleError = value && reasonKey ? t(reasonKey) : null
  const canonicalReference = remote?.canonicalReference ?? local.canonicalReference

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    const customError = visibleError ?? ""
    input.setCustomValidity(customError)
  }, [visibleError])

  const feedbackId = `${id}-feedback`
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <Input
        ref={inputRef}
        id={id}
        name="name"
        value={value}
        required
        autoComplete="off"
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby={feedbackId}
        aria-invalid={Boolean(visibleError)}
        onChange={(event) => setValue(event.target.value)}
      />
      <div id={feedbackId} aria-live="polite" className="min-h-4 text-xs">
        {visibleError ? (
          <span className="text-destructive">{visibleError}</span>
        ) : checking ? (
          <span className="text-muted-foreground">{t("nameChecking")}</span>
        ) : checkFailed ? (
          <span className="text-muted-foreground">{t("nameCheckFailed")}</span>
        ) : validation.valid && remote?.available === false ? (
          <span className="text-destructive">{t("nameUnavailable")}</span>
        ) : canonicalReference ? (
          <span className="text-muted-foreground">
            {t("canonicalPreview", { reference: canonicalReference })}
            {remote?.available ? ` · ${t("nameAvailable")}` : ""}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("nameHint")}</span>
        )}
      </div>
    </div>
  )
}
