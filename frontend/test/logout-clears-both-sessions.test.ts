import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

// Regression guard for the "exit → setup dead-end" bug: logoutAction used to
// clear only the SmallKhoj session (A) and leave the better-auth session (B)
// intact, so /login saw a live B, forced immutable-name "setup" mode, hid the
// sign-in entry, and the user could not log into a second account.
//
// Logout must clear BOTH layers. auth.api.signOut deletes the better-auth DB
// session + cookie; clearSessionCookie deletes the SmallKhoj cookies. The
// better-auth call is wrapped so a stale/dirty B never blocks A cleanup.

const readServerActions = () =>
  readFile(new URL("../app/server-actions.ts", import.meta.url), "utf8")

test("logoutAction clears both better-auth (B) and SmallKhoj (A) session layers", async () => {
  const source = await readServerActions()

  // imports both auth layers
  assert.match(source, /import \{ auth \} from "@\/lib\/auth"/)
  assert.match(source, /clearSessionCookie/)

  // better-auth signOut is wired through the shared cleanup and is best-effort
  assert.match(source, /auth\.api\.signOut\(\{ headers: await headers\(\) \}\)/)
  assert.match(source, /try \{[\s\S]*?auth\.api\.signOut[\s\S]*?\} catch/)

  // logoutAction delegates to the shared all-session cleanup, then redirects
  assert.match(source, /export async function logoutAction\(\) \{[\s\S]*?clearAllSessions\(\)[\s\S]*?redirect\("\/login"\)/)
})

test("switchAccountAction gives the setup screen a force-clear escape hatch back to sign-in", async () => {
  const source = await readServerActions()

  assert.match(source, /export async function switchAccountAction\(\) \{[\s\S]*?clearAllSessions\(\)[\s\S]*?redirect\("\/login\?mode=signin"\)/)
})
