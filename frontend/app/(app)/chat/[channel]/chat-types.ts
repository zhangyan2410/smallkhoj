/**
 * 聊天路由共享的消息/线程类型。channel-client、message-list、composer
 * 都从这里取类型，避免组件文件之间互相 import 形成循环。
 */

export type ThreadSummary = {
  summary?: string | null
  status?: string | null
}

export type ReactionItem = {
  id: string
  reaction: string
  memberId: string
  member: string | null
  createdAt?: string | null
}

export type ChannelMessage = {
  id: string
  shortId?: string
  seq: number
  sender: string
  senderType: string
  content: string
  mentions?: string[]
  time: string
  parentId?: string | null
  threadId?: string
  threadShortId?: string | null
  replyCount?: number
  threadSummary?: ThreadSummary | null
  threadLatestSeq?: number
  threadUnreadCount?: number
  hasThreadUnread?: boolean
  reactions?: ReactionItem[]
  reactionCounts?: Record<string, number>
}

export type ThreadData = {
  thread?: ChannelMessage
  replies?: ChannelMessage[]
  messages?: ChannelMessage[]
  replyCount?: number
  threadSummary?: ThreadSummary | null
}
