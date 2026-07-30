import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { fileURLToPath } from "node:url"

import {
  betterAuthPool,
  parseBetterAuthDatabasePoolSize,
} from "../lib/auth"

const authSource = readFileSync(
  fileURLToPath(new URL("../lib/auth.ts", import.meta.url)),
  "utf8",
)

test("Better Auth uses one process-global pool with an explicit validated maximum", () => {
  assert.match(authSource, /BETTER_AUTH_DATABASE_POOL_SIZE/)
  assert.match(authSource, /__smallkhojBetterAuthPostgresPool/)
  assert.match(authSource, /new Pool\(\{[\s\S]*?max:\s*betterAuthDatabasePoolSize/)
  assert.match(authSource, /Number\.isSafeInteger/)
})

test("Better Auth parses only safe positive integer pool sizes", () => {
  assert.equal(parseBetterAuthDatabasePoolSize(undefined), 10)
  assert.equal(parseBetterAuthDatabasePoolSize(""), 10)
  assert.equal(parseBetterAuthDatabasePoolSize(" 7 "), 7)
  for (const invalid of ["0", "-1", "1.5", "ten", "9007199254740992"]) {
    assert.throws(
      () => parseBetterAuthDatabasePoolSize(invalid),
      /BETTER_AUTH_DATABASE_POOL_SIZE/,
    )
  }
})

test("Better Auth publishes the pool through the process-global registry", () => {
  const registry = globalThis as typeof globalThis & {
    __smallkhojBetterAuthPostgresPool?: unknown
  }

  assert.equal(registry.__smallkhojBetterAuthPostgresPool, betterAuthPool)
  assert.equal(betterAuthPool.options.max, 10)
})

test("independently evaluated server chunks reuse the same Better Auth pool", async () => {
  const firstUrl = new URL("../lib/auth.ts?pool-singleton-first", import.meta.url).href
  const secondUrl = new URL("../lib/auth.ts?pool-singleton-second", import.meta.url).href
  const first = await import(firstUrl)
  const second = await import(secondUrl)
  const firstPool = (first as Record<string, unknown>)["betterAuthPool"]
  const secondPool = (second as Record<string, unknown>)["betterAuthPool"]

  assert.ok(firstPool)
  assert.equal(firstPool, secondPool)
})
