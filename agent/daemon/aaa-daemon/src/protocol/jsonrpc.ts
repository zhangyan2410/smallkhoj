/**
 * JSON-RPC 2.0 protocol types and helpers.
 * Mirrors opencan-daemon/internal/protocol/jsonrpc.go.
 *
 * Uses \n-delimited framing (one JSON object per line) — no Content-Length header.
 */

// ── ID type ──────────────────────────────────────────────────

export type JSONRPCID = number | string;

export function formatId(id: JSONRPCID): string {
  return typeof id === 'number' ? String(id) : id;
}

export function idsEqual(a: JSONRPCID | null | undefined, b: JSONRPCID | null | undefined): boolean {
  if (a == null || b == null) return a === b;
  return String(a) === String(b);
}

// ── Message ──────────────────────────────────────────────────

export interface JSONRPCMessage {
  jsonrpc: '2.0';
  id?: JSONRPCID | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: JSONRPCError;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

// ── Standard error codes ─────────────────────────────────────

export enum ErrorCode {
  ParseError = -32700,
  InvalidRequest = -32600,
  MethodNotFound = -32601,
  InvalidParams = -32602,
  InternalError = -32603,
  ServerError = -32000, // implementation-defined range starts here
}

// ── Classification ───────────────────────────────────────────

export function isRequest(msg: JSONRPCMessage): boolean {
  return msg.id != null && msg.method != null && msg.result === undefined && msg.error === undefined;
}

export function isNotification(msg: JSONRPCMessage): boolean {
  return msg.id == null && msg.method != null;
}

export function isResponse(msg: JSONRPCMessage): boolean {
  return msg.id != null && (msg.result !== undefined || msg.error !== undefined);
}

export function isError(msg: JSONRPCMessage): boolean {
  return msg.error !== undefined;
}

export function isDaemonMethod(method: string): boolean {
  return method.startsWith('daemon/');
}

// ── Parse / Serialize ────────────────────────────────────────

/**
 * Parse a JSON-RPC line. Returns null for empty/non-JSON lines
 * (allows noise from pty / logs to pass through without crashing).
 */
export function parseLine(line: string): JSONRPCMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === 'object' && obj.jsonrpc === '2.0') {
      return obj as JSONRPCMessage;
    }
    return null;
  } catch {
    // Try fallback: extract ID from possibly malformed line for error response
    return tryRecoverMalformed(line);
  }
}

function tryRecoverMalformed(line: string): JSONRPCMessage | null {
  const idMatch = line.match(/"id"\s*:\s*(\d+|"[^"]*")/);
  if (!idMatch) return null;
  let id: JSONRPCID;
  try {
    id = JSON.parse(idMatch[1]);
  } catch {
    return null;
  }
  return {
    jsonrpc: '2.0',
    id,
    error: { code: ErrorCode.ParseError, message: 'Parse error' },
  };
}

export function serialize(msg: JSONRPCMessage): string {
  return JSON.stringify(msg) + '\n';
}

// ── Builders ─────────────────────────────────────────────────

export function buildRequest(id: JSONRPCID, method: string, params?: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', id, method, params };
}

export function buildNotification(method: string, params?: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', method, params };
}

export function buildResponse(id: JSONRPCID, result: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', id, result };
}

export function buildError(id: JSONRPCID | null, code: number, message: string, data?: unknown): JSONRPCMessage {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

// ── Param helpers ────────────────────────────────────────────

export function extractStringParam(params: unknown, key: string): string | undefined {
  if (params && typeof params === 'object' && key in (params as Record<string, unknown>)) {
    const val = (params as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : undefined;
  }
  return undefined;
}

export function setParam(params: Record<string, unknown> | undefined, key: string, value: unknown): Record<string, unknown> {
  return { ...(params ?? {}), [key]: value };
}
