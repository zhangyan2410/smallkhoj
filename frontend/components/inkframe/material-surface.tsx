"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react"

import {
  canUseInkMaterialRuntime,
  createInkMaterialSurface,
  ensureInkMaterialRuntime,
  type InkMaterialParams,
  type InkMaterialState,
  type InkMaterialSurface,
  type InkMaterialWaterStyle,
} from "./ink-material-engine"
import {
  discardMaterialResource,
  replaceMaterialResource,
  type MaterialOwnerKind,
  type MaterialResource,
  type MaterialResourceUrlEnv,
  defaultMaterialResourceUrlEnv,
} from "./material-resource"
import {
  captureMaterialSurfaceResource,
  shouldMaterialSurfaceCapturePointer,
} from "./material-surface-lifecycle"
import {
  createMaterialRestoreToken,
  restoreMaterialResourceIntoSurface,
  type MaterialImageLoader,
  type MaterialRestoreToken,
} from "./material-surface-restore"
import {
  materialSurfaceCoordinator,
  type MaterialSurfaceCoordinator,
  type MaterialWorkspaceRegion,
} from "./material-surface-store"

export type MaterialSurfaceMode =
  | "static"
  | "activating"
  | "active"
  | "keeping"
  | "discarding"
  | "error"
  | "fallback"

export type MaterialPointerMode = "none" | "draw" | "water"
export type MaterialPaperTint = readonly [number, number, number]

export const INKFRAME_DESK_PAPER_TINT = [246 / 255, 241 / 255, 226 / 255] as const satisfies MaterialPaperTint

export type MaterialSurfaceProps = Omit<ComponentPropsWithoutRef<"div">, "children" | "resource"> & {
  ownerKind: MaterialOwnerKind
  ownerId: string
  region: MaterialWorkspaceRegion
  tint: MaterialResource["tint"]
  mode?: MaterialSurfaceMode
  pointerMode?: MaterialPointerMode
  waterStyle?: InkMaterialWaterStyle
  paperTint?: MaterialPaperTint
  vignette?: number
  cleanPaper?: boolean
  washableFixedInk?: boolean
  resource?: MaterialResource | null
  defaultResource?: MaterialResource | null
  coordinator?: MaterialSurfaceCoordinator
  resourceEnv?: MaterialResourceUrlEnv
  loadImage?: MaterialImageLoader
  onResourceChange?: (resource: MaterialResource | null) => void
  onModeChange?: (mode: MaterialSurfaceMode) => void
  children?: ReactNode
}

const ACTIVE_MODES: ReadonlySet<MaterialSurfaceMode> = new Set(["activating", "active", "keeping", "discarding"])

export type MaterialPointerPoint = {
  x: number
  y: number
  pressure: number
  speed: number
}

type MaterialPointerStroke = {
  previous: MaterialPointerPoint | null
  current: MaterialPointerPoint
  dx: number
  dy: number
  dist: number
  pressure: number
  speed: number
  waterOverride: boolean
}

