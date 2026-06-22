import type { Member } from "@/lib/control-plane"

export const AGENT_DRAG_MIME = "application/x-smallkhoj-agent"

export type AgentDragPayload = Pick<Member, "id" | "name" | "displayName" | "handle" | "kind" | "status">

export function serializeAgentDragPayload(member: Member) {
  const payload: AgentDragPayload = {
    id: member.id,
    name: member.name,
    displayName: member.displayName,
    handle: member.handle,
    kind: member.kind,
    status: member.status,
  }
  return JSON.stringify(payload)
}

export function parseAgentDragPayload(value: string): AgentDragPayload | null {
  try {
    const data = JSON.parse(value) as Partial<AgentDragPayload>
    if (!data.id || !data.name) return null
    return {
      id: data.id,
      name: data.name,
      displayName: data.displayName,
      handle: data.handle,
      kind: data.kind ?? "agent",
      status: data.status ?? "offline",
    }
  } catch {
    return null
  }
}
