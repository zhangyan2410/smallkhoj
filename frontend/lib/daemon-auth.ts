export type AuthResult = {
  ok: boolean
  agentId?: string
  error?: string
  code?: string
}

const VALID_TOKENS = new Map<string, string>([
  ["sk_agent_aaa_local", "aaa"],
  ["sk_agent_deepseek_local", "deepseek"],
  ["sk_machine_local", "aaa"],
  ["sk_test_aaa", "aaa"],
  ["sk_test_deepseek", "deepseek"],
])

export function validateAuth(authHeader: string | null, agentIdHeader: string | null): AuthResult {
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, error: "Missing or invalid Authorization header", code: "UNAUTHORIZED" }
  }

  const token = authHeader.slice("Bearer ".length)
  const expectedAgentId = VALID_TOKENS.get(token)
  if (!expectedAgentId) {
    return { ok: false, error: "Invalid token", code: "UNAUTHORIZED" }
  }

  if (!agentIdHeader) {
    return { ok: false, error: "Missing agent id", code: "UNAUTHORIZED" }
  }

  if (token !== "sk_machine_local" && agentIdHeader !== expectedAgentId) {
    return { ok: false, error: "Agent ID mismatch", code: "FORBIDDEN" }
  }

  return { ok: true, agentId: agentIdHeader }
}
