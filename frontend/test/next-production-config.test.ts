import assert from "node:assert/strict"
import test from "node:test"

import nextConfig from "../next.config.mjs"

test("production frontend image emits standalone Next server output", () => {
  assert.equal(nextConfig.output, "standalone")
})
