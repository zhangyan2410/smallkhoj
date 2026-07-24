export type AuthResult = {
  ok: boolean
  agentId?: string
  error?: string
  code?: string
}

export const AGENT_WEBSOCKET_PROTOCOL = "smallkhoj.agent.v1"
const AGENT_WEBSOCKET_BEARER_PREFIX = "smallkhoj.bearer."
const AGENT_WEBSOCKET_ID_PREFIX = "smallkhoj.agent-id."

export type WebSocketProtocolAuth = {
  authHeader: string
  agentId: string
  selectedProtocol: typeof AGENT_WEBSOCKET_PROTOCOL
}

function decodeBase64Url(value: string) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8")
    if (!decoded || Buffer.from(decoded, "utf8").toString("base64url") !== value) return null
    return decoded
  } catch {
    return null
  }
}

export function parseWebSocketAuthProtocols(
  header: string | string[] | undefined,
): WebSocketProtocolAuth | null {
  const protocols = (Array.isArray(header) ? header.join(",") : header || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
  if (!protocols.includes(AGENT_WEBSOCKET_PROTOCOL)) return null
  const bearerValues = protocols
    .filter((item) => item.startsWith(AGENT_WEBSOCKET_BEARER_PREFIX))
    .map((item) => decodeBase64Url(item.slice(AGENT_WEBSOCKET_BEARER_PREFIX.length)))
  const agentValues = protocols
    .filter((item) => item.startsWith(AGENT_WEBSOCKET_ID_PREFIX))
    .map((item) => decodeBase64Url(item.slice(AGENT_WEBSOCKET_ID_PREFIX.length)))
  if (bearerValues.length !== 1 || agentValues.length !== 1) return null
  const token = bearerValues[0]
  const agentId = agentValues[0]
  if (!token || !agentId) return null
  return {
    authHeader: `Bearer ${token}`,
    agentId,
    selectedProtocol: AGENT_WEBSOCKET_PROTOCOL,
  }
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
