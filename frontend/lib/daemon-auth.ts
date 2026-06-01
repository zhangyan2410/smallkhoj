/**
 * Daemon API Authentication
 * Validates Authorization: Bearer {apiKey} and X-Agent-Id headers
 */

export interface AuthResult {
  ok: boolean
  agentId?: string
  error?: string
  code?: string
}

// In-memory token store (MVP — replace with DB later)
const VALID_TOKENS = new Map<string, string>([
  ["sk_test_aaa", "aaa"],
  ["sk_test_deepseek", "deepseek"],
  ["sk_test_codex", "codex-mac"],
])

export function validateAuth(
  authHeader: string | null,
  agentIdHeader: string | null
): AuthResult {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, error: "Missing or invalid Authorization header", code: "UNAUTHORIZED" }
  }

  const token = authHeader.slice(7)
  if (!token) {
    return { ok: false, error: "Empty Bearer token", code: "UNAUTHORIZED" }
  }

  const expectedAgentId = VALID_TOKENS.get(token)
  if (!expectedAgentId) {
    return { ok: false, error: "Invalid token", code: "UNAUTHORIZED" }
  }

  if (!agentIdHeader) {
    return { ok: false, error: "Missing X-Agent-Id header", code: "UNAUTHORIZED" }
  }

  if (agentIdHeader !== expectedAgentId) {
    return { ok: false, error: "Agent ID mismatch", code: "FORBIDDEN" }
  }

  return { ok: true, agentId: expectedAgentId }
}

export function registerToken(token: string, agentId: string): void {
  VALID_TOKENS.set(token, agentId)
}

export function revokeToken(token: string): void {
  VALID_TOKENS.delete(token)
}
