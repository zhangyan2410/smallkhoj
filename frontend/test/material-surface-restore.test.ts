import assert from "node:assert/strict"
import test from "node:test"

import type { InkMaterialSurface } from "../components/inkframe/ink-material-engine"
import type { MaterialResource } from "../components/inkframe/material-resource"
import {
  createMaterialRestoreToken,
  restoreMaterialResourceIntoSurface,
} from "../components/inkframe/material-surface-restore"

const image = {} as CanvasImageSource
type RestoreSurface = Pick<InkMaterialSurface, "loadImage" | "bakeSource">

function privateResource(patch: Partial<MaterialResource> = {}): MaterialResource {
  return {
    id: "resource-1",
    ownerKind: "message",
    tint: "paper",
    sourceKind: "ink-only",
    lifecycle: "private",
    createdAt: 1,
    ...patch,
  }
}

test("restoreMaterialResourceIntoSurface bakes restore before loading source color", async () => {
  const calls: string[] = []
  const surface: RestoreSurface = {
    loadImage() {
      calls.push("load")
    },
    bakeSource(options?: { density?: number; wet?: number }) {
      calls.push(`bake:${options?.density}:${options?.wet}`)
    },
  }
  const resource = privateResource({
    restoreObjectUrl: "blob:restore",
    sourceObjectUrl: "blob:source",
  })

  const restored = await restoreMaterialResourceIntoSurface({
    surface,
    resource,
    token: createMaterialRestoreToken(),
    loadImage: async (url) => {
      calls.push(`image:${url}`)
      return image
    },
    bake: { density: 0.8, wet: 0.1 },
  })

  assert.equal(restored, true)
  assert.deepEqual(calls, [
    "image:blob:restore",
    "load",
    "bake:0.8:0.1",
    "image:blob:source",
    "load",
  ])
})

test("restoreMaterialResourceIntoSurface skips shared/default resources with no restore url", async () => {
  const calls: string[] = []
  const restored = await restoreMaterialResourceIntoSurface({
    surface: {
      loadImage() {
        calls.push("load")
      },
      bakeSource() {
        calls.push("bake")
      },
    } satisfies RestoreSurface,
    resource: privateResource(),
    token: createMaterialRestoreToken(),
    loadImage: async () => image,
  })

  assert.equal(restored, false)
  assert.deepEqual(calls, [])
})

test("restore token cancels stale async image restore before baking", async () => {
  const calls: string[] = []
  const token = createMaterialRestoreToken()
  const restorePromise = restoreMaterialResourceIntoSurface({
    surface: {
      loadImage() {
        calls.push("load")
      },
      bakeSource() {
        calls.push("bake")
      },
    } satisfies RestoreSurface,
    resource: privateResource({ restoreObjectUrl: "blob:restore" }),
    token,
    loadImage: async (url) => {
      calls.push(`image:${url}`)
      token.cancel()
      return image
    },
  })

  assert.equal(await restorePromise, false)
  assert.deepEqual(calls, ["image:blob:restore"])
})
