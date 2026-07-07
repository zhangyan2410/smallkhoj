import type { EventScope } from "./realtime-events"

export type ChatUnreadEntry = {
  count: number
  lastSeq?: number
}

export type ChatUnreadStore = Record<string, ChatUnreadEntry>

export type ChatUnreadEntity = {
  id?: string | null
  name?: string | null
  type?: string | null
  latestSeq?: number | null
  unreadCount?: number | null
  hasUnread?: boolean | null
}

export type ChatReadCursor =
  | {
      scope: { kind: "channel" | "dm"; channelId: string }
      memberId: string
      lastReadSeq: number
    }
  | {
      scope: { kind: "thread"; rootMessageId: string }
      memberId: string
      lastReadSeq: number
      lastSeenMessageId?: string | null
    }

export type ChatReadCursorWriteRequest = {
  scope: { kind: "channel" | "dm"; channelId: string } | { kind: "thread"; rootMessageId: string }
  lastReadSeq: number
  lastSeenMessageId?: string | null
}

export type ChatUnreadView = {
  hasUnread: boolean
  unreadCount?: number
}

export type ChatThreadUnreadEntity = {
  id?: string | null
  threadId?: string | null
  threadUnreadCount?: number | null
  hasThreadUnread?: boolean | null
}

export const CHAT_UNREAD_STORAGE_KEY = "smallkhoj.chat.unread.v1"
export const CHAT_UNREAD_EVENT = "smallkhoj:chat-unread"

function entityKind(value?: string | null) {
  return value === "dm" ? "dm" : "channel"
}

