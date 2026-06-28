import Link from "next/link"
import { Play, RotateCcw, Square } from "lucide-react"

import { MemberAvatar } from "@/components/member-avatar"
import { getStatusBucket, getStatusLabel } from "@/lib/agent-status"
import type { Computer, Member } from "@/lib/control-plane"
import { controlMemberLifecycleAction as lifecycleAction } from "./actions"

function profileName(member: Member) {
  return member.profile?.displayName || member.displayName
}

function memberHref(member: Member) {
  return `/members?member=${encodeURIComponent(member.id)}`
}

/**
 * 选中 agent 时，在列表项下方展开 start/stop/restart 控制（server action form）。
 * 跟随 section tone 着色：start=success 绿、stop=danger 红、restart=neutral。
 */
function LifecycleControls({ member, tone }: { member: Member; tone: "green" | "yellow" | "mint" }) {
  const workspaceId = member.workspaceId
  if (!workspaceId) return null
  const bucket = getStatusBucket(member.status)
  const canStart = bucket === "OFFLINE" || bucket === "ERROR"
  const canStop = bucket === "ACTIVE" || bucket === "THINKING" || bucket === "STARTING"

  const btn = (action: "start" | "stop" | "restart", Icon: typeof Play, show: boolean, cls: string) => {
    if (!show) return null
    return (
      <form action={lifecycleAction} className="flex-1">
        <input type="hidden" name="memberId" value={member.id} />
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="action" value={action} />
        <button type="submit" className={`inline-flex w-full items-center justify-center gap-1 rounded-none border-2 border-[var(--ink)] px-1.5 py-1 text-[10px] font-medium transition-colors ${cls}`}>
          <Icon className="size-2.5" />
          {action === "start" ? "启动" : action === "stop" ? "停止" : "重启"}
        </button>
      </form>
    )
  }

  return (
    <div className="flex w-full items-stretch gap-1 pb-1 pl-9 pr-1 pt-0.5">
      {btn("start", Play, canStart, "sk-status-success")}
      {btn("stop", Square, canStop, "sk-status-danger")}
      {btn("restart", RotateCcw, canStop, "sk-cat-neutral")}
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
      <div key={member.id} className="flex flex-col">
        <Link
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
        {selected && member.kind === "agent" && member.workspaceId && (
          <LifecycleControls member={member} tone={tone} />
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
