/**
 * 聊天草稿状态层：按「作用域键」持久化输入框未发送的文字。
 *
 * 解决的问题：ChatComposer / ThreadComposer 的输入文字原本是组件内部
 * useState，导航离开 /chat/<channel> 路由段后组件卸载、state 销毁，
 * 回到页面时草稿丢失。这里把草稿落到 localStorage，按 channel/thread
 * 作用域键存取，刷新 / 切页 / 跨标签页都能恢复。
 *
 * 与 activity-unread-state.ts 同构：版本化 key、纯函数读写、自定义事件
 * 广播让同标签页多 hook 实例同步，跨标签页靠 storage 事件。hydration
 * 安全由 use-chat-draft hook 保证（首渲用空串，挂载后再读 localStorage）。
 */

export type ChatDraftStore = Record<string, string>

export const CHAT_DRAFT_STORAGE_KEY = "smallkhoj.chat.draft.v1"
export const CHAT_DRAFT_EVENT = "smallkhoj:chat-draft"

/** 草稿上限，避免长文本撑爆 localStorage（写失败时静默丢弃，不抛错）。 */
const DRAFT_MAX_LENGTH = 10_000

function parseStore(raw: string | null): ChatDraftStore {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as ChatDraftStore
    if (!parsed || typeof parsed !== "object") return {}
    return parsed
  } catch {
    return {}
  }
}

export function readChatDraftStore(
  storage: Pick<Storage, "getItem"> | undefined,
): ChatDraftStore {
  if (!storage) return {}
  return parseStore(storage.getItem(CHAT_DRAFT_STORAGE_KEY))
}

export function writeChatDraftStore(
  storage: Pick<Storage, "setItem"> | undefined,
  store: ChatDraftStore,
) {
  if (!storage) return
  try {
    storage.setItem(CHAT_DRAFT_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // 配额不足或隐私模式：草稿写不进去，宁可丢草稿也不抛错影响发送。
  }
}

export function notifyChatDraftChanged(target?: Pick<Window, "dispatchEvent">) {
  target?.dispatchEvent(new Event(CHAT_DRAFT_EVENT))
}

/** 读取某个作用域键的草稿（无则空串）。 */
export function readChatDraft(
  storage: Pick<Storage, "getItem"> | undefined,
  scopeKey: string,
): string {
  return readChatDraftStore(storage)[scopeKey] ?? ""
}

/**
 * 写入/更新某个作用域键的草稿。空串等价于清除该键（不保留空条目）。
 * 基于 localStorage 最新快照写入，避免与其它 hook 实例的内存副本产生竞态。
 */
export function setChatDraft(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  target: Pick<Window, "dispatchEvent"> | undefined,
  scopeKey: string,
  value: string,
): ChatDraftStore {
  if (!storage) return {}
  const next = readChatDraftStore(storage)
  const trimmed = value.length > DRAFT_MAX_LENGTH ? value.slice(0, DRAFT_MAX_LENGTH) : value
  if (trimmed) {
    next[scopeKey] = trimmed
  } else {
    delete next[scopeKey]
  }
  writeChatDraftStore(storage, next)
  notifyChatDraftChanged(target)
  return next
}

/** 清除某个作用域键的草稿。无该键时是空操作，不广播。 */
export function clearChatDraft(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  target: Pick<Window, "dispatchEvent"> | undefined,
  scopeKey: string,
): ChatDraftStore {
  if (!storage) return {}
  const latest = readChatDraftStore(storage)
  if (!(scopeKey in latest)) return latest
  const next = { ...latest }
  delete next[scopeKey]
  writeChatDraftStore(storage, next)
  notifyChatDraftChanged(target)
  return next
}
