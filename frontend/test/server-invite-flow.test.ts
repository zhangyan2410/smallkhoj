import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("acceptServerInviteAction activates the Server returned by invite acceptance", () => {
  const source = readFileSync(new URL("../app/server-actions.ts", import.meta.url), "utf8")
  const start = source.indexOf("export async function acceptServerInviteAction")
  const end = source.indexOf("export async function logoutAction")
  assert.ok(start >= 0 && end > start)

  const actionSource = source.slice(start, end)
  assert.match(actionSource, /server-invites\/\$\{encodeURIComponent\(token\)\}\/accept/)
  assert.match(actionSource, /setActiveServerCookie\(data\.server\.id\)/)
  assert.match(actionSource, /redirect\("\/members"\)/)
})

test("invite member dialog is link-first and does not claim email delivery", () => {
  const source = readFileSync(new URL("../app/(app)/members/invite-member-dialog.tsx", import.meta.url), "utf8")

  assert.match(source, /manualCopyHint/)
  assert.match(source, /generateInviteLink/)
  assert.match(source, /copyInviteLink/)
  assert.doesNotMatch(source, /email sent/i)
  assert.doesNotMatch(source, /sent email/i)
  assert.doesNotMatch(source, /verification code/i)
})
