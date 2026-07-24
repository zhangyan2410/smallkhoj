import type { PublicEventEnvelope } from "./realtime-events"

export type ChannelFileItem = {
  id: string
  attachmentId: string
  serverId: string
  channelId: string | null
  messageId: string | null
  uploadedBy: string
  fileName: string
  originalName: string
  mimeType: string
  size: number
  url: string
  previewUrl: string | null
  metadata: Record<string, unknown>
  createdAt: string | null
}

export type ChannelFilesPhase = "idle" | "loading" | "ready" | "error"

export type ChannelFilesCleanupWarning = {
  fileId: string
  fileName: string
}

export type ChannelFilesState = {
  scopeKey: string
  generation: number
  files: ChannelFileItem[]
  phase: ChannelFilesPhase
  error: string | null
  removedFileIds: ReadonlySet<string>
  cleanupWarnings: ChannelFilesCleanupWarning[]
}

export type ChannelFilesAction =
  | {
    type: "scopeChanged"
    scopeKey: string
    generation: number
  }
  | {
    type: "loadStarted"
    scopeKey: string
    generation: number
  }
  | {
    type: "loadSucceeded"
    scopeKey: string
    generation: number
    files: ChannelFileItem[]
  }
  | {
    type: "loadFailed"
    scopeKey: string
    generation: number
    error: string
  }
  | {
    type: "fileRemoved"
    scopeKey: string
    fileId: string
    fileName: string
    storageCleanup?: "deleted" | "quarantined"
  }

export function createChannelFilesState(scopeKey: string): ChannelFilesState {
  return {
    scopeKey,
    generation: 0,
    files: [],
    phase: "idle",
    error: null,
    removedFileIds: new Set<string>(),
    cleanupWarnings: [],
  }
}

export function channelFilesReducer(
  state: ChannelFilesState,
  action: ChannelFilesAction,
): ChannelFilesState {
  if (action.type === "scopeChanged") {
    if (action.generation < state.generation) return state
    if (action.scopeKey === state.scopeKey && action.generation === state.generation) return state
    return {
      ...createChannelFilesState(action.scopeKey),
      generation: action.generation,
    }
  }

  if (action.scopeKey !== state.scopeKey) return state

  if (action.type === "loadStarted") {
    if (action.generation < state.generation) return state
    return {
      ...state,
      generation: action.generation,
      phase: "loading",
      error: null,
    }
  }

  if (action.type === "loadSucceeded") {
    if (action.generation !== state.generation) return state
    return {
      ...state,
      files: action.files.filter((file) => !state.removedFileIds.has(file.id)),
      phase: "ready",
      error: null,
    }
  }

  if (action.type === "loadFailed") {
    if (action.generation !== state.generation) return state
    return {
      ...state,
      phase: "error",
      error: action.error,
    }
  }

  const removedFileIds = new Set(state.removedFileIds)
  removedFileIds.add(action.fileId)

  const alreadyWarned = state.cleanupWarnings.some(
    (warning) => warning.fileId === action.fileId,
  )
  const cleanupWarnings = action.storageCleanup === "quarantined" && !alreadyWarned
    ? [...state.cleanupWarnings, { fileId: action.fileId, fileName: action.fileName }]
    : state.cleanupWarnings

  return {
    ...state,
    files: state.files.filter((file) => file.id !== action.fileId),
    removedFileIds,
    cleanupWarnings,
  }
}

export type ChannelFileEventProjection =
  | { kind: "refresh" }
  | { kind: "remove"; fileId: string }
  | { kind: "ignore" }

function normalizedChannelName(value: string | null | undefined) {
  return value?.replace(/^#/, "")
}

function isCurrentChannel(
  event: PublicEventEnvelope,
  current: { channelId?: string | null; channelName?: string | null },
) {
  if (event.scope.kind !== "channel") return false
  const currentName = normalizedChannelName(current.channelName)
  return Boolean(
    (current.channelId && event.scope.id === current.channelId)
    || (currentName && normalizedChannelName(event.scope.name) === currentName),
  )
}

export function projectChannelFileEvent(
  event: PublicEventEnvelope,
  current: { channelId?: string | null; channelName?: string | null },
): ChannelFileEventProjection | null {
  if (event.type !== "file.uploaded" && event.type !== "file.deleted") return null
  if (!isCurrentChannel(event, current)) return { kind: "ignore" }
  if (event.type === "file.uploaded") return { kind: "refresh" }

  const fileId = event.payload.fileId
  return typeof fileId === "string" && fileId.trim().length > 0
    ? { kind: "remove", fileId }
    : { kind: "refresh" }
}
