import { Avatar } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import {
  avatarSourceForMember,
  isAgentMember,
  memberAvatarName,
  statusDotClass,
  type AvatarMember,
} from "@/lib/member-avatar"

type MemberAvatarProps = {
  member: AvatarMember
  size?: "xs" | "sm" | "default" | "lg" | "xl"
  showStatus?: boolean
  className?: string
}

const statusSizeClass: Record<NonNullable<MemberAvatarProps["size"]>, string> = {
  xs: "size-2",
  sm: "size-2.5",
  default: "size-2.5",
  lg: "size-3",
  xl: "size-3",
}

export function MemberAvatar({ member, size = "default", showStatus = true, className }: MemberAvatarProps) {
  const name = memberAvatarName(member)
  const status = member.status || "offline"
  const src = avatarSourceForMember(member)

  return (
    <span data-slot="member-avatar" data-avatar-kind={member.kind || "member"} className="relative inline-flex shrink-0">
      <Avatar name={name} src={src} size={size} className={className} />
      {showStatus ? (
        <span
          aria-label={status}
          data-status={status}
          className={cn(
            "absolute -right-0.5 -top-0.5 rounded-full border-2 border-background shadow-sm",
            statusSizeClass[size],
            statusDotClass(status),
            isAgentMember(member) ? "ring-1 ring-background" : ""
          )}
        />
      ) : null}
    </span>
  )
}
