import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  createMaterialResource,
  discardMaterialResource,
  replaceMaterialResource,
  revokeMaterialResource,
  type MaterialResourceUrlEnv,
} from "../components/inkframe/material-resource"

function urlEnv(): MaterialResourceUrlEnv & { revoked: string[] } {
  let seq = 0
  const revoked: string[] = []
  return {
    createObjectURL: () => `blob:test-${++seq}`,
    revokeObjectURL: (url) => {
      revoked.push(url)
    },
    now: () => 1234,
    revoked,
  }
}

test("createMaterialResource builds visual restore and source urls with owner metadata", () => {
  const env = urlEnv()
  const visualBlob = new Blob(["visual"])
  const restoreBlob = new Blob(["restore"])
  const sourceBlob = new Blob(["source"])

  const resource = createMaterialResource(
    {
      id: "msg-1-keep",
      ownerKind: "message",
      tint: "paper",
      sourceKind: "image",
      visualBlob,
      restoreBlob,
      sourceBlob,
    },
    env,
  )

  assert.equal(resource.id, "msg-1-keep")
  assert.equal(resource.ownerKind, "message")
  assert.equal(resource.tint, "paper")
  assert.equal(resource.sourceKind, "image")
  assert.equal(resource.lifecycle, "private")
  assert.equal(resource.createdAt, 1234)
  assert.equal(resource.visualBlob, visualBlob)
  assert.equal(resource.restoreBlob, restoreBlob)
  assert.equal(resource.sourceBlob, sourceBlob)
  assert.equal(resource.visualObjectUrl, "blob:test-1")
  assert.equal(resource.restoreObjectUrl, "blob:test-2")
  assert.equal(resource.sourceObjectUrl, "blob:test-3")
})

test("revokeMaterialResource revokes each private object url once", () => {
  const env = urlEnv()
  const resource = createMaterialResource(
    {
      id: "task-1",
      ownerKind: "task",
      tint: "task",
      sourceKind: "image",
      visualBlob: new Blob(["same"]),
      restoreBlob: new Blob(["restore"]),
      sourceBlob: new Blob(["same"]),
    },
    env,
  )
  resource.sourceObjectUrl = resource.visualObjectUrl

  const revoked = revokeMaterialResource(resource, env)

  assert.equal(revoked, 2)
  assert.deepEqual(env.revoked, ["blob:test-1", "blob:test-2"])
})

test("shared material resources are not revoked while still used as defaults", () => {
  const env = urlEnv()
  const shared = createMaterialResource(
    {
      id: "shared-paper",
      ownerKind: "message",
      tint: "paper",
      sourceKind: "generated",
      lifecycle: "shared",
      visualBlob: new Blob(["paper"]),
    },
    env,
  )

  assert.equal(revokeMaterialResource(shared, env), 0)
  assert.deepEqual(env.revoked, [])
})

test("replaceMaterialResource revokes the old private resource but keeps the new one", () => {
  const env = urlEnv()
  const oldResource = createMaterialResource(
    {
      id: "old",
      ownerKind: "evidence",
      tint: "evidence",
      sourceKind: "ink-only",
      visualBlob: new Blob(["old"]),
    },
    env,
  )
  const nextResource = createMaterialResource(
    {
      id: "next",
      ownerKind: "evidence",
      tint: "evidence",
      sourceKind: "ink-only",
      visualBlob: new Blob(["next"]),
    },
    env,
  )

  const result = replaceMaterialResource(oldResource, nextResource, env)

  assert.equal(result, nextResource)
  assert.deepEqual(env.revoked, ["blob:test-1"])
})

test("discardMaterialResource revokes current private resource and returns the shared fallback", () => {
  const env = urlEnv()
  const shared = createMaterialResource(
    {
      id: "shared-desk",
      ownerKind: "app-background",
      tint: "desk",
      sourceKind: "generated",
      lifecycle: "shared",
      visualBlob: new Blob(["desk"]),
    },
    env,
  )
  const current = createMaterialResource(
    {
      id: "private-desk",
      ownerKind: "app-background",
      tint: "desk",
      sourceKind: "ink-only",
      visualBlob: new Blob(["ink"]),
      restoreBlob: new Blob(["restore"]),
    },
    env,
  )

  const result = discardMaterialResource(current, shared, env)

  assert.equal(result, shared)
  assert.deepEqual(env.revoked, ["blob:test-2", "blob:test-3"])
})

test("app background image resources preserve desk owner tint and separated channels", () => {
  const env = urlEnv()
  const visualBlob = new Blob(["desk visual color"], { type: "image/png" })
  const restoreBlob = new Blob(["desk restore marks"], { type: "image/png" })
  const sourceBlob = new Blob(["desk source image"], { type: "image/png" })

  const current = createMaterialResource(
    {
      id: "desk-image-keep",
      ownerKind: "app-background",
      tint: "desk",
      sourceKind: "image",
      visualBlob,
      restoreBlob,
      sourceBlob,
    },
    env,
  )
  const fallback = createMaterialResource(
    {
      id: "shared-dry-desk",
      ownerKind: "app-background",
      tint: "desk",
      sourceKind: "generated",
      lifecycle: "shared",
      visualBlob: new Blob(["shared dry paper"], { type: "image/png" }),
    },
    env,
  )

  assert.equal(current.ownerKind, "app-background")
  assert.equal(current.tint, "desk")
  assert.equal(current.sourceKind, "image")
  assert.equal(current.visualBlob, visualBlob)
  assert.equal(current.restoreBlob, restoreBlob)
  assert.equal(current.sourceBlob, sourceBlob)
  assert.equal(current.visualObjectUrl, "blob:test-1")
  assert.equal(current.restoreObjectUrl, "blob:test-2")
  assert.equal(current.sourceObjectUrl, "blob:test-3")
  assert.notEqual(current.visualObjectUrl, current.restoreObjectUrl)
  assert.notEqual(current.visualObjectUrl, current.sourceObjectUrl)
  assert.notEqual(current.restoreObjectUrl, current.sourceObjectUrl)

  const discarded = discardMaterialResource(current, fallback, env)

  assert.equal(discarded, fallback)
  assert.equal(discarded.ownerKind, "app-background")
  assert.equal(discarded.tint, "desk")
  assert.deepEqual(env.revoked, ["blob:test-1", "blob:test-2", "blob:test-3"])
})

test("material resources register private urls for pagehide cleanup without revoking shared defaults", () => {
  const source = readFileSync(new URL("../components/inkframe/material-resource.ts", import.meta.url), "utf8")

  assert.match(source, /trackedPrivateResources/)
  assert.match(source, /pagehide/)
  assert.match(source, /flushMaterialResourcePageLifecycle/)
  assert.match(source, /resource\.lifecycle === "shared"/)
})
