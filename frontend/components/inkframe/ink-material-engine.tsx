import Script from "next/script"

import type { MaterialOwnerKind, MaterialResource } from "./material-resource"

export const inkMaterialEngineScriptPath = "/inkframe/ink-material-engine.js"

export function InkMaterialRuntimeScript() {
  return <Script id="ink-material-engine" src={inkMaterialEngineScriptPath} strategy="afterInteractive" />
}

export type InkMaterialQuality = "low" | "medium" | "high"
export type InkMaterialTool = "pen" | "brush"
export type InkMaterialPreset = "reference" | "productDryPen" | "demoVisible"
export type InkMaterialWaterStyle = "swirl" | "still" | "wash" | "splash" | "dew"
export type InkMaterialState = "idle" | "think" | "running" | "review" | "done" | "blocked"
export type InkMaterialParams = Partial<{
  size: number
  flow: number
  bleed: number
  dry: number
  ink: number
  penWet: number
  brushInk: number
  swirl: number
  vortex: number
  color: number
}>

export type InkMaterialMark = {
  x: number
  y: number
  radius?: number
  strength?: number
  pressure?: number
  speed?: number
  vx?: number
  vy?: number
}

export type InkMaterialStrokePoint = {
  x: number
  y: number
  pressure?: number
  speed?: number
}

export type InkMaterialSurfaceOptions = {
  quality?: InkMaterialQuality
  ownerKind?: MaterialOwnerKind
  tint?: MaterialResource["tint"]
  preset?: InkMaterialPreset
  waterStyle?: InkMaterialWaterStyle
  state?: InkMaterialState
  seed?: string
  params?: InkMaterialParams
  renderMode?: "fluid" | "inkify" | "live"
  washableFixedInk?: boolean
  paperTint?: readonly [number, number, number]
  vignette?: number
  cleanPaper?: boolean
  seedMarks?: boolean
}

export type InkMaterialSurface = {
  setState?: (state: { state?: InkMaterialState; preset?: InkMaterialPreset; seed?: string; seedMarks?: boolean }) => void
  setPreset?: (preset: InkMaterialPreset) => void
  setSeed?: (seed: string) => void
  setQuality?: (quality: InkMaterialQuality) => void
  pen: (mark: InkMaterialMark) => void
  brush: (mark: InkMaterialMark) => void
  stroke?: (points: InkMaterialStrokePoint[], options?: { tool?: InkMaterialTool }) => void
  inject?: (mark: InkMaterialMark & { kind?: "ink" | "water" }) => void
  injectInk?: (mark: InkMaterialMark) => void
  injectWater?: (mark: InkMaterialMark) => void
  fix?: (strength?: number) => void
  seedMarks?: (kind: InkMaterialState, count: number) => void
  loadImage?: (image: CanvasImageSource) => void
  bakeSource?: (options?: { density?: number; wet?: number }) => void
  clear: () => void
  pause?: () => void
  resume?: () => void
  destroy: () => void
  getState?: () => unknown
}

export type InkMaterialRuntime = {
  create: (canvas: HTMLCanvasElement, options?: InkMaterialSurfaceOptions) => InkMaterialSurface
  isWebGL2Available?: () => boolean
}

export type InkMaterialWindow = Window & {
  InkMaterial?: unknown
}

function defaultInkMaterialWindow(): Partial<InkMaterialWindow> {
  return globalThis as unknown as Partial<InkMaterialWindow>
}

export function getInkMaterialRuntime(target: Partial<InkMaterialWindow> = defaultInkMaterialWindow()) {
  const runtime = target.InkMaterial
  return isInkMaterialRuntime(runtime) ? runtime : null
}

export function isInkMaterialRuntimeReady(
  target: Partial<InkMaterialWindow> = defaultInkMaterialWindow(),
): boolean {
  return getInkMaterialRuntime(target) !== null
}

export function isInkMaterialRuntime(runtime: unknown): runtime is InkMaterialRuntime {
  if (!runtime || typeof runtime !== "object") return false
  const candidate = runtime as Partial<InkMaterialRuntime>
  return typeof candidate.create === "function"
}

export function canUseInkMaterialRuntime(
  target: Partial<InkMaterialWindow> = defaultInkMaterialWindow(),
): boolean {
  const runtime = getInkMaterialRuntime(target)
  if (!runtime) return false
  return runtime.isWebGL2Available?.() ?? true
}

export function ensureInkMaterialRuntime(
  target: Partial<InkMaterialWindow> = defaultInkMaterialWindow(),
  timeoutMs = 5000,
): Promise<boolean> {
  if (canUseInkMaterialRuntime(target)) return Promise.resolve(true)
  if (typeof document === "undefined") return Promise.resolve(false)

  const scriptId = "ink-material-engine"
  const existing = document.getElementById(scriptId) as HTMLScriptElement | null
  const script = existing ?? document.createElement("script")

  if (!existing) {
    script.id = scriptId
    script.src = inkMaterialEngineScriptPath
    script.async = true
    document.head.appendChild(script)
  } else if (!script.src) {
    script.src = inkMaterialEngineScriptPath
  }

  return new Promise((resolve) => {
    const startedAt = Date.now()
    let timer: number | null = null

    function cleanup() {
      if (timer !== null) window.clearInterval(timer)
      script.removeEventListener("load", check)
      script.removeEventListener("error", fail)
    }

    function check() {
      if (canUseInkMaterialRuntime(target)) {
        cleanup()
        resolve(true)
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        cleanup()
        resolve(false)
      }
    }

    function fail() {
      cleanup()
      resolve(false)
    }

    script.addEventListener("load", check)
    script.addEventListener("error", fail, { once: true })
    timer = window.setInterval(check, 100)
    check()
  })
}

export function createInkMaterialSurface(
  canvas: HTMLCanvasElement,
  options?: InkMaterialSurfaceOptions,
  target: Partial<InkMaterialWindow> = defaultInkMaterialWindow(),
): InkMaterialSurface {
  const runtime = getInkMaterialRuntime(target)
  if (!runtime) throw new Error(`Ink material runtime is not loaded from ${inkMaterialEngineScriptPath}`)
  return runtime.create(canvas, options)
}
