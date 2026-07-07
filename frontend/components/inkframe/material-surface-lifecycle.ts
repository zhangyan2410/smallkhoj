import {
  createMaterialResource,
  type MaterialOwnerKind,
  type MaterialResource,
  type MaterialResourceUrlEnv,
  defaultMaterialResourceUrlEnv,
} from "./material-resource"
import type { MaterialPointerMode, MaterialSurfaceMode } from "./material-surface"

export type CaptureMaterialSurfaceResourceInput = {
  canvas: HTMLCanvasElement
  ownerKind: MaterialOwnerKind
  ownerId: string
  tint: MaterialResource["tint"]
  env?: MaterialResourceUrlEnv
  type?: string
  quality?: number
}

export function shouldMaterialSurfaceCapturePointer(
  mode: MaterialSurfaceMode,
  pointerMode: MaterialPointerMode,
): boolean {
  if (pointerMode === "none") return false
  return mode === "active" && (pointerMode === "draw" || pointerMode === "water")
}

export function canvasToMaterialBlob(
  canvas: HTMLCanvasElement,
  type = "image/png",
  quality?: number,
): Promise<Blob> {
  if (typeof canvas.toBlob !== "function") {
    return Promise.reject(new Error("Unable to capture material surface snapshot: canvas.toBlob is unavailable"))
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to capture material surface snapshot"))
          return
        }
        resolve(blob)
      },
      type,
      quality,
    )
  })
}

export async function captureMaterialSurfaceResource({
  canvas,
  ownerKind,
  ownerId,
  tint,
  env = defaultMaterialResourceUrlEnv,
  type,
  quality,
}: CaptureMaterialSurfaceResourceInput): Promise<MaterialResource> {
  const snapshot = await canvasToMaterialBlob(canvas, type, quality)
  const now = env.now?.() ?? Date.now()

  return createMaterialResource(
    {
      id: `${ownerKind}:${ownerId}:${now}`,
      ownerKind,
      tint,
      sourceKind: "ink-only",
      visualBlob: snapshot,
      restoreBlob: snapshot,
    },
    {
      ...env,
      now: () => now,
    },
  )
}
