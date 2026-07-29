import Link from "next/link"
import { Activity, Clock3, Server, TerminalSquare } from "lucide-react"
import { getTranslations } from "next-intl/server"

import { IntegrationGateConsole } from "@/components/integration-gate-console"
import { ProductShell } from "@/components/product-shell"
import { Button } from "@/components/ui/button"
import { Panel } from "@/components/ui/panel"
import { readIntegrationGateResults, resolveIntegrationGateResultRoot } from "@/lib/integration-gate-results"

export const dynamic = "force-dynamic"

export default async function IntegrationGatesPage() {
  const t = await getTranslations("integrationGate")
  const results = readIntegrationGateResults()
  const resultRoot = resolveIntegrationGateResultRoot()

  return (
    <ProductShell
      title={t("title")}
      description={t("description")}
      actions={
        <Link href="/control/integration">
          <Button variant="outline" size="sm">
            <Activity className="size-4" />
            {t("taskRunControl")}
          </Button>
        </Link>
      }
      sidebarTitle={t("sidebar.title")}
      sidebarDescription={t("sidebar.description")}
      sidebar={
        <div className="space-y-3 text-sm">
          <Panel className="p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <TerminalSquare className="size-3.5" />
              {t("sidebar.safeExample")}
            </div>
            <code className="mt-2 block break-words text-xs">
              node tools/integration-gate/run.mjs --mode foundation-only --server-id &lt;server-id&gt;
            </code>
          </Panel>
          <Panel className="p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Server className="size-3.5" />
              {t("sidebar.resultDirectory")}
            </div>
            <code className="mt-2 block break-all text-xs">{resultRoot}</code>
          </Panel>
          <Panel className="sk-cat-warning p-3 text-xs">
            <div className="flex items-center gap-2 font-semibold">
              <Clock3 className="size-3.5" />
              {t("sidebar.freshness")}
            </div>
            <p className="mt-1 text-muted-foreground">
              {t("sidebar.freshnessDescription")}
            </p>
          </Panel>
        </div>
      }
    >
      <IntegrationGateConsole results={results} />
    </ProductShell>
  )
}
