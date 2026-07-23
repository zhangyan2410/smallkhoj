"use client"

import { useEffect } from "react"
import { useTranslations } from "next-intl"

import { RouteErrorState } from "@/components/route-error-state"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations("common")

  useEffect(() => {
    console.error("[route-error]", error)
  }, [error])

  return (
    <RouteErrorState
      title={t("routeError")}
      description={t("routeErrorDesc")}
      retryLabel={t("tryAgain")}
      onRetry={reset}
    />
  )
}
