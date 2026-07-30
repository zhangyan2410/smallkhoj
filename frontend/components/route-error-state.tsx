import { Button } from "@/components/ui/button"
import { Panel, PanelTitle } from "@/components/ui/panel"

export function RouteErrorState({
  title,
  description,
  retryLabel,
  onRetry,
}: {
  title: string
  description: string
  retryLabel: string
  onRetry: () => void
}) {
  return (
    <main
      data-slot="route-error"
      data-region="route-status"
      role="alert"
      aria-live="assertive"
      className="flex min-h-[60vh] items-center justify-center px-4 py-12"
    >
      <Panel variant="raised" className="w-full max-w-xl p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="inline-flex size-8 shrink-0 items-center justify-center border-2 border-[var(--ink)] bg-destructive/10 font-semibold text-destructive"
          >
            !
          </span>
          <div className="min-w-0 space-y-1">
            <PanelTitle>{title}</PanelTitle>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <div className="mt-5 flex justify-end">
          <Button type="button" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      </Panel>
    </main>
  )
}
