import assert from "node:assert/strict"
import test from "node:test"

import { activeComposerToken, replaceComposerToken } from "../lib/composer-suggestions"

test("active composer token follows the caret for Unicode @ and # tokens", () => {
  assert.deepEqual(activeComposerToken("请问 @张", 5), {
    trigger: "@",
    query: "张",
    start: 3,
    end: 5,
  })
  assert.deepEqual(activeComposerToken("去 #研发", 5), {
    trigger: "#",
    query: "研发",
    start: 2,
    end: 5,
  })
  assert.equal(activeComposerToken("mail@example.com", 16), null)
})

test("suggestion replacement changes only the active caret token", () => {
  const value = "请 @张 看 #general"
  const token = activeComposerToken(value, 4)
  assert.ok(token)
  assert.deepEqual(replaceComposerToken(value, token, "@张翰-s7k2m"), {
    value: "请 @张翰-s7k2m 看 #general",
    caret: 11,
  })
})
