/**
 * Minimal Slock Daemon - Core Types
 */

export interface SlockMessage {
  id: string;
  shortId: string;
  target: string;
  sender: string;
  content: string;
  timestamp: string;
  type: 'human' | 'agent' | 'system';
  threadId?: string;
}

export interface Task {
  id: number;
  messageId: string;
  title: string;
  status: 'todo' | 'in_progress' | 'in_review' | 'done';
  assignee?: string;
  channel: string;
}

export interface Credential {
  agentId: string;
  serverId: string;
  token: string;
  serverUrl: string;
  wsUrl: string;
}

export interface DaemonConfig {
  agentId: string;
  serverUrl: string;
  wsUrl: string;
  credentialPath: string;
  proxyPort: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface InboxEntry {
  seq: number;
  message: SlockMessage;
  read: boolean;
}

export type DaemonEvent =
  | { type: 'message'; message: SlockMessage }
  | { type: 'task_claimed'; taskId: number; assignee: string }
  | { type: 'task_updated'; taskId: number; status: string }
  | { type: 'connected' }
  | { type: 'disconnected'; reason: string }
  | { type: 'error'; error: Error };
