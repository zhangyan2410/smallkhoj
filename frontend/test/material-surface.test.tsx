import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { renderToStaticMarkup } from "react-dom/server"

import { TaskMaterialSurface } from "../components/inkframe-object-ui"
import { MessageFrame } from "../components/message-frame"
import {
  AppDeskBackground,
  resolveAppDeskMaterialAction,
} from "../components/inkframe/app-desk-background"
import { MaterialSurface } from "../components/inkframe/material-surface"
import type { MaterialResource } from "../components/inkframe/material-resource"
import {
  captureMaterialSurfaceResource,
  shouldMaterialSurfaceCapturePointer,
} from "../components/inkframe/material-surface-lifecycle"

const keptResource: MaterialResource = {
  id: "msg-1-resource",
  ownerKind: "message",
  tint: "paper",
  sourceKind: "ink-only",
  lifecycle: "private",
  visualObjectUrl: "blob:visual",
  restoreObjectUrl: "blob:restore",
  createdAt: 1234,
}

const appDeskResource: MaterialResource = {
  id: "desk-image-resource",
  ownerKind: "app-background",
  tint: "desk",
  sourceKind: "image",
  lifecycle: "private",
  visualObjectUrl: "blob:desk-visual",
  restoreObjectUrl: "blob:desk-restore",
  sourceObjectUrl: "blob:desk-source",
  createdAt: 1235,
}

test("MaterialSurface renders owner, region, mode, tint, and static resource slots", () => {
  const markup = renderToStaticMarkup(
    <MaterialSurface
      ownerKind="message"
      ownerId="msg-1"
      region="chat-main"
      tint="paper"
      mode="static"
      resource={keptResource}
    >
      readable message
    </MaterialSurface>,
  )

  assert.match(markup, /data-slot="material-surface"/)
  assert.match(markup, /data-object="material-surface"/)
  assert.match(markup, /data-inkframe-surface="material"/)
  assert.match(markup, /data-inkframe-owner-kind="message"/)
  assert.match(markup, /data-inkframe-owner-id="msg-1"/)
  assert.match(markup, /data-inkframe-region="chat-main"/)
  assert.match(markup, /data-inkframe-mode="static"/)
  assert.match(markup, /data-inkframe-tint="paper"/)
  assert.match(markup, /data-inkframe-pointer-capture="false"/)
  assert.match(markup, /data-owner-kind="message"/)
  assert.match(markup, /data-owner-id="msg-1"/)
  assert.match(markup, /data-region="chat-main"/)
  assert.match(markup, /data-mode="static"/)
  assert.match(markup, /data-tint="paper"/)
  assert.match(markup, /data-resource-id="msg-1-resource"/)
  assert.match(markup, /data-resource-owner-kind="message"/)
  assert.match(markup, /data-resource-tint="paper"/)
  assert.match(markup, /data-resource-source-kind="ink-only"/)
  assert.match(markup, /data-inkframe-resource-id="msg-1-resource"/)
  assert.match(markup, /data-inkframe-resource-owner-kind="message"/)
  assert.match(markup, /data-inkframe-resource-tint="paper"/)
  assert.match(markup, /data-inkframe-resource-source-kind="ink-only"/)
  assert.match(markup, /data-inkframe-resource-has-visual="true"/)
  assert.match(markup, /data-inkframe-resource-has-restore="true"/)
  assert.match(markup, /data-inkframe-resource-has-source="false"/)
  assert.match(markup, /data-slot="material-static-layer"/)
  assert.match(markup, /background-image:url\(blob:visual\)/)
  assert.match(markup, /data-slot="material-content"/)
  assert.match(markup, /readable message/)
})

test("AppDeskBackground exposes the shell-owned Inkframe background contract", () => {
  const markup = renderToStaticMarkup(<AppDeskBackground />)

  assert.match(markup, /data-inkframe-surface="app-background"/)
  assert.match(markup, /data-inkframe-owner-kind="app-background"/)
  assert.match(markup, /data-inkframe-owner-id="global-desk"/)
  assert.match(markup, /data-inkframe-region="app-background"/)
  assert.match(markup, /data-inkframe-mode="static"/)
  assert.match(markup, /data-inkframe-tint="desk"/)
  assert.match(markup, /data-inkframe-pointer-capture="false"/)
  assert.match(markup, /data-inkframe-background-owner="product-shell"/)
  assert.match(markup, /data-inkframe-background-scope="global-desk"/)
  assert.match(markup, /data-inkframe-resource-owner-kind="app-background"/)
  assert.match(markup, /data-inkframe-resource-tint="desk"/)
  assert.match(markup, /data-inkframe-resource-source-kind="none"/)
  assert.match(markup, /data-material-owner="app-background"/)
  assert.match(markup, /data-material-tint="desk"/)
  assert.match(markup, /data-material-mode="static"/)
  assert.match(markup, /data-material-pointer-mode="none"/)
})

test("AppDeskBackground preserves the desk owner contract with a future image resource", () => {
  const markup = renderToStaticMarkup(<AppDeskBackground defaultResource={appDeskResource} />)

  assert.match(markup, /data-inkframe-owner-kind="app-background"/)
  assert.match(markup, /data-inkframe-owner-id="global-desk"/)
  assert.match(markup, /data-inkframe-region="app-background"/)
  assert.match(markup, /data-inkframe-tint="desk"/)
  assert.match(markup, /data-inkframe-resource-owner-kind="app-background"/)
  assert.match(markup, /data-inkframe-resource-tint="desk"/)
  assert.match(markup, /data-inkframe-resource-source-kind="image"/)
  assert.match(markup, /data-inkframe-background-source-mode="image"/)
  assert.match(markup, /data-inkframe-background-has-visual="true"/)
  assert.match(markup, /data-inkframe-background-has-restore="true"/)
  assert.match(markup, /data-inkframe-background-has-source="true"/)
  assert.match(markup, /data-resource-owner-kind="app-background"/)
  assert.match(markup, /data-resource-tint="desk"/)
  assert.match(markup, /data-resource-source-kind="image"/)
  assert.match(markup, /data-inkframe-resource-has-source="true"/)
  assert.match(markup, /data-material-resource-id="desk-image-resource"/)
  assert.match(markup, /background-image:url\(blob:desk-visual\)/)
})

test("AppDeskBackground exposes an explicit material action contract", () => {
  const expected = [
    ["activate", "active", "none", false],
    ["draw", "active", "draw", true],
    ["water", "active", "water", true],
    ["keep", "keeping", "none", false],
    ["discard", "discarding", "none", false],
    ["static", "static", "none", false],
  ] as const

  for (const [action, mode, pointerMode, capturesPointer] of expected) {
    const resolved = resolveAppDeskMaterialAction(action)

    assert.deepEqual(resolved, { mode, pointerMode })
    assert.equal(
      shouldMaterialSurfaceCapturePointer(resolved.mode, resolved.pointerMode),
      capturesPointer,
      `${action} pointer capture contract changed`,
    )
  }
})

