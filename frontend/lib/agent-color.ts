const AGENT_COLORS = [
  "var(--agent-color-1)",
  "var(--agent-color-2)",
  "var(--agent-color-3)",
  "var(--agent-color-4)",
  "var(--agent-color-5)",
  "var(--agent-color-6)",
]

export function getAgentColor(agentId?: string | null): string {
  const source = agentId || "agent"
  let hash = 0
  for (let i = 0; i < source.length; i += 1) {
    hash = (hash * 31 + source.charCodeAt(i)) >>> 0
  }
  return AGENT_COLORS[hash % AGENT_COLORS.length]
}
