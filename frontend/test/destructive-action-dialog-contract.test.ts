import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

test("shared DialogContent owns one backdrop and a localizable disableable close", async () => {
  const [source, taskFormSource] = await Promise.all([
    readFile(new URL("../components/ui/dialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/task-form-dialogs.tsx", import.meta.url), "utf8"),
  ])

  assert.equal(source.match(/<DialogBackdrop\s*\/>/g)?.length, 1)
  assert.doesNotMatch(taskFormSource, /DialogBackdrop/)
  assert.match(source, /closeLabel\s*=\s*"Close"/)
  assert.match(source, /closeDisabled\s*=\s*false/)
  assert.match(source, /aria-label=\{closeLabel\}/)
  assert.match(source, /disabled=\{closeDisabled\}/)
  assert.match(source, /function DialogClose/)
})

test("destructive dialog exposes confirmation, pending, failure, retry and success contracts", async () => {
  const source = await readFile(
    new URL("../components/destructive-action-dialog.tsx", import.meta.url),
    "utf8",
  )

  assert.doesNotMatch(source, /DialogBackdrop/)
  assert.doesNotMatch(source, /window\.confirm/)
  assert.match(source, /targetName/)
  assert.match(source, /consequence/)
  assert.match(source, /retryLabel/)
  assert.match(source, /failureLabel/)
  assert.match(source, /successLabel\?/)
  assert.match(source, /aria-busy=\{isSubmitting\}/)
  assert.match(source, /role="status"/)
  assert.match(source, /role="alert"/)
  assert.match(source, /closeLabel=\{closeLabel\}/)
  assert.match(source, /closeDisabled=\{isSubmitting\}/)
  assert.match(source, /<DialogClose/)
  assert.match(source, /eventDetails/)
  assert.match(source, /guardDestructiveActionOpenChange/)
  assert.match(source, /gate\.isPending\(\)/)
  assert.match(source, /disabled=\{isSubmitting/)
})