test("AppDeskBackground keeps material resources session-local", () => {
  const source = readFileSync(new URL("../components/inkframe/app-desk-background.tsx", import.meta.url), "utf8")

  assert.match(source, /APP_DESK_MATERIAL_EVENT/)
  assert.match(source, /window\.addEventListener\(APP_DESK_MATERIAL_EVENT/)
  assert.doesNotMatch(source, /localStorage/)
  assert.doesNotMatch(source, /indexedDB/i)
  assert.doesNotMatch(source, /fetch\(/)
})

test("MaterialSurface renders an active canvas only in active material modes", () => {
  const staticMarkup = renderToStaticMarkup(
    <MaterialSurface ownerKind="task" ownerId="task-1" region="task-main" tint="task" mode="static" />,
  )
  const activeMarkup = renderToStaticMarkup(
    <MaterialSurface ownerKind="task" ownerId="task-1" region="task-main" tint="task" mode="active" />,
  )

  assert.doesNotMatch(staticMarkup, /data-slot="material-canvas"/)
  assert.match(activeMarkup, /data-slot="material-canvas"/)
  assert.match(activeMarkup, /aria-hidden="true"/)
})

test("desk material surfaces use clean product paper without vignette or idle darkening", () => {
  const materialSource = readFileSync(new URL("../components/inkframe/material-surface.tsx", import.meta.url), "utf8")
  const appDeskSource = readFileSync(new URL("../components/inkframe/app-desk-background.tsx", import.meta.url), "utf8")
  const chatSource = [
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/message-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/composer.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const engineSource = readFileSync(new URL("../public/inkframe/ink-material-engine.js", import.meta.url), "utf8")
  const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  const appDeskMaterialBlock = globalCss.match(/\.sk-app-desk-material \{[\s\S]*?\n  \}/)?.[0] ?? ""
  const appDeskStaticBlock = globalCss.match(/\.sk-app-desk-static \{[\s\S]*?\n  \}/)?.[0] ?? ""
  const appDeskFibersBlock = globalCss.match(/\.sk-app-desk-fibers \{[\s\S]*?\n  \}/)?.[0] ?? ""
  const chatDeskMaterialLayerBlock = globalCss.match(/\.sk-chat-desk-material-surface \.sk-material-static-layer,[\s\S]*?\n  \}/)?.[0] ?? ""
  const chatDeskStaticBlock = globalCss.match(/\.sk-chat-desk-static \{[\s\S]*?\n  \}/)?.[0] ?? ""

  assert.match(materialSource, /INKFRAME_DESK_PAPER_TINT/)
  assert.match(materialSource, /paperTint\?:\s*MaterialPaperTint/)
  assert.match(materialSource, /vignette\?:\s*number/)
  assert.match(materialSource, /cleanPaper\?:\s*boolean/)
  assert.match(materialSource, /paperTint,/)
  assert.match(materialSource, /vignette,/)
  assert.match(materialSource, /cleanPaper,/)
  assert.match(materialSource, /paperTint:\s*paperTint \?\? \(tint === "desk" \? INKFRAME_DESK_PAPER_TINT : undefined\)/)
  assert.match(materialSource, /vignette:\s*vignette \?\? \(tint === "desk" \? 0 : undefined\)/)
  assert.match(materialSource, /cleanPaper:\s*cleanPaper \?\? tint === "desk"/)
  assert.match(appDeskSource, /paperTint=\{INKFRAME_DESK_PAPER_TINT\}/)
  assert.match(appDeskSource, /vignette=\{0\}/)
  assert.match(appDeskSource, /cleanPaper/)
  assert.match(chatSource, /paperTint=\{INKFRAME_DESK_PAPER_TINT\}/)
  assert.match(chatSource, /vignette=\{0\}/)
  assert.match(chatSource, /cleanPaper/)
  assert.match(engineSource, /uniform sampler2D uInk, uFixed, uWet;[\s\S]*uniform vec3 uPaperTint;/)
  assert.match(engineSource, /uniform bool uCleanPaper;/)
  assert.match(engineSource, /vec3 paper = uPaperTint;/)
  assert.match(engineSource, /if \(!uCleanPaper\) \{[\s\S]*paper -= \(fiber - 0\.5\) \* 0\.05;[\s\S]*paper -= \(tooth - 0\.5\) \* 0\.022;[\s\S]*\}/)
  assert.match(engineSource, /if \(!uCleanPaper\) \{[\s\S]*float wraw = texture\(uWet, vUv\)\.x;[\s\S]*col \*= vec3\(1\.0\) - ws \* vec3\(0\.16, 0\.15, 0\.11\);[\s\S]*\}/)
  assert.match(engineSource, /gl\.uniform3f\(p\.uniforms\.uPaperTint, this\.paperTint\[0\], this\.paperTint\[1\], this\.paperTint\[2\]\)/)
  assert.match(engineSource, /gl\.uniform1i\(p\.uniforms\.uCleanPaper, this\.cleanPaper \? 1 : 0\)/)
  assert.match(appDeskMaterialBlock, /background-image:\s*none;/)
  assert.match(appDeskStaticBlock, /background-image:\s*none;/)
  assert.match(appDeskFibersBlock, /background-image:\s*none;/)
  assert.match(appDeskFibersBlock, /opacity:\s*0;/)
  assert.match(globalCss, /\.sk-app-desk-vignette \{[\s\S]*?background:\s*none;[\s\S]*?opacity:\s*0;/)
  assert.match(chatDeskMaterialLayerBlock, /opacity:\s*1;/)
  assert.match(chatDeskMaterialLayerBlock, /mix-blend-mode:\s*normal;/)
  assert.match(chatDeskStaticBlock, /background-image:\s*none;/)
})

test("MaterialSurface exposes explicit fallback and pointer-capture state", () => {
  const markup = renderToStaticMarkup(
    <MaterialSurface
      ownerKind="app-background"
      ownerId="desk"
      region="app-background"
      tint="desk"
      mode="fallback"
      pointerMode="draw"
    />,
  )

  assert.match(markup, /data-mode="fallback"/)
  assert.match(markup, /data-pointer-mode="draw"/)
  assert.match(markup, /data-captures-pointer="false"/)
})

test("material surface pointer capture is only enabled for active draw or water modes", () => {
  assert.equal(shouldMaterialSurfaceCapturePointer("static", "draw"), false)
  assert.equal(shouldMaterialSurfaceCapturePointer("fallback", "water"), false)
  assert.equal(shouldMaterialSurfaceCapturePointer("active", "none"), false)
  assert.equal(shouldMaterialSurfaceCapturePointer("active", "draw"), true)
  assert.equal(shouldMaterialSurfaceCapturePointer("active", "water"), true)
  assert.equal(shouldMaterialSurfaceCapturePointer("keeping", "water"), false)
  assert.equal(shouldMaterialSurfaceCapturePointer("discarding", "draw"), false)
})

test("captureMaterialSurfaceResource snapshots a canvas into private visual and restore resources", async () => {
  const created: Blob[] = []
  const revoked: string[] = []
  const canvas = {
    toBlob(callback: BlobCallback) {
      callback(new Blob(["kept-ink"], { type: "image/png" }))
    },
  } as HTMLCanvasElement

  const resource = await captureMaterialSurfaceResource({
    canvas,
    ownerKind: "message",
    ownerId: "message-1",
    tint: "paper",
    env: {
      createObjectURL(blob) {
        created.push(blob)
        return `blob:kept-${created.length}`
      },
      revokeObjectURL(url) {
        revoked.push(url)
      },
      now: () => 1234,
    },
  })

  assert.equal(resource.ownerKind, "message")
  assert.equal(resource.tint, "paper")
  assert.equal(resource.sourceKind, "ink-only")
  assert.equal(resource.lifecycle, "private")
  assert.equal(resource.id, "message:message-1:1234")
  assert.equal(resource.visualObjectUrl, "blob:kept-1")
  assert.equal(resource.restoreObjectUrl, "blob:kept-2")
  assert.equal(resource.visualBlob, created[0])
  assert.equal(resource.restoreBlob, created[1])
  assert.deepEqual(revoked, [])
})

test("captureMaterialSurfaceResource fails clearly when canvas snapshot is unavailable", async () => {
  const canvas = {
    toBlob(callback: BlobCallback) {
      callback(null)
    },
  } as HTMLCanvasElement

  await assert.rejects(
    () =>
      captureMaterialSurfaceResource({
        canvas,
        ownerKind: "task",
        ownerId: "task-1",
        tint: "task",
      }),
    /Unable to capture material surface snapshot/,
  )
})

test("MaterialSurface source owns the runtime lifecycle hooks instead of only structural markup", () => {
  const source = readFileSync(new URL("../components/inkframe/material-surface.tsx", import.meta.url), "utf8")

  assert.match(source, /"use client"/)
  assert.match(source, /createInkMaterialSurface/)
  assert.match(source, /restoreMaterialResourceIntoSurface/)
  assert.match(source, /coordinator = materialSurfaceCoordinator/)
  assert.match(source, /coordinator\.activate/)
  assert.match(source, /captureMaterialSurfaceResource/)
  assert.match(source, /discardMaterialResource/)
  assert.match(source, /destroy\(\)/)
})

test("MaterialSurface active pointer handlers call material draw and water APIs", () => {
  const source = readFileSync(new URL("../components/inkframe/material-surface.tsx", import.meta.url), "utf8")

  assert.match(source, /onPointerDown=\{handleMaterialPointerDown\}/)
  assert.match(source, /onPointerMove=\{handleMaterialPointerMove\}/)
  assert.match(source, /onPointerUp=\{handleMaterialPointerUp\}/)
  assert.match(source, /onContextMenu=\{handleMaterialContextMenu\}/)
  assert.match(source, /setPointerCapture/)
  assert.match(source, /runtimeSurfaceRef\.current/)
  assert.match(source, /ensureInkMaterialRuntime/)
  assert.match(source, /surface\.brush\(/)
  assert.match(source, /if \(surface\.stroke\) \{[\s\S]*surface\.stroke\(/)
  assert.match(source, /tool:\s*"pen"/)
  assert.match(source, /surface\.pen\(/)
  assert.match(source, /waterOverride/)
  assert.match(source, /materialRuntimeState\(pointerMode\)/)
  assert.match(source, /pointerMode === "draw" \|\| pointerMode === "water"[\s\S]*?"running"/)
  assert.match(source, /seedMarks:\s*false/)
  assert.match(source, /lastPointerPointRef\.current = canvas \? materialPointerPoint\(event, canvas\) : null/)
  assert.doesNotMatch(source, /lastPointerPointRef\.current = null\s*\n\s*applyMaterialPointer\(event\)/)
  assert.doesNotMatch(source, /radius:\s*44/)
})

test("product material drawing activation does not seed random ink marks", () => {
  const materialSource = readFileSync(new URL("../components/inkframe/material-surface.tsx", import.meta.url), "utf8")
  const wrapperSource = readFileSync(new URL("../components/inkframe/ink-material-engine.tsx", import.meta.url), "utf8")
  const engineSource = readFileSync(new URL("../public/inkframe/ink-material-engine.js", import.meta.url), "utf8")

  assert.match(wrapperSource, /seedMarks\?:\s*boolean/)
  assert.match(wrapperSource, /setState\?:\s*\(state:\s*\{[\s\S]*seedMarks\?:\s*boolean/)
  assert.match(engineSource, /seedMarks:\s*options\.seedMarks !== false/)
  assert.match(materialSource, /createInkMaterialSurface\(activeCanvas,[\s\S]*seedMarks:\s*false/)
})

test("MaterialSurface uses the demo engine y-up pointer coordinate contract", () => {
  const source = readFileSync(new URL("../components/inkframe/material-surface.tsx", import.meta.url), "utf8")

  assert.match(source, /const y = 1 - \(event\.clientY - rect\.top\) \/ height/)
  assert.match(source, /vy:\s*stroke\.dy \* 60/)
})

test("MaterialSurface keeps the demo tool contract instead of a one-button paint rewrite", () => {
  const source = readFileSync(new URL("../components/inkframe/material-surface.tsx", import.meta.url), "utf8")

  assert.match(source, /pointerMode === "draw"/)
  assert.match(source, /pointerMode === "water"/)
  assert.match(source, /event\.shiftKey/)
  assert.match(source, /event\.ctrlKey/)
  assert.match(source, /event\.buttons & 2/)
  assert.match(source, /surface\.brush\(/)
  assert.match(source, /surface\.pen\(/)
  assert.match(source, /const steps = Math\.min\(Math\.max\(Math\.ceil\(stroke\.dist \/ spacing\), 1\), 120\)/)
})

test("product material pen strokes use denser interpolation and product-scale ink", () => {
  const materialSource = readFileSync(new URL("../components/inkframe/material-surface.tsx", import.meta.url), "utf8")
  const wrapperSource = readFileSync(new URL("../components/inkframe/ink-material-engine.tsx", import.meta.url), "utf8")
  const engineSource = readFileSync(new URL("../public/inkframe/ink-material-engine.js", import.meta.url), "utf8")

  assert.match(wrapperSource, /export type InkMaterialParams = Partial<\{[\s\S]*size: number[\s\S]*ink: number/)
  assert.match(wrapperSource, /params\?:\s*InkMaterialParams/)
  assert.match(materialSource, /function materialRuntimeParams\(ownerKind: MaterialOwnerKind\): InkMaterialParams/)
  assert.match(materialSource, /ownerKind === "message"[\s\S]*size:\s*0\.72[\s\S]*ink:\s*1\.05/)
  assert.match(materialSource, /size:\s*0\.82[\s\S]*ink:\s*1\.08/)
  assert.match(materialSource, /params:\s*materialRuntimeParams\(ownerKind\)/)
  assert.match(engineSource, /const spacing = Math\.max\(baseRadius \* \(tool === "brush" \? 0\.45 : 0\.22\), 0\.00025\);/)
  assert.match(engineSource, /const steps = Math\.min\(Math\.max\(Math\.ceil\(dist \/ spacing\), 1\), 180\);/)
  assert.match(engineSource, /const stepSpeed = \(dist \/ Math\.max\(steps, 1\)\) \* 60;/)
  assert.match(engineSource, /speed:\s*stepSpeed/)
})

test("message annotation material is explicitly washable without making all surfaces washable", () => {
  const materialSource = readFileSync(new URL("../components/inkframe/material-surface.tsx", import.meta.url), "utf8")
  const messageFrameSource = readFileSync(new URL("../components/message-frame.tsx", import.meta.url), "utf8")

  assert.match(materialSource, /washableFixedInk\?:\s*boolean/)
  assert.match(materialSource, /washableFixedInk,/)
  assert.match(materialSource, /washableFixedInk,[\s\S]*paperTint:[\s\S]*vignette:[\s\S]*cleanPaper:[\s\S]*\}\)/)
  assert.match(messageFrameSource, /washableFixedInk/)
  assert.match(messageFrameSource, /data-inkframe-purpose="message-annotation"/)
})

test("chat message material actions expose pen water keep and discard controls", () => {
  const source = [
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/message-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/composer.tsx", import.meta.url), "utf8"),
  ].join("\n")

  assert.match(source, /message-material-pen/)
  assert.match(source, /message-material-water/)
  assert.match(source, /message-material-keep/)
  assert.match(source, /message-material-discard/)
  assert.match(source, /setMessageMaterialResources/)
  assert.match(source, /onResourceChange/)
  assert.match(source, /materialPointerMode=\{activeMaterialMessageId === msg\.id \? activeMaterialPointerMode : "none"\}/)
  assert.match(source, /materialPointerMode=\{activeMaterialMessageId === activeRoot\.id \? activeMaterialPointerMode : "none"\}/)
})

test("chat route exposes a separate desk material layer for blank chat workspace areas", () => {
  const source = [
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/message-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/composer.tsx", import.meta.url), "utf8"),
  ].join("\n")

  assert.match(source, /data-slot="chat-desk-material-layer"/)
  assert.match(source, /data-inkframe-purpose="chat-desk-canvas"/)
  assert.match(source, /ownerKind="app-background"/)
  assert.match(source, /ownerId=\{`chat-desk:\$\{channelName\}`\}/)
  assert.match(source, /region="chat-main"/)
  assert.match(source, /tint="desk"/)
  assert.match(source, /chatDeskMaterialMode/)
  assert.match(source, /chatDeskPointerMode/)
})

test("chat desk drawing owns the message list pointer layer while active", () => {
  const source = [
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/message-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/composer.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const messageFrameSource = readFileSync(new URL("../components/message-frame.tsx", import.meta.url), "utf8")

  assert.match(source, /chatDeskPointerForwardingRef/)
  assert.match(source, /forwardChatDeskPointerEvent/)
  assert.match(source, /onPointerDownCapture=\{handleChatDeskPointerDownCapture\}/)
  assert.match(source, /onPointerMoveCapture=\{handleChatDeskPointerMoveCapture\}/)
  assert.match(source, /onPointerUpCapture=\{handleChatDeskPointerUpCapture\}/)
  assert.match(source, /onPointerCancelCapture=\{handleChatDeskPointerUpCapture\}/)
  assert.doesNotMatch(source, /isChatDeskBlankPointerTarget/)
  assert.doesNotMatch(source, /closest\(/)
  assert.match(source, /className=\{`[^`]*pointer-events-auto/)
  assert.match(source, /group\/message relative -mx-2 min-w-0 px-2 py-1\.5 pointer-events-none/)
  assert.match(source, /deskCapturing \? "pointer-events-none" : "pointer-events-auto"/)
  assert.doesNotMatch(source, /sk-chat-message-stack pointer-events-auto/)
  assert.match(messageFrameSource, /w-fit max-w-full/)
})

test("ProductShell icon rail remains fixed and does not push chat or tasks down", () => {
  // P2: the rail moved from product-shell.tsx to components/app-rail.tsx
  const railSource = readFileSync(new URL("../components/app-rail.tsx", import.meta.url), "utf8")
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

  const railClass = railSource.match(/data-slot="tool-spine"[\s\S]*?className="([^"]*)"/)?.[1] ?? ""

  assert.match(railClass, /(?:^|\s)sk-rail(?:\s|$)/)
  assert.match(railClass, /(?:^|\s)z-20(?:\s|$)/)
  assert.doesNotMatch(railClass, /(?:^|\s)relative(?:\s|$)/, "relative overrides .sk-rail fixed positioning")
  assert.match(css, /\.sk-rail\s*\{[\s\S]*?position:\s*fixed;/)
})

test("MaterialSurface styles are token-backed component layer rules", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

  assert.match(css, /\.sk-material-surface\s*\{/)
  assert.match(css, /\.sk-material-static-layer\s*\{/)
  assert.match(css, /\.sk-material-canvas\s*\{/)
  assert.match(css, /\.sk-material-content\s*\{/)
  assert.match(css, /background-color:\s*var\(--paper\)/)
  assert.match(css, /border:\s*2px solid var\(--ink\)/)
  assert.doesNotMatch(css, /\.sk-material-surface[\s\S]*?border-radius:\s*(?:0\.5rem|var\(--radius\)|8px)/)
})

test("MessageFrame can mount a static message material layer without creating an active canvas", () => {
  const markup = renderToStaticMarkup(
    <MessageFrame
      member={{ id: "agent-1", name: "agent-one", kind: "agent", status: "running" }}
      senderType="agent"
      contentLength={180}
      materialSurface={{
        ownerId: "message-1",
        mode: "static",
        resource: keptResource,
      }}
      actions={<button type="button">copy</button>}
    >
      material-backed message
    </MessageFrame>,
  )

  assert.match(markup, /data-slot="message-material-layer"/)
  assert.match(markup, /data-inkframe-object="message"/)
  assert.match(markup, /data-inkframe-density="long"/)
  assert.match(markup, /data-inkframe-surface="material"/)
  assert.match(markup, /data-inkframe-owner-kind="message"/)
  assert.match(markup, /data-owner-kind="message"/)
  assert.match(markup, /data-owner-id="message-1"/)
  assert.match(markup, /data-region="chat-main"/)
  assert.match(markup, /data-mode="static"/)
  assert.match(markup, /data-inkframe-object="message-actions"/)
  assert.match(markup, /data-inkframe-state="toolbar-hidden"/)
  assert.doesNotMatch(markup, /data-slot="material-canvas"/)
  assert.match(markup, /material-backed message/)
})

test("MessageFrame active material layer creates exactly one message canvas", () => {
  const markup = renderToStaticMarkup(
    <MessageFrame
      member={{ id: "agent-1", name: "agent-one", kind: "agent", status: "running" }}
      senderType="agent"
      materialSurface={{
        ownerId: "message-1",
        mode: "active",
        pointerMode: "draw",
      }}
    >
      active material message
    </MessageFrame>,
  )

  assert.equal(markup.match(/data-slot="material-canvas"/g)?.length ?? 0, 1)
  assert.match(markup, /data-captures-pointer="true"/)
  assert.match(markup, /data-slot="message-material-layer"[^>]*data-captures-pointer="true"/)
  assert.match(markup, /data-inkframe-purpose="message-annotation"/)
  assert.match(markup, /sk-message-annotation-surface/)
  assert.match(markup, /data-slot="material-content"/)
})

test("Chat route defaults messages to static material surfaces but exposes one active foreground surface", () => {
  const source = [
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/message-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/composer.tsx", import.meta.url), "utf8"),
  ].join("\n")

  assert.match(source, /activeMaterialMessageId/)
  assert.match(source, /setActiveMaterialMessageId/)
  assert.match(source, /messageMaterialMode\(msg\.id\)/)
  assert.match(source, /materialPointerMode=\{activeMaterialMessageId === msg\.id \? activeMaterialPointerMode : "none"\}/)
  assert.match(source, /data-slot="message-material-pen"/)
  assert.match(source, /data-slot="message-material-water"/)
  assert.match(source, /data-slot="message-material-keep"/)
  assert.match(source, /data-slot="message-material-discard"/)
  assert.match(source, /messageMaterialMode\(activeRoot\.id\)/)
})

test("TaskMaterialSurface can mount a static task material layer without active canvas", () => {
  const markup = renderToStaticMarkup(
    <TaskMaterialSurface status="in_progress" materialSurface={{ ownerId: "task-1", mode: "static" }}>
      task ticket
    </TaskMaterialSurface>,
  )

  assert.match(markup, /data-slot="task-material-layer"/)
  assert.match(markup, /data-inkframe-object="task-ticket"/)
  assert.match(markup, /data-inkframe-state="in_progress"/)
  assert.match(markup, /data-inkframe-surface="material"/)
  assert.match(markup, /data-inkframe-owner-kind="task"/)
  assert.match(markup, /data-owner-kind="task"/)
  assert.match(markup, /data-owner-id="task-1"/)
  assert.match(markup, /data-region="task-main"/)
  assert.match(markup, /data-mode="static"/)
  assert.doesNotMatch(markup, /data-slot="material-canvas"/)
})

test("Task surfaces stay static material objects and do not expose drawing controls", () => {
  const sources = [
    readFileSync(new URL("../components/task-list-panel.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-dnd-board.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-board.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-material-state.tsx", import.meta.url), "utf8"),
  ].join("\n")

  assert.doesNotMatch(sources, /data-slot="task-material-toggle"/)
  assert.doesNotMatch(sources, /activeMaterialTaskId ===/)
  assert.doesNotMatch(sources, /materialActive/)
  assert.doesNotMatch(sources, /pointerMode:\s*[^\n]*"draw"/)
  assert.match(sources, /mode:\s*"static"/)
  assert.match(sources, /pointerMode:\s*"none"/)
})

test("chat and task routes expose mobile proof roles for later twd checks", () => {
  const chatSource = [
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/message-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/composer.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const taskPageSource = [
    readFileSync(new URL("../app/(app)/tasks/page.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-route-projection.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const taskBoardSource = readFileSync(new URL("../components/task-dnd-board.tsx", import.meta.url), "utf8")
  const shellBodySource = readFileSync(new URL("../components/product-shell-body.tsx", import.meta.url), "utf8")
  const taskMaterialStateSource = readFileSync(new URL("../components/task-material-state.tsx", import.meta.url), "utf8")

  for (const role of [
    "chat-workspace",
    "chat-message-list",
    "chat-composer",
    "chat-thread-panel",
    "chat-members-panel",
  ]) {
    assert.match(chatSource, new RegExp(`data-inkframe-mobile-role="${role}"`), `chat should expose ${role}`)
  }

  for (const role of ["task-workspace", "task-controls"]) {
    assert.match(taskPageSource, new RegExp(`data-inkframe-mobile-role="${role}"`), `tasks should expose ${role}`)
  }
  for (const role of ["task-evidence", "task-review"]) {
    assert.match(taskPageSource, new RegExp(`data-inkframe-mobile-role="${role}"`), `tasks should expose ${role}`)
  }
  assert.match(taskMaterialStateSource, /data-inkframe-mobile-role="task-detail"/)
  assert.match(taskBoardSource, /data-inkframe-mobile-role="task-board"/)
  assert.match(shellBodySource, /data-inkframe-mobile-role="sidebar-drawer"/)
  assert.match(shellBodySource, /data-inkframe-state=\{mobileListOpen \? "open" : "collapsed"\}/)
})

test("chat mobile tab strip is horizontally contained instead of widening the header", () => {
  const chatSource = [
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/message-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/composer.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const tabStripMatch = chatSource.match(
    /<div[\s\S]*?data-inkframe-mobile-role="chat-tab-strip"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )

  assert.ok(tabStripMatch, "chat tab strip should expose a stable mobile proof role")
  assert.match(tabStripMatch[1], /(?:^|\s)overflow-x-auto(?:\s|$)/)
  assert.match(tabStripMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(tabStripMatch[1], /(?:^|\s)flex-1(?:\s|$)/)
})

test("chat mobile message and composer surfaces are contained flex regions", () => {
  const chatSource = [
    readFileSync(new URL("../app/(app)/chat/[channel]/channel-client.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/message-list.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../app/(app)/chat/[channel]/composer.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const messageFrameSource = readFileSync(new URL("../components/message-frame.tsx", import.meta.url), "utf8")

  const messageListMatch = chatSource.match(
    /<div ref=\{messageListRef\}[\s\S]*?data-inkframe-mobile-role="chat-message-list"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(messageListMatch, "chat message list should expose the mobile scroll-owner role")
  assert.match(messageListMatch[1], /(?:^|\s)min-h-0(?:\s|$)/)
  assert.match(messageListMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(messageListMatch[1], /(?:^|\s)flex-1(?:\s|$)/)
  assert.match(messageListMatch[1], /(?:^|\s)overflow-hidden(?:\s|$)/)

  const messageScrollMatch = chatSource.match(
    /data-slot="chat-message-scroll"[\s\S]*?className=\{`([^`]*)`\}[\s\S]*?>/,
  )
  assert.ok(messageScrollMatch, "chat message scroll slot should own overflow when the desk canvas is fixed under it")
  assert.match(messageScrollMatch[1], /(?:^|\s)min-h-0(?:\s|$)/)
  assert.match(messageScrollMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(messageScrollMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)
  assert.match(messageScrollMatch[1], /(?:^|\s)overflow-y-auto(?:\s|$)/)

  const messageStackMatch = chatSource.match(
    /data-slot="chat-message-scroll"[\s\S]*?<div className="([^"]*max-w-\[1248px\][^"]*)"[\s\S]*?>/,
  )
  assert.ok(messageStackMatch, "chat message stack should be contained inside the scroll owner")
  assert.match(messageStackMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)

  const frameRootMatch = messageFrameSource.match(/data-slot="message-frame"[\s\S]*?cn\("([^"]*)"/)
  assert.ok(frameRootMatch, "MessageFrame should keep one shared contained root")
  assert.match(frameRootMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)

  const frameBodyMatch = messageFrameSource.match(/<div className=\{cn\("([^"]*)", bodyClassName\)\}>/)
  assert.ok(frameBodyMatch, "MessageFrame body should be the contained flex child")
  assert.match(frameBodyMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(frameBodyMatch[1], /(?:^|\s)flex-1(?:\s|$)/)

  const messageBodyMatch = messageFrameSource.match(
    /<div data-slot="message-body" className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(messageBodyMatch, "MessageFrame message body should suppress horizontal widening")
  assert.match(messageBodyMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(messageBodyMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const paperContentMatch = messageFrameSource.match(
    /<div data-slot="message-paper-content" className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(paperContentMatch, "MessagePaper content should be a contained markdown host")
  assert.match(paperContentMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(paperContentMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const composerMatch = chatSource.match(
    /<div data-region="composer"[\s\S]*?data-inkframe-mobile-role="chat-composer"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(composerMatch, "chat composer should expose the mobile composer region")
  assert.match(composerMatch[1], /(?:^|\s)shrink-0(?:\s|$)/)
  assert.match(composerMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(composerMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const composerSurfaceMatch = chatSource.match(/<ChatComposerSurface className="([^"]*)"[\s\S]*?>/)
  assert.ok(composerSurfaceMatch, "chat composer surface should own the wrapping control row")
  assert.match(composerSurfaceMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(composerSurfaceMatch[1], /(?:^|\s)flex-wrap(?:\s|$)/)
  assert.match(composerSurfaceMatch[1], /(?:^|\s)items-end(?:\s|$)/)

  const mainInputMatch = chatSource.match(/<Input[\s\S]*?name="content"[\s\S]*?className="([^"]*)"[\s\S]*\/>/)
  assert.ok(mainInputMatch, "chat message input should be a contained flex child")
  assert.match(mainInputMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(mainInputMatch[1], /(?:^|\s)flex-1(?:\s|$)/)

  const threadScrollerMatch = chatSource.match(
    /<div className="([^"]*overflow-y-auto[^"]*)"[\s\S]*?>\s*\{activeRoot &&/,
  )
  assert.ok(threadScrollerMatch, "thread message scroller should be a contained scroll region")
  assert.match(threadScrollerMatch[1], /(?:^|\s)min-h-0(?:\s|$)/)
  assert.match(threadScrollerMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(threadScrollerMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const threadComposerMatch = chatSource.match(
    /<div className="([^"]*border-t[^"]*min-w-0[^"]*)"[\s\S]*?>\s*<Input[\s\S]*?value=\{input\}/,
  )
  assert.ok(threadComposerMatch, "thread reply composer should be a contained flex row")
  assert.match(threadComposerMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const threadInputMatch = chatSource.match(/<Input[\s\S]*?placeholder=\{placeholder\}[\s\S]*?className="([^"]*)"[\s\S]*\/>/)
  assert.ok(threadInputMatch, "thread reply input should be a contained flex child")
  assert.match(threadInputMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(threadInputMatch[1], /(?:^|\s)flex-1(?:\s|$)/)
})

test("ProductShell mobile list drawer has a reachable toggle and coupled open state", () => {
  const shellBodySource = readFileSync(new URL("../components/product-shell-body.tsx", import.meta.url), "utf8")

  assert.match(shellBodySource, /const mobileDrawerId = "inkframe-mobile-sidebar-drawer"/)
  assert.match(shellBodySource, /const \[mobileListOpen, setMobileListOpen\] = useState\(false\)/)

  const toggleMatch = shellBodySource.match(
    /<(?:button|Button)[\s\S]*?data-inkframe-mobile-role="sidebar-drawer-toggle"[\s\S]*?<\/(?:button|Button)>/,
  )
  assert.ok(toggleMatch, "mobile drawer toggle should be a reachable button")
  assert.match(toggleMatch[0], /aria-controls=\{mobileDrawerId\}/)
  assert.match(toggleMatch[0], /aria-expanded=\{mobileListOpen\}/)
  assert.match(toggleMatch[0], /sm:hidden/)
  assert.match(toggleMatch[0], /setMobileListOpen\(\(open\) => !open\)/)

  const drawerMatch = shellBodySource.match(
    /<aside[\s\S]*?data-inkframe-mobile-role="sidebar-drawer"[\s\S]*?<\/aside>/,
  )
  assert.ok(drawerMatch, "mobile drawer should remain the ProductShell list aside")
  assert.match(drawerMatch[0], /id=\{mobileDrawerId\}/)
  assert.match(drawerMatch[0], /data-inkframe-state=\{mobileListOpen \? "open" : "collapsed"\}/)
  assert.match(drawerMatch[0], /mobileListOpen \? "[^"]*flex[^"]*" : "hidden"/)
  assert.match(drawerMatch[0], /sm:flex/)
  assert.match(drawerMatch[0], /sm:w-\[var\(--inkframe-list-width\)\]/)
  assert.match(drawerMatch[0], /className="sk-resize-handle/)

  const drawerContentMatch = drawerMatch[0].match(
    /<div[\s\S]*?data-slot="paper-stack-content"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(drawerContentMatch, "drawer content should expose a stable scroll-owner slot")
  assert.match(drawerContentMatch[1], /(?:^|\s)min-h-0(?:\s|$)/)
  assert.match(drawerContentMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(drawerContentMatch[1], /(?:^|\s)flex-1(?:\s|$)/)
  assert.match(drawerContentMatch[1], /(?:^|\s)overflow-y-auto(?:\s|$)/)

  const closeMatch = drawerMatch[0].match(
    /<(?:button|Button)[\s\S]*?data-inkframe-mobile-role="sidebar-drawer-close"[\s\S]*?<\/(?:button|Button)>/,
  )
  assert.ok(closeMatch, "open mobile drawer should expose an in-drawer close control")
  assert.match(closeMatch[0], /aria-controls=\{mobileDrawerId\}/)
  assert.match(closeMatch[0], /setMobileListOpen\(false\)/)
  assert.match(closeMatch[0], /sm:hidden/)
})

test("task board mobile filters, board, cards, list, and overlay are contained", () => {
  const taskPageSource = [
    readFileSync(new URL("../app/(app)/tasks/page.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-route-projection.tsx", import.meta.url), "utf8"),
  ].join("\n")
  const taskDndBoardSource = readFileSync(new URL("../components/task-dnd-board.tsx", import.meta.url), "utf8")
  const taskBoardSource = readFileSync(new URL("../components/task-board.tsx", import.meta.url), "utf8")

  const filterSurfaceMatch = taskPageSource.match(
    /<InkframeObjectSurface[\s\S]*?data-inkframe-mobile-role="task-filters"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(filterSurfaceMatch, "Tasks route should expose a stable mobile filter surface role")
  assert.match(filterSurfaceMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(filterSurfaceMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)
  assert.match(filterSurfaceMatch[1], /(?:^|\s)grid-cols-1(?:\s|$)/)
  assert.match(filterSurfaceMatch[1], /(?:^|\s)sm:grid-cols-2(?:\s|$)/)
  assert.match(filterSurfaceMatch[1], /(?:^|\s)xl:grid-cols-5(?:\s|$)/)

  const filterActionsMatch = taskPageSource.match(
    /data-inkframe-mobile-role="task-filters"[\s\S]*?<div className="([^"]*items-end[^"]*)"[\s\S]*?>/,
  )
  assert.ok(filterActionsMatch, "Task filter actions should stay reachable in a contained row")
  assert.match(filterActionsMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)

  const taskBoardWrapperMatch = taskDndBoardSource.match(
    /<div[\s\S]*?data-inkframe-mobile-role="task-board"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(taskBoardWrapperMatch, "TaskDndBoard should expose a contained task-board wrapper")
  assert.match(taskBoardWrapperMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(taskBoardWrapperMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const taskBoardRootMatch = taskBoardSource.match(
    /const activeTask = activeDragId[\s\S]*?<div data-slot="task-board-root" className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(taskBoardRootMatch, "TaskBoard root should be a contained layout root")
  assert.match(taskBoardRootMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(taskBoardRootMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const boardGridMatch = taskBoardSource.match(/const boardContent = \(\s*<div className=\{`([^`]*)`\}>/)
  assert.ok(boardGridMatch, "TaskBoard board grid should have a source-tested responsive grid contract")
  assert.match(boardGridMatch[1], /(?:^|\s)grid-cols-1(?:\s|$)/)
  assert.match(boardGridMatch[1], /sm:grid-cols-2/)
  assert.match(boardGridMatch[1], /md:grid-cols-3/)
  assert.match(boardGridMatch[1], /xl:grid-cols-5/)
  assert.doesNotMatch(boardGridMatch[1], /(?:^|\s)grid-cols-2(?:\s|$)/)

  const statusColumnMatch = taskBoardSource.match(
    /<section[\s\S]*?className=\{`([^`]*sk-task-status-column[^`]*)`\}[\s\S]*?>/,
  )
  assert.ok(statusColumnMatch, "TaskStatusColumn should own column containment")
  assert.match(statusColumnMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(statusColumnMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const taskStackMatch = taskBoardSource.match(/<div className="([^"]*min-h-\[72px\][^"]*)"[\s\S]*?>/)
  assert.ok(taskStackMatch, "TaskStatusColumn task stack should suppress horizontal overflow")
  assert.match(taskStackMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(taskStackMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const sortableOuterMatch = taskBoardSource.match(/<div ref=\{setNodeRef\} style=\{style\} className="([^"]*)"[\s\S]*?>/)
  assert.ok(sortableOuterMatch, "Sortable task card wrapper should be contained")
  assert.match(sortableOuterMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)

  const sortableButtonMatch = taskBoardSource.match(
    /aria-label=\{`Drag or open task \$\{task\.title\}`\}[\s\S]*?className=\{`([^`]*)`\}/,
  )
  assert.ok(sortableButtonMatch, "Sortable task card interactive surface should be contained")
  assert.match(sortableButtonMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)

  const sortableSurfaceMatch = taskBoardSource.match(
    /<TaskMaterialSurface[\s\S]*?status=\{task\.status\}[\s\S]*?className=\{`([^`]*)`\}/,
  )
  assert.ok(sortableSurfaceMatch, "Sortable task material surface should suppress horizontal widening")
  assert.match(sortableSurfaceMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(sortableSurfaceMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const sortableSourceMatch = taskBoardSource.match(
    /<EvidenceSurface kind="source" className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(sortableSourceMatch, "Task card source chip should be contained")
  assert.match(sortableSourceMatch[1], /(?:^|\s)max-w-full(?:\s|$)/)
  assert.match(sortableSourceMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(sortableSourceMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const listRowMatch = taskBoardSource.match(/role="button"[\s\S]*?className="([^"]*)"[\s\S]*?>\s*<TaskMaterialSurface/)
  assert.ok(listRowMatch, "Task list row should be a contained interactive surface")
  assert.match(listRowMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)

  const listRowSurfaceMatch = taskBoardSource.match(
    /function ListRow[\s\S]*?<TaskMaterialSurface[\s\S]*?className=\{`([^`]*)`\}/,
  )
  assert.ok(listRowSurfaceMatch, "Task list row material surface should suppress horizontal widening")
  assert.match(listRowSurfaceMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(listRowSurfaceMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const dragOverlayMatch = taskBoardSource.match(/<DragOverlay>[\s\S]*?<div className="([^"]*)"[\s\S]*?>/)
  assert.ok(dragOverlayMatch, "Task drag overlay should be contained")
  assert.match(dragOverlayMatch[1], /(?:^|\s)max-w-full(?:\s|$)/)
  assert.match(dragOverlayMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(dragOverlayMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)
})

test("members and computers sidebar entity lists share contained prefab rows", () => {
  const membersListSource = readFileSync(new URL("../app/(app)/members/members-list.tsx", import.meta.url), "utf8")
  const computersPageSource = readFileSync(new URL("../app/(app)/computers/page.tsx", import.meta.url), "utf8")
  const globalCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")

  const membersListMatch = membersListSource.match(
    /<div[\s\S]*?data-inkframe-mobile-role="members-list"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(membersListMatch, "MembersList should expose the contained members-list owner")
  assert.match(membersListMatch[1], /(?:^|\s)min-h-0(?:\s|$)/)
  assert.match(membersListMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(membersListMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const renderItemStart = membersListSource.indexOf("function renderItem(")
  const renderItemEnd = membersListSource.indexOf("function sectionTitle(", renderItemStart)
  assert.ok(renderItemStart >= 0 && renderItemEnd > renderItemStart, "MembersList should keep member row rendering inside renderItem")
  const renderItemSource = membersListSource.slice(renderItemStart, renderItemEnd)
  const memberEntityMatch = renderItemSource.match(
    /<SidebarEntityItem[\s\S]*?data-inkframe-mobile-role="member-entity-item"[\s\S]*?>/,
  )
  assert.ok(memberEntityMatch, "member rows should use the shared SidebarEntityItem prefab")
  assert.match(renderItemSource, /avatar=\{<AvatarObject member=\{member\} size="sm" \/>\}/)
  assert.doesNotMatch(membersListSource, /\bMemberAvatar\b/)
  assert.doesNotMatch(membersListSource, /<MemberNameTag[\s\S]*?data-inkframe-mobile-role="member-entity-item"/)

  const computersListMatch = computersPageSource.match(
    /<div[\s\S]*?data-inkframe-mobile-role="computers-list"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(computersListMatch, "Computers page should expose the contained computers-list owner")
  assert.match(computersListMatch[1], /(?:^|\s)min-h-0(?:\s|$)/)
  assert.match(computersListMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(computersListMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)
  assert.match(computersListMatch[1], /(?:^|\s)overflow-y-auto(?:\s|$)/)

  const computerEntityMatch = computersPageSource.match(
    /function ComputerListRow[\s\S]*?<SidebarEntityItem[\s\S]*?data-inkframe-mobile-role="computer-entity-item"[\s\S]*?>/,
  )
  assert.ok(computerEntityMatch, "computer rows should use the shared SidebarEntityItem prefab")
  assert.match(computerEntityMatch[0], /tone="green"/)
  assert.match(computerEntityMatch[0], /icon=\{<Monitor className="size-4" \/>/)
  assert.doesNotMatch(computerEntityMatch[0], /<ComputerInkstone/)
  assert.match(computersPageSource, /function ComputerDetail[\s\S]*?<ComputerInkstone/)
  assert.match(globalCss, /\.sk-sidebar-entity-item\[data-tone="green"\]\.sk-sidebar-entity-item-active/)
  assert.match(globalCss, /\.sk-sidebar-entity-item\[data-tone="yellow"\]\.sk-sidebar-entity-item-active/)
})

test("member and computer detail surfaces expose contained mobile owners", () => {
  const membersPageSource = readFileSync(new URL("../app/(app)/members/page.tsx", import.meta.url), "utf8")
  const computersPageSource = readFileSync(new URL("../app/(app)/computers/page.tsx", import.meta.url), "utf8")

  const memberDetailMatch = membersPageSource.match(
    /function MemberDetail[\s\S]*?<Card[\s\S]*?data-inkframe-mobile-role="member-detail"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(memberDetailMatch, "MemberDetail should expose a contained member-detail owner")
  assert.match(memberDetailMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(memberDetailMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const memberProfileMatch = membersPageSource.match(
    /function ProfileTab[\s\S]*?<MemberNameTag[\s\S]*?data-inkframe-mobile-role="member-profile"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(memberProfileMatch, "ProfileTab should expose the member-profile object owner")
  assert.match(memberProfileMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(memberProfileMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const memberRuntimeBindingMatch = membersPageSource.match(
    /function ProfileTab[\s\S]*?<ComputerInkstone[\s\S]*?data-inkframe-mobile-role="member-workspace-binding"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(memberRuntimeBindingMatch, "ProfileTab runtime binding should share the contained workspace binding owner")
  assert.match(memberRuntimeBindingMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(memberRuntimeBindingMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const tabBarMatch = membersPageSource.match(
    /function TabBar[\s\S]*?<div[\s\S]*?data-inkframe-mobile-role="member-tab-bar"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(tabBarMatch, "member tab bar should expose a contained horizontal owner")
  assert.match(tabBarMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(tabBarMatch[1], /(?:^|\s)overflow-x-auto(?:\s|$)/)

  const permissionEntryMatches = membersPageSource.match(/data-inkframe-mobile-role="member-permission-entry"/g) ?? []
  assert.ok(permissionEntryMatches.length >= 2, "permission and action rows should share a source role")
  assert.match(membersPageSource, /data-inkframe-mobile-role="member-permission-entry"[\s\S]*?className="[^"]*min-w-0[^"]*overflow-x-hidden/)

  const addPermissionFormSource = membersPageSource.match(/function AddPermissionForm[\s\S]*?function DmTab/)
  assert.ok(addPermissionFormSource, "AddPermissionForm should keep its add rows in one source-owned block")
  const addEntryRows = addPermissionFormSource[0].match(/<form action=\{addPermissionEntryAction\} className="([^"]*)"/g) ?? []
  assert.equal(addEntryRows.length, 2, "permission and action add rows should both be contained")
  for (const row of addEntryRows) {
    const className = row.match(/className="([^"]*)"/)?.[1] ?? ""
    assert.match(className, /(?:^|\s)min-w-0(?:\s|$)/)
    assert.match(className, /(?:^|\s)flex-wrap(?:\s|$)/)
    assert.match(className, /(?:^|\s)overflow-x-hidden(?:\s|$)/)
  }
  assert.match(addPermissionFormSource[0], /<Input name="key"[\s\S]*?className="[^"]*min-w-0[^"]*flex-1/)
  assert.match(addPermissionFormSource[0], /<Select id="permission-entry-value"[\s\S]*?className="[^"]*shrink-0/)
  assert.match(addPermissionFormSource[0], /<Select id="action-entry-value"[\s\S]*?className="[^"]*shrink-0/)

  const workspaceBindingMatch = membersPageSource.match(
    /function WorkspaceTab[\s\S]*?data-inkframe-mobile-role="member-workspace-binding"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(workspaceBindingMatch, "member workspace binding should expose a contained owner")
  assert.match(workspaceBindingMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(workspaceBindingMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const computerDetailMatch = computersPageSource.match(
    /function ComputerDetail[\s\S]*?<div[\s\S]*?data-inkframe-mobile-role="computer-detail"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(computerDetailMatch, "ComputerDetail should expose a contained computer-detail owner")
  assert.match(computerDetailMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(computerDetailMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const lifecycleMatch = computersPageSource.match(
    /data-inkframe-mobile-role="computer-lifecycle"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(lifecycleMatch, "computer lifecycle controls should expose a contained owner")
  assert.match(lifecycleMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(lifecycleMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const reconnectMatch = computersPageSource.match(
    /data-inkframe-mobile-role="computer-reconnect-command"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(reconnectMatch, "reconnect command should expose a contained proof surface")
  assert.match(reconnectMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(reconnectMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const workspaceListMatch = computersPageSource.match(
    /data-inkframe-mobile-role="computer-workspace-list"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(workspaceListMatch, "computer workspace list should expose a contained owner")
  assert.match(workspaceListMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(workspaceListMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const workspaceRowMatch = computersPageSource.match(
    /data-inkframe-mobile-role="computer-workspace-row"[\s\S]*?className="([^"]*)"/,
  )
  assert.ok(workspaceRowMatch, "workspace rows should expose contained row owners")
  assert.match(workspaceRowMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(workspaceRowMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)
})

test("task mobile detail dialog contains material detail, evidence, and review surfaces", () => {
  const taskDialogSource = readFileSync(new URL("../components/task-detail-dialog.tsx", import.meta.url), "utf8")
  const taskMaterialStateSource = readFileSync(new URL("../components/task-material-state.tsx", import.meta.url), "utf8")
  const taskPageSource = [
    readFileSync(new URL("../app/(app)/tasks/page.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../components/task-route-projection.tsx", import.meta.url), "utf8"),
  ].join("\n")

  const dialogContentMatch = taskDialogSource.match(
    /<DialogContent[\s\S]*?data-inkframe-mobile-role="task-detail-dialog"[\s\S]*?className="([^"]*)"[\s\S]*?>/,
  )
  assert.ok(dialogContentMatch, "TaskDetailDialog should expose a stable mobile detail dialog role")
  assert.match(dialogContentMatch[1], /(?:^|\s)w-\[calc\(100vw-1rem\)\](?:\s|$)/)
  assert.match(dialogContentMatch[1], /(?:^|\s)max-w-4xl(?:\s|$)/)
  assert.match(dialogContentMatch[1], /(?:^|\s)max-h-\[calc\(100svh-1rem\)\](?:\s|$)/)
  assert.match(dialogContentMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)
  assert.match(dialogContentMatch[1], /(?:^|\s)overflow-y-auto(?:\s|$)/)
  assert.match(dialogContentMatch[1], /(?:^|\s)p-3(?:\s|$)/)
  assert.match(dialogContentMatch[1], /(?:^|\s)sm:p-6(?:\s|$)/)

  const detailFrameMatch = taskMaterialStateSource.match(
    /<TaskMaterialSurface[\s\S]*?data-inkframe-mobile-role="task-detail"[\s\S]*?className=\{cn\("([^"]*)"/,
  )
  assert.ok(detailFrameMatch, "TaskRouteDetailMaterialFrame should own the task detail containment class")
  assert.match(detailFrameMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  assert.match(detailFrameMatch[1], /(?:^|\s)overflow-x-hidden(?:\s|$)/)

  const evidenceFormMatch = taskPageSource.match(
    /<div data-inkframe-mobile-role="task-evidence"[\s\S]*?<form[\s\S]*?<\/form>/,
  )
  assert.ok(evidenceFormMatch, "task evidence region should include its form in the mobile contract")
  const evidenceRowMatch = evidenceFormMatch[0].match(/<div className="([^"]*flex[^"]*gap-2[^"]*)"[\s\S]*?>/)
  assert.ok(evidenceRowMatch, "task evidence entry row should be a contained flex row")
  assert.match(evidenceRowMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)

  const evidencePathInputMatch = evidenceFormMatch[0].match(
    /<Input name="entryPath"[\s\S]*?className="([^"]*)"[\s\S]*\/>/,
  )
  assert.ok(evidencePathInputMatch, "task evidence path input should be contained")
  assert.match(evidencePathInputMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
  const evidenceContentInputMatch = evidenceFormMatch[0].match(
    /<Input name="entryContent"[\s\S]*?className="([^"]*)"[\s\S]*\/>/,
  )
  assert.ok(evidenceContentInputMatch, "task evidence content input should be contained")
  assert.match(evidenceContentInputMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)

  const reviewMatch = taskPageSource.match(
    /<EvidenceSurface kind="review"[\s\S]*?data-inkframe-mobile-role="task-review"[\s\S]*?<\/EvidenceSurface>/,
  )
  assert.ok(reviewMatch, "task review region should expose its mobile proof role")
  const reviewInputMatch = reviewMatch[0].match(/<Input name="reviewNote"[\s\S]*?className="([^"]*)"[\s\S]*\/>/)
  assert.ok(reviewInputMatch, "task review note input should be contained")
  assert.match(reviewInputMatch[1], /(?:^|\s)min-w-0(?:\s|$)/)
})
