/**
 * Slock Daemon - Core Types
 * Mirrors opencan-daemon's clean separation: types are plain data, no logic.
 */

// ── Credential ──────────────────────────────────────────────

export interface Credential {
  agentId: string;
  serverId: string;
  token: string;
  serverUrl: string;
  /** WebSocket endpoint for real-time events */
  wsUrl?: string;
}

// ── Daemon Config ───────────────────────────────────────────

export interface DaemonConfig {
  agentId: string;
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
  runtime?: 'none' | 'claude';
  /** Runtime executable; defaults to claude for Claude runtime */
  runtimeCommand?: string;
  /** Extra runtime executable args before daemon-managed args */
  runtimeCommandArgs?: string[];
  /** Optional model alias/name for Claude runtime */
  runtimeModel?: string;
  /** Resume an existing Claude Code session id */
  runtimeResumeSessionId?: string;
  /** Restart Claude runtime once after an unexpected exit */
  runtimeRestartOnCrash?: boolean;
  /** Busy runtime inactivity threshold before stall recovery; disabled when unset/0 */
  runtimeStallTimeoutMs?: number;
  /** Unix socket path (unused on Windows; falls back to TCP) */
  socketPath?: string;
}

// ── Slock Messages ──────────────────────────────────────────

export interface SlockMessage {
  id: string;
  shortId: string;
  target: string;
  sender: string;
  senderType: 'human' | 'agent' | 'system';
  content: string;
  timestamp: string;
  seq: number;
  threadId?: string;
  channelType?: 'channel' | 'dm' | 'thread';
  channelName?: string;
}

// ── Tasks ────────────────────────────────────────────────────

export type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done';

export interface Task {
  id: number;
  messageId: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  channel: string;
}

// ── Inbox ────────────────────────────────────────────────────

export interface InboxEntry {
  seq: number;
  message: SlockMessage;
  read: boolean;
  receivedAt: number; // Date.now()
}

// ── Daemon Events ───────────────────────────────────────────

export type DaemonEvent =
  | { type: 'message'; message: SlockMessage }
  | { type: 'task_claimed'; taskId: number; assignee: string }
  | { type: 'task_updated'; taskId: number; status: TaskStatus }
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'error'; error: string };

// ── Session ──────────────────────────────────────────────────

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  status: 'active' | 'idle' | 'dead';
  cwd: string;
  command: string;
  createdAt: number;
  updatedAt: number;
}

// ── Message freshness ────────────────────────────────────────

export interface FreshnessState {
  lastSeenSeq: number;
  pendingCount: number;
  heldMessages: SlockMessage[];
}
