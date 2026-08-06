/**
 * Slock Daemon - Core Types
 * Mirrors opencan-daemon's clean separation: types are plain data, no logic.
 *
 * Based on slock-detail-spec.md Chapter 1 (Data Structure Definitions).
 */

// ════════════════════════════════════════════════════════════════
// 1. Top-level Entities
// ════════════════════════════════════════════════════════════════

/** Top-level isolation unit; each account maps to one Server */
export interface Server {
  id: string;                        // Format: srv_{uuid}
  name: string;
  ownerId: string;                   // Creator member ID
  createdAt: string;                 // ISO 8601
  updatedAt: string;
  version: string;                   // Server version
}

// ── Computer & Daemon Registration ────────────────────────────

/** Physical machine that runs a Daemon */
export interface Computer {
  id: string;                        // Format: comp_{uuid}
  serverId: string;
  name: string;                      // Editable display name
  os: string;                        // Operating system (immutable)
  daemonVersion: string;             // Daemon version (immutable)
  apiKey: string;                    // Machine credential sk_machine_{hash}
  status: ComputerStatus;
  detectedRuntimes: DetectedRuntime[];
  agentWorkspaces: AgentWorkspace[];
  createdAt: string;
  updatedAt: string;
  lastHeartbeatAt?: string;
}

export type ComputerStatus = 'online' | 'offline' | 'idle';

/** Detected AI runtime on a Computer */
export interface DetectedRuntime {
  type: RuntimeType;
  version?: string;
  executablePath?: string;
  // not_installed: 本机 CLI 检测未命中（无需 ccswitch 配置即可得出）。
  status: 'available' | 'running' | 'error' | 'not_installed';
  provider?: string;
  runtimeProvider?: string;
  model?: string;
  source?: string;
}

export type RuntimeType = 'pi' | 'claude_code' | 'codex' | 'codex_cli' | 'codex_acp' | 'opencode' | 'kimi_cli' | 'custom';

/** Agent instance running on a Computer */
export interface AgentWorkspace {
  id: string;                        // Format: ws_{uuid}
  computerId: string;
  agentId: string;                   // Links to AgentMember.id
  runtime: RuntimeType;
  runtimeCommand?: string;
  runtimeModel?: string;
  runtimeProvider?: string;
  status: AgentWorkspaceStatus;
  sessionId?: string;                // Runtime session ID
  cwd?: string;                      // Working directory
  pid?: number;                      // Process ID
  startedAt?: string;
  stoppedAt?: string;
}

export type AgentWorkspaceStatus = 'starting' | 'running' | 'idle' | 'stopped' | 'crashed' | 'restarting';

/** Daemon registration request (submitted during CLI register) */
export interface DaemonRegistration {
  computerId?: string;               // Empty on first registration, present on reconnect
  name: string;
  os: string;
  daemonVersion: string;
  detectedRuntimes: DetectedRuntime[];
}

// ════════════════════════════════════════════════════════════════
// 2. Members
// ════════════════════════════════════════════════════════════════

/** Unified member interface covering both humans and agents */
export type Member = HumanMember | AgentMember;

interface MemberBase {
  id: string;                        // Format: member_{uuid}
  serverId: string;
  displayName: string;
  description?: string;
  avatarUrl?: string;
  status: MemberStatus;
  role: MemberRole;
  createdAt: string;
  updatedAt: string;
}

export type MemberStatus = 'online' | 'idle' | 'offline' | 'suspended';
export type MemberRole = 'owner' | 'admin' | 'member' | 'guest';

/** Human member */
export interface HumanMember extends MemberBase {
  kind: 'human';
  email?: string;
}

/** Agent member */
export interface AgentMember extends MemberBase {
  kind: 'agent';
  computerId: string;                // Computer the agent runs on
  workspaceId?: string;              // Corresponding AgentWorkspace
  backend: string;                   // Runtime backend (e.g. "Claude", "Codex", "Kimi")
  profile: AgentProfile;
  permissions: AgentPermissions;
  actions: AgentActions;
}

