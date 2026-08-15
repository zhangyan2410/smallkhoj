// Structured agent event schema (Part B). Replaces the lossy "pseudo-Anthropic
// envelope + regex diagnostics" path: ACP SessionUpdates are translated into
// this discriminated union once, and every daemon consumer reads the same
// typed events. Tool failures arrive as `status: 'failed'` instead of being
// guessed by scanning text.
//
// Design (from the grilled PRD): a NAP UniversalEvent-derived shape with four
// deliberate decisions — only terminal tool states are emitted, reasoning is
// kept as a delta (downgraded usage), structured diff/image output is dropped
// (but tool stdout stays fully recoverable), and stop_reason is passed through.

export type ItemKind = 'message' | 'tool_call' | 'tool_result';
export type ItemRole = 'assistant' | 'user';
export type ItemStatus = 'in_progress' | 'completed' | 'failed';

export interface UniversalItem {
  kind: ItemKind;
  role: ItemRole;
  status: ItemStatus;
  content: ContentPart[];
  /** Correlates a tool_call with its tool_result across events. */
  callId?: string;
  /** Stable tool name (goose _meta preferred, falls back to kind/title). */
  toolName?: string;
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_call'; toolName?: string; rawInput?: unknown }
  | { type: 'tool_result'; output?: string; isError?: boolean }
  | { type: 'status'; status: string };

export interface TurnStats {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  contextTokens?: number;
  contextWindow?: number;
  costUsd?: number;
}

// --- discriminated union: type → payload is exhaustive at compile time ---

export interface SessionStartedEvent {
  type: 'session_started';
  sessionId: string;
}

export interface ItemStartedEvent {
  type: 'item_started';
  sessionId: string;
  item: UniversalItem;
}

export interface ItemDeltaEvent {
  type: 'item_delta';
  sessionId: string;
  /** Correlates a delta with the tool item it belongs to, when applicable. */
  callId?: string;
  delta: { type: 'text'; text: string } | { type: 'reasoning'; text: string };
  /** Forwarded from agent_message_chunk so message-id recovery still works. */
  messageId?: string;
}

export interface ItemCompletedEvent {
  type: 'item_completed';
  sessionId: string;
  item: UniversalItem;
}

export interface SessionEndedEvent {
  type: 'session_ended';
  sessionId: string;
  stopReason?: string;
  stats?: TurnStats;
}

export interface ErrorEvent {
  type: 'error';
  sessionId?: string;
  message: string;
}

export type AgentEvent =
  | SessionStartedEvent
  | ItemStartedEvent
  | ItemDeltaEvent
  | ItemCompletedEvent
  | SessionEndedEvent
  | ErrorEvent;

export type AgentEventType = AgentEvent['type'];
