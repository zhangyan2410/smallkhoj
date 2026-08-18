/**
 * 当前正在查看的聊天会话（频道/DM）注册表。
 *
 * chat-sidebar 挂载/切换实体时写入；ActivityUnreadTracker 读取后按
 * channelId 抑制未读递增。存在的原因：DM 事件的 scope.name 是内部名
 * `dm:{idA}-{idB}`（agent_api._display_channel 原样返回 channel.name），
 * 与路由名 `/chat/<对方handle>` 永不相等，纯名字匹配对 DM 全部失效，
 * 导致「正在查看的 DM」消息也积累未读（切走时角标显形）。
 * 模块级状态即可：每个标签页一份，随路由切换即时更新。
 */

export type CurrentChatView = {
  channelId: string
  name?: string
}

let current: CurrentChatView | null = null

export function setCurrentChatView(view: CurrentChatView | null): void {
  current = view
}

export function getCurrentChatView(): CurrentChatView | null {
  return current
}

export function currentChatChannelId(): string | null {
  return current?.channelId ?? null
}
