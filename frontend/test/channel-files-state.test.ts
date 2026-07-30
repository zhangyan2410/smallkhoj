import assert from "node:assert/strict"
import test from "node:test"

import {
  channelFilesReducer,
  createChannelFilesState,
  projectChannelFileEvent,
  type ChannelFileItem,
} from "../lib/channel-files-state"
import type { PublicEventEnvelope } from "../lib/realtime-events"

function file(id: string, overrides: Partial<ChannelFileItem> = {}): ChannelFileItem {
  return {
    id,
    attachmentId: id,
    serverId: "server-a",
    channelId: "channel-a",
    messageId: null,
    uploadedBy: "member-a",
    fileName: `${id}.txt`,
    originalName: `${id}.txt`,
    mimeType: "text/plain",
    size: 12,
    url: `/files/${id}`,
    previewUrl: null,
    metadata: {},
    createdAt: null,
    ...overrides,
  }
}

function event(
  type: string,
  scope: PublicEventEnvelope["scope"],
  payload: Record<string, unknown> = {},
): PublicEventEnvelope {
  return {
    id: `event-${type}`,
    type,
    scope,
    payload,
    seq: 1,
    epoch: "epoch-a",
  }
}

test("strict file load failure preserves the last successful channel list", () => {
  let state = createChannelFilesState("server-a:channel-a")
  state = channelFilesReducer(state, {
    type: "loadStarted",
    scopeKey: "server-a:channel-a",
    generation: 1,
  })
  state = channelFilesReducer(state, {
    type: "loadSucceeded",
    scopeKey: "server-a:channel-a",
    generation: 1,
    files: [file("file-1")],
  })
  state = channelFilesReducer(state, {
    type: "loadStarted",
    scopeKey: "server-a:channel-a",
    generation: 2,
  })
  state = channelFilesReducer(state, {
    type: "loadFailed",
    scopeKey: "server-a:channel-a",
    generation: 2,
    error: "files unavailable",
  })

  assert.equal(state.phase, "error")
  assert.equal(state.error, "files unavailable")
  assert.deepEqual(state.files.map((item) => item.id), ["file-1"])
})

test("local/event deletion tombstones prevent stale GET resurrection until scope changes", () => {
  let state = createChannelFilesState("server-a:channel-a")
  state = channelFilesReducer(state, {
    type: "loadStarted",
    scopeKey: state.scopeKey,
    generation: 1,
  })
  state = channelFilesReducer(state, {
    type: "loadSucceeded",
    scopeKey: state.scopeKey,
    generation: 1,
    files: [file("file-1"), file("file-2")],
  })
  state = channelFilesReducer(state, {
    type: "loadStarted",
    scopeKey: state.scopeKey,
    generation: 2,
  })
  state = channelFilesReducer(state, {
    type: "fileRemoved",
    scopeKey: state.scopeKey,
    fileId: "file-1",
    fileName: "file-1.txt",
    storageCleanup: "quarantined",
  })
  state = channelFilesReducer(state, {
    type: "loadSucceeded",
    scopeKey: state.scopeKey,
    generation: 2,
    files: [file("file-1"), file("file-2"), file("file-3")],
  })
  state = channelFilesReducer(state, {
    type: "fileRemoved",
    scopeKey: state.scopeKey,
    fileId: "file-1",
    fileName: "file-1.txt",
    storageCleanup: "quarantined",
  })

  assert.deepEqual(state.files.map((item) => item.id), ["file-2", "file-3"])
  assert.deepEqual(state.cleanupWarnings, [{ fileId: "file-1", fileName: "file-1.txt" }])

  const staleState = channelFilesReducer(state, {
    type: "loadSucceeded",
    scopeKey: state.scopeKey,
    generation: 1,
    files: [file("stale")],
  })
  assert.equal(staleState, state)

  const nextScope = channelFilesReducer(state, {
    type: "scopeChanged",
    scopeKey: "server-a:channel-b",
    generation: 3,
  })
  assert.deepEqual(nextScope.files, [])
  assert.deepEqual(nextScope.cleanupWarnings, [])
  assert.equal(nextScope.removedFileIds.size, 0)
})

test("file realtime projection isolates current-channel collection changes", () => {
  const current = { channelId: "channel-a", channelName: "alpha" }

  assert.deepEqual(
    projectChannelFileEvent(
      event("file.deleted", { kind: "channel", id: "channel-a", name: "alpha" }, { fileId: "file-1" }),
      current,
    ),
    { kind: "remove", fileId: "file-1" },
  )
  assert.deepEqual(
    projectChannelFileEvent(
      event("file.uploaded", { kind: "channel", id: "channel-a", name: "alpha" }),
      current,
    ),
    { kind: "refresh" },
  )
  assert.deepEqual(
    projectChannelFileEvent(
      event("file.deleted", { kind: "channel", id: "channel-b", name: "beta" }, { fileId: "foreign" }),
      current,
    ),
    { kind: "ignore" },
  )
  assert.equal(
    projectChannelFileEvent(
      event("message.created", { kind: "channel", id: "channel-b", name: "beta" }),
      current,
    ),
    null,
  )
})
