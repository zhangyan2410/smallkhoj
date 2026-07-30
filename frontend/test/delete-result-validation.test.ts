import assert from "node:assert/strict"
import test from "node:test"

import {
  isFileDeleteResult,
  isTaskDeleteResult,
  type FileDeleteResult,
  type TaskDeleteResult,
} from "../lib/control-plane"

test("Task deletion result validation accepts only a successful matching resource", () => {
  const valid: unknown = { deleted: true, taskId: "task-1", taskNumber: 7 }
  assert.equal(isTaskDeleteResult(valid, "task-1"), true)
  if (isTaskDeleteResult(valid, "task-1")) {
    const typed: TaskDeleteResult = valid
    assert.equal(typed.taskNumber, 7)
  }

  assert.equal(isTaskDeleteResult({ deleted: false, taskId: "task-1", taskNumber: 7 }, "task-1"), false)
  assert.equal(isTaskDeleteResult({ deleted: true, taskId: "task-2", taskNumber: 7 }, "task-1"), false)
  assert.equal(isTaskDeleteResult({ deleted: true, taskId: "task-1", taskNumber: "7" }, "task-1"), false)
  assert.equal(isTaskDeleteResult(null, "task-1"), false)
})

test("File deletion result validation restricts cleanup state and matching resource", () => {
  const deletedValue = {
    deleted: true,
    fileId: "file-1",
    storageCleanup: "deleted",
  }
  const deleted: unknown = deletedValue
  const quarantined: unknown = {
    deleted: true,
    fileId: "file-1",
    storageCleanup: "quarantined",
  }
  assert.equal(isFileDeleteResult(deleted, "file-1"), true)
  assert.equal(isFileDeleteResult(quarantined, "file-1"), true)
  if (isFileDeleteResult(quarantined, "file-1")) {
    const typed: FileDeleteResult = quarantined
    assert.equal(typed.storageCleanup, "quarantined")
  }

  assert.equal(isFileDeleteResult({ ...deletedValue, deleted: false }, "file-1"), false)
  assert.equal(isFileDeleteResult({ ...deletedValue, fileId: "file-2" }, "file-1"), false)
  assert.equal(isFileDeleteResult({ ...deletedValue, storageCleanup: "pending" }, "file-1"), false)
  assert.equal(isFileDeleteResult({}, "file-1"), false)
})
