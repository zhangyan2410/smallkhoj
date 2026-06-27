import Link from "next/link"

import { MemberAvatar } from "@/components/member-avatar"
import { getStatusLabel } from "@/lib/agent-status"
import type { Computer, Member } from "@/lib/control-plane"

function profileName(member: Member) {
  return member.profile?.displayName || member.displayName
}

function memberHref(member: Member) {
  return `/members?member=${encodeURIComponent(member.id)}`
}

/**
 * Col 1 成员列表 —— server component。
 * agents 按 computer 分组（每个 computer 一个 section，green accent 标题），
 * 未绑定 computer 的 agent 归到"未绑定"区（yellow），humans 单独一区（mint）。
 * 当前选中项用墨边 + accent-soft 底标识（手作风，跟随所在 section 的 tone）。
 */
export function MembersList({
  members,
  computers,
  selectedMemberId,
}: {
  members: Member[]
  computers: Computer[]
  selectedMemberId?: string | null
}) {
  const agents = members.filter((m) => m.kind === "agent")
  const humans = members.filter((m) => m.kind === "human")

  // agents 按 computer 分组：computerId -> agents[]
  const byComputer = new Map<string, Member[]>()
  const unbound: Member[] = []
  for (const a of agents) {
    if (!a.computerId) {
      unbound.push(a)
    } else {
      const list = byComputer.get(a.computerId) ?? []
      list.push(a)
      byComputer.set(a.computerId, list)
    }
  }
  // 按 computer 在列表里的顺序排（已绑 computer 优先）
  const computerGroups = computers
    .map((c) => ({ computer: c, agents: byComputer.get(c.id) ?? [] }))
    .filter((g) => g.agents.length > 0)

  function renderItem(member: Member, tone: "green" | "yellow" | "mint") {
    const selected = member.id === selectedMemberId
    const activeSoft = tone === "green" ? "sk-accent-green-soft" : tone === "yellow" ? "sk-accent-yellow-soft" : "sk-accent-mint-soft"
    return (
      <Link
        key={member.id}
        href={memberHref(member)}
        aria-current={selected ? "page" : undefined}
        className={`group/member flex items-center gap-2.5 rounded-none border-2 px-2 py-1.5 text-sm transition-colors hover:bg-muted/60 ${
          selected ? `border-[var(--ink)] ${activeSoft} font-semibold` : "border-transparent"
        }`}
      >
        <MemberAvatar member={member} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">
            {profileName(member)}
          </div>
          <div className="truncate text-[10px] text-sand-muted">
            {getStatusLabel(member.status)}
          </div>
        </div>
      </Link>
    )
  }

  function sectionTitle(label: string, count: number, tone: "green" | "yellow" | "mint") {
    const titleColor = tone === "green" ? "text-accent-green" : tone === "yellow" ? "text-accent-yellow" : "text-accent-mint"
    const chipClass = tone === "green" ? "sk-accent-green-soft" : tone === "yellow" ? "sk-accent-yellow-soft" : "sk-accent-mint-soft"
    return (
      <h3 className={`flex items-center gap-1.5 px-2 pb-1.5 text-[11px] font-bold uppercase tracking-wider ${titleColor}`}>
        {label}
        <span className={`rounded-none border border-[var(--ink)] px-1 py-0.5 text-[10px] font-semibold ${chipClass}`}>
          {count}
        </span>
      </h3>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-2">
      {computerGroups.map(({ computer, agents: groupAgents }) => (
        <section key={computer.id}>
          {sectionTitle(computer.name, groupAgents.length, "green")}
          <div className="flex flex-col gap-0.5">
            {groupAgents.map((m) => renderItem(m, "green"))}
          </div>
        </section>
      ))}

      {unbound.length > 0 && (
        <section>
          {sectionTitle("未绑定", unbound.length, "yellow")}
          <div className="flex flex-col gap-0.5">
            {unbound.map((m) => renderItem(m, "yellow"))}
          </div>
        </section>
      )}

      {humans.length > 0 && (
        <section>
          {sectionTitle("成员", humans.length, "mint")}
          <div className="flex flex-col gap-0.5">
            {humans.map((m) => renderItem(m, "mint"))}
          </div>
        </section>
      )}
    </div>
  )
}
