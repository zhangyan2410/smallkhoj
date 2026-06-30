import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("currentAccount does not mutate cookies during Server Component render", () => {
  const source = readFileSync(new URL("../lib/server-auth.ts", import.meta.url), "utf8")
  const start = source.indexOf("export async function currentAccount")
  const end = source.indexOf("export async function requireCurrentAccount")
  assert.ok(start >= 0 && end > start)

  const currentAccountSource = source.slice(start, end)
  assert.doesNotMatch(currentAccountSource, /clearActiveServerCookie/)
  assert.doesNotMatch(currentAccountSource, /\.delete\(/)
})

test("serverApiHeaders resolves the account-scoped Server instead of trusting the raw active Server cookie", () => {
  const source = readFileSync(new URL("../lib/server-auth.ts", import.meta.url), "utf8")
  const start = source.indexOf("export async function serverApiHeaders")
  const end = source.indexOf("export async function setSessionCookie")
  assert.ok(start >= 0 && end > start)

  const serverApiHeadersSource = source.slice(start, end)
  assert.match(serverApiHeadersSource, /currentAccount\(/)
  assert.doesNotMatch(serverApiHeadersSource, /getActiveServerId\(/)
})
