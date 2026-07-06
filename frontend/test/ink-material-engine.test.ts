import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import test from "node:test"

import {
  InkMaterialRuntimeScript,
  createInkMaterialSurface,
  getInkMaterialRuntime,
  inkMaterialEngineScriptPath,
  isInkMaterialRuntimeReady,
} from "../components/inkframe/ink-material-engine"

test("product ink material engine asset is served outside Trellis evidence", () => {
  const asset = new URL("../public/inkframe/ink-material-engine.js", import.meta.url)

  assert.equal(inkMaterialEngineScriptPath, "/inkframe/ink-material-engine.js")
  assert.equal(existsSync(asset), true)

  const source = readFileSync(asset, "utf8")
  assert.match(source, /window\.InkMaterial/)
  assert.match(source, /create\(canvas,\s*options/)
  assert.match(source, /isWebGL2Available/)
  assert.match(source, /loadImage\(img\)/)
  assert.match(source, /bakeSource/)
})

test("ink material runtime lookup is explicit and SSR safe", () => {
  assert.equal(getInkMaterialRuntime(), null)
  assert.equal(isInkMaterialRuntimeReady(), false)
  assert.equal(isInkMaterialRuntimeReady({}), false)
  assert.equal(isInkMaterialRuntimeReady({ InkMaterial: { create: "bad" } }), false)

  const runtime = {
    create() {
      return { clear() {}, destroy() {} }
    },
    isWebGL2Available() {
      return true
    },
  }

  assert.equal(isInkMaterialRuntimeReady({ InkMaterial: runtime }), true)
  assert.equal(getInkMaterialRuntime({ InkMaterial: runtime }), runtime)
})

test("createInkMaterialSurface delegates to the loaded runtime", () => {
  const calls: Array<{ canvas: HTMLCanvasElement; quality?: string; ownerKind?: string }> = []
  const canvas = {} as HTMLCanvasElement
  const surface = { clear() {}, destroy() {} }
  const runtime = {
    create(inputCanvas: HTMLCanvasElement, options?: { quality?: string; ownerKind?: string }) {
      calls.push({ canvas: inputCanvas, quality: options?.quality, ownerKind: options?.ownerKind })
      return surface
    },
    isWebGL2Available() {
      return true
    },
  }

  assert.equal(
    createInkMaterialSurface(canvas, { quality: "low", ownerKind: "message" }, { InkMaterial: runtime }),
    surface,
  )
  assert.deepEqual(calls, [{ canvas, quality: "low", ownerKind: "message" }])
  assert.throws(() => createInkMaterialSurface(canvas, undefined, {}), /Ink material runtime is not loaded/)
})

test("InkMaterialRuntimeScript exposes the product engine asset for app surfaces", () => {
  const source = readFileSync(new URL("../components/inkframe/ink-material-engine.tsx", import.meta.url), "utf8")

  assert.equal(typeof InkMaterialRuntimeScript, "function")
  assert.match(source, /from "next\/script"/)
  assert.match(source, /src=\{inkMaterialEngineScriptPath\}/)
  assert.match(source, /strategy="afterInteractive"/)
})

test("product engine exposes explicit washable fixed-ink behavior for annotation surfaces", () => {
  const moduleSource = readFileSync(new URL("../components/inkframe/ink-material-engine.tsx", import.meta.url), "utf8")
  const assetSource = readFileSync(new URL("../public/inkframe/ink-material-engine.js", import.meta.url), "utf8")

  assert.match(moduleSource, /washableFixedInk\?:\s*boolean/)
  assert.match(assetSource, /this\.washableFixedInk\s*=/)
  assert.match(assetSource, /this\.renderMode === "live" \|\| this\.washableFixedInk/)
  assert.match(assetSource, /recentBrush\) \? 1\.5 : preset\.fixedLift/)
})
