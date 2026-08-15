import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { AgentEvent, ContentPart, TurnStats, UniversalItem } from './event-schema.js';

// Shared ACP → AgentEvent translator (Part B2). Pure functions, no state: the
// per-session tool-status tracking map lives on the driver instance, not here.
// Both codex and goose consumeUpdate call this so they emit one schema.

type RecordLike = Record<string, unknown>;

function isRecord(value: unknown): value is RecordLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'string' ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined;
  const field = value[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined;
}

/**
 * goose stashes the stable tool name under `_meta.goose.toolCall.toolName`;
 * codex has no `_meta` and the translator falls back to kind/title.
 */
function gooseToolName(update: SessionUpdate): string | undefined {
  const meta = (update as unknown as RecordLike)._meta as RecordLike | undefined;
  const name = (meta?.goose as RecordLike | undefined)?.toolCall as RecordLike | undefined;
  const toolName = (name as RecordLike | undefined)?.toolName;
  return typeof toolName === 'string' && toolName.length > 0 ? toolName : undefined;
}

function toolCallId(update: SessionUpdate): string | undefined {
  return stringField(update, 'toolCallId');
}

/**
 * Normalizes a tool's rawOutput/rawInput into the output string a consumer
 * needs. The hard invariant: aura `message send` stdout JSON MUST be fully
 * recoverable from a tool_result's output, so we never truncate here.
 */
function outputToString(rawOutput: unknown): string | undefined {
  if (typeof rawOutput === 'string') return rawOutput;
  if (rawOutput === undefined || rawOutput === null) return undefined;
  try {
    return JSON.stringify(rawOutput);
  } catch {
    return String(rawOutput);
  }
}

function buildToolItem(
  update: SessionUpdate,
  status: UniversalItem['status'],
  terminal: boolean,
): UniversalItem {
  const callId = toolCallId(update);
  const toolName = gooseToolName(update)
    ?? stringField(update, 'kind')
    ?? stringField(update, 'title');
  const content: ContentPart[] = terminal
    ? [{
        type: 'tool_result',
        output: outputToString((update as unknown as RecordLike).rawOutput),
        isError: status === 'failed',
      }]
    : [{
        type: 'tool_call',
        toolName,
        rawInput: (update as unknown as RecordLike).rawInput,
      }];
  return {
    kind: 'tool_result',
    role: 'user',
    status,
    content,
    ...(callId ? { callId } : {}),
    ...(toolName ? { toolName } : {}),
  };
}

function buildUsageStats(update: SessionUpdate): TurnStats {
  return {
    contextTokens: numberField(update, 'used'),
    contextWindow: numberField(update, 'size'),
  };
}

/**
 * Translates one ACP SessionUpdate into zero or more AgentEvents.
 *
 * - agent_message_chunk → ItemDelta(text)
 * - agent_thought_chunk → ItemDelta(reasoning)   (kept, not dropped)
 * - tool_call → ItemStarted(tool_call, in_progress)
 * - tool_call_update terminal → ItemCompleted(tool_result, completed|failed)
 * - usage_update → SessionEnded-ish stats fragment (caller accumulates)
 * - plan / others → dropped
 */
export function translateAcpSessionUpdate(update: SessionUpdate, sessionId: string): AgentEvent[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const content = (update as unknown as RecordLike).content as RecordLike | undefined;
      const text = stringField(content, 'text');
      if (content?.type === 'text' && typeof text === 'string') {
        return [{
          type: 'item_delta',
          sessionId,
          delta: { type: 'text', text },
          ...(stringField(content, 'messageId') ? { messageId: stringField(content, 'messageId')! } : {}),
        }];
      }
      return [];
    }
    case 'agent_thought_chunk': {
      const content = (update as unknown as RecordLike).content as RecordLike | undefined;
      const text = stringField(content, 'text');
      if (content?.type === 'text' && typeof text === 'string') {
        return [{ type: 'item_delta', sessionId, delta: { type: 'reasoning', text } }];
      }
      return [];
    }
    case 'tool_call': {
      // A tool_call with a terminal status (some agents fire completed
      // immediately) is emitted as completion; otherwise it is a start.
      const rawStatus = stringField(update, 'status');
      if (rawStatus === 'completed' || rawStatus === 'failed') {
        const item = buildToolItem(update, rawStatus, true);
        return [{ type: 'item_completed', sessionId, item }];
      }
      const callId = toolCallId(update);
      const toolName = gooseToolName(update)
        ?? stringField(update, 'kind')
        ?? stringField(update, 'title');
      const item: UniversalItem = {
        kind: 'tool_call',
        role: 'assistant',
        status: 'in_progress',
        content: [{ type: 'tool_call', toolName, rawInput: (update as unknown as RecordLike).rawInput }],
        ...(callId ? { callId } : {}),
        ...(toolName ? { toolName } : {}),
      };
      return [{ type: 'item_started', sessionId, item }];
    }
    case 'tool_call_update': {
      const rawStatus = stringField(update, 'status');
      // Only terminal states produce a completion; non-terminal progress is
      // intentionally not streamed (per the PRD four-field decision table).
      if (rawStatus !== 'completed' && rawStatus !== 'failed') return [];
      const item = buildToolItem(update, rawStatus, true);
      return [{ type: 'item_completed', sessionId, item }];
    }
    case 'usage_update': {
      // Surfaced as a stats-only SessionEnded so the caller can fold it into
      // the turn's final stats / context-window telemetry.
      return [{ type: 'session_ended', sessionId, stats: buildUsageStats(update) }];
    }
    default:
      return [];
  }
}
