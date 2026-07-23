import { getTranslations } from "next-intl/server"

import { RouteLoadingState } from "@/components/route-loading-state"

export default async function Loading() {
  const t = await getTranslations("common")
  return (
    <RouteLoadingState
      title={t("routeLoading")}
      description={t("loading")}
    />
  )
}