function loadBrowserImage(url: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Unable to load material resource image: ${url}`))
    image.src = url
  })
}

function materialPointerPoint(event: ReactPointerEvent, canvas: HTMLCanvasElement): MaterialPointerPoint {
  const rect = canvas.getBoundingClientRect()
  const width = rect.width || canvas.width || 1
  const height = rect.height || canvas.height || 1
  const x = (event.clientX - rect.left) / width
  const y = 1 - (event.clientY - rect.top) / height
  return {
    x,
    y,
    pressure: event.pressure > 0 && event.pressure < 1 ? event.pressure : 0.6,
    speed: Math.hypot(event.movementX || 0, event.movementY || 0) / Math.max(width, height),
  }
}

function materialRuntimeState(pointerMode: MaterialPointerMode): InkMaterialState {
  return pointerMode === "draw" || pointerMode === "water" ? "running" : "idle"
}

function materialRuntimeParams(ownerKind: MaterialOwnerKind): InkMaterialParams {
  if (ownerKind === "message") {
    return { size: 0.72, ink: 1.05, dry: 0.62, penWet: 0.0, bleed: 0.5 }
  }
  if (ownerKind === "app-background") {
    return { size: 0.82, ink: 1.08, dry: 0.6, penWet: 0.0, bleed: 0.52 }
  }
  return { size: 0.66, ink: 1.0, dry: 0.62, penWet: 0.0, bleed: 0.5 }
}

function materialWaterOverride(event: ReactPointerEvent): boolean {
  return (event.buttons & 2) !== 0 || event.shiftKey || event.ctrlKey
}

function materialPointerStroke(
  event: ReactPointerEvent,
  canvas: HTMLCanvasElement,
  previous: MaterialPointerPoint | null,
): MaterialPointerStroke {
  const current = materialPointerPoint(event, canvas)
  const base = previous ?? current
  const dx = current.x - base.x
  const dy = current.y - base.y
  const dist = Math.hypot(dx, dy)
  return {
    previous,
    current,
    dx,
    dy,
    dist,
    pressure: current.pressure,
    speed: dist * 60,
    waterOverride: materialWaterOverride(event),
  }
}

function applyPenStroke(surface: InkMaterialSurface, stroke: MaterialPointerStroke) {
  if (!stroke.previous) {
    return
  }
  if (surface.stroke) {
    surface.stroke([stroke.previous, { ...stroke.current, speed: stroke.speed }], { tool: "pen" })
    return
  }
  surface.pen({ ...stroke.current, speed: stroke.speed })
}

function applyBrushStroke(surface: InkMaterialSurface, stroke: MaterialPointerStroke) {
  const sm = 1
  const baseRadius = (0.014 + 0.060 * stroke.pressure) * sm
  const spacing = Math.max(baseRadius * 0.6, 0.0006)
  const steps = Math.min(Math.max(Math.ceil(stroke.dist / spacing), 1), 120)
  const base = stroke.previous ?? stroke.current

  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    surface.brush({
      x: base.x + stroke.dx * t,
      y: base.y + stroke.dy * t,
      pressure: stroke.pressure,
      speed: stroke.speed,
      vx: stroke.dx * 60,
      vy: stroke.dy * 60,
    })
  }
}

export function MaterialSurface({
  ownerKind,
  ownerId,
  region,
  tint,
  mode = "static",
  pointerMode = "none",
  waterStyle,
  paperTint,
  vignette,
  cleanPaper,
  washableFixedInk = false,
  resource,
  defaultResource = null,
  coordinator = materialSurfaceCoordinator,
  resourceEnv = defaultMaterialResourceUrlEnv,
  loadImage = loadBrowserImage,
  onResourceChange,
  onModeChange,
  children,
  className,
  style,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  ...props
}: MaterialSurfaceProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const runtimeSurfaceRef = useRef<InkMaterialSurface | null>(null)
  const restoreTokenRef = useRef<MaterialRestoreToken | null>(null)
  const pointerActiveRef = useRef(false)
  const lastPointerPointRef = useRef<MaterialPointerPoint | null>(null)
  const [modeOverride, setModeOverride] = useState<{
    baseMode: MaterialSurfaceMode
    value: MaterialSurfaceMode
  } | null>(null)
  const activeMode = ACTIVE_MODES.has(mode)
  const resolvedMode = modeOverride?.baseMode === mode ? modeOverride.value : mode
  const capturesPointer = shouldMaterialSurfaceCapturePointer(resolvedMode, pointerMode)
  const staticStyle: CSSProperties | undefined = resource?.visualObjectUrl
    ? { backgroundImage: `url(${resource.visualObjectUrl})` }
    : undefined

  const setMode = useCallback(
    (nextMode: MaterialSurfaceMode) => {
      setModeOverride(nextMode === mode ? null : { baseMode: mode, value: nextMode })
      onModeChange?.(nextMode)
    },
    [mode, onModeChange],
  )

  const destroyCurrentSurface = useCallback(() => {
    restoreTokenRef.current?.cancel()
    restoreTokenRef.current = null
    runtimeSurfaceRef.current?.destroy()
    runtimeSurfaceRef.current = null
  }, [])

  const keepCurrentSurface = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const nextResource = await captureMaterialSurfaceResource({
      canvas,
      ownerKind,
      ownerId,
      tint,
      env: resourceEnv,
    })
    onResourceChange?.(replaceMaterialResource(resource, nextResource, resourceEnv))
    setMode("static")
  }, [ownerKind, ownerId, onResourceChange, resource, resourceEnv, setMode, tint])

  const discardCurrentSurface = useCallback(() => {
    destroyCurrentSurface()
    onResourceChange?.(discardMaterialResource(resource, defaultResource, resourceEnv))
    setMode("static")
  }, [defaultResource, destroyCurrentSurface, onResourceChange, resource, resourceEnv, setMode])

  const applyMaterialPointer = useCallback((event: ReactPointerEvent) => {
    if (!capturesPointer) return
    const surface = runtimeSurfaceRef.current
    const canvas = canvasRef.current
    if (!surface || !canvas) return
    const stroke = materialPointerStroke(event, canvas, lastPointerPointRef.current)
    const useWater = pointerMode === "water" || (pointerMode === "draw" && stroke.waterOverride)

    if (useWater) applyBrushStroke(surface, stroke)
    else if (pointerMode === "draw") applyPenStroke(surface, stroke)

    lastPointerPointRef.current = stroke.current
  }, [capturesPointer, pointerMode])

  const handleMaterialPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerDown?.(event)
    if (event.defaultPrevented || !capturesPointer) return
    event.preventDefault()
    event.stopPropagation()
    pointerActiveRef.current = true
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Synthetic proof events and some mobile browsers can reject capture; the
      // explicit material mode still owns the stroke until pointerup/cancel.
    }
    const canvas = canvasRef.current
    lastPointerPointRef.current = canvas ? materialPointerPoint(event, canvas) : null
  }, [capturesPointer, onPointerDown])

  const handleMaterialPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event)
    if (event.defaultPrevented || !capturesPointer || !pointerActiveRef.current) return
    event.preventDefault()
    event.stopPropagation()
    applyMaterialPointer(event)
  }, [applyMaterialPointer, capturesPointer, onPointerMove])

  const handleMaterialPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerUp?.(event)
    if (capturesPointer && pointerActiveRef.current) {
      event.preventDefault()
      event.stopPropagation()
      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId)
        }
      } catch {
        // See pointerdown capture fallback above.
      }
    }
    pointerActiveRef.current = false
    lastPointerPointRef.current = null
  }, [capturesPointer, onPointerUp])

  const handleMaterialPointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    onPointerCancel?.(event)
    pointerActiveRef.current = false
    lastPointerPointRef.current = null
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.stopPropagation()
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      event.stopPropagation()
    }
  }, [onPointerCancel])

  const handleMaterialContextMenu = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!capturesPointer) return
    event.preventDefault()
    event.stopPropagation()
  }, [capturesPointer])

  useEffect(() => {
    if (!activeMode) {
      destroyCurrentSurface()
      return
    }
    if (mode === "discarding") return

    let disposed = false
    const canvas = canvasRef.current

    if (!canvas) {
      setMode("fallback")
      return
    }
    const activeCanvas = canvas

    const token = createMaterialRestoreToken()
    restoreTokenRef.current = token

    async function activateSurface() {
      try {
        const ready = canUseInkMaterialRuntime() || await ensureInkMaterialRuntime()
        if (!ready) {
          if (!disposed) setMode("fallback")
          return
        }
        const surface = createInkMaterialSurface(activeCanvas, {
          ownerKind,
          tint,
          preset: "productDryPen",
          waterStyle,
          state: materialRuntimeState(pointerMode),
          seed: ownerId,
          params: materialRuntimeParams(ownerKind),
          washableFixedInk,
          paperTint: paperTint ?? (tint === "desk" ? INKFRAME_DESK_PAPER_TINT : undefined),
          vignette: vignette ?? (tint === "desk" ? 0 : undefined),
          cleanPaper: cleanPaper ?? tint === "desk",
          seedMarks: false,
        })
        runtimeSurfaceRef.current = surface

        await coordinator.activate({
          region,
          ownerId,
          ownerKind,
          deactivate: async (keep) => {
            if (keep) {
              await keepCurrentSurface()
              return
            }
            discardCurrentSurface()
          },
        })

        await restoreMaterialResourceIntoSurface({
          surface,
          resource,
          token,
          loadImage,
          bake: { density: 0.8, wet: 0.08 },
        })

        if (!disposed && mode === "activating") setMode("active")
      } catch {
        if (!disposed) {
          destroyCurrentSurface()
          setMode("fallback")
        }
      }
    }

    void activateSurface()

    return () => {
      disposed = true
      token.cancel()
      coordinator.release(region, ownerId)
      destroyCurrentSurface()
    }
  }, [
    activeMode,
    coordinator,
    destroyCurrentSurface,
    discardCurrentSurface,
    keepCurrentSurface,
    loadImage,
    mode,
    ownerId,
    ownerKind,
    pointerMode,
    paperTint,
    region,
    resource,
    setMode,
    tint,
    vignette,
    cleanPaper,
    washableFixedInk,
    waterStyle,
  ])

  useEffect(() => {
    if (mode === "keeping") void keepCurrentSurface()
  }, [keepCurrentSurface, mode])

  useEffect(() => {
    if (mode === "discarding") void Promise.resolve().then(discardCurrentSurface)
  }, [discardCurrentSurface, mode])

  return (
    <div
      {...props}
      className={["sk-material-surface", className].filter(Boolean).join(" ")}
      data-slot="material-surface"
      data-object="material-surface"
      data-inkframe-surface="material"
      data-inkframe-owner-kind={ownerKind}
      data-inkframe-owner-id={ownerId}
      data-inkframe-region={region}
      data-inkframe-mode={resolvedMode}
      data-inkframe-tint={tint}
      data-inkframe-pointer-capture={capturesPointer ? "true" : "false"}
      data-owner-kind={ownerKind}
      data-owner-id={ownerId}
      data-region={region}
      data-mode={resolvedMode}
      data-pointer-mode={pointerMode}
      data-captures-pointer={capturesPointer ? "true" : "false"}
      data-resource-id={resource?.id}
      data-resource-owner-kind={resource?.ownerKind}
      data-resource-tint={resource?.tint}
      data-resource-source-kind={resource?.sourceKind}
      data-inkframe-resource-id={resource?.id}
      data-inkframe-resource-owner-kind={resource?.ownerKind}
      data-inkframe-resource-tint={resource?.tint}
      data-inkframe-resource-source-kind={resource?.sourceKind}
      data-inkframe-resource-has-visual={resource?.visualObjectUrl ? "true" : "false"}
      data-inkframe-resource-has-restore={resource?.restoreObjectUrl ? "true" : "false"}
      data-inkframe-resource-has-source={resource?.sourceObjectUrl ? "true" : "false"}
      data-tint={tint}
      style={style}
      onPointerDown={handleMaterialPointerDown}
      onPointerMove={handleMaterialPointerMove}
      onPointerUp={handleMaterialPointerUp}
      onPointerCancel={handleMaterialPointerCancel}
      onContextMenu={handleMaterialContextMenu}
    >
      <div aria-hidden="true" className="sk-material-static-layer" data-slot="material-static-layer" style={staticStyle} />
      {ACTIVE_MODES.has(mode) ? (
        <canvas ref={canvasRef} aria-hidden="true" className="sk-material-canvas" data-slot="material-canvas" />
      ) : null}
      {children ? (
        <div className="sk-material-content" data-slot="material-content">
          {children}
        </div>
      ) : null}
    </div>
  )
}
