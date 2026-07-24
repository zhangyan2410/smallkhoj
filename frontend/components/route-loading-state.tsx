import { Panel, PanelTitle } from "@/components/ui/panel"

export function RouteLoadingState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <main
      data-slot="route-loading"
      data-region="route-status"
      role="status"
      aria-busy="true"
      aria-live="polite"
      className="flex min-h-[60vh] items-center justify-center px-4 py-12"
    >
      <Panel variant="raised" className="w-full max-w-xl p-5">
        <div className="space-y-1">
          <PanelTitle>{title}</PanelTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div aria-hidden="true" className="mt-5 space-y-3">
          <div className="h-3 w-3/5 bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-full bg-muted motion-safe:animate-pulse" />
          <div className="h-3 w-4/5 bg-muted motion-safe:animate-pulse" />
        </div>
      </Panel>
    </main>
  )
}
