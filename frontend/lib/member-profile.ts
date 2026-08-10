/**
 * Member profile display helpers.
 *
 * Extracted from members/page.tsx so the chat member-detail card can reuse the
 * same name/description resolution without duplicating logic.
 *
 * Note: these intentionally differ from lib/member-avatar.ts's `memberAvatarName`,
 * which is tuned for chat-line display (fallback chain leans toward chat context).
 * Profile/detail contexts use `profileName` (agents prefer `name`).
 */

import type { Member } from "@/lib/control-plane"

/** Display name for a profile/detail view. Agents use `name`; humans prefer displayName. */
export function profileName(member: Pick<Member, "kind" | "name" | "displayName" | "profile">) {
  return member.kind === "agent"
    ? member.name
    : member.profile?.displayName || member.displayName || member.name
}

/** Description for a profile/detail view. Falls back to null when absent. */
export function profileDescription(member: Pick<Member, "description" | "profile">) {
  return member.profile?.description ?? member.description
}
