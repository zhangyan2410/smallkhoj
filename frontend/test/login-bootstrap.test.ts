import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import en from "../messages/en.json"
import zh from "../messages/zh-CN.json"

const readLoginPage = () => readFile(new URL("../app/login/page.tsx", import.meta.url), "utf8")

test("login keeps immutable Name setup and invite return-to in one retryable state machine", async () => {
  const source = await readLoginPage()

  assert.match(source, /type LoginMode = "signin" \| "signup" \| "setup"/)
  assert.match(source, /!raw \|\| !raw\.startsWith\("\/"\) \|\| raw\.startsWith\("\/\/"\)/)
  assert.match(source, /name="returnTo" value=\{returnTo\}/)
  assert.match(source, /if \(mode !== "signin" && !submittedName\)/)
  assert.match(source, /if \(mode !== "setup" && \(!email \|\| !password\)\)/)
  assert.match(source, /mode !== "signin" \? \(\s*<MemberNameField/)
  assert.match(source, /mode !== "setup" \? \(/)

  assert.match(source, /\/api\/v1\/auth\/name-preview\?name=/)
  assert.match(source, /mode === "setup"[\s\S]*auth\.api\.getSession/)
  assert.match(source, /redirect\(loginPathWithError\(returnTo, detail, "setup"\)\)/)
  assert.match(source, /userId: betterAuthUser\.id/)
  assert.match(source, /name: mode === "signin" \? betterAuthUser\.name : canonicalName/)
  assert.match(source, /redirect\(returnTo\)/)

  assert.match(source, /\.\.\.\(returnTo !== "\/" \? \{ returnTo \} : \{\}\)/)
  assert.match(source, /mode: mode === "signin" \? "signup" : "signin"/)
})

test("Chinese-first and English login identity copy cover signup, setup, and return-to", () => {
  const loginKeys = [
    "signUpDescription",
    "setupDescription",
    "nameLabel",
    "namePlaceholder",
    "returnToHint",
    "finishSetup",
  ] as const
  const identityKeys = [
    "nameRequired",
    "nameTooLong",
    "nameInvalidHyphen",
    "nameInvalidCharacter",
    "nameReservedSuffix",
  ] as const

  for (const key of loginKeys) {
    assert.ok(zh.login[key].trim(), `zh.login.${key}`)
    assert.ok(en.login[key].trim(), `en.login.${key}`)
  }
  for (const key of identityKeys) {
    assert.ok(zh.identity[key].trim(), `zh.identity.${key}`)
    assert.ok(en.identity[key].trim(), `en.identity.${key}`)
  }

  assert.match(zh.login.nameLabel, /名字/)
  assert.match(en.login.nameLabel, /Name/)
  assert.match(zh.login.returnToHint, /邀请|页面/)
  assert.match(en.login.returnToHint, /invite|page/i)
})
