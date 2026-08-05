import { Play, RotateCcw, Square } from "lucide-react"

import { AvatarObject, SidebarEntityItem } from "@/components/inkframe-object-ui"
import { Button } from "@/components/ui/button"
import { getStatusBucket, getStatusLabel } from "@/lib/agent-status"
import type { Computer, Member } from "@/lib/control-plane"
import { controlMemberLifecycleAction as lifecycleAction } from "./actions"

function profileName(member: Member) {
  return member.kind === "agent"
    ? member.name
    : member.profile?.displayName || member.displayName || member.name
}

function memberHref(member: Member) {
  return `/members?member=${encodeURIComponent(member.id)}`
}

/**
 * 选中 agent 时，在列表项下方展开 start/stop/restart 控制（server action form）。
 * 使用统一的墨边纸质按钮；状态颜色留给 badge，不让操作按钮变成大色块。
 */
function LifecycleControls({ member }: { member: Member }) {
  const workspaceId = member.workspaceId
  if (!workspaceId) return null
  const bucket = getStatusBucket(member.status)
  const canStart = bucket === "OFFLINE" || bucket === "ERROR"
  const canStop = bucket === "ACTIVE" || bucket === "THINKING" || bucket === "STARTING"

  const btn = (action: "start" | "stop" | "restart", Icon: typeof Play, show: boolean) => {
    if (!show) return null
    return (
      <form action={lifecycleAction} className="flex-1">
        <input type="hidden" name="memberId" value={member.id} />
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="action" value={action} />
        <Button type="submit" variant="outline" size="xs" className="w-full bg-[var(--paper)] text-[10px]">
          <Icon className="size-2.5" />
          {action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}
        </Button>
      </form>
    )
  }

  return (
    <div className="flex min-w-0 w-full items-stretch gap-1 overflow-x-hidden pb-1 pl-9 pr-1 pt-0.5">
      {btn("start", Play, canStart)}
      {btn("stop", Square, canStop)}
      {btn("restart", RotateCcw, canStop)}
    </div>
  )
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
      <div key={member.id} className="flex min-w-0 flex-col overflow-x-hidden">
        <SidebarEntityItem
          href={memberHref(member)}
          aria-current={selected ? "page" : undefined}
          data-inkframe-mobile-role="member-entity-item"
          active={selected}
          tone={tone}
          avatar={<AvatarObject member={member} size="sm" />}
          title={profileName(member)}
          subtitle={getStatusLabel(member.status)}
          className={`group/member text-sm ${selected ? activeSoft : ""}`}
        />
        {selected && member.kind === "agent" && member.workspaceId && (
          <LifecycleControls member={member} />
        )}
      </div>
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
    <div data-inkframe-mobile-role="members-list" className="flex min-h-0 min-w-0 flex-col gap-4 overflow-x-hidden p-2">
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
