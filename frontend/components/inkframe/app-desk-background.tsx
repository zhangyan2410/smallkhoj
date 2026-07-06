"use client"

import { useEffect, useState, type HTMLAttributes } from "react"

import { cn } from "@/lib/utils"
import {
  INKFRAME_DESK_PAPER_TINT,
  MaterialSurface,
  type MaterialPointerMode,
  type MaterialSurfaceMode,
} from "@/components/inkframe/material-surface"
import { shouldMaterialSurfaceCapturePointer } from "@/components/inkframe/material-surface-lifecycle"
import type { MaterialResource } from "@/components/inkframe/material-resource"

export const APP_DESK_MATERIAL_EVENT = "smallkhoj:app-desk-material"

export type AppDeskMaterialAction = "activate" | "draw" | "water" | "keep" | "discard" | "static"

export type AppDeskMaterialEventDetail = {
  action: AppDeskMaterialAction
}

export function resolveAppDeskMaterialAction(action: AppDeskMaterialAction): {
  mode: MaterialSurfaceMode
  pointerMode: MaterialPointerMode
} {
  switch (action) {
    case "activate":
      return { mode: "active", pointerMode: "none" }
    case "draw":
      return { mode: "active", pointerMode: "draw" }
    case "water":
      return { mode: "active", pointerMode: "water" }
    case "keep":
      return { mode: "keeping", pointerMode: "none" }
    case "discard":
      return { mode: "discarding", pointerMode: "none" }
    case "static":
    default:
      return { mode: "static", pointerMode: "none" }
  }
}

export function AppDeskBackground({
  mode = "static",
  defaultResource = null,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  mode?: MaterialSurfaceMode
  defaultResource?: MaterialResource | null
}) {
  const [materialMode, setMaterialMode] = useState<MaterialSurfaceMode>(mode)
  const [pointerMode, setPointerMode] = useState<MaterialPointerMode>("none")
  const [resource, setResource] = useState<MaterialResource | null>(defaultResource)
  const capturesPointer = shouldMaterialSurfaceCapturePointer(materialMode, pointerMode)
  const sourceMode = resource?.sourceKind ?? "none"

  useEffect(() => {
    function handleMaterialAction(event: Event) {
      const action = (event as CustomEvent<AppDeskMaterialEventDetail>).detail?.action
      if (!action) return
      const next = resolveAppDeskMaterialAction(action)
      setPointerMode(next.pointerMode)
      setMaterialMode(next.mode)
    }

    window.addEventListener(APP_DESK_MATERIAL_EVENT, handleMaterialAction)
    return () => window.removeEventListener(APP_DESK_MATERIAL_EVENT, handleMaterialAction)
  }, [])

  return (
    <div
      {...props}
      aria-hidden="true"
      data-slot="app-desk-background"
      data-region="app-desk-background"
      data-inkframe-surface="app-background"
      data-inkframe-background-owner="product-shell"
      data-inkframe-background-scope="global-desk"
      data-inkframe-owner-kind="app-background"
      data-inkframe-owner-id="global-desk"
      data-inkframe-region="app-background"
      data-inkframe-mode={materialMode}
      data-inkframe-tint="desk"
      data-inkframe-pointer-capture={capturesPointer ? "true" : "false"}
      data-inkframe-resource-owner-kind={resource?.ownerKind ?? "app-background"}
      data-inkframe-resource-tint={resource?.tint ?? "desk"}
      data-inkframe-resource-source-kind={sourceMode}
      data-inkframe-background-source-mode={sourceMode}
      data-inkframe-background-has-visual={resource?.visualObjectUrl ? "true" : "false"}
      data-inkframe-background-has-restore={resource?.restoreObjectUrl ? "true" : "false"}
      data-inkframe-background-has-source={resource?.sourceObjectUrl ? "true" : "false"}
      data-material-owner="app-background"
      data-material-tint="desk"
      data-material-mode={materialMode}
      data-material-pointer-mode={pointerMode}
      data-material-resource-id={resource?.id}
      className={cn("sk-app-desk-background", className)}
    >
      <MaterialSurface
        ownerKind="app-background"
        ownerId="global-desk"
        region="app-background"
        tint="desk"
        mode={materialMode}
        pointerMode={pointerMode}
        paperTint={INKFRAME_DESK_PAPER_TINT}
        vignette={0}
        cleanPaper
        resource={resource}
        defaultResource={defaultResource}
        onResourceChange={setResource}
        onModeChange={setMaterialMode}
        className="sk-app-desk-material"
      >
        <div data-slot="app-desk-static" className="sk-app-desk-static" />
        <div data-slot="app-desk-fibers" className="sk-app-desk-fibers" />
        <div data-slot="app-desk-vignette" className="sk-app-desk-vignette" />
      </MaterialSurface>
    </div>
  )
}