// ── Agent Profile, Skills, Actions ────────────────────────────

/** Agent-specific configuration */
export interface AgentProfile {
  skills: Skill[];
  systemInfo?: Record<string, string>;
  workspaceConfig?: string;          // Contents of .slock/ config file
  apps: AppIntegration[];
}

/** Skill loaded from config */
export interface Skill {
  name: string;
  description?: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

/** Skill definition (raw format from config file) */
export interface SkillDefinition {
  name: string;
  description: string;
  trigger: SkillTrigger;
  enabled?: boolean;                 // Default true
  config?: Record<string, unknown>;
}

/** Skill trigger condition */
export type SkillTrigger =
  | { type: 'mention'; pattern: string }
  | { type: 'keyword'; pattern: string }
  | { type: 'channel'; channelPattern: string }
  | { type: 'task'; taskStatus: TaskStatus[] }
  | { type: 'schedule'; cron: string }
  | { type: 'manual' };

/** Third-party app integration */
export interface AppIntegration {
  service: string;                   // Service name (e.g. "github", "notion")
  connected: boolean;
  scopes?: string[];
  connectedAt?: string;
}

/** Fine-grained agent permissions */
export interface AgentPermissions {
  fileRead: boolean;                 // Default true
  fileWrite: boolean;                // Default true
  commandExecution: boolean;         // Default true
  networkAccess: boolean;            // Default true
  sendMessage: boolean;              // Default true
  createTask: boolean;               // Default true
  claimTask: boolean;                // Default true
  inviteMember: boolean;             // Default false
  manageChannel: boolean;            // Default false
  customPermissions?: Record<string, boolean>;
}

/** Agent start/stop controls */
export interface AgentActions {
  paused: boolean;
  pausedAt?: string;
  pausedBy?: string;                 // Operator member ID
  autoRestart: boolean;              // Auto-restart after crash
}

// ════════════════════════════════════════════════════════════════
// 3. Channels
// ════════════════════════════════════════════════════════════════

/** Communication channel */
export interface Channel {
  id: string;                        // Format: ch_{uuid}
  serverId: string;
  name: string;                      // Display name (e.g. "#all", "#window")
  description?: string;
  type: ChannelType;
  creatorId: string;                 // Creator member ID
  members: ChannelMember[];
  createdAt: string;
  updatedAt: string;
  lastMessageAt?: string;
  unreadCount?: number;
}

export type ChannelType = 'public' | 'private' | 'dm';

/** Channel membership relation */
export interface ChannelMember {
  memberId: string;
  joinedAt: string;
  role: ChannelRole;
  lastReadSeq?: number;
  muted: boolean;
}

export type ChannelRole = 'admin' | 'member' | 'guest';

/** DM channel extension */
export interface DMChannel extends Channel {
  type: 'dm';
  participants: [string, string];    // Exactly two member IDs
}

// ════════════════════════════════════════════════════════════════
// 4. Messages
// ════════════════════════════════════════════════════════════════

/** Unified message model */
export interface Message {
  id: string;                        // Format: msg_{timestamp}_{random}
  shortId?: string;
  serverId: string;
  channelId: string;
  target: string;                    // Delivery target (channel name or dm:@xxx)
  sender: string;                    // Sender member ID
  senderType: SenderType;
  content: string;
  contentType: ContentType;
  attachments?: Attachment[];
  threadId?: string;                 // Thread root message ID
  channelType?: ChannelDeliveryType;
  channelName?: string;
  reactions?: Reaction[];
  mentions?: string[];               // @mention member ID list
  seq: number;
  createdAt: string;
  updatedAt?: string;
  editedAt?: string;
}

export type SenderType = 'human' | 'agent' | 'system';
export type ContentType = 'text' | 'markdown' | 'code' | 'rich';
export type ChannelDeliveryType = 'channel' | 'dm' | 'thread';

/** Message attachment */
export interface Attachment {
  id: string;                        // Format: att_{uuid}
  messageId: string;
  fileName: string;
  mimeType: string;
  size: number;                      // Bytes
  url: string;
  previewUrl?: string;
  uploadedBy: string;
  createdAt: string;
}

/** Message reaction */
export interface Reaction {
  emoji: string;
  memberId: string;
  createdAt: string;
}

/** Thread (a collection of messages) */
export interface Thread {
  id: string;                        // Equals the root message ID
  channelId: string;
  rootMessageId: string;
  replyCount: number;
  lastReplyAt?: string;
  participants: string[];            // Member IDs participating in the thread
}

// ════════════════════════════════════════════════════════════════
// 5. Tasks
// ════════════════════════════════════════════════════════════════

/** Task */
export interface Task {
  id: string;                        // Format: task_{uuid}
  number: number;                    // Auto-incrementing display number (e.g. #1, #2)
  serverId: string;
  channelId: string;
  channelName: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority?: TaskPriority;
  creatorId: string;
  creatorType: SenderType;
  assigneeId?: string;
  messageId?: string;                // Linked original message
  threadId?: string;
  tags?: string[];
  data?: Record<string, unknown>;
  statusHistory: StatusTransition[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  closedAt?: string;
  closedBy?: string;
}

/** Task status (state machine) */
export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'closed';

/** Task priority */
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Status transition record */
export interface StatusTransition {
  from: TaskStatus;
  to: TaskStatus;
  changedBy: string;                 // Operator member ID
  changedAt: string;
  reason?: string;
}

/** Create task request */
export interface CreateTaskRequest {
  title: string;
  channel: string;
  assigneeId?: string;
  messageId?: string;
  priority?: TaskPriority;
  tags?: string[];
  data?: Record<string, unknown>;
}

/** Claim task request */
export interface ClaimTaskRequest {
  channel?: string;
  taskNumbers?: number[];
  messageIds?: string[];
  assigneeId?: string;               // Assign to a different member
}

// ════════════════════════════════════════════════════════════════
// 6. Files
// ════════════════════════════════════════════════════════════════

/** File management entry (unified chat attachment storage) */
export interface FileEntry {
  id: string;                        // Format: file_{uuid}
  serverId: string;
  channelId: string;
  messageId?: string;
  uploadedBy: string;                // Uploader member ID
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  url: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  metadata?: FileMetadata;
  createdAt: string;
}

export interface FileMetadata {
  width?: number;
  height?: number;
  duration?: number;                 // Audio/video duration in seconds
  pages?: number;                    // PDF page count
}

// ════════════════════════════════════════════════════════════════
// 7. Activity Log
// ════════════════════════════════════════════════════════════════

/** Agent activity log entry */
export interface ActivityLog {
  id: string;                        // Format: act_{uuid}
  serverId: string;
  agentId: string;
  type: ActivityType;
  description: string;               // Human-readable description
  details?: ActivityDetails;
  channelId?: string;
  taskId?: string;
  timestamp: string;
}

export type ActivityType =
  | 'command_executed'
  | 'file_read'
  | 'file_modified'
  | 'file_created'
  | 'file_deleted'
  | 'message_sent'
  | 'message_received'
  | 'task_claimed'
  | 'task_completed'
  | 'task_status_changed'
  | 'channel_joined'
  | 'channel_left'
  | 'agent_started'
  | 'agent_stopped'
  | 'agent_error'
  | 'permission_denied'
  | 'integration_connected'
  | 'custom';

/** Activity details */
export interface ActivityDetails {
  command?: string;
  exitCode?: number;
  filePath?: string;
  fileSize?: number;
  messageSnippet?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

// ════════════════════════════════════════════════════════════════
// 8. Reminders
// ════════════════════════════════════════════════════════════════

/** Scheduled reminder */
export interface Reminder {
  id: string;                        // Format: rmd_{uuid}
  serverId: string;
  agentId: string;
  title: string;
  description?: string;
  fireAt: string;                    // ISO 8601 trigger time
  status: ReminderStatus;
  repeat?: RepeatConfig;
  channelId?: string;
  messageId?: string;
  taskId?: string;
  data?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  firedAt?: string;                  // Actual fire time
}

export type ReminderStatus = 'pending' | 'fired' | 'cancelled' | 'snoozed';

export interface RepeatConfig {
  pattern: 'daily' | 'weekly' | 'monthly' | 'custom';
  interval?: number;
  cron?: string;
  until?: string;
}

// ════════════════════════════════════════════════════════════════
// 9. Permissions & Roles
// ════════════════════════════════════════════════════════════════

/** Permission definition */
export interface Permission {
  key: string;                       // e.g. "file.write"
  displayName: string;
  description: string;
  category: PermissionCategory;
  defaultValue: boolean;
  agentDefault: boolean;             // Agent default (usually differs from human)
}

export type PermissionCategory =
  | 'file'
  | 'command'
  | 'network'
  | 'message'
  | 'task'
  | 'channel'
  | 'member'
  | 'integration'
  | 'system';

/** Role definition */
export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: Record<string, boolean>; // Permission key -> allowed
  isDefault: boolean;
}

// ════════════════════════════════════════════════════════════════
// 10. Events
// ════════════════════════════════════════════════════════════════

/** Unified event model for WebSocket / SSE push */
export type ServerEvent =
  | MessageEvent
  | TaskEvent
  | MemberEvent
  | ChannelEvent
  | FileEvent
  | ActivityEvent
  | ReminderEvent
  | ConnectionEvent
  | ErrorEvent;

/** Message event */
export interface MessageEvent {
  type: 'message.created' | 'message.updated' | 'message.deleted' | 'message.reaction';
  payload: {
    message: Message;
    channelId: string;
  };
  seq: number;
  timestamp: string;
}

/** Task event */
export interface TaskEvent {
  type: 'task.created' | 'task.claimed' | 'task.updated' | 'task.completed' | 'task.closed';
  payload: {
    taskId: string;
    taskNumber?: number;
    channel: string;
    assigneeId?: string;
    status?: TaskStatus;
    previousStatus?: TaskStatus;
    changedBy: string;
  };
  seq: number;
  timestamp: string;
}

/** Member event */
export interface MemberEvent {
  type: 'member.joined' | 'member.left' | 'member.status_changed' | 'member.profile_updated' | 'member.permissions_changed';
  payload: {
    memberId: string;
    status?: MemberStatus;
    changes?: Record<string, unknown>;
  };
  seq: number;
  timestamp: string;
}

/** Channel event */
export interface ChannelEvent {
  type: 'channel.created' | 'channel.member_joined' | 'channel.member_left';
  payload: {
    channelId: string;
    channelName?: string;
    rosterRevision?: number;
    member?: {
      memberId: string;
      kind: 'human' | 'agent';
      reference: string;
    };
    referenceUpdates?: Array<{ memberId: string; reference: string }>;
    removedAgentId?: string;
  };
  seq: number;
  timestamp: string;
}

/** File event */
export interface FileEvent {
  type: 'file.uploaded' | 'file.deleted';
  payload: {
    fileId: string;
    channelId: string;
    uploadedBy: string;
  };
  seq: number;
  timestamp: string;
}

/** Agent activity event */
export interface ActivityEvent {
  type: 'activity.log';
  payload: ActivityLog;
  seq: number;
  timestamp: string;
}

/** Reminder event */
export interface ReminderEvent {
  type: 'reminder.fired' | 'reminder.created' | 'reminder.cancelled';
  payload: {
    reminderId: string;
    agentId: string;
    title: string;
    channelId?: string;
    taskId?: string;
  };
  seq: number;
  timestamp: string;
}

/** Connection event */
export interface ConnectionEvent {
  type: 'connected' | 'disconnected';
  payload: {
    agentId?: string;
    computerId?: string;
    reason?: string;
  };
  seq: number;
  timestamp: string;
}

/** Error event */
export interface ErrorEvent {
  type: 'error';
  payload: {
    error: string;
    code: string;
    details?: Record<string, unknown>;
  };
  seq: number;
  timestamp: string;
}

/** Event envelope (transport wrapper) */
export interface EventEnvelope {
  id: string;
  event: ServerEvent;
  recipient?: string;                // Target recipient (empty = broadcast)
}

// ════════════════════════════════════════════════════════════════
// 11. Daemon Reserved Types (backward-compatible)
// ════════════════════════════════════════════════════════════════

/** Daemon authentication credential */
export interface Credential {
  agentId: string;
  serverId: string;
  computerId?: string;
  machineId?: string;
  token: string;
  serverUrl: string;
  /** WebSocket endpoint for real-time events */
  wsUrl?: string;
}

/** Daemon runtime configuration */
export interface DaemonConfig {
  agentId: string;
  /** Computer name written by the local Aura Setup step. */
  computerName?: string;
  serverUrl: string;
  wsUrl: string;
  credentialPath: string;
  proxyPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Path to PID file */
  pidFile?: string;
  /** Existing Slock .slock runtime directory to import credentials/proxy from */
  importSlockRuntime?: string;
  /** Path to log file */
  logFile?: string;
  /** Workspace where managed runtime files such as .slock wrappers are written */
  workspacePath?: string;
  /** Runtime driver to start after daemon setup */
  runtime?: RuntimeType;
  /** Runtime executable; defaults to claude for Claude runtime */
  runtimeCommand?: string;
  /** Extra runtime executable args before daemon-managed args */
  runtimeCommandArgs?: string[];
  /** Optional model alias/name for Claude runtime */
  runtimeModel?: string;
  /** Optional agent/persona name for runtimes that support it */
  runtimeAgent?: string;
  /** Local runtime provider/profile selection. Resolved by the daemon, not the server. */
  runtimeProvider?: string;
  /** Resume an existing Claude Code session id */
  runtimeResumeSessionId?: string;
  /** Restart Claude runtime once after an unexpected exit */
  runtimeRestartOnCrash?: boolean;
  /** Busy runtime inactivity threshold before stall recovery; disabled when unset/0 */
  runtimeStallTimeoutMs?: number;
  /** Max ms to wait for the startup warmup slock tool call before degrading to ready; defaults to 120000 */
  runtimeWarmupTimeoutMs?: number;
  /** Register this daemon/computer/workspace with a local Slock-compatible backend */
  daemonRegister?: boolean;
  /** Explicitly allow daemon-managed runtimes to run write-capable Slock/Raft CLI commands */
  allowWrites?: boolean;
  /** Optional comma-separated target allowlist for daemon-managed runtime writes */
  writeTargetAllowlist?: string;
  /** Unix socket path (unused on Windows; falls back to TCP) */
  socketPath?: string;
}

/** Inbox entry for local message queue */
export interface InboxEntry {
  seq: number;
  message: Message;
  read: boolean;
  receivedAt: number; // Date.now()
}

/** Message freshness tracking state */
export interface FreshnessState {
  lastSeenSeq: number;
  pendingCount: number;
  heldMessages: Message[];
}

/** Session info for a running runtime instance */
export interface SessionInfo {
  sessionId: string;
  agentId: string;
  status: 'active' | 'idle' | 'dead';
  cwd: string;
  command: string;
  createdAt: number;
  updatedAt: number;
}

// ════════════════════════════════════════════════════════════════
// Backward-compatible aliases
// ════════════════════════════════════════════════════════════════

/** @deprecated Use Message instead */
export type SlockMessage = Message;

/** @deprecated Use ServerEvent instead */
export type DaemonEvent = ServerEvent;
