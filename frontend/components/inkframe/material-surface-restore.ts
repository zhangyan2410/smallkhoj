import type { InkMaterialSurface } from "./ink-material-engine"
import type { MaterialResource } from "./material-resource"

export type MaterialRestoreToken = {
  readonly id: number
  readonly active: boolean
  cancel: () => void
}

export type MaterialImageLoader = (url: string) => Promise<CanvasImageSource>

export type MaterialSurfaceRestoreInput = {
  surface: Pick<InkMaterialSurface, "loadImage" | "bakeSource">
  resource: MaterialResource | null | undefined
  token: MaterialRestoreToken
  loadImage: MaterialImageLoader
  bake?: { density?: number; wet?: number }
}

let nextRestoreTokenId = 1

export function createMaterialRestoreToken(): MaterialRestoreToken {
  let active = true
  const token = {
    id: nextRestoreTokenId++,
    get active() {
      return active
    },
    cancel() {
      active = false
    },
  }
  return token
}

export async function restoreMaterialResourceIntoSurface({
  surface,
  resource,
  token,
  loadImage,
  bake,
}: MaterialSurfaceRestoreInput): Promise<boolean> {
  const restoreUrl = resource?.restoreObjectUrl
  if (!restoreUrl || !surface.loadImage || !surface.bakeSource) return false

  const restoreImage = await loadImage(restoreUrl)
  if (!token.active) return false

  surface.loadImage(restoreImage)
  surface.bakeSource(bake)

  const sourceUrl = resource?.sourceObjectUrl
  if (sourceUrl) {
    const sourceImage = await loadImage(sourceUrl)
    if (!token.active) return false
    surface.loadImage(sourceImage)
  }

  return token.active
}
