import Link from "next/link"

import { MemberAvatar } from "@/components/member-avatar"
import { getStatusLabel } from "@/lib/agent-status"
import type { Member } from "@/lib/control-plane"

function profileName(member: Member) {
  return member.profile?.displayName || member.displayName
}

function memberHref(member: Member) {
  return `/members?member=${encodeURIComponent(member.id)}`
}

/**
 * Col 1 成员列表 —— server component。
 * agents 在上、humans 在下；当前选中项用左侧高亮条 + 浅蓝底标识。
 * 每个 item 是 <Link>，由 next/link 做客户端路由（不破坏 server-side 数据流）。
 */
export function MembersList({
  members,
  selectedMemberId,
}: {
  members: Member[]
  selectedMemberId?: string | null
}) {
  const agents = members.filter((m) => m.kind === "agent")
  const humans = members.filter((m) => m.kind === "human")

  function renderItem(member: Member) {
    const selected = member.id === selectedMemberId
    return (
      <Link
        key={member.id}
        href={memberHref(member)}
        aria-current={selected ? "page" : undefined}
        className={`group/member relative flex items-center gap-2.5 rounded-none px-2 py-1.5 text-sm transition-colors hover:bg-muted/60 ${
          selected ? "bg-primary/10 text-primary-foreground" : ""
        }`}
      >
        {selected && (
          <span className="absolute inset-y-1 left-0 w-0.5 rounded-r-full bg-primary" />
        )}
        <MemberAvatar member={member} size="sm" />
        <div className="min-w-0 flex-1">
          <div className={`truncate text-sm ${selected ? "font-semibold text-foreground" : "font-medium text-foreground"}`}>
            {profileName(member)}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {getStatusLabel(member.status)}
          </div>
        </div>
      </Link>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-2">
      <section>
        <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Agents
          <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {agents.length}
          </span>
        </h3>
        <div className="flex flex-col gap-0.5">
          {agents.map(renderItem)}
        </div>
      </section>

      {humans.length > 0 && (
        <section>
          <h3 className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Humans
            <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {humans.length}
            </span>
          </h3>
          <div className="flex flex-col gap-0.5">
            {humans.map(renderItem)}
          </div>
        </section>
      )}
    </div>
  )
}