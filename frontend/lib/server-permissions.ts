export type ServerPermissionSession = {
  server?: {
    id?: string | null
  } | null
  memberships?: ReadonlyArray<{
    server?: {
      id?: string | null
    } | null
    role?: string | null
    status?: string | null
  }> | null
} | null | undefined

/**
 * Destructive Server management is fail-closed: authority must come from an
 * active owner/admin membership for the Server that the session currently
 * selected. An owner role on another Server never grants access here.
 */
export function canManageActiveServer(session: ServerPermissionSession): boolean {
  const activeServerId = session?.server?.id
  if (!activeServerId || !Array.isArray(session.memberships)) return false

  return session.memberships.some((membership) => (
    membership.server?.id === activeServerId
    && membership.status === "active"
    && (membership.role === "owner" || membership.role === "admin")
  ))
}