function routeName(value?: string | null) {
  return (value || "").trim().replace(/^#/, "")
}

function addKey(keys: string[], key: string) {
  if (!keys.includes(key)) keys.push(key)
}

export function chatEntityKeys(entity: ChatUnreadEntity): string[] {
  const kind = entityKind(entity.type)
  const keys: string[] = []
  if (entity.id) addKey(keys, `${kind}:id:${entity.id}`)
  const name = routeName(entity.name)
  if (name) addKey(keys, `${kind}:name:${name}`)
  return keys
}

export function chatScopeKeys(scope?: Pick<EventScope, "kind" | "id" | "name"> | null): string[] {
  if (!scope || (scope.kind !== "channel" && scope.kind !== "dm")) return []
  const kind = scope.kind
  const keys: string[] = []
  if (scope.id) addKey(keys, `${kind}:id:${scope.id}`)
  const name = routeName(scope.name)
  if (name) addKey(keys, `${kind}:name:${name}`)
  return keys
}

export function chatReadCursorKey(cursor: ChatReadCursor): string {
  if (cursor.scope.kind === "thread") return `thread:id:${cursor.scope.rootMessageId}`
  return `${cursor.scope.kind}:id:${cursor.scope.channelId}`
}

export function mergeChatReadCursorsIntoEntities<T extends ChatUnreadEntity>(
  entities: T[],
  cursors: ChatReadCursor[],
): Array<T & { unreadCount: number; hasUnread: boolean }> {
  const cursorByKey = new Map(cursors.map((cursor) => [chatReadCursorKey(cursor), cursor]))
  return entities.map((entity) => {
    if (typeof entity.unreadCount === "number") {
      const unreadCount = Math.max(0, entity.unreadCount)
      return {
        ...entity,
        unreadCount,
        hasUnread: Boolean(entity.hasUnread || unreadCount > 0),
      }
    }
    const latestSeq = Math.max(0, entity.latestSeq ?? 0)
    const readSeq = Math.max(
      0,
      ...chatEntityKeys(entity).map((key) => cursorByKey.get(key)?.lastReadSeq ?? 0),
    )
    const unreadCount = Math.max(0, latestSeq - readSeq)
    return {
      ...entity,
      unreadCount,
      hasUnread: unreadCount > 0,
    }
  })
}

export function chatReadCursorRequestForEntity(entity: ChatUnreadEntity): ChatReadCursorWriteRequest | null {
  if (!entity.id || !entity.latestSeq) return null
  const kind = entityKind(entity.type)
  return {
    scope: { kind, channelId: entity.id },
    lastReadSeq: Math.max(0, entity.latestSeq),
  }
}

export function chatReadCursorRequestForThread({
  rootMessageId,
  messages,
}: {
  rootMessageId?: string | null
  messages: Array<{ id?: string | null; seq?: number | null }>
}): ChatReadCursorWriteRequest | null {
  if (!rootMessageId) return null
  let latestMessage: { id?: string | null; seq?: number | null } | null = null
  for (const message of messages) {
    if (!latestMessage || Math.max(0, message.seq ?? 0) > Math.max(0, latestMessage.seq ?? 0)) {
      latestMessage = message
    }
  }
  const lastReadSeq = Math.max(0, latestMessage?.seq ?? 0)
  if (lastReadSeq === 0) return null
  return {
    scope: { kind: "thread", rootMessageId },
    lastReadSeq,
    lastSeenMessageId: latestMessage?.id ?? null,
  }
}

export function hasUnreadThreadActivity(
  message: ChatThreadUnreadEntity,
  localUnreadRootIds: ReadonlySet<string>,
): boolean {
  if (message.hasThreadUnread || (message.threadUnreadCount ?? 0) > 0) return true
  const rootId = message.threadId || message.id
  return Boolean(rootId && localUnreadRootIds.has(rootId))
}

export function incrementChatUnreadForScope(
  store: ChatUnreadStore,
  scope: Pick<EventScope, "kind" | "id" | "name">,
  seq?: number,
): ChatUnreadStore {
  const keys = chatScopeKeys(scope)
  if (keys.length === 0) return store
  const next: ChatUnreadStore = { ...store }
  for (const key of keys) {
    const current = next[key]
    if (typeof seq === "number" && typeof current?.lastSeq === "number" && seq <= current.lastSeq) {
      continue
    }
    next[key] = {
      count: (current?.count ?? 0) + 1,
      lastSeq: seq ?? current?.lastSeq,
    }
  }
  return next
}

export function clearChatUnreadForEntity(store: ChatUnreadStore, entity: ChatUnreadEntity): ChatUnreadStore {
  const keys = chatEntityKeys(entity)
  if (keys.length === 0) return store
  const next: ChatUnreadStore = { ...store }
  for (const key of keys) delete next[key]
  return next
}

export function deriveChatUnreadView(
  entity: ChatUnreadEntity,
  store: ChatUnreadStore,
  currentRouteName?: string | null,
): ChatUnreadView {
  if (routeName(entity.name) === routeName(currentRouteName)) {
    return { hasUnread: false, unreadCount: undefined }
  }
  const localCount = Math.max(0, ...chatEntityKeys(entity).map((key) => store[key]?.count ?? 0))
  const serverCount = Math.max(0, entity.unreadCount ?? 0)
  const unreadCount = Math.max(localCount, serverCount)
  const hasUnread = Boolean(entity.hasUnread || unreadCount > 0)
  return {
    hasUnread,
    unreadCount: unreadCount > 0 ? unreadCount : undefined,
  }
}

export function readChatUnreadStore(storage: Pick<Storage, "getItem"> | undefined): ChatUnreadStore {
  if (!storage) return {}
  try {
    const raw = storage.getItem(CHAT_UNREAD_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as ChatUnreadStore
    if (!parsed || typeof parsed !== "object") return {}
    return parsed
  } catch {
    return {}
  }
}

export function writeChatUnreadStore(storage: Pick<Storage, "setItem"> | undefined, store: ChatUnreadStore) {
  if (!storage) return
  storage.setItem(CHAT_UNREAD_STORAGE_KEY, JSON.stringify(store))
}

export function notifyChatUnreadChanged(target?: Pick<Window, "dispatchEvent">) {
  target?.dispatchEvent(new Event(CHAT_UNREAD_EVENT))
}

export function markChatUnreadScope(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  target: Pick<Window, "dispatchEvent"> | undefined,
  scope: Pick<EventScope, "kind" | "id" | "name">,
  seq?: number,
) {
  const next = incrementChatUnreadForScope(readChatUnreadStore(storage), scope, seq)
  writeChatUnreadStore(storage, next)
  notifyChatUnreadChanged(target)
  return next
}
