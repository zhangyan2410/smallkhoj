"use client"

/**
 * 设计预览页（mock 数据，仅用于样式评审，评审后删除）。
 * 覆盖 frontend-handoff-phase1.md 的三个改动点：
 * 1. 创建表单：职责 textarea + 技能 chips
 * 2. 成员详情：职责只读区块 + 技能卡片
 * 3. 权限 tab：manageAgents / installSkills / proposeAgents 三个人话开关
 */

import { useState } from "react"
import { useTranslations } from "next-intl"

import { CreateAgentForm } from "@/components/create-agent-form"
import { SkillChipsSelect } from "@/components/skill-chips-select"
import { AgentRoleBlocks } from "@/components/member-tabs/profile-tab"
import { PermissionsTab } from "@/components/member-tabs/permissions-tab"
import type { AgentSkill, Computer, Member } from "@/lib/control-plane"

const MOCK_SKILLS: AgentSkill[] = [
  {
    id: "skill-web-search",
    name: "web-search",
    version: "1.0.2",
    description: "Search the public web. Use when the answer requires up-to-date information beyond local knowledge.",
  },
  {
    id: "skill-asset-upload",
    name: "资产上传",
    version: "1.0.11",
    description: "任务产物上传到房间资产空间并返回 file-array。Use when a task produces files others need.",
  },
  {
    id: "skill-reminder",
    name: "定时任务",
    version: "1.0.0",
    description: "创建与管理定时提醒。Use when the user asks to schedule or repeat work.",
  },
  {
    id: "skill-memory",
    name: "wy-memory-skill",
    version: "2.1.0",
    description: "跨会话长期记忆读写。Use when the user states preferences or facts worth remembering.",
  },
]

const MOCK_COMPUTER: Computer = {
  id: "computer-preview",
  name: "本地电脑",
  status: "online",
  detectedRuntimes: ["claude_code", "pi"],
  agentWorkspaces: [],
}

const MOCK_MEMBER: Member = {
  id: "member-preview",
  name: "小万预览",
  kind: "agent",
  status: "online",
  systemPrompt:
    "1、日常事务自己接，直接回复\n2、复杂任务把对的事交给对的 Agent 或工具\n3、过程中记住你的偏好和上下文",
  skills: MOCK_SKILLS.slice(0, 3),
  permissions: {
    sendMessage: true,
    createTask: true,
    claimTask: true,
    updateTask: true,
    createReminder: true,
    updateReminder: true,
    fileWrite: true,
    updateProfile: false,
    manageIntegration: false,
    manageAgents: true,
    installSkills: true,
    proposeAgents: true,
  },
  actions: {
    "aura.message": true,
    "aura.task": true,
  },
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  )
}

export default function DesignPreviewPage() {
  const t = useTranslations("chat")
  const [chipsSelected, setChipsSelected] = useState<string[]>(["skill-web-search", "skill-reminder"])

  return (
    <div className="mx-auto max-w-3xl space-y-10 p-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">设计预览 · agent 职责与技能</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Mock 数据，仅评审样式；提交类交互不会写真实数据。
        </p>
      </div>

      <Section title="1. 创建/编辑表单（职责 + 技能 chips）">
        <div className="sk-object-surface p-4">
          <CreateAgentForm
            computers={[MOCK_COMPUTER]}
            providerOptions={[]}
            submitLabel={t("createAgent")}
          />
        </div>
      </Section>

      <Section title="技能 chips 选中态（单独看样式）">
        <div className="sk-object-surface p-4">
          <SkillChipsSelect
            skills={MOCK_SKILLS}
            selectedIds={chipsSelected}
            onToggle={(id) =>
              setChipsSelected((current) =>
                current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
              )
            }
          />
        </div>
      </Section>

      <Section title="2. 成员详情 · 职责与技能（只读）">
        <div className="sk-object-surface p-4">
          <AgentRoleBlocks member={MOCK_MEMBER} />
        </div>
      </Section>

      <Section title="3. 权限开关（三个新能力）">
        <div className="sk-object-surface p-4">
          <PermissionsTab member={MOCK_MEMBER} />
        </div>
      </Section>
    </div>
  )
}
