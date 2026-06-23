import assert from "node:assert/strict"
import test from "node:test"

import {
  artifactViewForEntry,
  buildTaskRecoveryModel,
  groupMemoryEntries,
} from "../lib/memory-presentation"
import type { MemoryEntry } from "../lib/control-plane"

function memoryEntry(overrides: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: overrides.id ?? `mem-${Math.random()}`,
    scopeType: overrides.scopeType ?? "task",
    scopeId: overrides.scopeId ?? "task-1",
    path: overrides.path ?? "MEMORY.md",
    title: overrides.title ?? overrides.path ?? "MEMORY.md",
    entryKind: overrides.entryKind ?? "note",
    contentText: overrides.contentText ?? "",
    mimeType: overrides.mimeType ?? "text/markdown",
    sizeBytes: overrides.sizeBytes ?? 0,
    contentSha256: overrides.contentSha256 ?? "abcdef1234567890",
    version: overrides.version ?? 1,
    sourceMessageId: overrides.sourceMessageId ?? null,
    sourceChannelId: overrides.sourceChannelId ?? null,
    sourceThreadId: overrides.sourceThreadId ?? null,
    sourceTaskId: overrides.sourceTaskId ?? null,
    sourcePath: overrides.sourcePath ?? null,
    fileId: overrides.fileId ?? null,
    blobKey: overrides.blobKey ?? null,
    metadata: overrides.metadata ?? {},
    createdAt: overrides.createdAt ?? "2026-06-22T10:00:00Z",
    updatedAt: overrides.updatedAt ?? "2026-06-22T10:00:00Z",
  }
}

test("buildTaskRecoveryModel turns task memory into a compact recovery cockpit", () => {
  const model = buildTaskRecoveryModel([
    memoryEntry({
      path: "brief.md",
      title: "Original task",
      entryKind: "brief",
      contentText: "Build visible channel/task memory.",
    }),
    memoryEntry({
      path: "plan.md",
      title: "Implementation plan",
      entryKind: "plan",
      contentText: [
        "- [x] Add server-owned memory rows",
        "- [ ] Render image/video artifacts",
        "- [ ] Add compaction recovery notes",
      ].join("\n"),
    }),
    memoryEntry({
      path: "progress.md",
      title: "Progress log",
      entryKind: "progress",
      contentText: "Backend and daemon are green; frontend evidence remains.",
    }),
    memoryEntry({
      path: "artifacts/ui-screenshot.png",
      title: "Task screenshot",
      entryKind: "artifact",
      mimeType: "image/png",
      fileId: "file-1",
      contentText: "Visible task memory panel.",
      metadata: { artifactKind: "screenshot" },
      sourcePath: ".trellis/tasks/demo/evidence/ui.png",
      sourceMessageId: "msg-1",
    }),
    memoryEntry({
      path: "evidence/api-proof.md",
      title: "API proof",
      entryKind: "evidence",
      contentText: "GET /api/v1/tasks/task-1/memory returned 200.",
      metadata: { artifactKind: "api_proof" },
    }),
  ])

  assert.equal(model.brief?.path, "brief.md")
  assert.equal(model.plan?.path, "plan.md")
  assert.equal(model.progress?.path, "progress.md")
  assert.deepEqual(model.subtasks.map((item) => [item.done, item.text]), [
    [true, "Add server-owned memory rows"],
    [false, "Render image/video artifacts"],
    [false, "Add compaction recovery notes"],
  ])
  assert.equal(model.outputs.length, 2)
  assert.equal(model.outputs[0].viewer, "image")
  assert.equal(model.outputs[0].href, "/api/v1/attachments/file-1")
  assert.equal(model.outputs[0].sourceLabel, ".trellis/tasks/demo/evidence/ui.png")
  assert.equal(model.outputs[1].viewer, "api_proof")
  assert.equal(model.recoveryCompleteness.hasBrief, true)
  assert.equal(model.recoveryCompleteness.hasPlan, true)
  assert.equal(model.recoveryCompleteness.hasProgress, true)
  assert.equal(model.recoveryCompleteness.hasOutput, true)
})

test("artifactViewForEntry classifies inspectable images videos files and proofs", () => {
  assert.equal(artifactViewForEntry(memoryEntry({ mimeType: "image/png", entryKind: "artifact" })).viewer, "image")
  assert.equal(artifactViewForEntry(memoryEntry({ mimeType: "video/mp4", entryKind: "artifact" })).viewer, "video")
  assert.equal(artifactViewForEntry(memoryEntry({ path: "evidence/trace.md", entryKind: "evidence", metadata: { artifactKind: "trace" } })).viewer, "trace")
  assert.equal(artifactViewForEntry(memoryEntry({ path: "review.md", entryKind: "review" })).viewer, "review")
  assert.equal(artifactViewForEntry(memoryEntry({ path: "notes.md", entryKind: "note" })).viewer, "text")
})

test("groupMemoryEntries promotes channel knowledge and typed outputs into separate display sections", () => {
  const groups = groupMemoryEntries([
    memoryEntry({ scopeType: "channel", path: "MEMORY.md", entryKind: "summary" }),
    memoryEntry({ scopeType: "channel", path: "decisions/runtime-scope.md", entryKind: "decision" }),
    memoryEntry({ scopeType: "channel", path: "references/smallkhoj.md", entryKind: "reference" }),
    memoryEntry({ scopeType: "channel", path: "tasks/task-1/final-summary.md", entryKind: "summary" }),
    memoryEntry({ scopeType: "channel", path: "artifacts/demo.mp4", entryKind: "artifact", mimeType: "video/mp4" }),
    memoryEntry({ scopeType: "channel", path: "promotions/task-1.md", entryKind: "promotion" }),
  ])

  assert.deepEqual(groups.knowledge.map((entry) => entry.path), [
    "MEMORY.md",
    "decisions/runtime-scope.md",
    "references/smallkhoj.md",
  ])
  assert.deepEqual(groups.taskSummaries.map((entry) => entry.path), ["tasks/task-1/final-summary.md"])
  assert.deepEqual(groups.outputs.map((entry) => entry.path), ["artifacts/demo.mp4"])
  assert.deepEqual(groups.promotions.map((entry) => entry.path), ["promotions/task-1.md"])
  assert.equal(groups.other.length, 0)
})
