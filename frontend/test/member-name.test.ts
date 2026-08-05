import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { validateMemberName } from "../lib/member-name"

type Fixture = {
  valid: Array<{ input: string; handle: string; handleKey: string }>
  invalid: Array<{ input: string; reasonCode: string }>
}

const fixture = JSON.parse(
  await readFile(new URL("../../contracts/member-name-cases.json", import.meta.url), "utf8"),
) as Fixture

test("frontend member Name validation matches the shared valid fixtures", () => {
  for (const item of fixture.valid) {
    const result = validateMemberName(item.input)
    assert.equal(result.valid, true, item.input)
    assert.equal(result.canonicalName, item.handle, item.input)
    assert.equal(result.canonicalReference, `@${item.handle}`, item.input)
  }
})

test("frontend member Name validation matches the shared invalid fixtures", () => {
  for (const item of fixture.invalid) {
    const result = validateMemberName(item.input)
    assert.equal(result.valid, false, item.input)
    assert.equal(result.reasonCode, item.reasonCode, item.input)
  }
})
