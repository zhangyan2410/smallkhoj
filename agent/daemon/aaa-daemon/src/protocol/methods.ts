/**
 * Method constants — centralized definition of all JSON-RPC method names.
 * Mirrors opencan-daemon/internal/protocol/router.go.
 */

// ── Daemon methods (exposed to clients via proxy) ────────────

export const DaemonMethods = {
  /** Health check / handshake */
  Hello: 'daemon/hello',

  /** Probe whether an external command is a valid ACP agent */
  AgentProbe: 'daemon/agent.probe',

  // ── Sessions ───────────────────────────────────────────

  /** List known sessions (managed + loadable external) */
  SessionList: 'daemon/session.list',

  /** Kill a running session */
  SessionKill: 'daemon/session.kill',

  // ── Conversations ──────────────────────────────────────

  /** Create a new conversation session from a launch command */
  ConversationCreate: 'daemon/conversation.create',

  /** Open (attach to) an existing conversation */
  ConversationOpen: 'daemon/conversation.open',

  /** Detach from a conversation without killing it */
  ConversationDetach: 'daemon/conversation.detach',

  /** List all conversations */
  ConversationList: 'daemon/conversation.list',

  // ── Logs ───────────────────────────────────────────────

  /** Retrieve daemon log buffer */
  Logs: 'daemon/logs',

  // ── Message operations (Slock-specific) ────────────────

  /** Send a message to a channel/DM */
  MessageSend: 'daemon/message.send',

  /** Check for new messages (non-blocking) */
  MessageCheck: 'daemon/message.check',

  /** Read message history */
  MessageRead: 'daemon/message.read',

  /** Search messages */
  MessageSearch: 'daemon/message.search',

  /** Add/remove reaction */
  MessageReact: 'daemon/message.react',

  // ── Task operations (Slock-specific) ───────────────────

  TaskList: 'daemon/task.list',
  TaskCreate: 'daemon/task.create',
  TaskClaim: 'daemon/task.claim',
  TaskUnclaim: 'daemon/task.unclaim',
  TaskUpdate: 'daemon/task.update',

  // ── Channel operations (Slock-specific) ────────────────

  ServerInfo: 'daemon/server.info',
  ChannelMembers: 'daemon/channel.members',
  ChannelJoin: 'daemon/channel.join',
  ChannelLeave: 'daemon/channel.leave',
  ThreadFollow: 'daemon/thread.follow',
  ThreadUnfollow: 'daemon/thread.unfollow',

  // ── Profile / integration / reminder / attachment operations ─

  ProfileGet: 'daemon/profile.get',
  ProfileUpdate: 'daemon/profile.update',
  IntegrationList: 'daemon/integration.list',
  IntegrationLogin: 'daemon/integration.login',
  ReminderList: 'daemon/reminder.list',
  ReminderCreate: 'daemon/reminder.create',
  ReminderSchedule: 'daemon/reminder.schedule',
  ReminderUpdate: 'daemon/reminder.update',
  ReminderCancel: 'daemon/reminder.cancel',
  ReminderDelete: 'daemon/reminder.delete',
  AttachmentView: 'daemon/attachment.view',
  AttachmentDownload: 'daemon/attachment.download',
  AttachmentUpload: 'daemon/attachment.upload',
  KnowledgeList: 'daemon/knowledge.list',
  KnowledgeGet: 'daemon/knowledge.get',
  KnowledgeSearch: 'daemon/knowledge.search',
} as const;

// ── ACP methods (internal, forwarded to agent process) ────────

export const ACPMethods = {
  Initialize: 'initialize',
  SessionNew: 'session/new',
  SessionPrompt: 'session/prompt',
  SessionUpdate: 'session/update',
  SessionList: 'session/list',
  SessionLoad: 'session/load',
} as const;

// ── Internal notifications (daemon → client) ─────────────────

export const NotificationMethods = {
  /** New message arrived */
  MessageReceived: 'message_received',

  /** Daemon attached to client transport */
  Attached: 'daemon/attached',

  /** Session state changed */
  SessionChanged: 'daemon/session.changed',

  /** Task state changed */
  TaskChanged: 'daemon/task.changed',
} as const;

export type DaemonMethod = (typeof DaemonMethods)[keyof typeof DaemonMethods];
export type ACPMethod = (typeof ACPMethods)[keyof typeof ACPMethods];
