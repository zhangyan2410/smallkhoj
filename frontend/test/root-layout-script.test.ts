import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("RootLayout uses next/script for the pre-hydration theme script", () => {
  const source = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8")

  assert.match(source, /from "next\/script"/)
  assert.match(source, /strategy="beforeInteractive"/)
  assert.doesNotMatch(source, /<script[\s>]/)
})
